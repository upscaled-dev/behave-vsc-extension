import * as vscode from "vscode";
import { FeatureParser } from "../parsers/feature-parser";
import { TestExecutor } from "../core/test-executor";
import { TestOrganizationStrategy, BehaveExtensionContext } from "../types";
import { Logger } from "../utils/logger";
import { ExtensionConfig } from "../core/extension-config";
import { TestDiscoveryManager } from "../core/test-discovery-manager";
import { TestOrganizationManager } from "../core/test-organization";
import * as path from 'path';
import { isScenarioOutlineExampleName, extractOutlineName } from "../utils/scenario-outline";
import { TestItemMapping } from "../utils/test-item-mapping";
import { TestTreeBuilder } from "./test-tree-builder";
import { BehaveJsonParser } from "../utils/behave-json-parser";
import { PytestResultParser } from "../utils/pytest-result-parser";
import { CucumberJsonParser } from "../utils/cucumber-json-parser";
import { FrameworkFactory } from "../core/framework-factory";

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

/** A run result plus the per-scenario status and output maps. */
type ScenarioRunResult = import("../types").TestRunResult & {
  scenarioResults?: Record<string, string>;
  scenarioOutputs?: Record<string, string>;
};

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
  // Store scenario outline parent-child relationships for hierarchy view
  private scenarioOutlineParents = new Map<string, string>(); // exampleId -> parentId

  public static create(testController: vscode.TestController, context?: BehaveExtensionContext): BehaveTestProvider {
    return new BehaveTestProvider(testController, context);
  }

  private createDefaultContext(): BehaveExtensionContext {
    const logger = Logger.create();
    const config = ExtensionConfig.create();
    const testExecutor = TestExecutor.create();
    const discoveryManager = TestDiscoveryManager.create();
    const organizationManager = TestOrganizationManager.create();
    const featureParser = FeatureParser.create(logger);
    const behaveJsonParser = BehaveJsonParser.create(logger);
    const pytestResultParser = PytestResultParser.create(logger);
    const cucumberJsonParser = CucumberJsonParser.create(logger);
    const testItemMapping = TestItemMapping.create();
    
    // Create command builder with default framework (behave)
    const framework = config.getFramework();
    const commandBuilder = FrameworkFactory.createCommandBuilder(framework, config);

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
    this.context = context ?? this.createDefaultContext();
    this.treeBuilder = new TestTreeBuilder(
      this.testController,
      this.context,
      this.discoveredTests,
      this.scenarioOutlineParents
    );
    this.setupTestController();

    // Discover tests immediately after setup
    this.discoverTests().catch((_error) => {
      // console.error("Error during initial test discovery:", _error);
    });

    // Set up file watcher for feature files
    this.setupFileWatcher();
  }

  private setupTestController(): void {
    this.testController.resolveHandler = async (test) => {
      if (!test) {
        await this.discoverTests();
      }
    };

    const runProfile = this.testController.createRunProfile(
      "Run",
      vscode.TestRunProfileKind.Run,
      async (request) => {
        await this.runTests(request);
      }
    );
    runProfile.configureHandler = () => {};

    const debugProfile = this.testController.createRunProfile(
      "Debug",
      vscode.TestRunProfileKind.Debug,
      async (request) => {
        await this.debugTests(request);
      }
    );
    debugProfile.configureHandler = () => {};
  }

  private saveTestStatus(): void {
    // Preserve existing test status cache - don't clear it.
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

  public async discoverTests(): Promise<void> {
    try {
      this.saveTestStatus();
      await this.treeBuilder.discoverTests();
      this.restoreTestStatus();
    } catch (error) {
      const errorMessage = errMsg(error);
      this.context.logger.error(`Failed to discover tests: ${errorMessage}`, {
        pattern: this.context.config.testFilePattern,
      });

      vscode.window.showErrorMessage(
        `Test discovery failed: ${errorMessage}. Please check your configuration.`
      );
    }
  }

  public async addFeatureFileToTestController(file: vscode.Uri): Promise<void> {
    await this.treeBuilder.addFeatureFileToTestController(file);
  }

  /**
   * Yields every leaf descendant of a test item. Used so result-mapping loops work
   * for any depth (e.g. Outline → ExamplesBlock → Example).
   */
  private collectLeafTestItems(item: vscode.TestItem): vscode.TestItem[] {
    const leaves: vscode.TestItem[] = [];
    const visit = (node: vscode.TestItem): void => {
      if (node.children.size === 0) {
        leaves.push(node);
        return;
      }
      node.children.forEach((child) => visit(child));
    };
    visit(item);
    return leaves;
  }

  public async refreshTests(): Promise<void> {
    try {
      // discoverTests() already forces a cache refresh, so no separate
      // refreshCache() pass is needed here.
      this.testController.items.replace([]);
      this.discoveredTests.clear();

      await this.discoverTests();
    } catch (error) {
      const errorMessage = errMsg(error);
      this.context.logger.error(`Failed to refresh tests: ${errorMessage}`);

      vscode.window.showErrorMessage(
        `Failed to refresh tests: ${errorMessage}. Please try again.`
      );
    }
  }

  public async forceRefreshTestExplorer(): Promise<void> {
    try {
      this.testController.items.replace([]);
      this.discoveredTests.clear();

      if (this.testController.resolveHandler) {
        await this.testController.resolveHandler(undefined);
      }

      try {
        await vscode.commands.executeCommand("testing.refreshTests");
      } catch {
        // ignore
      }

      try {
        await vscode.commands.executeCommand("workbench.action.files.revert");
      } catch {
        // ignore
      }

      try {
        const run = this.testController.createTestRun(
          new vscode.TestRunRequest()
        );
        run.end();
      } catch {
        // ignore
      }
    } catch (error) {
      this.context.logger.error("Failed to force refresh Test Explorer", {
        error: errMsg(error),
      });
    }
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

  private setupFileWatcher(): void {
    const pattern = this.context.config.testFilePattern;
    const fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    fileWatcher.onDidCreate((uri) => {
      this.addFeatureFileToTestController(uri).catch((_err) => {
        // console.error(`Error adding feature file on create:`, _err);
      });
    });

    fileWatcher.onDidChange(async (_uri) => {
      // refreshTests() re-discovers with forceRefresh, which already rebuilds
      // the discovery cache — avoid a second full workspace sweep here.
      await this.refreshTests();
    });

    fileWatcher.onDidDelete((uri) => {
      const testItem = this.discoveredTests.get(uri.fsPath);
      if (testItem) {
        this.testController.items.delete(testItem.id);
        this.discoveredTests.delete(uri.fsPath);
      }
    });
  }

  /**
   * Surface a run's native output in the Test Results panel. Prefers the
   * human-readable `display` (Behave's pretty output) over `output` (which is
   * machine-readable JSON for Behave). The Test Results terminal requires CRLF
   * line endings, so lone `\n` are normalised to `\r\n`.
   */
  private appendRunOutput(
    run: vscode.TestRun,
    result: { display?: string | undefined; output?: string | undefined } | undefined
  ): void {
    const text = result?.display ?? result?.output;
    if (!text) {
      return;
    }
    try {
      run.appendOutput(text.replace(/\r?\n/g, "\r\n"));
    } catch (error) {
      this.context.logger.error("Error appending run output", { error: String(error) });
    }
  }

  /**
   * Attach each scenario's own output to its test item so that selecting the
   * scenario in the Test Results view shows its steps/errors (rather than "test
   * case did not report any output"). Outputs are keyed exactly like
   * scenarioResults, so the same matcher resolves a leaf item to its text.
   */
  private attachScenarioOutputs(
    run: vscode.TestRun,
    root: vscode.TestItem,
    scenarioOutputs: Record<string, string> | undefined,
    workspaceRoot: string
  ): void {
    if (!scenarioOutputs || Object.keys(scenarioOutputs).length === 0) {
      return;
    }
    for (const leaf of this.collectLeafTestItems(root)) {
      const parent = leaf.parent;
      const text = this.context.testItemMapping.getScenarioStatusForTestItem(
        { id: leaf.id, ...(leaf.uri ? { uri: leaf.uri } : {}) },
        parent
          ? { id: parent.id, ...(parent.uri ? { uri: parent.uri } : {}) }
          : { id: "" },
        scenarioOutputs,
        workspaceRoot
      );
      if (text) {
        try {
          run.appendOutput(text.replace(/\r?\n/g, "\r\n"), undefined, leaf);
        } catch (error) {
          this.context.logger.error("Error attaching scenario output", { itemId: leaf.id, error: String(error) });
        }
      }
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

  /** Workspace root used to relativize feature paths for result keys. */
  private workspaceRoot(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  }

  /** Forward-slashed workspace-relative path, matching behave result keys. */
  private toResultPath(absolutePath: string): string {
    return path.relative(this.workspaceRoot(), absolutePath).replace(/\\/g, "/");
  }

  /** Run a capture and surface its output in the Test Results panel. */
  private async captureAndRender(
    run: vscode.TestRun,
    test: vscode.TestItem,
    capture: () => Promise<ScenarioRunResult>
  ): Promise<ScenarioRunResult> {
    const result = await capture();
    this.appendRunOutput(run, result);
    this.attachScenarioOutputs(run, test, result.scenarioOutputs, this.workspaceRoot());
    return result;
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
      } else {
        run.skipped(item);
      }
    } catch (error) {
      this.context.logger.error("Error reporting test result", { itemId: item.id, error: String(error) });
    }
  }

  /**
   * Mark every leaf with the status keyed by `keyFor(leaf)` in the run's
   * result maps and return the aggregate outcome for parent roll-up.
   */
  private applyKeyedResults(
    run: vscode.TestRun,
    leaves: Iterable<vscode.TestItem>,
    testResult: ScenarioRunResult,
    keyFor: (leaf: vscode.TestItem) => string
  ): { anyFailed: boolean; allPassed: boolean } {
    let anyFailed = false;
    let allPassed = true;
    for (const leaf of leaves) {
      const key = keyFor(leaf);
      const status = testResult.scenarioResults?.[key];
      this.markResult(run, leaf, status, testResult.scenarioOutputs?.[key], key);
      if (status === "failed") { anyFailed = true; }
      if (status !== "passed") { allPassed = false; }
    }
    return { anyFailed, allPassed };
  }

  /** Mark a parent item according to its children's aggregate outcome. */
  private markParentFromOutcome(
    run: vscode.TestRun,
    parent: vscode.TestItem,
    outcome: { anyFailed: boolean; allPassed: boolean },
    failMessage: string
  ): void {
    try {
      if (outcome.anyFailed) {
        this.updateTestStatus(parent.id, "failed");
        run.failed(parent, new vscode.TestMessage(failMessage));
      } else if (outcome.allPassed) {
        this.updateTestStatus(parent.id, "passed");
        run.passed(parent);
      } else {
        run.skipped(parent);
      }
    } catch (error) {
      this.context.logger.error("Error reporting parent result", { itemId: parent.id, error: String(error) });
    }
  }

  /** Resolve a test item's value in a result map via the fuzzy matcher. */
  private matchScenarioValue(
    child: vscode.TestItem,
    parent: vscode.TestItem | undefined,
    map: Record<string, string> | undefined,
    workspaceRoot: string
  ): string | undefined {
    return this.context.testItemMapping.getScenarioStatusForTestItem(
      { id: child.id, ...(child.uri ? { uri: child.uri } : {}) },
      parent ? { id: parent.id, ...(parent.uri ? { uri: parent.uri } : {}) } : { id: "" },
      map ?? {},
      workspaceRoot
    );
  }

  /** Mark a group node from the overall result map (all passed or not). */
  private markGroupFromResults(
    run: vscode.TestRun,
    group: vscode.TestItem,
    results: Record<string, string> | undefined,
    failMessage: string
  ): void {
    const allPassed = Object.values(results ?? {}).every((s) => s === "passed");
    if (allPassed) {
      this.updateTestStatus(group.id, "passed");
      run.passed(group);
    } else {
      this.updateTestStatus(group.id, "failed");
      run.failed(group, new vscode.TestMessage(failMessage));
    }
  }

  private async runTests(request: vscode.TestRunRequest): Promise<void> {
    if (this.isTestRunning) {
      vscode.window.showWarningMessage("A test run is already in progress. Please wait for it to finish before starting another.");
      return;
    }
    this.isTestRunning = true;
    const run = this.testController.createTestRun(request);

    try {
      for (const test of request.include ?? []) {
        run.started(test);
        this.updateTestStatus(test.id, "started");

        if (test.uri) {
          const lineNumber = this.extractLineNumberFromTestId(test.id);
          const isFeatureFile = this.isFeatureFileTest(test.id);
          const isGroupTest = this.isGroupTest(test.id);
          const scenarioName = isFeatureFile ? undefined : test.label;

          try {
            if (isFeatureFile) {
              await this.runFeatureFileTest(run, test);
            } else if (test.id.includes(":outline:")) {
              await this.runOutlineTest(run, test);
            } else if (isGroupTest) {
              await this.runFileGroupTest(run, test);
            } else {
              await this.runSingleScenarioTest(run, test, lineNumber, scenarioName);
            }
          } catch (error) {
            const errorMessage = errMsg(error);
            this.context.logger.error(
              `Test execution failed for ${test.label}: ${errorMessage}`,
              {
                testId: test.id,
                filePath: test.uri.fsPath,
                lineNumber,
              }
            );
            run.failed(
              test,
              new vscode.TestMessage(`Test execution failed: ${errorMessage}`)
            );
            this.updateTestStatus(test.id, "failed");
          }
        } else if (this.isGroupTest(test.id) && test.id.startsWith('tag:')) {
          await this.runTagGroupTest(run, test);
          return;
        } else if (this.isGroupTest(test.id)) {
          // For flat, file, and scenario type organizations, aggregate results
          // across all relevant feature files before marking children.
          await this.runAggregatedGroupTest(run, test);
          return;
        }
      }
    } catch (error) {
      const errorMessage = errMsg(error);
      this.context.logger.error(`Error running tests: ${errorMessage}`);
      for (const test of request.include ?? []) {
        run.failed(
          test,
          new vscode.TestMessage(`Test execution failed: ${errorMessage}`)
        );
      }
    } finally {
      run.end();
      this.isTestRunning = false;
    }
  }

  /** Run a whole feature file and mark its children from per-scenario results. */
  private async runFeatureFileTest(run: vscode.TestRun, test: vscode.TestItem): Promise<void> {
    const featureFilePath = (test.uri as vscode.Uri).fsPath;
    const testResult = await this.captureAndRender(run, test, () =>
      this.context.testExecutor.runFeatureFileWithOutput({ filePath: featureFilePath })
    );

    if (testResult.scenarioResults && test.children.size > 0) {
      const featureLine = test.range ? String(test.range.start.line + 1) : "1";
      for (const [, child] of Array.from(test.children)) {
        if (child.children.size === 0) {
          // Leaf scenario: the child id already carries the 3-segment result
          // key when discovery produced one; otherwise rebuild it.
          this.applyKeyedResults(run, [child], testResult, (leaf) => {
            if (/^(.*):(\d+):(\d+)$/.exec(leaf.id)) {
              return leaf.id;
            }
            return `${this.toResultPath(featureFilePath)}:${featureLine}:${this.extractLineNumberFromTestId(leaf.id)}`;
          });
        } else {
          // Scenario outline: mark started, then roll up from its examples
          // (which may be nested under per-Examples-block groups).
          run.started(child);
          this.updateTestStatus(child.id, "started");
          const outcome = this.applyKeyedResults(run, this.collectLeafTestItems(child), testResult, (leaf) =>
            `${this.toResultPath(featureFilePath)}:${featureLine}:${this.extractLineNumberFromTestId(leaf.id)}`
          );
          this.markParentFromOutcome(run, child, outcome, "One or more examples failed");
        }
      }
    } else {
      this.context.logger.warn("No scenarioResults mapping found, falling back to overall result for all children", { testId: test.id });
      this.markAllChildrenBasedOnResult(test, run, testResult);
    }

    // Explicitly update all scenario outline parents after processing all scenarios
    for (const [, child] of Array.from(test.children)) {
      if (child.children.size > 0) {
        this.updateScenarioOutlineParentStatus(child.id);
      }
    }
  }

  /** Run a scenario-outline node: all examples in one run filtered by outline name. */
  private async runOutlineTest(run: vscode.TestRun, test: vscode.TestItem): Promise<void> {
    const filePath = (test.uri as vscode.Uri).fsPath;
    const outlineName = /:outline:(.+)$/.exec(test.id)?.[1] ?? test.label.replace(/^Scenario Outline: /, "");
    const testResult = await this.captureAndRender(run, test, () =>
      this.context.testExecutor.runScenarioWithOutput({ filePath, scenarioName: outlineName })
    );

    if (testResult.scenarioResults && test.children.size > 0) {
      // Mark intermediate groupings (Examples blocks) as started so VS Code shows progress
      test.children.forEach((directChild) => {
        if (directChild.children.size > 0) {
          run.started(directChild);
          this.updateTestStatus(directChild.id, "started");
        }
      });

      const featureLine = test.parent?.range ? String(test.parent.range.start.line + 1) : undefined;
      this.applyKeyedResults(run, this.collectLeafTestItems(test), testResult, (leaf) => {
        const childLine = this.extractLineNumberFromTestId(leaf.id);
        const rel = this.toResultPath(filePath);
        return featureLine ? `${rel}:${featureLine}:${childLine}` : `${rel}:${childLine}`;
      });
    } else {
      this.context.logger.warn("No scenarioResults mapping found, falling back to overall result for all children", { testId: test.id });
      this.markAllChildrenBasedOnResult(test, run, testResult);
    }
  }

  /** Run a file-backed group: all scenarios in the file, keyed by absolute path. */
  private async runFileGroupTest(run: vscode.TestRun, test: vscode.TestItem): Promise<void> {
    const groupFilePath = (test.uri as vscode.Uri).fsPath;
    const testResult = await this.captureAndRender(run, test, () =>
      this.context.testExecutor.runFeatureFileWithOutput({ filePath: groupFilePath })
    );

    if (testResult.scenarioResults && test.children.size > 0) {
      this.applyKeyedResults(
        run,
        Array.from(test.children, ([, child]) => child),
        testResult,
        (leaf) => `${groupFilePath}:${this.extractLineNumberFromTestId(leaf.id)}`
      );
    } else {
      this.context.logger.warn("No scenarioResults mapping found, falling back to overall result for all children", { testId: test.id });
      this.markAllChildrenBasedOnResult(test, run, testResult);
    }
  }

  /** Run a single scenario (an outline example runs its whole outline). */
  private async runSingleScenarioTest(
    run: vscode.TestRun,
    test: vscode.TestItem,
    lineNumber: number | undefined,
    scenarioName: string | undefined
  ): Promise<void> {
    const isExample = isScenarioOutlineExampleName(scenarioName);
    const scenarioOptions: import("../types").TestExecutionOptions = {
      filePath: (test.uri as vscode.Uri).fsPath,
      ...(lineNumber ? { lineNumber } : {}),
      ...(scenarioName ? { scenarioName } : {}),
    };

    const testResult = await this.captureAndRender(run, test, () =>
      this.context.testExecutor.runScenarioWithOutput(
        isExample
          ? { ...scenarioOptions, scenarioName: extractOutlineName(scenarioName ?? "") }
          : scenarioOptions
      )
    );

    // For scenario outline examples, store all example results in the cache
    if (isExample && testResult.scenarioResults) {
      for (const [childKey, status] of Object.entries(testResult.scenarioResults)) {
        this.testStatusCache.set(childKey, status as "passed" | "failed");
        const lineMatch = /:(\d+)$/.exec(childKey);
        if (lineMatch) {
          this.updateTestStatus(`:${lineMatch[1]}`, status as "passed" | "failed");
        }
      }
    }

    const workspaceRoot = this.workspaceRoot();
    const foundStatus = this.matchScenarioValue(test, test.parent, testResult.scenarioResults, workspaceRoot);
    const foundOutput = this.matchScenarioValue(test, test.parent, testResult.scenarioOutputs, workspaceRoot);

    if (foundStatus === "passed" || foundStatus === "failed") {
      this.markResult(run, test, foundStatus, foundOutput);
    } else if (foundStatus) {
      run.skipped(test);
    } else {
      // No per-scenario result resolved: fall back to the overall outcome.
      this.markResult(run, test, testResult.success ? "passed" : "failed", foundOutput ?? testResult.display);
    }
  }

  /** Run a tag group: one run with the tag expression, then match children. */
  private async runTagGroupTest(run: vscode.TestRun, test: vscode.TestItem): Promise<void> {
    const tag = /^tag:(.+)$/.exec(test.id)?.[1] ?? test.label ?? "";
    const testResult = await this.captureAndRender(run, test, () =>
      this.context.testExecutor.runAllTestsWithTagsOutput(tag)
    );

    const workspaceRoot = this.workspaceRoot();
    for (const [, child] of Array.from(test.children)) {
      const status = this.matchScenarioValue(child, test, testResult.scenarioResults, workspaceRoot);
      const output = status === "failed"
        ? this.matchScenarioValue(child, test, testResult.scenarioOutputs, workspaceRoot)
        : undefined;
      this.markResult(run, child, status, output);
    }
    this.markGroupFromResults(run, test, testResult.scenarioResults, "One or more scenarios failed");
  }

  /** Run a non-file group by aggregating one run per backing feature file. */
  private async runAggregatedGroupTest(run: vscode.TestRun, test: vscode.TestItem): Promise<void> {
    const featureFiles = new Set<string>();
    const collectFeatureFiles = (testItem: vscode.TestItem) => {
      if (testItem.uri) {
        featureFiles.add(testItem.uri.fsPath);
      }
      testItem.children.forEach(collectFeatureFiles);
    };
    collectFeatureFiles(test);

    const aggregatedScenarioResults: Record<string, string> = {};
    const aggregatedScenarioOutputs: Record<string, string> = {};
    for (const filePath of featureFiles) {
      const result = await this.context.testExecutor.runFeatureFileWithOutput({ filePath });
      this.appendRunOutput(run, result);
      Object.assign(aggregatedScenarioResults, result.scenarioResults);
      Object.assign(aggregatedScenarioOutputs, result.scenarioOutputs);
    }

    const workspaceRoot = this.workspaceRoot();
    this.attachScenarioOutputs(run, test, aggregatedScenarioOutputs, workspaceRoot);
    for (const [, child] of Array.from(test.children)) {
      if (this.isScenarioOutlineParent(child)) {
        let anyFailed = false;
        let allPassed = true;
        for (const [, grandChild] of Array.from(child.children)) {
          const grandChildStatus = this.matchScenarioValue(grandChild, child, aggregatedScenarioResults, workspaceRoot);
          if (grandChildStatus === "failed") {
            anyFailed = true;
            allPassed = false;
          } else if (grandChildStatus !== "passed") {
            allPassed = false;
          }
        }
        this.markParentFromOutcome(run, child, { anyFailed, allPassed }, "One or more examples failed");
        continue;
      }

      const status = this.matchScenarioValue(child, test, aggregatedScenarioResults, workspaceRoot);
      const output = status === "failed"
        ? this.matchScenarioValue(child, test, aggregatedScenarioOutputs, workspaceRoot)
        : undefined;
      this.markResult(run, child, status, output);
    }
    this.markGroupFromResults(run, test, aggregatedScenarioResults, "One or more scenarios failed");
  }

  private async debugTests(request: vscode.TestRunRequest): Promise<void> {
    if (this.isTestRunning) {
      vscode.window.showWarningMessage("A test run is already in progress. Please wait for it to finish before starting another.");
      return;
    }
    this.isTestRunning = true;
    try {
      for (const test of request.include ?? []) {
        try {
          if (test.uri) {
            const lineNumber = this.extractLineNumberFromTestId(test.id);
            const isFeatureFile = this.isFeatureFileTest(test.id);
            const isGroupTest = this.isGroupTest(test.id);
            const scenarioName = isFeatureFile ? undefined : test.label;

            if (isFeatureFile || isGroupTest) {
              await this.context.testExecutor.debugScenario({
                filePath: test.uri.fsPath,
                debug: true,
              });
            } else {
              const debugOptions: import("../types").TestExecutionOptions = {
                filePath: test.uri.fsPath,
                ...(lineNumber ? { lineNumber } : {}),
                debug: true,
                ...(scenarioName ? { scenarioName } : {}),
              };
              await this.context.testExecutor.debugScenario(debugOptions);
            }
          } else if (this.isGroupTest(test.id)) {
            // Handle tag groups (no URI) - debug all scenarios in the group
            const featureFiles = new Set<string>();
            const collectFeatureFiles = (testItem: vscode.TestItem) => {
              if (testItem.uri) {
                featureFiles.add(testItem.uri.fsPath);
              }
              testItem.children.forEach(collectFeatureFiles);
            };
            collectFeatureFiles(test);

            for (const filePath of featureFiles) {
              await this.context.testExecutor.debugScenario({
                filePath,
                debug: true,
              });
            }
          }
        } catch (testError) {
          const errorMessage = errMsg(testError);
          this.context.logger.error(
            `Failed to debug test ${test.label}: ${errorMessage}`,
            {
              testId: test.id,
              filePath: test.uri?.fsPath,
            }
          );

          vscode.window.showErrorMessage(
            `Failed to debug test "${test.label}": ${errorMessage}`
          );
        }
      }
    } catch (error) {
      const errorMessage = errMsg(error);
      this.context.logger.error(
        `Failed to start debug session: ${errorMessage}`
      );

      vscode.window.showErrorMessage(
        `Failed to start debug session: ${errorMessage}`
      );
    } finally {
      this.isTestRunning = false;
    }
  }

  private markAllChildrenBasedOnResult(
    parentTest: vscode.TestItem,
    run: vscode.TestRun,
    result: import("../types").TestRunResult
  ): void {
    const markChildrenRecursively = (test: vscode.TestItem) => {
      test.children.forEach((child) => {
        run.started(child);

        if (result.success) {
          run.passed(child);
          this.updateTestStatus(child.id, "passed");
        } else {
          run.failed(
            child,
            new vscode.TestMessage(
              `Test failed: ${result.error ?? "Unknown error"}`
            )
          );
          this.updateTestStatus(child.id, "failed");
        }

        markChildrenRecursively(child);
      });
    };

    markChildrenRecursively(parentTest);
  }

  private extractLineNumberFromTestId(testId: string): number | undefined {
    // Test ID formats: file.feature, file.feature:8, file.feature:outline:name, file.feature:group:name
    const lineMatch = testId.match(/:(\d+)$/);
    if (lineMatch) {
      const lineNumber = parseInt(lineMatch[1] ?? "0", 10);
      return lineNumber > 0 ? lineNumber : undefined;
    }

    if (!testId.includes(":")) {
      return undefined;
    }

    if (
      testId.includes(":outline:") ||
      testId.includes(":group:") ||
      testId.includes("scenario_")
    ) {
      return undefined;
    }

    // Fallback: any number embedded in the ID
    const numberMatch = testId.match(/:(\d+)/);
    if (numberMatch) {
      const lineNumber = parseInt(numberMatch[1] ?? "0", 10);
      return lineNumber > 0 ? lineNumber : undefined;
    }

    return undefined;
  }

  private isFeatureFileTest(testId: string): boolean {
    if (!testId.includes(":")) {
      return true;
    }

    if (
      testId.includes(":group:") ||
      testId.includes(":outline:") ||
      testId.includes("scenario_")
    ) {
      return false;
    }

    if (testId.match(/:(\d+)$/)) {
      return false;
    }

    return true;
  }

  private isGroupTest(testId: string): boolean {
    return (
      testId.startsWith("group:") ||
      testId.startsWith("tag:") ||
      testId.includes(":group:") ||
      testId.includes(":all") ||
      testId.includes(":tag:") ||
      testId.includes(":regular") ||
      testId.includes(":outlines")
    );
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

  public dispose(): void {
    try {
      this.discoveredTests.clear();
      this.testController.dispose();
    } catch (error) {
      this.context.logger.error("Failed to dispose test provider", { error });
    }
  }

  private isScenarioOutlineParent(testItem: vscode.TestItem): boolean {
    // Has children, label starts with "Scenario Outline:", children are outline examples.
    return (
      testItem.children.size > 0 &&
      testItem.label.startsWith("Scenario Outline:") &&
      Array.from(testItem.children).every(([, child]) =>
        isScenarioOutlineExampleName(child.label)
      )
    );
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
