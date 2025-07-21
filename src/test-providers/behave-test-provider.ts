import * as vscode from "vscode";
import { FeatureParser } from "../parsers/feature-parser";
import { TestExecutor } from "../core/test-executor";
import { Scenario, TestOrganizationStrategy } from "../types";
import { Logger } from "../utils/logger";
import { ExtensionConfig } from "../core/extension-config";
import { TestDiscoveryManager } from "../core/test-discovery-manager";
import { TestOrganizationManager } from "../core/test-organization";

/**
 * Provides test discovery and execution for Behave tests
 */
export class BehaveTestProvider {
  private testController: vscode.TestController;
  private discoveredTests: Map<string, vscode.TestItem>;
  private config: ExtensionConfig;
  private testExecutor: TestExecutor;
  private discoveryManager: TestDiscoveryManager;
  private organizationManager: TestOrganizationManager;
  private testStatusCache: Map<string, "started" | "passed" | "failed"> =
    new Map();
  private testStatusByLocation: Map<string, "started" | "passed" | "failed"> =
    new Map();

  constructor(testController: vscode.TestController) {
    this.testController = testController;
    this.discoveredTests = new Map();
    this.config = ExtensionConfig.getInstance();
    this.testExecutor = new TestExecutor(
      vscode.workspace,
      vscode.window,
      vscode.debug
    );
    this.discoveryManager = TestDiscoveryManager.getInstance();
    this.organizationManager = TestOrganizationManager.getInstance();
    this.setupTestController();

    // Discover tests immediately after setup
    this.discoverTests().catch((_error) => {
      // console.error("Error during initial test discovery:", _error);
    });

    // Set up file watcher for feature files
    this.setupFileWatcher();
  }

  /**
   * Setup the test controller with run and debug profiles
   */
  private setupTestController(): void {
    // Set up test resolver for discovery
    this.testController.resolveHandler = async (test) => {
      if (!test) {
        // Root level - discover all tests
        await this.discoverTests();
      } else if (test.canResolveChildren) {
        // Feature file level - resolve scenarios
        // The scenarios are already added in addFeatureFileToTestController
        // This is just for VS Code to know the children are resolved
      }
    };

    // Create run profile with proper gutter button type
    const runProfile = this.testController.createRunProfile(
      "Run",
      vscode.TestRunProfileKind.Run,
      async (request) => {
        await this.runTests(request);
      }
    );
    runProfile.configureHandler = () => {};

    // Create debug profile with proper gutter button type
    const debugProfile = this.testController.createRunProfile(
      "Debug",
      vscode.TestRunProfileKind.Debug,
      async (request) => {
        await this.debugTests(request);
      }
    );
    debugProfile.configureHandler = () => {};

    // Create parallel run profile with proper gutter button type
    const parallelProfile = this.testController.createRunProfile(
      "Run in Parallel",
      vscode.TestRunProfileKind.Run,
      async (request) => {
        await this.runTestsInParallel(request);
      }
    );
    parallelProfile.configureHandler = () => {};
  }

  /**
   * Save current test status before clearing test items
   */
  private saveTestStatus(): void {
    // Only save status for tests that have actually been run
    // Don't clear the cache - keep existing status for tests that have been executed
    Logger.getInstance().info("Preserving existing test status cache", {
      idCacheSize: this.testStatusCache.size,
      locationCacheSize: this.testStatusByLocation.size,
    });
  }

  /**
   * Update test status in the cache
   */
  public updateTestStatus(
    testId: string,
    status: "started" | "passed" | "failed"
  ): void {
    this.testStatusCache.set(testId, status);

    // Also store by location for organization-independent tracking
    const locationKey = this.getLocationKey(testId);
    if (locationKey) {
      this.testStatusByLocation.set(locationKey, status);
    }

    Logger.getInstance().debug(
      `Updated test status cache for ${testId}: ${status}`
    );
  }

  /**
   * Get location-based key for a test ID
   */
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

  /**
   * Restore test status after recreating test items
   */
  private restoreTestStatus(): void {
    if (this.testStatusByLocation.size === 0) {
      return;
    }

    let restoredCount = 0;

    const restoreStatusRecursively = (testItem: vscode.TestItem) => {
      // Try to find status by location key first
      const locationKey = this.getLocationKey(testItem.id);
      let cachedStatus = locationKey
        ? this.testStatusByLocation.get(locationKey)
        : undefined;

      // Fallback to test ID cache
      cachedStatus ??= this.testStatusCache.get(testItem.id);

      if (cachedStatus) {
        // Create a test run to restore the status
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
        restoredCount++;
      }

      // Recursively restore status for children
      testItem.children.forEach(restoreStatusRecursively);
    };

    this.testController.items.forEach(restoreStatusRecursively);

    Logger.getInstance().info("Restored test status cache", {
      locationCacheSize: this.testStatusByLocation.size,
      idCacheSize: this.testStatusCache.size,
      restoredStatusCount: restoredCount,
    });
  }

  /**
   * Discover tests in the workspace with intelligent caching
   */
  public async discoverTests(): Promise<void> {
    try {
      const pattern = this.config.testFilePattern;

      if (!pattern || pattern.trim() === "") {
        throw new Error("Test file pattern is empty or invalid");
      }

      // Use the discovery manager for intelligent caching
      const filePaths = await this.discoveryManager.discoverTestFiles({
        pattern,
        forceRefresh: true, // Force refresh to ensure we get the latest files
      });

      Logger.getInstance().info(
        `Discovered ${filePaths.length} feature files`,
        {
          pattern,
          cacheStats: this.discoveryManager.getCacheStats(),
        }
      );

      // Save current test status before clearing
      this.saveTestStatus();

      // Clear existing test items to avoid duplicates
      this.testController.items.replace([]);
      this.discoveredTests.clear();

      Logger.getInstance().info(
        "Cleared existing test items and discovered tests map",
        {
          previousTestItems: this.testController.items.size,
          previousDiscoveredTests: this.discoveredTests.size,
        }
      );

      // First pass: collect all scenarios from all feature files
      const allScenarios: Array<{ scenario: Scenario; file: vscode.Uri }> = [];
      const featureFiles: Array<{ file: vscode.Uri; parsed: any }> = [];

      for (const filePath of filePaths) {
        try {
          const file = vscode.Uri.file(filePath);
          const content = await vscode.workspace.fs.readFile(file);
          const text = new TextDecoder().decode(content);
          const parsed = FeatureParser.parseFeatureContent(text);

          if (parsed) {
            featureFiles.push({ file, parsed });
            // Add file path to each scenario for reference
            for (const scenario of parsed.scenarios) {
              scenario.filePath = file.fsPath;
            }
            allScenarios.push(
              ...parsed.scenarios.map((scenario) => ({ scenario, file }))
            );
          }
        } catch (fileError) {
          const errorMessage =
            fileError instanceof Error
              ? fileError.message
              : "Unknown error occurred";
          Logger.getInstance().error(
            `Failed to process feature file ${filePath}: ${errorMessage}`
          );
          // Continue processing other files even if one fails
        }
      }

      // Second pass: organize all scenarios using the current strategy
      const allScenarioObjects = allScenarios.map((item) => item.scenario);
      const organizedGroups =
        this.organizationManager.organizeTests(allScenarioObjects);

      // Third pass: create test hierarchy based on organization
      if (
        this.organizationManager.getStrategy().strategyType ===
        "TagBasedOrganization"
      ) {
        // For tag-based organization, create a flat structure with tag groups at the root
        this.createTagBasedTestHierarchy(organizedGroups, allScenarios);
      } else if (
        this.organizationManager.getStrategy().strategyType ===
        "FeatureBasedOrganization"
      ) {
        // For feature-based organization, create hierarchical structure with feature files as root
        await this.createHierarchicalFeatureBasedTestHierarchy(
          organizedGroups,
          allScenarios
        );
      } else {
        // For other organizations, create hierarchy based on organized groups
        await this.createFeatureBasedTestHierarchy(
          organizedGroups,
          allScenarios
        );
      }

      // Restore test status after recreating test items
      this.restoreTestStatus();

      Logger.getInstance().info("Test discovery completed", {
        totalTestItems: this.testController.items.size,
        discoveredTestsCount: this.discoveredTests.size,
        organizationStrategy: this.getOrganizationStrategyName(),
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      Logger.getInstance().error(`Failed to discover tests: ${errorMessage}`, {
        pattern: this.config.testFilePattern,
      });

      vscode.window.showErrorMessage(
        `Test discovery failed: ${errorMessage}. Please check your configuration.`
      );
    }
  }

  /**
   * Add a feature file to the test controller with proper gutter button hierarchy
   * @param file - Feature file URI
   */
  public async addFeatureFileToTestController(file: vscode.Uri): Promise<void> {
    try {
      if (!file?.fsPath) {
        throw new Error("Invalid file URI provided");
      }

      const content = await vscode.workspace.fs.readFile(file);
      const text = new TextDecoder().decode(content);
      const parsed = FeatureParser.parseFeatureContent(text);

      if (!parsed) {
        Logger.getInstance().warn(
          `Failed to parse feature file: ${file.fsPath}`
        );
        return;
      }

      // Create the main feature file test item
      const featureItem = this.testController.createTestItem(
        file.fsPath,
        parsed.feature,
        file
      );

      // Configure the feature file test item with proper gutter button positioning
      featureItem.canResolveChildren = true;

      // Set the range to the feature line for proper gutter button positioning
      // Only set range if we have a valid feature line number
      if (parsed.featureLineNumber && parsed.featureLineNumber > 0) {
        featureItem.range = new vscode.Range(
          parsed.featureLineNumber - 1,
          0,
          parsed.featureLineNumber - 1,
          0
        );
      }

      // For non-tag organizations, create a simple flat structure under the feature
      // Group scenarios by their original outline (if they are examples)
      const scenarioGroups = this.groupScenariosByOutline(parsed.scenarios);

      // Add scenarios to feature
      for (const [outlineName, scenarios] of scenarioGroups) {
        if (scenarios.length === 1 && !scenarios[0]?.isScenarioOutline) {
          // Single regular scenario - add directly to feature for individual run/debug buttons
          const scenario = scenarios[0];
          if (scenario) {
            const scenarioItem = this.createScenarioTestItem(
              file,
              scenario,
              `${file.fsPath}:${scenario.lineNumber}`
            );
            featureItem.children.add(scenarioItem);
          }
        } else if (scenarios.length > 1 && scenarios[0]?.isScenarioOutline) {
          // Multiple examples from same outline - create parent outline item AND individual examples
          const hasOutlineLineNumber = scenarios[0]?.outlineLineNumber;
          if (hasOutlineLineNumber) {
            // Create the outline item for "run all examples" functionality
            const outlineItem = this.createOutlineTestItem(
              file,
              outlineName,
              scenarios,
              `${file.fsPath}:outline:${outlineName}`
            );
            featureItem.children.add(outlineItem);
          } else {
            // If no outline line number, add examples individually to avoid overlapping
            for (const scenario of scenarios) {
              const scenarioItem = this.createScenarioTestItem(
                file,
                scenario,
                `${file.fsPath}:${scenario.lineNumber}`
              );
              featureItem.children.add(scenarioItem);
            }
          }
        } else if (scenarios.length === 1 && scenarios[0]?.isScenarioOutline) {
          // Single example from outline - add directly as individual test item
          const scenario = scenarios[0];
          if (scenario) {
            const scenarioItem = this.createScenarioTestItem(
              file,
              scenario,
              `${file.fsPath}:${scenario.lineNumber}`
            );
            featureItem.children.add(scenarioItem);
          }
        } else {
          // Multiple regular scenarios - add each individually for individual run/debug buttons
          for (const scenario of scenarios) {
            const scenarioItem = this.createScenarioTestItem(
              file,
              scenario,
              `${file.fsPath}:${scenario.lineNumber}`
            );
            featureItem.children.add(scenarioItem);
          }
        }
      }

      this.testController.items.add(featureItem);
      this.discoveredTests.set(file.fsPath, featureItem);

      Logger.getInstance().info(
        `Successfully added feature file to test controller: ${file.fsPath}`,
        {
          scenarios: parsed.scenarios.length,
          organizationStrategy: this.getOrganizationStrategyName(),
        }
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      Logger.getInstance().error(
        `Failed to add feature file to test controller: ${errorMessage}`,
        {
          filePath: file.fsPath,
        }
      );

      throw error; // Re-throw to be handled by the caller
    }
  }

  /**
   * Group scenarios by their original outline name
   * @param scenarios - Array of scenarios
   * @returns Map of outline name to scenarios
   */
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

        // Ensure outlineName is a string
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
        // Regular scenario - each gets its own individual group for individual buttons
        // Use a unique key to ensure each scenario gets its own group
        const groupKey = `scenario_${
          scenario.lineNumber
        }_${scenario.name.replace(/\s+/g, "_")}`;
        groups.set(groupKey, [scenario]);
      }
    }

    return groups;
  }

  /**
   * Create a test item for a scenario outline with its examples
   * @param file - Feature file URI
   * @param outlineName - Name of the outline
   * @param examples - Array of example scenarios
   * @param testId - Test item ID
   * @returns Test item
   */
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

    // Configure the outline test item with proper gutter button positioning
    outlineItem.canResolveChildren = true;
    outlineItem.description = `${examples.length} example(s)`;

    // Set the range to the scenario outline line for proper gutter button positioning
    // Only set range if we have a valid outline line number to avoid overlap with examples
    if (
      examples.length > 0 &&
      examples[0]?.outlineLineNumber &&
      examples[0].outlineLineNumber > 0
    ) {
      const outlineLine = examples[0].outlineLineNumber - 1;
      outlineItem.range = new vscode.Range(outlineLine, 0, outlineLine, 0);
    } else {
      // If no valid outline line number, don't set a range to prevent overlap
      outlineItem.range = undefined;
    }

    // Add each example as a child for individual run/debug buttons
    // Each example will have its own gutter button at its specific line
    for (const example of examples) {
      const exampleItem = this.createScenarioTestItem(
        file,
        example,
        `${file.fsPath}:${example.lineNumber}`
      );
      outlineItem.children.add(exampleItem);
    }

    return outlineItem;
  }

  /**
   * Create a test item for a scenario
   * @param file - Feature file URI
   * @param scenario - Scenario data
   * @param testId - Test item ID
   * @returns Test item
   */
  private createScenarioTestItem(
    file: vscode.Uri,
    scenario: Scenario,
    testId: string
  ): vscode.TestItem {
    const scenarioItem = this.testController.createTestItem(
      testId,
      scenario.name,
      file
    );

    // Configure the scenario test item with proper gutter button positioning
    // Only set range if we have a valid line number to avoid overlap
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

    return scenarioItem;
  }

  /**
   * Refresh tests in the workspace with cache management
   */
  public async refreshTests(): Promise<void> {
    try {
      Logger.getInstance().info("Starting test refresh");

      // Force refresh the discovery cache
      await this.discoveryManager.refreshCache();

      // Clear existing tests
      this.testController.items.replace([]);
      this.discoveredTests.clear();

      // Rediscover tests
      await this.discoverTests();

      Logger.getInstance().info("Test refresh completed successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      Logger.getInstance().error(`Failed to refresh tests: ${errorMessage}`);

      vscode.window.showErrorMessage(
        `Failed to refresh tests: ${errorMessage}. Please try again.`
      );
    }
  }

  /**
   * Force refresh the Test Explorer view
   */
  public async forceRefreshTestExplorer(): Promise<void> {
    try {
      Logger.getInstance().info("Forcing Test Explorer refresh");

      // Clear all test items
      this.testController.items.replace([]);
      this.discoveredTests.clear();

      // Force VS Code to recognize the changes by triggering multiple refresh mechanisms

      // 1. Trigger the resolve handler
      if (this.testController.resolveHandler) {
        await this.testController.resolveHandler(undefined);
      }

      // 2. Try to trigger VS Code's internal refresh command
      try {
        await vscode.commands.executeCommand("testing.refreshTests");
      } catch (error) {
        Logger.getInstance().debug("Built-in refresh command failed", {
          error,
        });
      }

      // 3. Try to trigger workspace refresh
      try {
        await vscode.commands.executeCommand("workbench.action.files.revert");
      } catch (error) {
        Logger.getInstance().debug("Workspace revert command failed", {
          error,
        });
      }

      // 4. Force a UI update by triggering a test run request
      try {
        const run = this.testController.createTestRun(
          new vscode.TestRunRequest()
        );
        run.end();
      } catch (error) {
        Logger.getInstance().debug("Test run creation failed", {
          error,
        });
      }

      Logger.getInstance().info(
        "Test Explorer refresh triggered with multiple mechanisms"
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      Logger.getInstance().error("Failed to force refresh Test Explorer", {
        error: errorMessage,
      });
    }
  }

  /**
   * Check if a scenario is a scenario outline example
   */
  private isScenarioOutlineExample(scenarioName?: string): boolean {
    if (!scenarioName) {
      return false;
    }

    // Check if the scenario name follows the pattern of scenario outline examples
    // Pattern: "1: Scenario Name - param1: value1, param2: value2"
    return /^\d+:\s*.+\s*-\s*/.test(scenarioName);
  }

  /**
   * Extract the original outline name from a scenario outline example name
   */
  private extractOriginalOutlineName(scenarioName: string): string {
    // Extract the original outline name from "1: Scenario Name - param1: value1, param2: value2"
    const match = scenarioName.match(/^\d+:\s*(.+?)\s*-\s*/);
    const extracted = match?.[1] ?? scenarioName;
    // Handle edge case where only whitespace was captured
    const trimmed = extracted.trim();
    // If the extracted name is empty (like "1: - param: value"), return original scenario name
    // Otherwise return the trimmed name or original scenario name
    return trimmed || scenarioName;
  }

  /**
   * Get discovered tests
   * @returns Map of discovered tests
   */
  public getDiscoveredTests(): Map<string, vscode.TestItem> {
    return this.discoveredTests;
  }

  /**
   * Get cache statistics for monitoring
   * @returns Cache statistics
   */
  public getCacheStats(): ReturnType<
    typeof this.discoveryManager.getCacheStats
  > {
    return this.discoveryManager.getCacheStats();
  }

  /**
   * Set the test organization strategy
   * @param strategy - The organization strategy to use
   */
  public setOrganizationStrategy(strategy: TestOrganizationStrategy): void {
    try {
      this.organizationManager.setStrategy(strategy);
      Logger.getInstance().info("Test organization strategy changed", {
        strategy: strategy.constructor.name,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      Logger.getInstance().error(
        `Failed to set organization strategy: ${errorMessage}`
      );
    }
  }

  /**
   * Get the current organization strategy
   * @returns Current organization strategy
   */
  public getOrganizationStrategy(): TestOrganizationStrategy {
    return this.organizationManager.getStrategy();
  }

  /**
   * Get available organization strategies
   * @returns Array of available strategies
   */
  public getAvailableOrganizationStrategies(): ReturnType<
    typeof this.organizationManager.getAvailableStrategies
  > {
    return this.organizationManager.getAvailableStrategies();
  }

  /**
   * Set up file watcher for feature files
   */
  private setupFileWatcher(): void {
    const pattern = this.config.testFilePattern;
    const fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    fileWatcher.onDidCreate((uri) => {
      this.addFeatureFileToTestController(uri).catch((_err) => {
        // console.error(`Error adding feature file on create:`, _err);
      });
    });

    fileWatcher.onDidChange(async (_uri) => {
      // Force refresh the specific file and its cache
      await this.discoveryManager.refreshCache();
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
   * Run tests based on the test run request
   * @param request - Test run request
   */
  private async runTests(request: vscode.TestRunRequest): Promise<void> {
    const run = this.testController.createTestRun(request);

    try {
      for (const test of request.include ?? []) {
        run.started(test);

        // Update status cache to track that this test has been started
        this.updateTestStatus(test.id, "started");

        if (test.uri) {
          const lineNumber = this.extractLineNumberFromTestId(test.id);
          const isFeatureFile = this.isFeatureFileTest(test.id);
          const isGroupTest = this.isGroupTest(test.id);
          const scenarioName = isFeatureFile ? undefined : test.label;

          // Debug logging to understand what's being executed
          Logger.getInstance().info(`Executing test: ${test.label}`, {
            testId: test.id,
            filePath: test.uri.fsPath,
            lineNumber,
            isFeatureFile,
            isGroupTest,
            scenarioName,
          });

          try {
            let testResult: import("../types").TestRunResult;

            if (isFeatureFile) {
              // Run the entire feature file
              Logger.getInstance().info(
                `Running entire feature file: ${test.uri.fsPath}`
              );

              // First, run the feature file in the terminal to show output to user
              await this.testExecutor.runFeatureFile({
                filePath: test.uri.fsPath,
              });

              testResult = await this.testExecutor.runFeatureFileWithOutput({
                filePath: test.uri.fsPath,
              });

              // Mark all child tests based on the feature file result
              this.markAllChildrenBasedOnResult(test, run, testResult);
            } else if (isGroupTest) {
              // Run all scenarios in the group
              Logger.getInstance().info(
                `Running all scenarios in group: ${test.label}`
              );

              // First, run the feature file in the terminal to show output to user
              await this.testExecutor.runFeatureFile({
                filePath: test.uri.fsPath,
              });

              testResult = await this.testExecutor.runFeatureFileWithOutput({
                filePath: test.uri.fsPath,
              });

              // Mark all child tests based on the group result
              this.markAllChildrenBasedOnResult(test, run, testResult);
            } else {
              // Run a specific scenario
              Logger.getInstance().info(
                `Running specific scenario: ${scenarioName} at line ${lineNumber}`
              );

              // Check if this is a scenario outline example
              const isScenarioOutlineExample =
                this.isScenarioOutlineExample(scenarioName);

              const scenarioOptions: import("../types").TestExecutionOptions = {
                filePath: test.uri.fsPath,
                ...(lineNumber ? { lineNumber } : {}),
                ...(scenarioName ? { scenarioName } : {}),
              };

              // First, run the scenario in the terminal to show output to user
              await this.testExecutor.runScenario(scenarioOptions);

              if (isScenarioOutlineExample) {
                // For scenario outline examples, run the entire outline to ensure all examples are executed
                Logger.getInstance().info(
                  `Running scenario outline for example: ${scenarioName}`
                );
                const originalOutlineName = this.extractOriginalOutlineName(
                  scenarioName ?? ""
                );
                testResult = await this.testExecutor.runScenarioWithOutput({
                  ...scenarioOptions,
                  scenarioName: originalOutlineName,
                });
              } else {
                testResult = await this.testExecutor.runScenarioWithOutput(
                  scenarioOptions
                );
              }
            }

            // Mark test based on actual result
            if (testResult.success) {
              run.passed(test);
              this.updateTestStatus(test.id, "passed");

              // Log success with output summary
              Logger.getInstance().info(`Test passed: ${test.label}`, {
                testId: test.id,
                duration: testResult.duration,
                outputLength: testResult.output.length,
              });
            } else {
              // Create test message with error details
              const errorMessage =
                testResult.error ?? "Test failed with no error details";
              const testMessage = new vscode.TestMessage(
                `Test failed: ${errorMessage}`
              );

              // Add output to the test message if available
              if (testResult.output) {
                const fullMessage = `Test failed: ${errorMessage}\n\nOutput:\n${testResult.output}`;
                run.failed(test, new vscode.TestMessage(fullMessage));
              } else {
                run.failed(test, testMessage);
              }

              run.failed(test, testMessage);
              this.updateTestStatus(test.id, "failed");

              // Log failure with details
              Logger.getInstance().error(`Test failed: ${test.label}`, {
                testId: test.id,
                error: errorMessage,
                output: testResult.output,
                duration: testResult.duration,
              });
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            Logger.getInstance().error(
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

            // Update status cache
            this.updateTestStatus(test.id, "failed");
          }
        } else if (this.isGroupTest(test.id)) {
          // Handle tag groups (no URI) - run all scenarios in the group
          Logger.getInstance().info(
            `Running all scenarios in tag group: ${test.label}`
          );

          // Collect all feature files from the group's children
          const featureFiles = new Set<string>();
          const collectFeatureFiles = (testItem: vscode.TestItem) => {
            if (testItem.uri) {
              featureFiles.add(testItem.uri.fsPath);
            }
            testItem.children.forEach(collectFeatureFiles);
          };
          collectFeatureFiles(test);

          // Run all feature files that contain scenarios in this tag group
          let allPassed = true;
          const results: import("../types").TestRunResult[] = [];

          for (const filePath of featureFiles) {
            // First, run the feature file in the terminal to show output to user
            await this.testExecutor.runFeatureFile({
              filePath,
            });

            const result = await this.testExecutor.runFeatureFileWithOutput({
              filePath,
            });
            results.push(result);
            if (!result.success) {
              allPassed = false;
            }
          }

          // Mark all child tests based on combined results
          this.markAllChildrenBasedOnCombinedResults(test, run, results);

          // Mark the group test based on whether all feature files passed
          if (allPassed) {
            run.passed(test);
            this.updateTestStatus(test.id, "passed");
          } else {
            const failedResults = results.filter((r) => !r.success);
            const errorMessage = `Group test failed: ${failedResults.length} feature files failed`;
            run.failed(test, new vscode.TestMessage(errorMessage));
            this.updateTestStatus(test.id, "failed");
          }
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      Logger.getInstance().error(`Error running tests: ${errorMessage}`);
      for (const test of request.include ?? []) {
        run.failed(
          test,
          new vscode.TestMessage(`Test execution failed: ${errorMessage}`)
        );
      }
    } finally {
      run.end();
    }
  }

  /**
   * Debug tests based on the test run request
   * @param request - Test run request
   */
  private async debugTests(request: vscode.TestRunRequest): Promise<void> {
    try {
      for (const test of request.include ?? []) {
        try {
          if (test.uri) {
            const lineNumber = this.extractLineNumberFromTestId(test.id);
            const isFeatureFile = this.isFeatureFileTest(test.id);
            const isGroupTest = this.isGroupTest(test.id);
            const scenarioName = isFeatureFile ? undefined : test.label;

            Logger.getInstance().info(
              `Starting debug session for: ${test.label}`,
              {
                filePath: test.uri.fsPath,
                lineNumber,
                isFeatureFile,
                isGroupTest,
              }
            );

            if (isFeatureFile) {
              // Debug the entire feature file (run all scenarios)
              await this.testExecutor.debugScenario({
                filePath: test.uri.fsPath,
                debug: true,
              });
            } else if (isGroupTest) {
              // Debug all scenarios in the group
              await this.testExecutor.debugScenario({
                filePath: test.uri.fsPath,
                debug: true,
              });
            } else {
              // Debug a specific scenario
              const debugOptions: import("../types").TestExecutionOptions = {
                filePath: test.uri.fsPath,
                ...(lineNumber ? { lineNumber } : {}),
                debug: true,
                ...(scenarioName ? { scenarioName } : {}),
              };
              await this.testExecutor.debugScenario(debugOptions);
            }
          } else if (this.isGroupTest(test.id)) {
            // Handle tag groups (no URI) - debug all scenarios in the group
            Logger.getInstance().info(
              `Starting debug session for tag group: ${test.label}`
            );

            // Collect all feature files from the group's children
            const featureFiles = new Set<string>();
            const collectFeatureFiles = (testItem: vscode.TestItem) => {
              if (testItem.uri) {
                featureFiles.add(testItem.uri.fsPath);
              }
              testItem.children.forEach(collectFeatureFiles);
            };
            collectFeatureFiles(test);

            // Debug all feature files that contain scenarios in this tag group
            for (const filePath of featureFiles) {
              await this.testExecutor.debugScenario({
                filePath,
                debug: true,
              });
            }
          }
        } catch (testError) {
          const errorMessage =
            testError instanceof Error
              ? testError.message
              : "Unknown error occurred";
          Logger.getInstance().error(
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
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      Logger.getInstance().error(
        `Failed to start debug session: ${errorMessage}`
      );

      vscode.window.showErrorMessage(
        `Failed to start debug session: ${errorMessage}`
      );
    }
  }

  /**
   * Mark all child tests based on combined results of multiple tests
   * @param parentTest - The parent test item
   * @param run - The test run instance
   * @param results - Array of results from each test execution
   */
  private markAllChildrenBasedOnCombinedResults(
    parentTest: vscode.TestItem,
    run: vscode.TestRun,
    results: import("../types").TestRunResult[]
  ): void {
    const markChildrenRecursively = (test: vscode.TestItem) => {
      test.children.forEach((child) => {
        run.started(child);

        // For combined results, we'll mark all children based on whether any test failed
        const anyFailed = results.some((r) => !r.success);

        if (!anyFailed) {
          run.passed(child);
          this.updateTestStatus(child.id, "passed");
        } else {
          const failedResults = results.filter((r) => !r.success);
          const errorMessage = `Group test failed: ${failedResults.length} tests failed`;
          run.failed(child, new vscode.TestMessage(errorMessage));
          this.updateTestStatus(child.id, "failed");
        }

        markChildrenRecursively(child);
      });
    };

    markChildrenRecursively(parentTest);
  }

  /**
   * Run tests in parallel based on the test run request
   * @param request - Test run request
   */
  private async runTestsInParallel(
    request: vscode.TestRunRequest
  ): Promise<void> {
    const run = this.testController.createTestRun(request);

    try {
      // Collect all feature files from selected tests
      const featureFiles = new Set<string>();
      for (const test of request.include ?? []) {
        if (test.uri) {
          featureFiles.add(test.uri.fsPath);
        }
      }

      if (featureFiles.size === 0) {
        return;
      }

      // Mark all tests as started and their children
      for (const test of request.include ?? []) {
        run.started(test);

        // Update status cache to track that this test has been started
        this.updateTestStatus(test.id, "started");

        this.markAllChildrenAsStarted(test, run);
      }

      // Run all feature files in parallel
      const featureFilesArray = Array.from(featureFiles);

      // For parallel execution, we'll use the existing parallel runner but capture results
      // This is a simplified approach - in a full implementation, we'd need to modify the parallel runner
      // to return results for each file
      const results: import("../types").TestRunResult[] = [];

      for (const filePath of featureFilesArray) {
        try {
          // First, run the feature file in the terminal to show output to user
          await this.testExecutor.runFeatureFile({
            filePath,
          });

          const result = await this.testExecutor.runFeatureFileWithOutput({
            filePath,
          });
          results.push(result);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          results.push({
            success: false,
            output: "",
            error: errorMessage,
            duration: 0,
          });
        }
      }

      // Mark all tests based on results
      const allPassed = results.every((r) => r.success);

      for (const test of request.include ?? []) {
        if (allPassed) {
          run.passed(test);
          this.updateTestStatus(test.id, "passed");
        } else {
          const failedResults = results.filter((r) => !r.success);
          const errorMessage = `Parallel test execution failed: ${failedResults.length} feature files failed`;
          run.failed(test, new vscode.TestMessage(errorMessage));
          this.updateTestStatus(test.id, "failed");
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      Logger.getInstance().error(
        `Error running tests in parallel: ${errorMessage}`
      );

      for (const test of request.include ?? []) {
        run.failed(
          test,
          new vscode.TestMessage(
            `Parallel test execution failed: ${errorMessage}`
          )
        );
      }
    } finally {
      run.end();
    }
  }

  /**
   * Mark all child tests as started when running a parent test
   * @param parentTest - The parent test item
   * @param run - The test run instance
   */
  private markAllChildrenAsStarted(
    parentTest: vscode.TestItem,
    run: vscode.TestRun
  ): void {
    const markChildrenRecursively = (test: vscode.TestItem) => {
      test.children.forEach((child) => {
        run.started(child);
        this.updateTestStatus(child.id, "started");
        markChildrenRecursively(child);
      });
    };

    markChildrenRecursively(parentTest);
  }

  /**
   * Mark all child tests based on a single test result
   * @param parentTest - The parent test item
   * @param run - The test run instance
   * @param result - The result of the test execution
   */
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

  /**
   * Extract line number from test ID
   * @param testId - Test ID
   * @returns Line number or undefined
   */
  private extractLineNumberFromTestId(testId: string): number | undefined {
    // Handle different test ID formats:
    // 1. /path/to/file.feature:8 (scenario)
    // 2. /path/to/file.feature (feature file)
    // 3. /path/to/file.feature:outline:name (outline)
    // 4. /path/to/file.feature:group:name (group)

    // First try to extract line number from the end
    const lineMatch = testId.match(/:(\d+)$/);
    if (lineMatch) {
      const lineNumber = parseInt(lineMatch[1] ?? "0", 10);
      return lineNumber > 0 ? lineNumber : undefined;
    }

    // If no line number found, check if it's a feature file (no colon at the end)
    const hasColon = testId.includes(":");
    if (!hasColon) {
      // This is a feature file path, no line number
      return undefined;
    }

    // Check if it's an outline or group (contains 'outline:' or 'group:')
    if (
      testId.includes(":outline:") ||
      testId.includes(":group:") ||
      testId.includes("scenario_")
    ) {
      // This is a group or outline item, no specific line number
      return undefined;
    }

    // Try to extract any number from the ID as a fallback
    const numberMatch = testId.match(/:(\d+)/);
    if (numberMatch) {
      const lineNumber = parseInt(numberMatch[1] ?? "0", 10);
      return lineNumber > 0 ? lineNumber : undefined;
    }

    return undefined;
  }

  /**
   * Check if a test ID corresponds to a feature file.
   * @param testId - The test ID to check.
   * @returns True if it's a feature file, false otherwise.
   */
  private isFeatureFileTest(testId: string): boolean {
    // A feature file test ID is just the file path without any additional identifiers
    // It should not contain colons (except for the file extension)
    const hasColon = testId.includes(":");
    if (!hasColon) {
      return true; // No colons means it's just a file path
    }

    // Check if it contains any special identifiers that indicate it's not a feature file
    if (
      testId.includes(":group:") ||
      testId.includes(":outline:") ||
      testId.includes("scenario_")
    ) {
      return false;
    }

    // If it ends with a line number, it's not a feature file
    const lineMatch = testId.match(/:(\d+)$/);
    if (lineMatch) {
      return false;
    }

    // If it has a colon but no special identifiers and no line number, it's likely a feature file
    return true;
  }

  /**
   * Check if a test ID corresponds to a group.
   * @param testId - The test ID to check.
   * @returns True if it's a group, false otherwise.
   */
  private isGroupTest(testId: string): boolean {
    // A group test ID contains special identifiers that indicate it's a group
    return (
      testId.includes(":group:") ||
      testId.includes(":all") ||
      testId.includes(":tag:") ||
      testId.includes(":regular") ||
      testId.includes(":outlines")
    );
  }

  /**
   * Create tag-based test hierarchy with tag groups at the root level
   */
  private createTagBasedTestHierarchy(
    organizedGroups: any[],
    allScenarios: Array<{ scenario: Scenario; file: vscode.Uri }>
  ): void {
    Logger.getInstance().info("Creating tag-based test hierarchy", {
      groupCount: organizedGroups.length,
      totalScenarios: allScenarios.length,
    });

    // Create tag groups at the root level
    for (const group of organizedGroups) {
      if (group.scenarios.length > 0) {
        const groupItem = this.testController.createTestItem(
          `tag:${group.id}`,
          group.label,
          undefined // No URI for tag groups
        );
        groupItem.canResolveChildren = true;
        groupItem.description = group.description ?? "";
        groupItem.range = undefined; // No range for tag groups

        Logger.getInstance().info(`Creating tag group: ${group.label}`, {
          scenarioCount: group.scenarios.length,
          groupId: group.id,
        });

        // Add scenarios to the tag group
        for (const scenario of group.scenarios) {
          const scenarioItem = this.createScenarioTestItem(
            vscode.Uri.file(scenario.filePath),
            scenario,
            `${scenario.filePath}:${scenario.lineNumber}`
          );
          groupItem.children.add(scenarioItem);
        }

        this.testController.items.add(groupItem);
      }
    }

    Logger.getInstance().info("Created tag-based test hierarchy", {
      groupCount: organizedGroups.length,
      totalScenarios: allScenarios.length,
      finalTestItems: this.testController.items.size,
    });
  }

  /**
   * Create feature-based test hierarchy (for non-tag organizations)
   */
  private async createFeatureBasedTestHierarchy(
    organizedGroups: any[],
    allScenarios: Array<{ scenario: Scenario; file: vscode.Uri }>
  ): Promise<void> {
    // For non-tag organizations, create the traditional feature-based structure
    for (const group of organizedGroups) {
      if (group.scenarios.length > 0) {
        const groupItem = this.testController.createTestItem(
          `group:${group.id}`,
          group.label,
          undefined // No URI for group items
        );
        groupItem.canResolveChildren = true;
        groupItem.description = group.description ?? "";
        groupItem.range = undefined; // No range for group items

        Logger.getInstance().info(`Creating feature group: ${group.label}`, {
          scenarioCount: group.scenarios.length,
          groupId: group.id,
        });

        // Add scenarios to the group
        for (const scenario of group.scenarios) {
          const scenarioItem = this.createScenarioTestItem(
            vscode.Uri.file(scenario.filePath),
            scenario,
            `${scenario.filePath}:${scenario.lineNumber}`
          );
          groupItem.children.add(scenarioItem);
        }

        this.testController.items.add(groupItem);
      }
    }

    // Add a small delay to ensure UI updates properly
    await new Promise((resolve) => setTimeout(resolve, 0));

    Logger.getInstance().info("Created feature-based test hierarchy", {
      groupCount: organizedGroups.length,
      totalScenarios: allScenarios.length,
      finalTestItems: this.testController.items.size,
    });
  }

  /**
   * Create a hierarchical test hierarchy for FeatureBasedOrganization
   * This method creates a structure where feature files are at the root,
   * and scenarios are nested under their respective feature files.
   */
  private async createHierarchicalFeatureBasedTestHierarchy(
    organizedGroups: any[],
    allScenarios: Array<{ scenario: Scenario; file: vscode.Uri }>
  ): Promise<void> {
    Logger.getInstance().info(
      "Creating hierarchical feature-based test hierarchy",
      {
        groupCount: organizedGroups.length,
        totalScenarios: allScenarios.length,
      }
    );

    // For FeatureBasedOrganization, we want to create the traditional feature-based structure
    // where each feature file is a root item with scenarios as children
    // This is exactly what addFeatureFileToTestController does

    // Get unique feature files from the scenarios
    const uniqueFeatureFiles = new Set<string>();
    for (const { file } of allScenarios) {
      uniqueFeatureFiles.add(file.fsPath);
    }

    // Add each feature file to the test controller using the existing method
    for (const filePath of uniqueFeatureFiles) {
      const file = vscode.Uri.file(filePath);
      await this.addFeatureFileToTestController(file);
    }

    Logger.getInstance().info(
      "Created hierarchical feature-based test hierarchy",
      {
        totalFeatureFiles: uniqueFeatureFiles.size,
        totalScenarios: allScenarios.length,
        finalTestItems: this.testController.items.size,
      }
    );
  }

  /**
   * Dispose of the test provider
   */
  public dispose(): void {
    try {
      Logger.getInstance().info("Disposing test provider");

      // Clear discovered tests
      this.discoveredTests.clear();

      // Dispose test controller
      this.testController.dispose();

      Logger.getInstance().info("Test provider disposed successfully");
    } catch (error) {
      Logger.getInstance().error("Failed to dispose test provider", { error });
    }
  }

  /**
   * Get the name of the current organization strategy
   * @returns The name of the strategy
   */
  private getOrganizationStrategyName(): string {
    const strategy = this.organizationManager.getStrategy();
    const strategyType = strategy.strategyType;

    Logger.getInstance().debug("Getting organization strategy name", {
      strategyType,
      strategyTypeType: typeof strategyType,
    });

    switch (strategyType) {
      case "TagBasedOrganization":
        return "Tag-Based";
      case "FileBasedOrganization":
        return "File-Based";
      case "ScenarioTypeOrganization":
        return "Scenario Type";
      case "FlatOrganization":
        return "Flat";
      case "FeatureBasedOrganization":
        return "Feature-Based (Hierarchical)";
      default:
        Logger.getInstance().warn("Unknown organization strategy", {
          strategyType,
        });
        return strategyType;
    }
  }
}
