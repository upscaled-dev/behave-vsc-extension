import * as vscode from "vscode";
import { FeatureParser } from "../parsers/feature-parser";
import { TestExecutor } from "../core/test-executor";
import { Scenario, TestOrganizationStrategy, TestGroup, BehaveExtensionContext } from "../types";
import { Logger } from "../utils/logger";
import { ExtensionConfig } from "../core/extension-config";
import { TestDiscoveryManager } from "../core/test-discovery-manager";
import { TestOrganizationManager } from "../core/test-organization";
import * as path from 'path';
import { TestItemMapping } from "../utils/test-item-mapping";
import { BehaveJsonParser } from "../utils/behave-json-parser";
import { PytestResultParser } from "../utils/pytest-result-parser";
import { CucumberJsonParser } from "../utils/cucumber-json-parser";
import { FrameworkFactory } from "../core/framework-factory";

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export class BehaveTestProvider {
  private readonly testController: vscode.TestController;
  private readonly discoveredTests: Map<string, vscode.TestItem>;
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
    // Extract file path and line number from test ID
    // Test IDs are typically in format: filepath:lineNumber or filepath
    const parts = testId.split(":");
    if (parts.length >= 2) {
      const filePath = parts[0];
      const lineNumber = parts[1];
      return `${filePath}:${lineNumber}`;
    } else if (parts.length === 1) {
      // Feature file test
      return parts[0] ?? null;
    }
    return null;
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
      const pattern = this.context.config.testFilePattern;

      if (!pattern || pattern.trim() === "") {
        throw new Error("Test file pattern is empty or invalid");
      }

      const filePaths = await this.context.discoveryManager.discoverTestFiles({
        pattern,
        forceRefresh: true,
      });

      this.saveTestStatus();

      this.testController.items.replace([]);
      this.discoveredTests.clear();

      // First pass: collect all scenarios from all feature files
      const allScenarios: Array<{ scenario: Scenario; file: vscode.Uri }> = [];

      for (const filePath of filePaths) {
        try {
          const file = vscode.Uri.file(filePath);
          const content = await vscode.workspace.fs.readFile(file);
          const text = new TextDecoder().decode(content);
          const parsed = this.context.featureParser.parseFeatureContent(text);

          if (parsed) {
            for (const scenario of parsed.scenarios) {
              scenario.filePath = file.fsPath;
            }
            allScenarios.push(
              ...parsed.scenarios.map((scenario) => ({ scenario, file }))
            );
          }
        } catch (fileError) {
          this.context.logger.error(
            `Failed to process feature file ${filePath}: ${errMsg(fileError)}`
          );
        }
      }

      // Second pass: organize all scenarios using the current strategy
      const allScenarioObjects = allScenarios.map((item) => item.scenario);
      const organizedGroups =
        this.context.organizationManager.organizeTests(allScenarioObjects);

      // Third pass: create test hierarchy based on organization
      const strategyType = this.context.organizationManager.getStrategy().strategyType;
      if (strategyType === "TagBasedOrganization") {
        this.createTagBasedTestHierarchy(organizedGroups, allScenarios);
      } else if (strategyType === "FeatureBasedOrganization") {
        await this.createHierarchicalFeatureBasedTestHierarchy(
          organizedGroups,
          allScenarios
        );
      } else {
        await this.createFeatureBasedTestHierarchy(
          organizedGroups,
          allScenarios
        );
      }

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
    try {
      if (!file?.fsPath) {
        throw new Error("Invalid file URI provided");
      }

      const content = await vscode.workspace.fs.readFile(file);
      const text = new TextDecoder().decode(content);
      const parsed = this.context.featureParser.parseFeatureContent(text);

      if (!parsed || typeof parsed.featureLineNumber !== 'number') {
        this.context.logger.warn(`Invalid or unparsable feature file: ${file.fsPath}`);
        return;
      }

      const featureItem = this.testController.createTestItem(
        file.fsPath,
        parsed.feature,
        file
      );

      featureItem.canResolveChildren = true;

      if (parsed.featureLineNumber && parsed.featureLineNumber > 0) {
        featureItem.range = new vscode.Range(
          parsed.featureLineNumber - 1,
          0,
          parsed.featureLineNumber - 1,
          0
        );
      }

      const scenarioGroups = this.groupScenariosByOutline(parsed.scenarios);

      for (const [outlineName, scenarios] of scenarioGroups) {
        if (scenarios.length === 1 && !scenarios[0]?.isScenarioOutline) {
          const scenario = scenarios[0];
          if (scenario && typeof scenario.featureLineNumber === 'number') {
            featureItem.children.add(this.createScenarioTestItem(file, scenario));
          } else {
            this.context.logger.warn(`Scenario missing featureLineNumber or is undefined, skipping: ${scenario?.name}`);
          }
        } else if (scenarios.length > 1 && scenarios[0]?.isScenarioOutline) {
          const hasOutlineLineNumber = scenarios[0]?.outlineLineNumber;
          if (hasOutlineLineNumber && typeof scenarios[0].featureLineNumber === 'number') {
            const outlineItem = this.createOutlineTestItem(
              file,
              outlineName,
              scenarios,
              `${file.fsPath}:outline:${outlineName}`
            );
            featureItem.children.add(outlineItem);
          } else {
            for (const scenario of scenarios) {
              if (typeof scenario.featureLineNumber === 'number') {
                featureItem.children.add(this.createScenarioTestItem(file, scenario));
              } else {
                this.context.logger.warn(`Scenario missing featureLineNumber, skipping: ${scenario.name}`);
              }
            }
          }
        } else if (scenarios.length === 1 && scenarios[0]?.isScenarioOutline) {
          const scenario = scenarios[0];
          if (scenario && typeof scenario.featureLineNumber === 'number') {
            featureItem.children.add(this.createScenarioTestItem(file, scenario));
          } else {
            this.context.logger.warn(`Scenario missing featureLineNumber, skipping: ${scenario?.name}`);
          }
        } else {
          for (const scenario of scenarios) {
            if (typeof scenario.featureLineNumber === 'number') {
              featureItem.children.add(this.createScenarioTestItem(file, scenario));
            } else {
              this.context.logger.warn(`Scenario missing featureLineNumber, skipping: ${scenario.name}`);
            }
          }
        }
      }

      this.testController.items.add(featureItem);
      this.discoveredTests.set(file.fsPath, featureItem);
    } catch (error) {
      this.context.logger.error(
        `Failed to add feature file to test controller: ${errMsg(error)}`,
        { filePath: file.fsPath }
      );
      throw error;
    }
  }

  private groupScenariosByOutline(
    scenarios: Scenario[]
  ): Map<string, Scenario[]> {
    const groups = new Map<string, Scenario[]>();

    for (const scenario of scenarios) {
      if (scenario.isScenarioOutline) {
        // Extract the original outline name from the example name
        // Example: "1: Load testing with multiple users - user_count: 10" -> "Load testing with multiple users"
        const match = scenario.name.match(/^\d+:\s*(.+?)\s*-\s*/);
        const outlineName = match ? match[1] : scenario.name;

        if (outlineName && typeof outlineName === "string") {
          if (!groups.has(outlineName)) {
            groups.set(outlineName, []);
          }
          const group = groups.get(outlineName);
          if (group) {
            group.push(scenario);
          }
        }
      } else {
        // Regular scenario - use file path and line number for uniqueness
        const groupKey = `${scenario.filePath}:${scenario.lineNumber}`;
        groups.set(groupKey, [scenario]);
      }
    }

    return groups;
  }

  private createOutlineTestItem(
    file: vscode.Uri,
    outlineName: string,
    examples: Scenario[],
    testId: string
  ): vscode.TestItem {
    const outlineItem = this.testController.createTestItem(
      testId,
      `Scenario Outline: ${outlineName}`,
      file
    );

    outlineItem.canResolveChildren = false;
    outlineItem.description = `${examples.length} example(s)`;

    if (
      examples.length > 0 &&
      examples[0]?.outlineLineNumber &&
      examples[0].outlineLineNumber > 0
    ) {
      const outlineLine = examples[0].outlineLineNumber - 1;
      outlineItem.range = new vscode.Range(outlineLine, 0, outlineLine, 0);
    } else {
      outlineItem.range = undefined;
    }

    const blockGroups = new Map<string, Scenario[]>();
    for (const example of examples) {
      const key = example.examplesBlockName ?? "";
      const list = blockGroups.get(key) ?? [];
      list.push(example);
      blockGroups.set(key, list);
    }

    const hasNamedBlock = Array.from(blockGroups.keys()).some((k) => k !== "");
    const useBlockHierarchy = blockGroups.size > 1 || hasNamedBlock;

    if (!useBlockHierarchy) {
      for (const example of examples) {
        this.appendExampleChild(outlineItem, file, example, testId);
      }
      return outlineItem;
    }

    for (const [blockName, blockExamples] of blockGroups) {
      const blockItem = this.createExamplesBlockTestItem(file, blockName, blockExamples, testId);
      outlineItem.children.add(blockItem);
    }
    return outlineItem;
  }

  private createExamplesBlockTestItem(
    file: vscode.Uri,
    blockName: string,
    examples: Scenario[],
    outlineTestId: string
  ): vscode.TestItem {
    const first = examples[0];
    const blockLine = first?.examplesBlockLineNumber ?? 0;
    const blockId = `${first?.filePath ?? ""}:examples:${blockLine}`;
    const label = blockName ? `Examples: ${blockName}` : "Examples";
    const tags = first?.examplesBlockTags ?? [];

    const blockItem = this.testController.createTestItem(blockId, label, file);
    blockItem.canResolveChildren = false;
    blockItem.description = `${examples.length} example(s)`;
    if (tags.length > 0) {
      blockItem.description += ` | Tags: ${tags.join(", ")}`;
    }
    if (blockLine > 0) {
      blockItem.range = new vscode.Range(blockLine - 1, 0, blockLine - 1, 0);
    }

    for (const example of examples) {
      this.appendExampleChild(blockItem, file, example, outlineTestId);
    }
    return blockItem;
  }

  private appendExampleChild(
    parent: vscode.TestItem,
    file: vscode.Uri,
    example: Scenario,
    outlineTestId: string
  ): void {
    if (typeof example.featureLineNumber !== "number") {
      this.context.logger.warn(`Outline example missing featureLineNumber, skipping: ${example.name}`);
      return;
    }
    const exampleItem = this.createScenarioTestItem(file, example, outlineTestId);
    parent.children.add(exampleItem);
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

  private createScenarioTestItem(
    file: vscode.Uri,
    scenario: Scenario,
    parentTestId?: string
  ): vscode.TestItem {
    // Always use absolute file path and scenario.lineNumber for ID
    const id = `${scenario.filePath}:${scenario.lineNumber}`;
    const scenarioItem = this.testController.createTestItem(
      id,
      scenario.name,
      file
    );

    if (scenario.lineNumber && scenario.lineNumber > 0) {
      scenarioItem.range = new vscode.Range(
        scenario.lineNumber - 1,
        0,
        scenario.lineNumber - 1,
        0
      );
    }

    scenarioItem.canResolveChildren = false;
    scenarioItem.description = `Line ${scenario.lineNumber}`;

    // Add tags as metadata
    if (scenario.tags && scenario.tags.length > 0) {
      scenarioItem.description += ` | Tags: ${scenario.tags.join(", ")}`;
    }

    // Only store parent relationships in hierarchy view
    if (this.getOrganizationStrategy().strategyType === "FeatureBasedOrganization" && scenario.outlineLineNumber) {
      const parentId = parentTestId ?? `${scenario.filePath}:${scenario.outlineLineNumber}`;
      this.scenarioOutlineParents.set(id, parentId);
    }

    return scenarioItem;
  }

  public async refreshTests(): Promise<void> {
    try {
      await this.context.discoveryManager.refreshCache();

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

  private isScenarioOutlineExample(scenarioName?: string): boolean {
    if (!scenarioName) {
      return false;
    }
    // Pattern: "1: Scenario Name - param1: value1, param2: value2"
    return /^\d+:\s*.+\s*-\s*/.test(scenarioName);
  }

  private extractOriginalOutlineName(scenarioName: string): string {
    const match = scenarioName.match(/^\d+:\s*(.+?)\s*-\s*/);
    const extracted = match?.[1] ?? scenarioName;
    const trimmed = extracted.trim();
    return trimmed || scenarioName;
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
      // Force refresh the specific file and its cache
      await this.context.discoveryManager.refreshCache();
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
   * Whether the active framework is Behave. For Behave a single run shows native
   * (pretty) output in the terminal while also writing JSON to a file we parse
   * for status icons, so the separate shell-display run is skipped. Other
   * frameworks keep streaming their native output via the shell-display run.
   */
  private isBehave(): boolean {
    return this.context.commandBuilder?.getFrameworkName?.() === "behave";
  }

  /**
   * Run the framework's shell-display command. Skipped for Behave, whose
   * `*WithOutput` methods already display native output in the terminal in the
   * same single run that captures results (avoids running each test twice).
   */
  private async displayShellRun(shellRun: () => Promise<void>): Promise<void> {
    if (!this.isBehave()) {
      await shellRun();
    }
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
            let testResult: import("../types").TestRunResult & { scenarioResults?: Record<string, string>; scenarioOutputs?: Record<string, string> };

            if (isFeatureFile) {
              const featureFilePath = test.uri.fsPath;
              await this.displayShellRun(() => this.context.testExecutor.runFeatureFile({
                filePath: featureFilePath,
              }));

              testResult = await this.context.testExecutor.runFeatureFileWithOutput({
                filePath: featureFilePath,
              });
              this.appendRunOutput(run, testResult);
              this.attachScenarioOutputs(run, test, testResult.scenarioOutputs, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
              // Mark each scenario individually using scenarioResults
              if (testResult.scenarioResults && test.children.size > 0) {
                for (const [, child] of Array.from(test.children)) {
                  // Mark parent nodes (scenario outlines) as started first
                  if (child.children.size > 0) {
                    run.started(child);
                    this.updateTestStatus(child.id, "started");
                  }

                  // Only mark leaf nodes (scenarios/examples), not parent outline nodes
                  if (child.children.size === 0) {
                    // Try to extract feature line number from child.id
                    let relativeFeaturePath = "";
                    let featureLineNumber = "1";
                    let childLine = "";
                    const idMatch = child.id.match(/^(.*):(\d+):(\d+)$/);
                    if (idMatch) {
                      relativeFeaturePath = idMatch[1] ?? "";
                      featureLineNumber = idMatch[2] ?? "1";
                      childLine = idMatch[3] ?? "";
                    } else {
                      // fallback to previous logic
                      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
                      relativeFeaturePath = path.relative(workspaceRoot, test.uri.fsPath);
                      if (test.range) {
                        featureLineNumber = String(test.range.start.line + 1);
                      }
                      childLine = String(this.extractLineNumberFromTestId(child.id));
                    }
                    const childKey = `${relativeFeaturePath}:${featureLineNumber}:${childLine}`;
                    const status = testResult.scenarioResults?.[childKey];
                    if (status === "passed") {
                      this.testStatusCache.set(childKey, "passed");
                      this.updateTestStatus(child.id, "passed");
                      try {
                        run.passed(child);
                      } catch (error) {
                        this.context.logger.error("Error calling run.passed", { childId: child.id, error: String(error) });
                      }
                    } else if (status === "failed") {
                      this.testStatusCache.set(childKey, "failed");
                      this.updateTestStatus(child.id, "failed");
                      try {
                        run.failed(child, this.failureMessage(testResult.scenarioOutputs?.[childKey], "Test failed"));
                      } catch (error) {
                        this.context.logger.error("Error calling run.failed", { childId: child.id, error: String(error) });
                      }
                    } else {
                      try {
                        run.skipped(child);
                      } catch (error) {
                        this.context.logger.error("Error calling run.skipped", { childId: child.id, error: String(error) });
                      }
                    }
                  } else {
                    // Parent node (e.g., scenario outline): walk all leaf descendants
                    // (may be 2 or 3 levels deep when Examples blocks group examples)
                    let anyFailed = false;
                    let allPassed = true;

                    for (const grandChild of this.collectLeafTestItems(child)) {
                      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
                      const relativeFeaturePath = path.relative(workspaceRoot, test.uri.fsPath);
                      const featureLineNumber = test.range ? String(test.range.start.line + 1) : "1";
                      const childLine = String(this.extractLineNumberFromTestId(grandChild.id));
                      const childKey = `${relativeFeaturePath}:${featureLineNumber}:${childLine}`;

                      const status = testResult.scenarioResults?.[childKey];
                      if (status === "passed") {
                        this.testStatusCache.set(childKey, "passed");
                        this.updateTestStatus(grandChild.id, "passed");
                        try {
                          run.passed(grandChild);
                        } catch (error) {
                          this.context.logger.error("Error calling run.passed for outline example", { childId: grandChild.id, error: String(error) });
                        }
                      } else if (status === "failed") {
                        this.testStatusCache.set(childKey, "failed");
                        this.updateTestStatus(grandChild.id, "failed");
                        try {
                          run.failed(grandChild, this.failureMessage(testResult.scenarioOutputs?.[childKey], "Test failed"));
                        } catch (error) {
                          this.context.logger.error("Error calling run.failed for outline example", { childId: grandChild.id, error: String(error) });
                        }
                        anyFailed = true;
                        allPassed = false;
                      } else {
                        try {
                          run.skipped(grandChild);
                        } catch (error) {
                          this.context.logger.error("Error calling run.skipped for outline example", { childId: grandChild.id, error: String(error) });
                        }
                        allPassed = false;
                      }
                    }

                    if (anyFailed) {
                      this.updateTestStatus(child.id, "failed");
                      try {
                        run.failed(child, new vscode.TestMessage("One or more examples failed"));
                      } catch (error) {
                        this.context.logger.error("Error calling run.failed for parent", { childId: child.id, error: String(error) });
                      }
                    } else if (allPassed) {
                      this.updateTestStatus(child.id, "passed");
                      try {
                        run.passed(child);
                      } catch (error) {
                        this.context.logger.error("Error calling run.passed for parent", { childId: child.id, error: String(error) });
                      }
                    } else {
                      try {
                        run.skipped(child);
                      } catch (error) {
                        this.context.logger.error("Error calling run.skipped for parent", { childId: child.id, error: String(error) });
                      }
                    }
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
            } else if (test.id.includes(":outline:")) {
              // Scenario outline node: run all examples by outline name
              const filePath = test.uri.fsPath;
              const outlineMatch = test.id.match(/:outline:(.+)$/);
              const outlineName = outlineMatch ? outlineMatch[1] : test.label.replace(/^Scenario Outline: /, "");
              await this.displayShellRun(() => this.context.testExecutor.runScenario({
                filePath,
                scenarioName: outlineName ?? "",
              }));
              testResult = await this.context.testExecutor.runScenarioWithOutput({
                filePath,
                scenarioName: outlineName ?? "",
              });
              this.appendRunOutput(run, testResult);
              this.attachScenarioOutputs(run, test, testResult.scenarioOutputs, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
              if (testResult.scenarioResults && test.children.size > 0) {
                // Walk every leaf example (may be nested under per-Examples-block groups)
                const leaves = this.collectLeafTestItems(test);
                // Mark intermediate groupings (blocks) as started so VS Code shows progress
                test.children.forEach((directChild) => {
                  if (directChild.children.size > 0) {
                    run.started(directChild);
                    this.updateTestStatus(directChild.id, "started");
                  }
                });

                for (const child of leaves) {
                  const childLine = this.extractLineNumberFromTestId(child.id);
                  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
                  const relativeFeaturePath = path.relative(workspaceRoot, filePath);
                  let featureLineNumber: number | undefined = undefined;
                  if (test.parent?.range) {
                    featureLineNumber = test.parent.range.start.line + 1;
                  }
                  const childKey = featureLineNumber
                    ? `${relativeFeaturePath}:${featureLineNumber}:${childLine}`
                    : `${relativeFeaturePath}:${childLine}`;
                  const status = testResult.scenarioResults?.[childKey];
                  if (status === "passed") {
                    this.testStatusCache.set(childKey, "passed");
                    this.updateTestStatus(child.id, "passed");
                    try {
                      run.passed(child);
                    } catch (error) {
                      this.context.logger.error("Error calling run.passed for outline", { childId: child.id, error: String(error) });
                    }
                  } else if (status === "failed") {
                    this.testStatusCache.set(childKey, "failed");
                    this.updateTestStatus(child.id, "failed");
                    try {
                      run.failed(child, this.failureMessage(testResult.scenarioOutputs?.[childKey], "Test failed"));
                    } catch (error) {
                      this.context.logger.error("Error calling run.failed for outline", { childId: child.id, error: String(error) });
                    }
                  } else {
                    try {
                      run.skipped(child);
                    } catch (error) {
                      this.context.logger.error("Error calling run.skipped for outline", { childId: child.id, error: String(error) });
                    }
                  }
                }
              } else {
                this.context.logger.warn("No scenarioResults mapping found, falling back to overall result for all children", { testId: test.id });
                this.markAllChildrenBasedOnResult(test, run, testResult);
              }
            } else if (isGroupTest) {
              // Run all scenarios in the group (file-level fallback)
              const groupFilePath = test.uri.fsPath;
              await this.displayShellRun(() => this.context.testExecutor.runFeatureFile({
                filePath: groupFilePath,
              }));

              testResult = await this.context.testExecutor.runFeatureFileWithOutput({
                filePath: groupFilePath,
              });
              this.appendRunOutput(run, testResult);
              this.attachScenarioOutputs(run, test, testResult.scenarioOutputs, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
              if (testResult.scenarioResults && test.children.size > 0) {
                for (const [, child] of Array.from(test.children)) {
                  const childLine = this.extractLineNumberFromTestId(child.id);
                  const childKey = `${test.uri.fsPath}:${childLine}`;
                  const status = testResult.scenarioResults[childKey];
                  if (status === "passed") {
                    this.updateTestStatus(child.id, "passed");
                    try {
                      run.passed(child);
                    } catch (error) {
                      this.context.logger.error("Error calling run.passed for group", { childId: child.id, error: String(error) });
                    }
                  } else if (status === "failed") {
                    this.updateTestStatus(child.id, "failed");

                    try {
                      run.failed(child, this.failureMessage(testResult.scenarioOutputs?.[childKey], "Test failed"));
                    } catch (error) {
                      this.context.logger.error("Error calling run.failed for group", { childId: child.id, error: String(error) });
                    }
                  } else {
                    try {
                      run.skipped(child);
                    } catch (error) {
                      this.context.logger.error("Error calling run.skipped for group", { childId: child.id, error: String(error) });
                    }
                  }
                }
              } else {
                this.context.logger.warn("No scenarioResults mapping found, falling back to overall result for all children", { testId: test.id });
                this.markAllChildrenBasedOnResult(test, run, testResult);
              }
            } else {
              // Run a specific scenario
              const isScenarioOutlineExample =
                this.isScenarioOutlineExample(scenarioName);

              const scenarioOptions: import("../types").TestExecutionOptions = {
                filePath: test.uri.fsPath,
                ...(lineNumber ? { lineNumber } : {}),
                ...(scenarioName ? { scenarioName } : {}),
              };

              await this.displayShellRun(() => this.context.testExecutor.runScenario(scenarioOptions));

              if (isScenarioOutlineExample) {
                // For scenario outline examples, run the entire outline to ensure all examples are executed
                const originalOutlineName = this.extractOriginalOutlineName(
                  scenarioName ?? ""
                );
                testResult = await this.context.testExecutor.runScenarioWithOutput({
                  ...scenarioOptions,
                  scenarioName: originalOutlineName,
                });
              } else {
                testResult = await this.context.testExecutor.runScenarioWithOutput(
                  scenarioOptions
                );
              }
              this.appendRunOutput(run, testResult);
              const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
              this.attachScenarioOutputs(run, test, testResult.scenarioOutputs, workspaceRoot);

              // For scenario outline examples, store all example results in the cache
              if (isScenarioOutlineExample && testResult.scenarioResults) {
                for (const [childKey, status] of Object.entries(testResult.scenarioResults)) {
                  this.testStatusCache.set(childKey, status as "passed" | "failed");
                  const lineMatch = childKey.match(/:(\d+)$/);
                  if (lineMatch) {
                    const childLine = lineMatch[1];
                    const childId = `:${childLine}`;
                    this.updateTestStatus(childId, status as "passed" | "failed");
                  }
                }
              }

              const parentRef = test.parent?.uri
                ? { id: test.parent.id, uri: test.parent.uri }
                : { id: test.parent?.id ?? "" };
              const foundStatus = this.context.testItemMapping.getScenarioStatusForTestItem(
                { id: test.id, uri: test.uri },
                parentRef,
                testResult.scenarioResults ?? {},
                workspaceRoot
              );
              const foundOutput = this.context.testItemMapping.getScenarioStatusForTestItem(
                { id: test.id, uri: test.uri },
                parentRef,
                testResult.scenarioOutputs ?? {},
                workspaceRoot
              );

              if (!foundStatus && testResult.success) {
                run.passed(test);
                this.updateTestStatus(test.id, "passed");
              } else if (!foundStatus && !testResult.success) {
                run.failed(test, this.failureMessage(foundOutput ?? testResult.display, "Test failed"));
                this.updateTestStatus(test.id, "failed");
              } else if (foundStatus === "passed") {
                run.passed(test);
                this.updateTestStatus(test.id, "passed");
              } else if (foundStatus === "failed") {
                run.failed(test, this.failureMessage(foundOutput, "Test failed"));
                this.updateTestStatus(test.id, "failed");
              } else {
                run.skipped(test);
              }
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
          // Tag group execution: run Behave once with the tag expression
          const tagMatch = test.id.match(/^tag:(.+)$/);
          const tag = tagMatch?.[1] ?? test.label ?? "";
          await this.displayShellRun(() => this.context.testExecutor.runAllTestsWithTags(tag));
          const testResult = await this.context.testExecutor.runAllTestsWithTagsOutput(tag);
          this.appendRunOutput(run, testResult);
          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
          this.attachScenarioOutputs(run, test, testResult.scenarioOutputs, workspaceRoot);
          for (const [, child] of Array.from(test.children)) {
            const status = this.context.testItemMapping.getScenarioStatusForTestItem(
              child as { id: string; uri?: vscode.Uri },
              test as { id: string; uri?: vscode.Uri },
              testResult.scenarioResults ?? {},
              workspaceRoot
            );
            if (status === "passed") {
              run.passed(child);
              this.updateTestStatus(child.id, "passed");
            } else if (status === "failed") {
              const childOutput = this.context.testItemMapping.getScenarioStatusForTestItem(
                child as { id: string; uri?: vscode.Uri },
                test as { id: string; uri?: vscode.Uri },
                testResult.scenarioOutputs ?? {},
                workspaceRoot
              );
              run.failed(child, this.failureMessage(childOutput, "Test failed"));
              this.updateTestStatus(child.id, "failed");
            } else {
              run.skipped(child);
            }
          }
          // Mark the group test based on whether all children passed
          const allPassed = Object.values(testResult.scenarioResults ?? {}).every(s => s === "passed");
          if (allPassed) {
            run.passed(test);
            this.updateTestStatus(test.id, "passed");
          } else {
            run.failed(test, new vscode.TestMessage("One or more scenarios failed"));
            this.updateTestStatus(test.id, "failed");
          }
          return;
        }
        // For flat, file, and scenario type organizations, aggregate results across all relevant feature files before marking children
        else if (this.isGroupTest(test.id)) {
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
            await this.displayShellRun(() => this.context.testExecutor.runFeatureFile({ filePath }));
            const result = await this.context.testExecutor.runFeatureFileWithOutput({ filePath });
            this.appendRunOutput(run, result);
            Object.assign(aggregatedScenarioResults, result.scenarioResults);
            Object.assign(aggregatedScenarioOutputs, result.scenarioOutputs);
          }

          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
          this.attachScenarioOutputs(run, test, aggregatedScenarioOutputs, workspaceRoot);
          for (const [, child] of Array.from(test.children)) {
            if (this.isScenarioOutlineParent(child)) {
              let anyFailed = false;
              let allPassed = true;

              for (const [, grandChild] of Array.from(child.children)) {
                const grandChildStatus = this.context.testItemMapping.getScenarioStatusForTestItem(
                  grandChild as { id: string; uri?: vscode.Uri },
                  child as { id: string; uri?: vscode.Uri },
                  aggregatedScenarioResults,
                  workspaceRoot
                );

                if (grandChildStatus === "failed") {
                  anyFailed = true;
                  allPassed = false;
                } else if (grandChildStatus !== "passed") {
                  allPassed = false;
                }
              }

              if (anyFailed) {
                run.failed(child, new vscode.TestMessage("One or more examples failed"));
                this.updateTestStatus(child.id, "failed");
              } else if (allPassed) {
                run.passed(child);
                this.updateTestStatus(child.id, "passed");
              } else {
                run.skipped(child);
              }
              continue;
            }

            const foundStatus = this.context.testItemMapping.getScenarioStatusForTestItem(
              child as { id: string; uri?: vscode.Uri },
              test as { id: string; uri?: vscode.Uri },
              aggregatedScenarioResults,
              workspaceRoot
            );
            if (foundStatus === "passed") {
              run.passed(child);
            } else if (foundStatus === "failed") {
              const childOutput = this.context.testItemMapping.getScenarioStatusForTestItem(
                child as { id: string; uri?: vscode.Uri },
                test as { id: string; uri?: vscode.Uri },
                aggregatedScenarioOutputs,
                workspaceRoot
              );
              run.failed(child, this.failureMessage(childOutput, "Scenario failed"));
            } else {
              run.skipped(child);
            }
          }

          const allPassed = Object.values(aggregatedScenarioResults).every(s => s === "passed");
          if (allPassed) {
            run.passed(test);
            this.updateTestStatus(test.id, "passed");
          } else {
            run.failed(test, new vscode.TestMessage("One or more scenarios failed"));
            this.updateTestStatus(test.id, "failed");
          }
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

  private createTagBasedTestHierarchy(
    organizedGroups: TestGroup[],
    _allScenarios: Array<{ scenario: Scenario; file: vscode.Uri }>
  ): void {
    for (const group of organizedGroups) {
      if (group.scenarios.length > 0) {
        const groupItem = this.testController.createTestItem(
          group.id,
          group.label,
          undefined
        );
        groupItem.canResolveChildren = true;
        groupItem.description = group.description ?? "";
        groupItem.range = undefined;

        for (const scenario of group.scenarios) {
          const scenarioItem = this.createScenarioTestItem(
            vscode.Uri.file(scenario.filePath),
            scenario
          );
          groupItem.children.add(scenarioItem);
        }

        this.testController.items.add(groupItem);
      }
    }
  }

  private async createFeatureBasedTestHierarchy(
    organizedGroups: TestGroup[],
    _allScenarios: Array<{ scenario: Scenario; file: vscode.Uri }>
  ): Promise<void> {
    for (const group of organizedGroups) {
      if (group.scenarios.length > 0) {
        const groupItem = this.testController.createTestItem(
          `group:${group.id}`,
          group.label,
          undefined
        );
        groupItem.canResolveChildren = true;
        groupItem.description = group.description ?? "";
        groupItem.range = undefined;

        for (const scenario of group.scenarios) {
          const scenarioItem = this.createScenarioTestItem(
            vscode.Uri.file(scenario.filePath),
            scenario
          );
          groupItem.children.add(scenarioItem);
        }

        this.testController.items.add(groupItem);
      }
    }

    // Small delay to ensure UI updates properly
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  private async createHierarchicalFeatureBasedTestHierarchy(
    _organizedGroups: TestGroup[],
    allScenarios: Array<{ scenario: Scenario; file: vscode.Uri }>
  ): Promise<void> {
    // For FeatureBasedOrganization, feature files are root items with scenarios as children
    const uniqueFeatureFiles = new Set<string>();
    for (const { file } of allScenarios) {
      uniqueFeatureFiles.add(file.fsPath);
    }

    for (const filePath of uniqueFeatureFiles) {
      const file = vscode.Uri.file(filePath);
      await this.addFeatureFileToTestController(file);
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
        this.isScenarioOutlineExample(child.label)
      )
    );
  }

  private extractFeatureFileFromTestId(testId: string): string | undefined {
    const parts = testId.split(":");
    if (parts.length >= 2) {
      return parts[0];
    }
    return undefined;
  }
}
