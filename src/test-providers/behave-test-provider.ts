import * as vscode from "vscode";
import { FeatureParser } from "../parsers/feature-parser";
import { TestExecutor } from "../core/test-executor";
import { TestOrganizationStrategy, BehaveExtensionContext } from "../types";
import { Logger } from "../utils/logger";
import { ExtensionConfig } from "../core/extension-config";
import { TestDiscoveryManager } from "../core/test-discovery-manager";
import { TestOrganizationManager } from "../core/test-organization";
import * as path from 'path';
import { TestItemMapping, ScenarioResultLookup } from "../utils/test-item-mapping";
import { TestTreeBuilder } from "./test-tree-builder";
import { testExplorerRunPlan } from "./test-explorer-run-plan";
import { TestDiscoveryLifecycle } from "./test-discovery-lifecycle";
import { BehaveJsonParser } from "../utils/behave-json-parser";
import { PytestResultParser } from "../utils/pytest-result-parser";
import { CucumberJsonParser } from "../utils/cucumber-json-parser";
import { projectForFile } from "../core/project-context";
import { FrameworkFactory } from "../core/framework-factory";

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export class BehaveTestProvider {
  private readonly testController: vscode.TestController;
  private readonly discoveredTests: Map<string, vscode.TestItem>;
  private readonly treeBuilder: TestTreeBuilder;
  private readonly context: BehaveExtensionContext;
  private testStatusCache: Map<string, "started" | "passed" | "failed"> =
    new Map();
  private readonly testStatusByLocation: Map<string, "started" | "passed" | "failed"> =
    new Map();
  private isTestRunning = false;
  private readonly discovery: TestDiscoveryLifecycle;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly fileWatchers: vscode.FileSystemWatcher[] = [];
  private watchedPatterns = "";
  private autoDiscover: boolean;
  private disposed = false;
  private disposal: Promise<void> | undefined;
  private runCancellation: vscode.CancellationTokenSource | undefined;
  private readonly ownsContext: boolean;
  private observedDiscovery: Promise<void> | undefined;
  // Store scenario outline parent-child relationships for hierarchy view
  private scenarioOutlineParents = new Map<string, string>(); // exampleId -> parentId

  public static create(testController: vscode.TestController, context?: BehaveExtensionContext): BehaveTestProvider {
    return new BehaveTestProvider(testController, context);
  }

  private createDefaultContext(): BehaveExtensionContext {
    const config = ExtensionConfig.create();
    let commandBuilder: BehaveExtensionContext["commandBuilder"];
    try {
      commandBuilder = FrameworkFactory.createCommandBuilder(config.getFramework(), config);
    } catch (error) {
      config.dispose();
      throw error;
    }
    const logger = new Logger();
    const testExecutor = TestExecutor.create(undefined, undefined, undefined, config, logger);
    const discoveryManager = TestDiscoveryManager.create(logger, config);
    const organizationManager = TestOrganizationManager.create(logger);
    const featureParser = FeatureParser.create(logger);
    const behaveJsonParser = BehaveJsonParser.create(logger);
    const pytestResultParser = PytestResultParser.create(logger);
    const cucumberJsonParser = CucumberJsonParser.create(logger);
    const testItemMapping = TestItemMapping.create();

    return {
      logger,
      config,
      testExecutor,
      discoveryManager,
      organizationManager,
      featureParser,
      behaveJsonParser,
      pytestResultParser,
      cucumberJsonParser,
      testItemMapping,
      commandBuilder
    };
  }

  constructor(testController: vscode.TestController, context?: BehaveExtensionContext) {
    this.testController = testController;
    this.discoveredTests = new Map();
    this.ownsContext = !context;
    this.context = context ?? this.createDefaultContext();
    this.autoDiscover = this.automaticDiscoveryEnabled();
    this.treeBuilder = new TestTreeBuilder(
      this.testController,
      this.context,
      this.discoveredTests,
      this.scenarioOutlineParents
    );
    this.discovery = new TestDiscoveryLifecycle(async (isCurrent, token) => {
      await this.treeBuilder.discoverTests(isCurrent, token);
      if (isCurrent()) {this.restoreTestStatus();}
    });
    this.setupTestController();
    this.setupFileWatcher();
    this.disposables.push(this.context.config.addChangeListener(() => this.updateDiscoverySettings()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.updateDiscoverySettings()));
  }

  private setupTestController(): void {
    this.testController.resolveHandler = async (test) => {
      if (!test) {
        await this.discoverTests();
      }
    };

    this.testController.refreshHandler = () => this.discoverTests();

    const runProfile = this.testController.createRunProfile(
      "Run",
      vscode.TestRunProfileKind.Run,
      async (request, token) => {
        await this.runTests(request, token);
      }
    );
    runProfile.configureHandler = () => {};

    const debugProfile = this.testController.createRunProfile(
      "Debug",
      vscode.TestRunProfileKind.Debug,
      async (request, token) => {
        await this.debugTests(request, token);
      }
    );
    debugProfile.configureHandler = () => {};
    this.disposables.push(runProfile, debugProfile);
  }

  public updateTestStatus(
    testId: string,
    status: "started" | "passed" | "failed"
  ): void {
    this.testStatusCache.set(testId, status);

    const locationKey = this.getLocationKey(testId);
    if (locationKey) {
      this.testStatusByLocation.set(locationKey, status);
    }

    // Only update parents in hierarchy view
    if (this.getOrganizationStrategy().strategyType === "FeatureBasedOrganization") {
      const parentId = this.scenarioOutlineParents.get(testId);
      if (parentId) {
        const childFeatureFile = this.extractFeatureFileFromTestId(testId);
        const parentFeatureFile = this.extractFeatureFileFromTestId(parentId);
        if (childFeatureFile && parentFeatureFile && childFeatureFile === parentFeatureFile) {
          this.updateScenarioOutlineParentStatus(parentId);
        }
      }
    }
  }

  private getLocationKey(testId: string): string | null {
    // Extract file path and line number from test ID.
    // Test IDs are typically `filepath:lineNumber` (or `filepath`), where the
    // file path may itself contain a colon (Windows drive letter), so line
    // numbers must be parsed from the right — a naive split(":") would return
    // the drive letter and drop the line number.
    if (!testId) {
      return null;
    }
    const match = /^(.*?):(\d+)(?::\d+)?$/.exec(testId);
    if (match) {
      return `${match[1]}:${match[2]}`;
    }
    // Feature-file or outline IDs carry no line number; they are already
    // location-unique, so use them as-is.
    return testId;
  }

  private restoreTestStatus(): void {
    if (this.testStatusByLocation.size === 0) {
      return;
    }

    const restoreStatusRecursively = (testItem: vscode.TestItem) => {
      const locationKey = this.getLocationKey(testItem.id);
      let cachedStatus = locationKey
        ? this.testStatusByLocation.get(locationKey)
        : undefined;

      cachedStatus ??= this.testStatusCache.get(testItem.id);

      if (cachedStatus) {
        const run = this.testController.createTestRun(
          new vscode.TestRunRequest([testItem])
        );

        switch (cachedStatus) {
          case "started":
            run.started(testItem);
            break;
          case "passed":
            run.passed(testItem);
            break;
          case "failed":
            run.failed(testItem, new vscode.TestMessage("Test failed"));
            break;
        }

        run.end();
      }

      testItem.children.forEach(restoreStatusRecursively);
    };

    this.testController.items.forEach(restoreStatusRecursively);
  }

  public discoverTests(): Promise<void> {
    return this.discovery.refresh();
  }

  private observeDiscovery(pending: Promise<void>): void {
    if (this.observedDiscovery === pending) {return;}
    this.observedDiscovery = pending;
    const clear = () => {if (this.observedDiscovery === pending) {this.observedDiscovery = undefined;}};
    pending.then(clear, (error) => {
      clear();
      if (!this.disposed) {this.reportDiscoveryError(error);}
    });
  }

  private reportDiscoveryError(error: unknown): void {
    const message = errMsg(error);
    this.context.logger.error("Test discovery failed", { error: message, pattern: this.context.config.testFilePattern });
    vscode.window.showErrorMessage(`Test discovery failed: ${message}. Please check your configuration and refresh tests.`);
  }

  // Retained for callers adding an explicit file outside workspace discovery.
  public async addFeatureFileToTestController(file: vscode.Uri): Promise<void> {
    if (this.disposed) {return;}
    await this.treeBuilder.addFeatureFileToTestController(file, () => !this.disposed);
  }

  public refreshTests(): Promise<void> {
    return this.discovery.refresh({ invalidate: true });
  }

  public forceRefreshTestExplorer(): Promise<void> {
    return this.refreshTests();
  }

  public getDiscoveredTests(): Map<string, vscode.TestItem> {
    return this.discoveredTests;
  }

  public getCacheStats(): ReturnType<
    typeof this.context.discoveryManager.getCacheStats
  > {
    return this.context.discoveryManager.getCacheStats();
  }

  public setOrganizationStrategy(strategy: TestOrganizationStrategy): void {
    try {
      this.context.organizationManager.setStrategy(strategy);
      this.context.logger.info("Test organization strategy changed", {
        strategy: strategy.constructor.name,
      });
    } catch (error) {
      this.context.logger.error(
        `Failed to set organization strategy: ${errMsg(error)}`
      );
    }
  }

  public getOrganizationStrategy(): TestOrganizationStrategy {
    return this.context.organizationManager.getStrategy();
  }

  public getAvailableOrganizationStrategies(): ReturnType<
    typeof this.context.organizationManager.getAvailableStrategies
  > {
    return this.context.organizationManager.getAvailableStrategies();
  }

  // Expose organization manager for CommandManager compatibility
  public get organizationManager() {
    return this.context.organizationManager;
  }

  // Expose discovery manager for CommandManager compatibility
  public get discoveryManager() {
    return this.context.discoveryManager;
  }

  private automaticDiscoveryEnabled(): boolean {
    return (vscode.workspace.workspaceFolders ?? []).some((folder) => ExtensionConfig.forResource(folder.uri).autoDiscoverTests);
  }

  private discoveryPatternKey(): string {
    return JSON.stringify((vscode.workspace.workspaceFolders ?? []).map((folder) =>
      [folder.uri.toString(), ExtensionConfig.forResource(folder.uri).testFilePattern]));
  }

  private updateDiscoverySettings(): void {
    const changed = this.watchedPatterns !== this.discoveryPatternKey();
    const automatic = this.automaticDiscoveryEnabled();
    const enabled = !this.autoDiscover && automatic;
    this.autoDiscover = automatic;
    if (changed) {this.setupFileWatcher(); this.context.discoveryManager.clearCache();}
    if (changed || enabled) {this.observeDiscovery(enabled ? this.discovery.refresh() : this.discovery.invalidate());}
  }

  private setupFileWatcher(): void {
    this.watchedPatterns = this.discoveryPatternKey();
    for (const watcher of this.fileWatchers.splice(0)) {watcher.dispose();}
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const config = ExtensionConfig.forResource(folder.uri);
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, config.testFilePattern));
      this.fileWatchers.push(watcher);
      const refresh = () => {
        if (this.disposed || !this.fileWatchers.includes(watcher)) {return;}
        this.observeDiscovery(this.discovery.invalidate());
      };
      watcher.onDidCreate(refresh); watcher.onDidChange(refresh); watcher.onDidDelete(refresh);
    }
  }

  /**
   * Build a failure message for a scenario. Uses the scenario's own rendered
   * output (steps + the failing step's error) when available so the failure
   * shows inline detail rather than a generic "Test failed".
   */
  private failureMessage(scenarioOutput: string | undefined, fallback: string): vscode.TestMessage {
    return new vscode.TestMessage(scenarioOutput?.trim() ? scenarioOutput : fallback);
  }

  /**
   * Report one item's outcome on the run and mirror it into the status caches.
   * An unknown status marks the item skipped and deliberately leaves the
   * caches untouched so a later run can still restore its last real status.
   */
  private markResult(
    run: vscode.TestRun,
    item: vscode.TestItem,
    status: string | undefined,
    output?: string,
    cacheKey?: string
  ): void {
    try {
      if (status === "passed") {
        if (cacheKey) { this.testStatusCache.set(cacheKey, "passed"); }
        this.updateTestStatus(item.id, "passed");
        run.passed(item);
      } else if (status === "failed") {
        if (cacheKey) { this.testStatusCache.set(cacheKey, "failed"); }
        this.updateTestStatus(item.id, "failed");
        run.failed(item, this.failureMessage(output, "Test failed"));
      } else if (status === "errored") {
        run.errored(item, this.failureMessage(output, "The selected test did not produce a valid outcome. Inspect the captured output."));
      } else {
        run.skipped(item);
      }
    } catch (error) {
      this.context.logger.error("Error reporting test result", { itemId: item.id, error: String(error) });
    }
  }

  /** Plain-object reference for the result-lookup API. */
  private itemRef(item: vscode.TestItem | undefined): { id: string; uri?: vscode.Uri } {
    if (!item) {
      return { id: "" };
    }
    return { id: item.id, ...(item.uri ? { uri: item.uri } : {}) };
  }

  /** Build a per-run result index for a status/output map. */
  private resultLookup(
    map: Record<string, string> | undefined,
    workspaceRoot: string
  ): ScenarioResultLookup {
    return this.context.testItemMapping.createLookup(map ?? {}, workspaceRoot);
  }

  private async executionPlan(request: vscode.TestRunRequest) {
    const roots = Array.from(this.testController.items, ([, item]) => item);
    const scenarios = this.treeBuilder.scenarioSnapshot();
    const scenarioFor = (id: string) => scenarios.get(id);
    const units = testExplorerRunPlan(request, roots, scenarioFor);
    const projects = await this.context.testExecutor.resolveProjects(units.map((unit) => unit.options.filePath));
    return units.map((unit) => ({ ...unit, project: projectForFile(projects, unit.options.filePath) }));
  }

  private async runTests(request: vscode.TestRunRequest, token?: vscode.CancellationToken): Promise<void> {
    if (this.isTestRunning) {
      vscode.window.showWarningMessage("A test run is already in progress. Please wait for it to finish before starting another.");
      return;
    }
    this.isTestRunning = true;
    const cancellation = this.runCancellation = new vscode.CancellationTokenSource();
    const linked = token?.onCancellationRequested(() => cancellation.cancel());
    if (token?.isCancellationRequested) {cancellation.cancel();}
    const run = this.testController.createTestRun(request);
    try {
      await this.context.testExecutor.withExecutionSession(async (session) => {
        const plan = await this.executionPlan(request);
        const outcomes = new Map<vscode.TestItem, string>();
        for (const unit of plan) {
          const project = unit.project;
          if (session.signal.aborted) {
            for (const logical of unit.scenarios) {for (const alias of logical.aliases) {run.skipped(alias); outcomes.set(alias, "skipped");}}
            continue;
          }
          for (const logical of unit.scenarios) {
            for (const alias of logical.aliases) {run.started(alias); this.updateTestStatus(alias.id, "started");}
          }
          try {
            const result = unit.kind === "file"
              ? await this.context.testExecutor.runFeatureFileWithOutput(unit.options, session, project)
              : await this.context.testExecutor.runScenarioWithOutput(unit.options, session, project);
            if (!result.outputStreamed) {session.publish(result.display ?? result.output);}
            const statuses = this.resultLookup(result.scenarioResults, project.cwd);
            const outputs = this.resultLookup(result.scenarioOutputs, project.cwd);
            for (const logical of unit.scenarios) {
              for (const alias of logical.aliases) {
                const status = result.cancelled ? "skipped" : result.errored ? "errored" : statuses.get(this.itemRef(alias), this.itemRef(alias.parent)) ?? "errored";
                const output = outputs.get(this.itemRef(alias), this.itemRef(alias.parent));
                if (output && !result.outputStreamed) {session.publish(output);}
                const detail = status === "failed" || status === "errored" ? session.limitDisplay(output ?? result.error ?? result.display ?? "") : undefined;
                this.markResult(run, alias, status, detail);
                outcomes.set(alias, status);
              }
            }
          } catch (error) {
            for (const logical of unit.scenarios) {
              for (const alias of logical.aliases) {
                this.markResult(run, alias, session.signal.aborted ? "skipped" : "errored", session.limitDisplay(errMsg(error)));
                outcomes.set(alias, session.signal.aborted ? "skipped" : "errored");
              }
            }
          }
        }
        const rollup = (item: vscode.TestItem): string[] => {
          if (item.children.size === 0) {
            const status = outcomes.get(item);
            return status ? [status] : [];
          }
          const statuses = Array.from(item.children, ([, child]) => rollup(child)).flat();
          if (statuses.length > 0) {
            this.markResult(run, item, statuses.includes("errored") ? "errored" : statuses.includes("failed") ? "failed" : statuses.every((status) => status === "passed") ? "passed" : "skipped");
          }
          return statuses;
        };
        this.testController.items.forEach(rollup);
      }, cancellation.token, (text) => run.appendOutput(text), (text) => text.replace(/\r?\n/g, "\r\n"));
    } catch (error) {
      this.context.logger.error("Test selection failed", { error: errMsg(error) });
      vscode.window.showErrorMessage(errMsg(error));
    } finally {
      run.end();
      linked?.dispose(); cancellation.dispose(); this.runCancellation = undefined;
      this.isTestRunning = false;
    }
  }

  private async debugTests(request: vscode.TestRunRequest, token?: vscode.CancellationToken): Promise<void> {
    if (this.isTestRunning) {
      vscode.window.showWarningMessage("A test run is already in progress. Please wait for it to finish before starting another.");
      return;
    }
    this.isTestRunning = true;
    const cancellation = this.runCancellation = new vscode.CancellationTokenSource();
    const linked = token?.onCancellationRequested(() => cancellation.cancel());
    if (token?.isCancellationRequested) {cancellation.cancel();}
    const run = this.testController.createTestRun(request);
    try {
      await this.context.testExecutor.withExecutionSession(async (session) => {
        const plan = await this.executionPlan(request);
        let failed = false;
        for (const unit of plan) {
          const project = unit.project;
          let failure: unknown;
          if (!failed && !session.signal.aborted) {
            try {await this.context.testExecutor.debugScenario({ ...unit.options, debug: true }, session, project);}
            catch (error) {
              if (!(error instanceof Error && error.name === "AbortError" && session.signal.aborted)) {failure = error; failed = true;}
            }
          }
          for (const logical of unit.scenarios) {
            for (const alias of logical.aliases) {
              if (failure) {this.markResult(run, alias, "errored", session.limitDisplay(errMsg(failure)));}
              else {run.skipped(alias);}
            }
          }
        }
      }, cancellation.token);
    } catch (error) {
      this.context.logger.error("Debug selection failed", { error: errMsg(error) });
      vscode.window.showErrorMessage(errMsg(error));
    } finally {
      run.end();
      linked?.dispose(); cancellation.dispose(); this.runCancellation = undefined;
      this.isTestRunning = false;
    }
  }

  private updateScenarioOutlineParentStatus(parentId: string): void {
    const parent = this.findTestItemById(parentId);
    if (!parent) {
      return;
    }

    let anyFailed = false;
    let allPassed = true;
    let anyStarted = false;

    // Extract feature path from parent ID for constructing cache keys
    const parentMatch = parentId.match(/(.*\.feature):outline:(.+)$/);
    if (!parentMatch) {
      return;
    }

    const fullFeaturePath = parentMatch[1];
    const featureFilename = fullFeaturePath ? path.basename(fullFeaturePath) : "";

    for (const [, child] of Array.from(parent.children)) {
      // Find the cache key that matches this child by line number
      const childLine = child.id.startsWith(":") ? child.id.slice(1) : child.id;
      let cacheKey = "";

      // Cache key format: features/advanced-example.feature:2:39
      for (const [key] of this.testStatusCache) {
        if (key.includes(featureFilename) && key.includes(`:${childLine}`)) {
          cacheKey = key;
          break;
        }
      }

      const childStatus = this.testStatusCache.get(cacheKey);
      if (childStatus === "failed") {
        anyFailed = true;
        allPassed = false;
      } else if (childStatus === "started") {
        anyStarted = true;
        allPassed = false;
      } else if (childStatus !== "passed") {
        allPassed = false;
      }
    }

    let parentStatus: "started" | "passed" | "failed";
    if (anyFailed) {
      parentStatus = "failed";
    } else if (allPassed) {
      parentStatus = "passed";
    } else if (anyStarted) {
      parentStatus = "started";
    } else {
      parentStatus = "failed";
    }

    this.testStatusCache.set(parentId, parentStatus);
  }

  private findTestItemById(testId: string): vscode.TestItem | undefined {
    for (const [, testItem] of this.discoveredTests) {
      const found = this.findTestItemRecursively(testItem, testId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  private findTestItemRecursively(testItem: vscode.TestItem, targetId: string): vscode.TestItem | undefined {
    if (testItem.id === targetId) {
      return testItem;
    }

    for (const [, child] of Array.from(testItem.children)) {
      const found = this.findTestItemRecursively(child, targetId);
      if (found) {
        return found;
      }
    }

    return undefined;
  }

  public dispose(): Promise<void> {
    if (this.disposed) {return this.disposal ?? Promise.resolve();}
    this.disposed = true;
    this.runCancellation?.cancel();
    const discoveryDrain = this.disposal = this.discovery.dispose();
    for (const watcher of this.fileWatchers.splice(0)) {watcher.dispose();}
    for (const disposable of this.disposables.reverse()) {disposable.dispose();}
    delete this.testController.resolveHandler;
    this.testController.refreshHandler = undefined;
    this.discoveredTests.clear();
    this.scenarioOutlineParents.clear();
    this.testStatusCache.clear();
    this.testStatusByLocation.clear();
    if (this.ownsContext) {
      const executionDrain = this.context.testExecutor.dispose()
        .catch((error: unknown) => this.context.logger.error("Execution cleanup failed", { error: errMsg(error) }));
      this.disposal = Promise.all([discoveryDrain, executionDrain])
        .then(() => {
          this.context.discoveryManager.dispose();
          this.context.logger.dispose();
        })
        .catch((error: unknown) => {process.stderr.write(`Provider cleanup failed: ${errMsg(error)}\n`);});
      this.context.config.dispose();
    }
    return this.disposal;
  }

  private extractFeatureFileFromTestId(testId: string): string | undefined {
    // The file path may contain a Windows drive-letter colon, so strip known
    // suffixes (`:outline:<name>` or trailing `:<line>` segments) from the
    // right instead of splitting on ":".
    const outlineIndex = testId.indexOf(":outline:");
    if (outlineIndex !== -1) {
      return testId.slice(0, outlineIndex);
    }
    const match = /^(.*?)(?::\d+)+$/.exec(testId);
    if (match) {
      return match[1];
    }
    return undefined;
  }
}
