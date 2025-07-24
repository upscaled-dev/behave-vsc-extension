import * as vscode from "vscode";
import { FeatureParser } from "../parsers/feature-parser";
import { TestExecutor } from "../core/test-executor";
import { Scenario, TestOrganizationStrategy, TestGroup, ParsedFeature } from "../types";
import { Logger } from "../utils/logger";
import { ExtensionConfig } from "../core/extension-config";
import { TestDiscoveryManager } from "../core/test-discovery-manager";
import { TestOrganizationManager } from "../core/test-organization";
import * as path from 'path';
import { getScenarioStatusForTestItem } from "../utils/test-item-mapping";

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
  private isTestRunning = false;
  // Store scenario outline parent-child relationships for hierarchy view
  private scenarioOutlineParents = new Map<string, string>(); // exampleId -> parentId

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

    // Also store by location for restoration
    const locationKey = this.getLocationKey(testId);
    if (locationKey) {
      this.testStatusByLocation.set(locationKey, status);
    }

    // Only update parents in hierarchy view
    if (this.getOrganizationStrategy().strategyType === "FeatureBasedOrganization") {
      const parentId = this.scenarioOutlineParents.get(testId);
      Logger.getInstance().info("Checking for parent update", {
        testId,
        parentId,
        hasParent: !!parentId,
        organizationStrategy: this.getOrganizationStrategy().strategyType
      });
      if (parentId) {
        // Only update parent if it belongs to the same feature file
        const childFeatureFile = this.extractFeatureFileFromTestId(testId);
        const parentFeatureFile = this.extractFeatureFileFromTestId(parentId);
        
        Logger.getInstance().info("Feature file comparison", {
          childId: testId,
          parentId,
          childFeatureFile,
          parentFeatureFile,
          sameFeature: childFeatureFile === parentFeatureFile
        });
        
        if (childFeatureFile && parentFeatureFile && childFeatureFile === parentFeatureFile) {
        Logger.getInstance().info("Found parent for child, updating parent status", {
          childId: testId,
          parentId,
            childStatus: status,
            featureFile: childFeatureFile
        });
        this.updateScenarioOutlineParentStatus(parentId);
        } else {
          Logger.getInstance().debug("Skipping parent update - different feature files", {
            childId: testId,
            parentId,
            childFeatureFile,
            parentFeatureFile
          });
        }
      } else {
        Logger.getInstance().debug("No parent found for child", { childId: testId });
      }
    }

    Logger.getInstance().info(
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
      const featureFiles: Array<{ file: vscode.Uri; parsed: ParsedFeature | null }> = [];

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

      // Only proceed if featureLineNumber is a valid number
      if (!parsed || typeof parsed.featureLineNumber !== 'number') {
        Logger.getInstance().warn(`Invalid or unparsable feature file: ${file.fsPath}`);
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
        Logger.getInstance().info("Processing scenario group", {
          outlineName,
          scenarioCount: scenarios.length,
          firstScenarioIsOutline: scenarios[0]?.isScenarioOutline,
          scenarioNames: scenarios.map(s => s.name)
        });

        if (scenarios.length === 1 && !scenarios[0]?.isScenarioOutline) {
          const scenario = scenarios[0];
          if (scenario && typeof scenario.featureLineNumber === 'number') {
            const scenarioItem = this.createScenarioTestItem(
              file,
              scenario
            );
            featureItem.children.add(scenarioItem);
          } else {
            Logger.getInstance().warn(`Scenario missing featureLineNumber or is undefined, skipping: ${scenario?.name}`);
          }
        } else if (scenarios.length > 1 && scenarios[0]?.isScenarioOutline) {
          Logger.getInstance().info("Creating scenario outline parent", {
            outlineName,
            scenarioCount: scenarios.length,
            firstScenario: scenarios[0]?.name
          });
          
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
            Logger.getInstance().warn("Missing outline line number, creating individual scenarios", {
              outlineName,
              hasOutlineLineNumber,
              featureLineNumber: scenarios[0]?.featureLineNumber
            });
            
            for (const scenario of scenarios) {
              if (typeof scenario.featureLineNumber === 'number') {
                const scenarioItem = this.createScenarioTestItem(
                  file,
                  scenario
                );
                featureItem.children.add(scenarioItem);
              } else {
                Logger.getInstance().warn(`Scenario missing featureLineNumber, skipping: ${scenario.name}`);
              }
            }
          }
        } else if (scenarios.length === 1 && scenarios[0]?.isScenarioOutline) {
          Logger.getInstance().info("Single scenario outline example", {
            outlineName,
            scenarioName: scenarios[0]?.name
          });
          
          const scenario = scenarios[0];
          if (scenario && typeof scenario.featureLineNumber === 'number') {
            const scenarioItem = this.createScenarioTestItem(
              file,
              scenario
            );
            featureItem.children.add(scenarioItem);
          } else {
            Logger.getInstance().warn(`Scenario missing featureLineNumber, skipping: ${scenario?.name}`);
          }
        } else {
          Logger.getInstance().info("Fallback: creating individual scenarios", {
            outlineName,
            scenarioCount: scenarios.length,
            firstScenarioIsOutline: scenarios[0]?.isScenarioOutline
          });
          
          for (const scenario of scenarios) {
            if (typeof scenario.featureLineNumber === 'number') {
              const scenarioItem = this.createScenarioTestItem(
                file,
                scenario
              );
              featureItem.children.add(scenarioItem);
            } else {
              Logger.getInstance().warn(`Scenario missing featureLineNumber, skipping: ${scenario.name}`);
            }
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

    Logger.getInstance().info("Grouping scenarios by outline", {
      totalScenarios: scenarios.length,
      scenarioNames: scenarios.map(s => s.name),
      scenarioOutlineFlags: scenarios.map(s => s.isScenarioOutline)
    });

    for (const scenario of scenarios) {
      if (scenario.isScenarioOutline) {
        // Extract the original outline name from the example name
        // Example: "1: Load testing with multiple users - user_count: 10" -> "Load testing with multiple users"
        const match = scenario.name.match(/^\d+:\s*(.+?)\s*-\s*/);
        const outlineName = match ? match[1] : scenario.name;

        Logger.getInstance().info("Processing scenario outline example", {
          scenarioName: scenario.name,
          match: match ? match[0] : null,
          outlineName,
          lineNumber: scenario.lineNumber,
          outlineLineNumber: scenario.outlineLineNumber
        });

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
        // Regular scenario - use file path and line number for uniqueness
        const groupKey = `${scenario.filePath}:${scenario.lineNumber}`;
        groups.set(groupKey, [scenario]);
      }
    }

    Logger.getInstance().info("Grouped scenarios result", {
      groupCount: groups.size,
      groups: Array.from(groups.entries()).map(([name, scenarios]) => ({
        name,
        scenarioCount: scenarios.length,
        scenarioNames: scenarios.map(s => s.name)
      }))
    });

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
    outlineItem.canResolveChildren = false;
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
      if (typeof example.featureLineNumber === 'number') {
        const exampleItem = this.createScenarioTestItem(
          file,
          example,
          testId // Pass the parent test item ID
        );
        outlineItem.children.add(exampleItem);
      } else {
        Logger.getInstance().warn(`Outline example missing featureLineNumber, skipping: ${example.name}`);
      }
    }

    return outlineItem;
  }

  /**
   * Create a test item for a scenario
   * @param file - Feature file URI
   * @param scenario - Scenario data
   * @param parentTestId - Optional parent test item ID for scenario outline examples
   * @returns Test item
   */
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

    // Only store parent relationships in hierarchy view
    if (this.getOrganizationStrategy().strategyType === "FeatureBasedOrganization" && scenario.outlineLineNumber) {
      // Use the provided parent test item ID if available, otherwise fall back to line-based ID
      const parentId = parentTestId ?? `${scenario.filePath}:${scenario.outlineLineNumber}`;
      this.scenarioOutlineParents.set(id, parentId);
      Logger.getInstance().info("Stored scenario outline parent-child relationship", {
        exampleId: id,
        parentId,
        exampleName: scenario.name,
        outlineLineNumber: scenario.outlineLineNumber
      });
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
    if (this.isTestRunning) {
      vscode.window.showWarningMessage("A test run is already in progress. Please wait for it to finish before starting another.");
      return;
    }
    this.isTestRunning = true;
    const run = this.testController.createTestRun(request);

    try {
      Logger.getInstance().info("Processing test run request", {
        includeCount: request.include?.length ?? 0,
        excludeCount: request.include?.length ?? 0,
        includeIds: request.include?.map(t => ({ id: t.id, label: t.label, hasChildren: t.children.size > 0 })) ?? []
      });
      
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
          childrenCount: test.children.size,
          hasChildren: test.children.size > 0
        });

          try {
            let testResult: import("../types").TestRunResult & { scenarioResults?: Record<string, string> };

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

              Logger.getInstance().info("ScenarioResults mapping for feature", { scenarioResults: testResult.scenarioResults });
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
                    Logger.getInstance().info("Scenario result lookup debug (flat)", {
                      childId: child.id,
                      childKey,
                      availableKeys: Object.keys(testResult.scenarioResults ?? {}),
                      parentLabel: test.label,
                      parentRange: test.range,
                      relativeFeaturePath,
                      featureLineNumber,
                      childLine
                    });
                    const status = testResult.scenarioResults?.[childKey];
                    Logger.getInstance().info("Scenario status lookup result", {
                      childId: child.id,
                      childKey,
                      status,
                      hasStatus: status !== undefined
                    });
                    if (status === "passed") {
                      // Store the status with the correct cache key (childKey from scenarioResults)
                      this.testStatusCache.set(childKey, "passed");
                      // Also store with the child ID for backward compatibility
                      this.updateTestStatus(child.id, "passed");
                      
                      // Then try to update the VS Code UI
                      try {
                        run.passed(child);
                      } catch (error) {
                        Logger.getInstance().error("Error calling run.passed", { childId: child.id, error: String(error) });
                        // Continue processing other scenarios even if this one fails
                      }
                    } else if (status === "failed") {
                      // Store the status with the correct cache key (childKey from scenarioResults)
                      this.testStatusCache.set(childKey, "failed");
                      // Also store with the child ID for backward compatibility
                      this.updateTestStatus(child.id, "failed");
                      
                      // Then try to update the VS Code UI
                      try {
                        run.failed(child, new vscode.TestMessage("Test failed"));
                      } catch (error) {
                        Logger.getInstance().error("Error calling run.failed", { childId: child.id, error: String(error) });
                        // Continue processing other scenarios even if this one fails
                      }
                    } else {
                      Logger.getInstance().warn("No scenario result found for child, marking as skipped", { childId: child.id, childKey });
                      try {
                      run.skipped(child);
                      } catch (error) {
                        Logger.getInstance().error("Error calling run.skipped", { childId: child.id, error: String(error) });
                      }
                    }
                  } else {
                    // Parent node (e.g., scenario outline): process children and aggregate
                    let anyFailed = false;
                    let allPassed = true;
                    
                    // Process scenario outline examples
                    for (const [, grandChild] of Array.from(child.children)) {
                      // Process the scenario outline example
                      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
                      const relativeFeaturePath = path.relative(workspaceRoot, test.uri.fsPath);
                      const featureLineNumber = test.range ? String(test.range.start.line + 1) : "1";
                      const childLine = String(this.extractLineNumberFromTestId(grandChild.id));
                      const childKey = `${relativeFeaturePath}:${featureLineNumber}:${childLine}`;
                      
                      const status = testResult.scenarioResults?.[childKey];
                      if (status === "passed") {
                        // Store the status with the correct cache key
                        this.testStatusCache.set(childKey, "passed");
                        this.updateTestStatus(grandChild.id, "passed");
                        try {
                          run.passed(grandChild);
                        } catch (error) {
                          Logger.getInstance().error("Error calling run.passed for outline example", { childId: grandChild.id, error: String(error) });
                        }
                      } else if (status === "failed") {
                        // Store the status with the correct cache key
                        this.testStatusCache.set(childKey, "failed");
                        this.updateTestStatus(grandChild.id, "failed");
                        try {
                          run.failed(grandChild, new vscode.TestMessage("Test failed"));
                        } catch (error) {
                          Logger.getInstance().error("Error calling run.failed for outline example", { childId: grandChild.id, error: String(error) });
                        }
                        anyFailed = true;
                        allPassed = false;
                      } else {
                        try {
                          run.skipped(grandChild);
                        } catch (error) {
                          Logger.getInstance().error("Error calling run.skipped for outline example", { childId: grandChild.id, error: String(error) });
                        }
                        allPassed = false;
                      }
                    }
                    
                    // Update parent status
                    if (anyFailed) {
                        // Always update the status cache first, regardless of VS Code API success
                      this.updateTestStatus(child.id, "failed");
                        
                        // Then try to update the VS Code UI
                        try {
                          run.failed(child, new vscode.TestMessage("One or more examples failed"));
                        } catch (error) {
                          Logger.getInstance().error("Error calling run.failed for parent", { childId: child.id, error: String(error) });
                        }
                    } else if (allPassed) {
                        // Always update the status cache first, regardless of VS Code API success
                      this.updateTestStatus(child.id, "passed");
                        
                        // Then try to update the VS Code UI
                        try {
                          run.passed(child);
                        } catch (error) {
                          Logger.getInstance().error("Error calling run.passed for parent", { childId: child.id, error: String(error) });
                        }
                    } else {
                        try {
                      run.skipped(child);
                        } catch (error) {
                          Logger.getInstance().error("Error calling run.skipped for parent", { childId: child.id, error: String(error) });
                        }
                    }
                  }
                }
              } else {
                Logger.getInstance().warn("No scenarioResults mapping found, falling back to overall result for all children", { testId: test.id });
                // Fallback: mark all children based on overall result
                this.markAllChildrenBasedOnResult(test, run, testResult);
              }
              
              // Explicitly update all scenario outline parents after processing all scenarios
              Logger.getInstance().info("Explicitly updating all scenario outline parents", { testId: test.id });
              for (const [, child] of Array.from(test.children)) {
                if (child.children.size > 0) {
                  // This is a scenario outline parent
                  Logger.getInstance().info("Updating scenario outline parent", { parentId: child.id, parentLabel: child.label });
                  this.updateScenarioOutlineParentStatus(child.id);
                }
              }
            } else if (test.id.includes(":outline:")) {
              // Scenario outline node: run all examples by outline name
              const filePath = test.uri.fsPath;
              // Extract outline name from test.id: /path/to/file.feature:outline:Outline Name
              const outlineMatch = test.id.match(/:outline:(.+)$/);
              const outlineName = outlineMatch ? outlineMatch[1] : test.label.replace(/^Scenario Outline: /, "");
              Logger.getInstance().info(
                `Running scenario outline: ${outlineName} in ${filePath}`
              );
              // Run behave with --name="<outlineName>"
              await this.testExecutor.runScenario({
                filePath,
                scenarioName: outlineName ?? "",
              });
              testResult = await this.testExecutor.runScenarioWithOutput({
                filePath,
                scenarioName: outlineName ?? "",
              });
              Logger.getInstance().info("ScenarioResults mapping for outline", { scenarioResults: testResult.scenarioResults });
              // Mark each example individually using scenarioResults
              if (testResult.scenarioResults && test.children.size > 0) {
                for (const [, child] of Array.from(test.children)) {
                  // Mark parent nodes (scenario outlines) as started first
                  if (child.children.size > 0) {
                    run.started(child);
                    this.updateTestStatus(child.id, "started");
                  }
                  
                  if (child.children.size === 0) {
                    const childLine = this.extractLineNumberFromTestId(child.id);
                    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
                    const relativeFeaturePath = path.relative(workspaceRoot, filePath);
                    // Extract feature line number from parent feature test item (test.parent)
                    let featureLineNumber: number | undefined = undefined;
                    if (test.parent?.range) {
                      featureLineNumber = test.parent.range.start.line + 1;
                    }
                    const childKey = featureLineNumber
                      ? `${relativeFeaturePath}:${featureLineNumber}:${childLine}`
                      : `${relativeFeaturePath}:${childLine}`;
                    Logger.getInstance().info("Scenario result lookup debug (outline)", {
                      childId: child.id,
                      childKey,
                      availableKeys: Object.keys(testResult.scenarioResults ?? {}),
                      parentLabel: test.label,
                      parentRange: test.range,
                      relativeFeaturePath,
                      featureLineNumber,
                      childLine
                    });
                    const status = testResult.scenarioResults?.[childKey];
                    if (status === "passed") {
                      // Store the status with the correct cache key (childKey from scenarioResults)
                      this.testStatusCache.set(childKey, "passed");
                      // Also store with the child ID for backward compatibility
                      this.updateTestStatus(child.id, "passed");
                      
                      // Then try to update the VS Code UI
                      try {
                        run.passed(child);
                      } catch (error) {
                        Logger.getInstance().error("Error calling run.passed for outline", { childId: child.id, error: String(error) });
                      }
                    } else if (status === "failed") {
                      // Store the status with the correct cache key (childKey from scenarioResults)
                      this.testStatusCache.set(childKey, "failed");
                      // Also store with the child ID for backward compatibility
                      this.updateTestStatus(child.id, "failed");
                      
                      // Then try to update the VS Code UI
                      try {
                        run.failed(child, new vscode.TestMessage("Test failed"));
                      } catch (error) {
                        Logger.getInstance().error("Error calling run.failed for outline", { childId: child.id, error: String(error) });
                      }
                    } else {
                      Logger.getInstance().warn("No scenario result found for child, marking as skipped", { childId: child.id, childKey });
                      try {
                      run.skipped(child);
                      } catch (error) {
                        Logger.getInstance().error("Error calling run.skipped for outline", { childId: child.id, error: String(error) });
                      }
                    }
                  } else {
                    // Parent node (should not happen for outline children, but handle just in case)
                    let anyFailed = false;
                    let allPassed = true;
                    Logger.getInstance().info("Checking children for parent status", {
                      parentId: child.id,
                      childCount: child.children.size,
                      childIds: Array.from(child.children).map(child => child[0])
                    });
                    for (const [, grandChild] of Array.from(child.children)) {
                      const status = this.testStatusCache.get(grandChild.id);
                      Logger.getInstance().info("Child status check", {
                        childId: grandChild.id,
                        status,
                        hasStatus: status !== undefined
                      });
                      if (status === "failed") {
                        anyFailed = true;
                        allPassed = false;
                      } else if (status !== "passed") {
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
                  }
                }
              } else {
                Logger.getInstance().warn("No scenarioResults mapping found, falling back to overall result for all children", { testId: test.id });
                this.markAllChildrenBasedOnResult(test, run, testResult);
              }
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
              Logger.getInstance().info("ScenarioResults mapping for group", { scenarioResults: testResult.scenarioResults });
              // Mark each scenario individually using scenarioResults
              if (testResult.scenarioResults && test.children.size > 0) {
                for (const [, child] of Array.from(test.children)) {
                  const childLine = this.extractLineNumberFromTestId(child.id);
                  const childKey = `${test.uri.fsPath}:${childLine}`;
                  Logger.getInstance().info("Checking scenario result for child", { childId: child.id, childKey, status: testResult.scenarioResults[childKey] });
                  const status = testResult.scenarioResults[childKey];
                  if (status === "passed") {
                    // Always update the status cache first, regardless of VS Code API success
                    this.updateTestStatus(child.id, "passed");
                    
                    // Then try to update the VS Code UI
                    try {
                      run.passed(child);
                    } catch (error) {
                      Logger.getInstance().error("Error calling run.passed for group", { childId: child.id, error: String(error) });
                    }
                  } else if (status === "failed") {
                    // Always update the status cache first, regardless of VS Code API success
                    this.updateTestStatus(child.id, "failed");
                    
                    // Then try to update the VS Code UI
                    try {
                      run.failed(child, new vscode.TestMessage("Test failed"));
                    } catch (error) {
                      Logger.getInstance().error("Error calling run.failed for group", { childId: child.id, error: String(error) });
                    }
                  } else {
                    Logger.getInstance().warn("No scenario result found for child, marking as skipped", { childId: child.id, childKey });
                    try {
                    run.skipped(child);
                    } catch (error) {
                      Logger.getInstance().error("Error calling run.skipped for group", { childId: child.id, error: String(error) });
                    }
                  }
                }
              } else {
                Logger.getInstance().warn("No scenarioResults mapping found, falling back to overall result for all children", { testId: test.id });
                this.markAllChildrenBasedOnResult(test, run, testResult);
              }
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

              // Mark this scenario based on scenarioResults if available
              // Use robust mapping logic for individual scenarios
              const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
              
              // For scenario outline examples, store all example results in the cache
              if (isScenarioOutlineExample && testResult.scenarioResults) {
                Logger.getInstance().info("Processing scenario outline example results", {
                  testId: test.id,
                  availableKeys: Object.keys(testResult.scenarioResults)
                });
                
                // Store all example results using the same format as feature file execution
                for (const [childKey, status] of Object.entries(testResult.scenarioResults)) {
                  Logger.getInstance().info("Storing scenario outline example result", {
                    childKey,
                    status,
                    testId: test.id
                  });
                  
                  // Store with the childKey format for parent status updates
                  this.testStatusCache.set(childKey, status as "passed" | "failed");
                  
                  // Also store with the child ID for backward compatibility
                  // Extract the line number from childKey (e.g., "features/advanced-example.feature:2:39" -> ":39")
                  const lineMatch = childKey.match(/:(\d+)$/);
                  if (lineMatch) {
                    const childLine = lineMatch[1];
                    const childId = `:${childLine}`;
                    this.updateTestStatus(childId, status as "passed" | "failed");
                  }
                }
              }
              
              const foundStatus = getScenarioStatusForTestItem(
                { id: test.id, uri: test.uri },
                test.parent?.uri
                  ? { id: test.parent.id, uri: test.parent.uri }
                  : { id: test.parent?.id ?? "" },
                testResult.scenarioResults ?? {},
                workspaceRoot
              );
              Logger.getInstance().info("Mapping debug (individual)", {
                childId: test.id,
                foundStatus,
                availableKeys: Object.keys(testResult.scenarioResults ?? {})
              });
              if (foundStatus === "passed") {
                run.passed(test);
                this.updateTestStatus(test.id, "passed");
              } else if (foundStatus === "failed") {
                run.failed(test, new vscode.TestMessage("Test failed"));
                this.updateTestStatus(test.id, "failed");
              } else {
                run.skipped(test);
              }
            }

            // Log success/failure with output summary
            Logger.getInstance().info(`Test result: ${test.label}`, {
              testId: test.id,
              duration: testResult.duration,
              outputLength: testResult.output.length,
              scenarioResults: testResult.scenarioResults,
            });
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
        } else if (this.isGroupTest(test.id) && test.id.startsWith('tag:')) {
          // In runTests, for tag group (tag-based organization) test execution:
          // Instead of collecting feature files and running each, run Behave once with the tag expression
          Logger.getInstance().info(
            `Running all scenarios in tag group: ${test.label}`
          );
          // Extract tag from test.id (e.g., tag:@smoke)
          const tagMatch = test.id.match(/^tag:(.+)$/);
          const tag = tagMatch?.[1] ?? test.label ?? "";
          // Run Behave with --tags="<tag>"
          await this.testExecutor.runAllTestsWithTags(tag);
          const testResult = await this.testExecutor.runAllTestsWithTagsOutput(tag);
          Logger.getInstance().info("ScenarioResults mapping for tag group", { scenarioResults: testResult.scenarioResults });
          // Log all scenario keys parsed
          Logger.getInstance().info("Parsed scenario result keys for tag group", { keys: Object.keys(testResult.scenarioResults ?? {}) });
          // Log which test item IDs were matched or not
          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
          for (const [, child] of Array.from(test.children)) {
            const status = getScenarioStatusForTestItem(
              child as { id: string; uri?: vscode.Uri },
              test as { id: string; uri?: vscode.Uri },
              testResult.scenarioResults ?? {},
              workspaceRoot
            );
            Logger.getInstance().info("Tag group child result mapping", { childId: child.id, label: child.label, status, matched: status !== undefined });
            if (status === "passed") {
              run.passed(child);
              this.updateTestStatus(child.id, "passed");
            } else if (status === "failed") {
              run.failed(child, new vscode.TestMessage("Test failed"));
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
          Logger.getInstance().info(
            `Running all scenarios in group: ${test.label}`
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
          // Aggregate scenario results from all feature files
          const aggregatedScenarioResults: Record<string, string> = {};
          for (const filePath of featureFiles) {
            await this.testExecutor.runFeatureFile({ filePath });
            const result = await this.testExecutor.runFeatureFileWithOutput({ filePath });
            Object.assign(aggregatedScenarioResults, result.scenarioResults);
          }
          Logger.getInstance().info("Parsed scenario result keys for group", { keys: Object.keys(aggregatedScenarioResults) });
          // Mark all child tests based on aggregated results
          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
          for (const [, child] of Array.from(test.children)) {
            // Debug logging to see what test items are being processed
            Logger.getInstance().info("Processing test item", {
              childId: child.id,
              childLabel: child.label,
              childChildrenCount: child.children.size,
              isScenarioOutlineParent: this.isScenarioOutlineParent(child),
              organizationStrategy: this.getOrganizationStrategy().strategyType
            });
            
            // Check if this child is a scenario outline parent
            if (this.isScenarioOutlineParent(child)) {
              Logger.getInstance().info("Processing scenario outline parent", {
                parentId: child.id,
                parentLabel: child.label,
                childCount: child.children.size
              });
              
              // For scenario outline parents, aggregate children's statuses
              let anyFailed = false;
              let allPassed = true;
              
              for (const [, grandChild] of Array.from(child.children)) {
                const grandChildStatus = getScenarioStatusForTestItem(
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
              
              // Set parent status based on aggregation
              if (anyFailed) {
                Logger.getInstance().info("Setting scenario outline parent status: FAILED", { testId: child.id, label: child.label });
                run.failed(child, new vscode.TestMessage("One or more examples failed"));
                this.updateTestStatus(child.id, "failed");
              } else if (allPassed) {
                Logger.getInstance().info("Setting scenario outline parent status: PASSED", { testId: child.id, label: child.label });
                run.passed(child);
                this.updateTestStatus(child.id, "passed");
              } else {
                Logger.getInstance().info("Setting scenario outline parent status: SKIPPED", { testId: child.id, label: child.label });
                run.skipped(child);
              }
              continue; // Skip the regular mapping logic for scenario outline parents
            }
            
            // Use shared mapping logic
            const foundStatus = getScenarioStatusForTestItem(
              child as { id: string; uri?: vscode.Uri },
              test as { id: string; uri?: vscode.Uri },
              aggregatedScenarioResults,
              workspaceRoot
            );
            Logger.getInstance().info("Mapping debug", { childId: child.id, foundStatus, availableKeys: Object.keys(aggregatedScenarioResults) });
            if (foundStatus === "passed") {
              Logger.getInstance().info("Setting test explorer status: PASSED", { testId: child.id, label: child.label });
              run.passed(child);
            } else if (foundStatus === "failed") {
              Logger.getInstance().info("Setting test explorer status: FAILED", { testId: child.id, label: child.label });
              run.failed(child, new Error("Scenario failed"));
            } else {
              Logger.getInstance().info("Setting test explorer status: SKIPPED", { testId: child.id, label: child.label });
              run.skipped(child);
            }
          }
          // Mark the group test based on whether all children passed
          const allPassed = Object.values(aggregatedScenarioResults).every(s => s === "passed");
          if (allPassed) {
            Logger.getInstance().info("Setting test explorer status: PASSED (group)", { testId: test.id, label: test.label });
          run.passed(test);
          this.updateTestStatus(test.id, "passed");
          } else {
            Logger.getInstance().info("Setting test explorer status: FAILED (group)", { testId: test.id, label: test.label });
            run.failed(test, new vscode.TestMessage("One or more scenarios failed"));
            this.updateTestStatus(test.id, "failed");
          }
          return;
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
      this.isTestRunning = false;
    }
  }

  /**
   * Debug tests based on the test run request
   * @param request - Test run request
   */
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
    } finally {
      this.isTestRunning = false;
    }
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
    // Recognize any testId that starts with 'group:' as a group test (including scenario type groups)
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

  /**
   * Create tag-based test hierarchy with tag groups at the root level
   */
  private createTagBasedTestHierarchy(
    organizedGroups: TestGroup[],
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
          group.id,
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
            scenario
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
    organizedGroups: TestGroup[],
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
            scenario
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
    organizedGroups: TestGroup[],
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
   * Update the status of a scenario outline parent based on its children's statuses
   * @param parentId - The test item ID of the scenario outline parent
   */
  private updateScenarioOutlineParentStatus(parentId: string): void {
    Logger.getInstance().info("Attempting to update scenario outline parent status", { parentId });
    
    const parent = this.findTestItemById(parentId);
    if (!parent) {
      Logger.getInstance().warn("Could not find scenario outline parent", { parentId });
      return;
    }

    Logger.getInstance().info("Found scenario outline parent", {
      parentId,
      parentLabel: parent.label,
      childCount: parent.children.size
    });

    // Aggregate statuses of all children
    let anyFailed = false;
    let allPassed = true;
    let anyStarted = false;

    Logger.getInstance().info("Checking children for parent status", {
      parentId: parent.id,
      childCount: parent.children.size,
      childIds: Array.from(parent.children).map(([id]) => id)
    });

    // Extract feature path from parent ID for constructing cache keys
    const parentMatch = parentId.match(/(.*\.feature):outline:(.+)$/);
    if (!parentMatch) {
      Logger.getInstance().warn("Could not parse parent ID format", { parentId });
      return;
    }
    
    const fullFeaturePath = parentMatch[1];
    // Extract the feature filename (advanced-example.feature)
    const featureFilename = fullFeaturePath?.split('/').pop() ?? "";
    
    Logger.getInstance().info("Constructing cache keys for children", {
      featureFilename,
      parentId,
      cacheKeys: Array.from(this.testStatusCache.keys()),
      cacheSize: this.testStatusCache.size
    });

    for (const [, child] of Array.from(parent.children)) {
      // Find the cache key that matches this child by looking for the child line number
      const childLine = child.id.startsWith(":") ? child.id.slice(1) : child.id;
      let cacheKey = "";
      
      // BREAKPOINT: Cache key matching logic
      Logger.getInstance().info("BREAKPOINT: Starting cache key search", {
        childId: child.id,
        childLine,
        featureFilename,
        totalCacheKeys: this.testStatusCache.size,
        allCacheKeys: Array.from(this.testStatusCache.keys())
      });
      
      // Find the actual cache key that contains this child line number
      for (const [key] of this.testStatusCache) {
        // Look for cache keys that contain the feature filename and the child line number
        // The cache key format is: features/advanced-example.feature:2:39
        // We need to match both the feature filename and the child line number
        const includesFeature = key.includes(featureFilename);
        const includesChildLine = key.includes(`:${childLine}`);
        const matches = includesFeature && includesChildLine;
        
        Logger.getInstance().info("BREAKPOINT: Cache key check", {
          key,
          featureFilename,
          childLine,
          includesFeature,
          includesChildLine,
          matches,
          willBreak: matches
        });
        
        if (matches) {
          cacheKey = key;
          Logger.getInstance().info("BREAKPOINT: Found matching cache key", {
            childId: child.id,
            cacheKey,
            key
          });
          break;
        }
      }
      
      if (!cacheKey) {
        Logger.getInstance().warn("BREAKPOINT: No matching cache key found", {
          childId: child.id,
          childLine,
          featureFilename,
          searchedKeys: Array.from(this.testStatusCache.keys())
        });
      }
      
      const childStatus = this.testStatusCache.get(cacheKey);
      Logger.getInstance().info("Child status check", {
        childId: child.id,
        childLabel: child.label,
        cacheKey,
        childStatus,
        hasStatus: childStatus !== undefined
      });
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

    // Set parent status based on aggregation
    let parentStatus: "started" | "passed" | "failed";
    if (anyFailed) {
      parentStatus = "failed";
    } else if (allPassed) {
      parentStatus = "passed";
    } else if (anyStarted) {
      parentStatus = "started";
    } else {
      parentStatus = "failed"; // Default to failed if no children have status
    }

    this.testStatusCache.set(parentId, parentStatus);
    Logger.getInstance().info("Updated scenario outline parent status", {
      parentId,
      parentLabel: parent.label,
      parentStatus,
      childCount: parent.children.size,
      anyFailed,
      allPassed,
      anyStarted
    });
  }

  /**
   * Find a test item by its ID
   * @param testId - The test item ID to find
   * @returns The test item if found, undefined otherwise
   */
  private findTestItemById(testId: string): vscode.TestItem | undefined {
    // Search in discovered tests first
    for (const [, testItem] of this.discoveredTests) {
      const found = this.findTestItemRecursively(testItem, testId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  /**
   * Recursively search for a test item by ID
   * @param testItem - The test item to search in
   * @param targetId - The target test item ID
   * @returns The test item if found, undefined otherwise
   */
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

  /**
   * Check if a test item is a scenario outline parent
   * @param testItem - The test item to check
   * @returns True if it's a scenario outline parent, false otherwise
   */
  private isScenarioOutlineParent(testItem: vscode.TestItem): boolean {
    // A scenario outline parent:
    // 1. Has children (examples)
    // 2. Label starts with "Scenario Outline:"
    // 3. Children are scenario outline examples
    return (
      testItem.children.size > 0 &&
      testItem.label.startsWith("Scenario Outline:") &&
      Array.from(testItem.children).every(([, child]) => 
        this.isScenarioOutlineExample(child.label)
      )
    );
  }

  /**
   * Extract the feature file path from a test ID.
   * This is useful for checking if a parent and child belong to the same feature file.
   * @param testId - The test item ID.
   * @returns The feature file path or undefined if not a feature file.
   */
  private extractFeatureFileFromTestId(testId: string): string | undefined {
    const parts = testId.split(":");
    if (parts.length >= 2) {
      return parts[0];
    }
    return undefined;
  }
}
