import * as vscode from "vscode";
import { TestExecutor } from "../core/test-executor";
import { ExtensionConfig } from "../core/extension-config";
import { Logger } from "../utils/logger";
import { CommandArguments, CommandHandler } from "../types";
import * as fs from "fs";

/**
 * Command registration and execution options
 */
export interface CommandOptions {
  command: string;
  title: string;
  category?: string;
  when?: string;
  handler: CommandHandler;
}

/**
 * Centralized command management for the Behave Test Runner extension
 */
export class CommandManager {
  private static instance: CommandManager | undefined;
  private commands: Map<string, vscode.Disposable> = new Map();
  private testExecutor: TestExecutor;
  private config: ExtensionConfig;
  private logger: Logger;
  private testProvider: any; // Will be set by extension

  private constructor() {
    this.testExecutor = new TestExecutor();
    this.config = ExtensionConfig.getInstance();
    this.logger = Logger.getInstance();
  }

  /**
   * Set the test provider reference for updating test status
   */
  public setTestProvider(testProvider: any): void {
    this.testProvider = testProvider;
  }

  /**
   * Update test status in the Test Explorer
   */
  private updateTestStatus(
    filePath: string,
    lineNumber?: number,
    status: "started" | "passed" | "failed" = "passed"
  ): void {
    if (!this.testProvider) {
      this.logger.debug("Test provider not available, skipping status update");
      return;
    }

    try {
      // Get the test controller from the test provider
      const testController = (this.testProvider as any).testController;
      if (!testController) {
        this.logger.debug(
          "Test controller not available, skipping status update"
        );
        return;
      }

      // Find the test item by file path and line number
      let testItem: vscode.TestItem | undefined;

      if (lineNumber) {
        // For scenarios, look for the specific line number
        const scenarioId = `${filePath}:${lineNumber}`;
        testItem =
          this.findTestItem(testController, scenarioId) ??
          this.findTestItemByLineNumber(testController, filePath, lineNumber);
      } else {
        // For features, look for the file path
        testItem = this.findTestItem(testController, filePath);
      }

      if (testItem) {
        // Create a test run to update the status
        const run = testController.createTestRun(
          new vscode.TestRunRequest([testItem])
        );

        switch (status) {
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
        this.logger.debug(
          `Updated test status for ${
            lineNumber ? `${filePath}:${lineNumber}` : filePath
          } to ${status}`
        );
      } else {
        this.logger.debug(
          `Test item not found for ${
            lineNumber ? `${filePath}:${lineNumber}` : filePath
          }`
        );
        // Log available test items for debugging
        this.logAvailableTestItems(testController);
      }
    } catch (error) {
      this.logger.error("Failed to update test status", { error });
    }
  }

  /**
   * Update test status for all scenarios matching specific tags
   */
  private updateTestStatusForTags(
    filePath: string,
    tags: string,
    status: "started" | "passed" | "failed" = "passed"
  ): void {
    if (!this.testProvider) {
      this.logger.debug("Test provider not available, skipping status update");
      return;
    }

    try {
      // Get the test controller from the test provider
      const testController = (this.testProvider as any).testController;
      if (!testController) {
        this.logger.debug(
          "Test controller not available, skipping status update"
        );
        return;
      }

      // Find all test items in the file that match the tags
      const matchingTestItems: vscode.TestItem[] = [];
      this.findTestItemsByTags(
        testController,
        filePath,
        tags,
        matchingTestItems
      );

      if (matchingTestItems.length > 0) {
        // Create a test run to update the status for all matching items
        const run = testController.createTestRun(
          new vscode.TestRunRequest(matchingTestItems)
        );

        for (const testItem of matchingTestItems) {
          switch (status) {
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
        }

        run.end();
        this.logger.debug(
          `Updated test status for ${matchingTestItems.length} test(s) with tags "${tags}" to ${status}`
        );
      } else {
        this.logger.debug(
          `No test items found for file ${filePath} with tags "${tags}"`
        );
      }
    } catch (error) {
      this.logger.error("Failed to update test status for tags", { error });
    }
  }

  /**
   * Find a test item by ID recursively
   */
  private findTestItem(
    testController: any,
    testId: string
  ): vscode.TestItem | undefined {
    const findRecursively = (items: any): vscode.TestItem | undefined => {
      for (const item of items.values()) {
        if (item.id === testId) {
          return item;
        }
        const child = findRecursively(item.children);
        if (child) {
          return child;
        }
      }
      return undefined;
    };

    return findRecursively(testController.items);
  }

  /**
   * Find a test item by line number in a specific file
   */
  private findTestItemByLineNumber(
    testController: any,
    filePath: string,
    lineNumber: number
  ): vscode.TestItem | undefined {
    const findRecursively = (items: any): vscode.TestItem | undefined => {
      for (const item of items.values()) {
        // Check if this item is in the right file and has the right line number
        if (
          item.uri?.fsPath === filePath &&
          item.range?.start.line === lineNumber - 1
        ) {
          return item;
        }
        const child = findRecursively(item.children);
        if (child) {
          return child;
        }
      }
      return undefined;
    };

    return findRecursively(testController.items);
  }

  /**
   * Log available test items for debugging
   */
  private logAvailableTestItems(testController: any): void {
    const logItems = (items: any, depth = 0): void => {
      for (const item of items.values()) {
        const indent = "  ".repeat(depth);
        this.logger.debug(
          `${indent}- ${item.id} (${item.label}) - Range: ${
            item.range?.start.line + 1
          }`
        );
        logItems(item.children, depth + 1);
      }
    };

    this.logger.debug("Available test items:");
    logItems(testController.items);
  }

  /**
   * Find test items by tags in a specific file
   */
  private findTestItemsByTags(
    testController: any,
    filePath: string,
    tags: string,
    matchingItems: vscode.TestItem[]
  ): void {
    const searchRecursively = (items: any): void => {
      for (const item of items.values()) {
        // Check if this item is in the right file
        if (item.uri?.fsPath === filePath) {
          // Check if the item has tags that match
          const itemTags = this.extractTagsFromTestItem(item);
          if (this.tagsMatch(itemTags, tags)) {
            matchingItems.push(item);
          }
        }

        // Search children recursively
        searchRecursively(item.children);
      }
    };

    searchRecursively(testController.items);
  }

  /**
   * Extract tags from a test item
   */
  private extractTagsFromTestItem(testItem: vscode.TestItem): string[] {
    const tags: string[] = [];

    // Check if the test item has tags in its description or label
    const description = testItem.description ?? "";
    const label = testItem.label ?? "";

    // Extract tags from description and label
    const tagMatches = [
      ...description.matchAll(/@\w+/g),
      ...label.matchAll(/@\w+/g),
    ];
    for (const match of tagMatches) {
      if (match[0]) {
        tags.push(match[0]);
      }
    }

    return tags;
  }

  /**
   * Check if item tags match the requested tags
   */
  private tagsMatch(itemTags: string[], requestedTags: string): boolean {
    // Parse requested tags (could be comma-separated or space-separated)
    const requestedTagList = requestedTags
      .split(/[,\s]+/)
      .map((tag) => tag.trim())
      .filter((tag) => tag.startsWith("@"));

    // Check if any of the requested tags match any of the item tags
    return requestedTagList.some((requestedTag) =>
      itemTags.some((itemTag) => itemTag === requestedTag)
    );
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
   * Check if a scenario is a scenario outline (not an example)
   */
  private isScenarioOutline(
    filePath: string,
    lineNumber: number,
    scenarioName?: string
  ): boolean {
    try {
      // Parse the feature file to check if this line contains a scenario outline
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      // Debug logging
      this.logger.debug(
        `Checking scenario outline at line ${lineNumber} in ${filePath}`,
        {
          lineNumber,
          filePath,
          scenarioName,
          totalLines: lines.length,
          lineContent:
            lineNumber > 0 && lineNumber <= lines.length
              ? lines[lineNumber - 1]
              : "N/A",
        }
      );

      // Check if the line at lineNumber contains "Scenario Outline:"
      if (lineNumber > 0 && lineNumber <= lines.length) {
        const line = lines[lineNumber - 1]; // Convert to 0-based index
        const isOutlineLine =
          line?.trim().startsWith("Scenario Outline:") ?? false;

        // If we have a scenario name, also check if it's not an example
        if (scenarioName && this.isScenarioOutlineExample(scenarioName)) {
          this.logger.debug(
            `Scenario name "${scenarioName}" is an example, returning false`
          );
          return false; // It's an example, not the outline itself
        }

        this.logger.debug(`Line ${lineNumber} is outline: ${isOutlineLine}`);
        return isOutlineLine;
      }

      this.logger.debug(
        `Line ${lineNumber} is out of range (1-${lines.length})`
      );
      return false;
    } catch (error) {
      // If we can't read the file, fall back to a simple check
      // This is not as reliable but prevents crashes
      this.logger.warn(
        `Could not read feature file to determine scenario outline: ${filePath}`,
        {
          error: error instanceof Error ? error.message : "Unknown error",
        }
      );
      return false;
    }
  }

  /**
   * Get the singleton instance of the command manager
   */
  public static getInstance(): CommandManager {
    CommandManager.instance ??= new CommandManager();
    return CommandManager.instance;
  }

  /**
   * Register all extension commands
   */
  public registerCommands(context: vscode.ExtensionContext): void {
    try {
      this.logger.info("Registering extension commands...");

      // Always clear existing commands first to ensure clean state
      this.clearCommands();

      const commands: CommandOptions[] = [
        {
          command: "behaveTestRunner.runScenario",
          title: "Run Behave Scenario",
          category: "Behave Test Runner",
          handler: this.runScenario.bind(this),
        },
        {
          command: "behaveTestRunner.runFeatureFile",
          title: "Run Behave Feature File",
          category: "Behave Test Runner",
          handler: this.runFeature.bind(this),
        },
        {
          command: "behaveTestRunner.runAllTests",
          title: "Run All Behave Tests",
          category: "Behave Test Runner",
          handler: this.runAllTests.bind(this),
        },
        {
          command: "behaveTestRunner.debugScenario",
          title: "Debug Behave Scenario",
          category: "Behave Test Runner",
          handler: this.debugScenario.bind(this),
        },
        {
          command: "behaveTestRunner.debugFeature",
          title: "Debug Behave Feature",
          category: "Behave Test Runner",
          handler: this.debugFeature.bind(this),
        },
        {
          command: "behaveTestRunner.refreshTests",
          title: "Refresh Behave Tests",
          category: "Behave Test Runner",
          handler: this.refreshTests.bind(this),
        },
        {
          command: "behaveTestRunner.showOutput",
          title: "Show Behave Test Output",
          category: "Behave Test Runner",
          handler: this.showOutput.bind(this),
        },
        {
          command: "behaveTestRunner.validateConfiguration",
          title: "Validate Behave Configuration",
          category: "Behave Test Runner",
          handler: this.validateConfiguration.bind(this),
        },
        {
          command: "behaveTestRunner.discoverTests",
          title: "Discover Behave Tests",
          category: "Behave Test Runner",
          handler: this.discoverTests.bind(this),
        },
        {
          command: "behaveTestRunner.runFeatureFileWithTags",
          title: "Run Behave Feature File with Tags",
          category: "Behave Test Runner",
          handler: this.runFeatureWithTags.bind(this),
        },
        {
          command: "behaveTestRunner.runScenarioWithTags",
          title: "Run Behave Scenario with Tags",
          category: "Behave Test Runner",
          handler: this.runScenarioWithTags.bind(this),
        },
        {
          command: "behaveTestRunner.runAllTestsParallel",
          title: "Run All Behave Tests in Parallel",
          category: "Behave Test Runner",
          handler: this.runAllTestsParallel.bind(this),
        },
        {
          command: "behaveTestRunner.runScenarioWithContext",
          title: "Run Behave Scenario (Context)",
          category: "Behave Test Runner",
          handler: this.runScenarioWithContext.bind(this),
        },
        {
          command: "behaveTestRunner.debugScenarioWithContext",
          title: "Debug Behave Scenario (Context)",
          category: "Behave Test Runner",
          handler: this.debugScenarioWithContext.bind(this),
        },
        {
          command: "behaveTestRunner.runFeatureFileWithContext",
          title: "Run Behave Feature File (Context)",
          category: "Behave Test Runner",
          handler: this.runFeatureFileWithContext.bind(this),
        },
        {
          command: "behaveTestRunner.setOrganizationStrategy",
          title: "Set Organization Strategy",
          category: "Behave Test Runner",
          handler: this.setOrganizationStrategy.bind(this),
        },
        {
          command: "behaveTestRunner.setTagBasedOrganization",
          title: "Organize by Tags",
          category: "Behave Test Runner",
          handler: this.setTagBasedOrganization.bind(this),
        },
        {
          command: "behaveTestRunner.setFileBasedOrganization",
          title: "Organize by File",
          category: "Behave Test Runner",
          handler: this.setFileBasedOrganization.bind(this),
        },
        {
          command: "behaveTestRunner.setScenarioTypeOrganization",
          title: "Organize by Scenario Type",
          category: "Behave Test Runner",
          handler: this.setScenarioTypeOrganization.bind(this),
        },
        {
          command: "behaveTestRunner.setFlatOrganization",
          title: "Flat Organization",
          category: "Behave Test Runner",
          handler: this.setFlatOrganization.bind(this),
        },
        {
          command: "behaveTestRunner.debugOrganization",
          title: "Debug Organization Strategy",
          category: "Behave Test Runner",
          handler: this.debugOrganization.bind(this),
        },
        {
          command: "behaveTestRunner.setFeatureBasedOrganization",
          title: "Feature-Based (Hierarchical) Organization",
          category: "Behave Test Runner",
          handler: this.setFeatureBasedOrganization.bind(this),
        },
      ];

      for (const cmdOptions of commands) {
        this.registerCommand(context, cmdOptions);
      }

      this.logger.info(`Successfully registered ${commands.length} commands`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to register commands: ${errorMessage}`, {
        error,
      });
      throw new Error(`Command registration failed: ${errorMessage}`);
    }
  }

  /**
   * Register a single command
   */
  private registerCommand(
    context: vscode.ExtensionContext,
    options: CommandOptions
  ): void {
    try {
      // Always register the command, even if it already exists
      // This ensures our handlers are properly attached
      const disposable = vscode.commands.registerCommand(
        options.command,
        async (...args: CommandArguments) => {
          try {
            this.logger.debug(`Executing command: ${options.command}`, {
              args,
            });
            await options.handler(...args);
            this.logger.debug(
              `Command executed successfully: ${options.command}`
            );
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error";
            this.logger.error(`Command execution failed: ${options.command}`, {
              error: errorMessage,
              args,
            });
            this.showErrorMessage(
              `Failed to execute ${options.title}: ${errorMessage}`
            );
          }
        }
      );

      this.commands.set(options.command, disposable);
      context.subscriptions.push(disposable);

      this.logger.debug(`Registered command: ${options.command}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to register command: ${options.command}`, {
        error,
      });
      throw new Error(
        `Command registration failed for ${options.command}: ${errorMessage}`
      );
    }
  }

  /**
   * Run a scenario
   */
  private async runScenario(...args: CommandArguments): Promise<void> {
    const [filePath, lineNumber, scenarioName] = args as [
      string,
      number | undefined,
      string | undefined
    ];

    if (!filePath) {
      throw new Error("File path is required");
    }

    try {
      this.logger.info(`Running scenario: ${scenarioName ?? "all scenarios"}`, {
        filePath,
        lineNumber,
        scenarioName,
      });

      // Update test status to started
      this.updateTestStatus(filePath, lineNumber, "started");

      let testResult: import("../types").TestRunResult;

      if (lineNumber) {
        // Check if this is a scenario outline example
        const isScenarioOutlineExample =
          this.isScenarioOutlineExample(scenarioName);

        if (isScenarioOutlineExample) {
          // For scenario outline examples, run the entire outline to ensure all examples are executed
          this.logger.info(
            `Running scenario outline example: ${
              scenarioName ?? "unnamed"
            } at line ${lineNumber}`,
            {
              scenarioName,
              lineNumber,
            }
          );

          // Extract the original outline name for the behave command
          const originalOutlineName = this.extractOriginalOutlineName(
            scenarioName ?? ""
          );

          // First, run the scenario in the terminal to show output to user
          await this.testExecutor.runScenario({
            filePath,
            lineNumber,
            scenarioName: originalOutlineName,
          });

          testResult = await this.testExecutor.runScenarioWithOutput({
            filePath,
            lineNumber,
            scenarioName: originalOutlineName,
          });
        } else {
          // Check if this is a scenario outline (not an example)
          // We need to parse the feature file to determine this
          const isScenarioOutline = this.isScenarioOutline(
            filePath,
            lineNumber,
            scenarioName
          );

          if (isScenarioOutline) {
            // For scenario outlines, run without --name parameter to iterate over all examples
            this.logger.info(
              `Running scenario outline: ${
                scenarioName ?? "unnamed"
              } (will iterate over all examples)`,
              {
                scenarioName,
              }
            );

            // First, run the scenario in the terminal to show output to user
            await this.testExecutor.runScenario({
              filePath,
              lineNumber,
              // Don't pass scenarioName to run all examples
            });

            testResult = await this.testExecutor.runScenarioWithOutput({
              filePath,
              lineNumber,
              // Don't pass scenarioName to run all examples
            });
          } else {
            // Regular scenario
            // First, run the scenario in the terminal to show output to user
            await this.testExecutor.runScenario({
              filePath,
              lineNumber,
              ...(scenarioName ? { scenarioName } : {}),
            });

            testResult = await this.testExecutor.runScenarioWithOutput({
              filePath,
              lineNumber,
              ...(scenarioName ? { scenarioName } : {}),
            });
          }
        }
      } else {
        // No line number specified, run the entire feature file
        this.logger.info(`Running entire feature file: ${filePath}`);

        // First, run the feature file in the terminal to show output to user
        await this.testExecutor.runFeatureFile({
          filePath,
        });

        testResult = await this.testExecutor.runFeatureFileWithOutput({
          filePath,
        });
      }

      // Update test status based on actual result
      if (testResult.success) {
        this.updateTestStatus(filePath, lineNumber, "passed");
        this.logger.info("Scenario execution completed successfully", {
          duration: testResult.duration,
          outputLength: testResult.output.length,
        });
      } else {
        this.updateTestStatus(filePath, lineNumber, "failed");
        this.logger.error("Scenario execution failed", {
          error: testResult.error,
          output: testResult.output,
          duration: testResult.duration,
        });
        throw new Error(`Test failed: ${testResult.error ?? "Unknown error"}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to run scenario", {
        error: errorMessage,
        args,
      });

      // Update test status to failed
      this.updateTestStatus(filePath, lineNumber, "failed");
      throw error;
    }
  }

  /**
   * Run a feature file
   */
  private async runFeature(...args: CommandArguments): Promise<void> {
    const [filePath] = args as [string];

    if (!filePath) {
      throw new Error("File path is required");
    }

    try {
      this.logger.info(`Running feature file: ${filePath}`);

      // Update test status to started
      this.updateTestStatus(filePath, undefined, "started");

      // First, run the feature file in the terminal to show output to user
      await this.testExecutor.runFeatureFile({
        filePath,
      });

      const testResult = await this.testExecutor.runFeatureFileWithOutput({
        filePath,
      });

      // Update test status based on actual result
      if (testResult.success) {
        this.updateTestStatus(filePath, undefined, "passed");
        this.logger.info("Feature execution completed successfully", {
          duration: testResult.duration,
          outputLength: testResult.output.length,
        });
      } else {
        this.updateTestStatus(filePath, undefined, "failed");
        this.logger.error("Feature execution failed", {
          error: testResult.error,
          output: testResult.output,
          duration: testResult.duration,
        });
        throw new Error(`Test failed: ${testResult.error ?? "Unknown error"}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to run feature", { error: errorMessage, args });

      // Update test status to failed
      this.updateTestStatus(filePath, undefined, "failed");
      throw error;
    }
  }

  /**
   * Run all tests
   */
  private async runAllTests(): Promise<void> {
    try {
      this.logger.info("Running all behave tests");

      await this.testExecutor.runAllTests();

      this.logger.info("All tests execution started successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to run all tests", { error: errorMessage });
      throw error;
    }
  }

  /**
   * Debug a specific scenario
   */
  private async debugScenario(...args: CommandArguments): Promise<void> {
    try {
      const [filePath, lineNumber, scenarioName] = args as [
        string,
        number,
        string
      ];

      if (!filePath) {
        throw new Error("File path is required");
      }

      this.logger.info(`Debugging scenario: ${scenarioName ?? "unnamed"}`, {
        filePath,
        lineNumber,
        scenarioName,
      });

      await this.testExecutor.debugScenario({
        filePath,
        lineNumber,
        scenarioName,
      });

      this.logger.info("Scenario debug started successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to debug scenario", {
        error: errorMessage,
        args,
      });
      throw error;
    }
  }

  /**
   * Debug a feature file
   */
  private async debugFeature(...args: CommandArguments): Promise<void> {
    try {
      const [filePath] = args as [string];

      if (!filePath) {
        throw new Error("File path is required");
      }

      this.logger.info(`Debugging feature file: ${filePath}`);

      // For now, we'll run the feature file normally since debugFeature doesn't exist
      await this.testExecutor.runFeatureFile({
        filePath,
      });

      this.logger.info("Feature debug started successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to debug feature", {
        error: errorMessage,
        args,
      });
      throw error;
    }
  }

  /**
   * Refresh tests in the Test Explorer
   */
  private refreshTests(): void {
    try {
      if (!this.testProvider) {
        throw new Error("Test provider not available");
      }

      this.logger.info("Refreshing tests in Test Explorer");

      // Call discoverTests to rebuild the entire test hierarchy with the new organization
      this.testProvider.discoverTests().catch((error: any) => {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.error("Failed to refresh tests", { error: errorMessage });
        this.showErrorMessage(`Failed to refresh tests: ${errorMessage}`);
      });

      this.logger.info("Test refresh initiated successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to refresh tests", { error });
      this.showErrorMessage(`Failed to refresh tests: ${errorMessage}`);
    }
  }

  /**
   * Show the output channel
   */
  private showOutput(): void {
    try {
      this.logger.info("Showing output channel");

      this.logger.showOutput();

      this.logger.info("Output channel displayed");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to show output", { error: errorMessage });
      throw error;
    }
  }

  /**
   * Validate the current configuration
   */
  private validateConfiguration(): void {
    try {
      this.logger.info("Validating configuration");

      const validationErrors = this.config.getValidationErrors();

      if (validationErrors.length > 0) {
        const errorMessage = `Configuration validation failed:\n${validationErrors.join(
          "\n"
        )}`;
        this.logger.error("Configuration validation failed", {
          errors: validationErrors,
        });
        this.showErrorMessage(errorMessage);
      } else {
        this.logger.info("Configuration validation passed");
        vscode.window.showInformationMessage("Configuration is valid");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to validate configuration", {
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Discover tests in the workspace
   */
  private discoverTests(): void {
    try {
      this.logger.info("Discovering tests in workspace");

      // This would typically trigger test discovery in the test provider
      // For now, we'll just log the action
      this.logger.info("Test discovery requested");

      // Show a notification to the user
      vscode.window.showInformationMessage("Test discovery started");

      this.logger.info("Test discovery completed");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to discover tests", { error: errorMessage });
      throw error;
    }
  }

  /**
   * Run a feature file with specific tags
   */
  private async runFeatureWithTags(...args: CommandArguments): Promise<void> {
    const [filePath, tags] = args as [string, string];

    if (!filePath) {
      throw new Error("File path is required");
    }

    if (!tags) {
      throw new Error("Tags are required");
    }

    try {
      this.logger.info(`Running feature file with tags: ${filePath}`, {
        filePath,
        tags,
      });

      // Update test status to started for all matching scenarios
      this.updateTestStatusForTags(filePath, tags, "started");

      // First, run the feature file in the terminal to show output to user
      await this.testExecutor.runFeatureFile({
        filePath,
        tags,
      });

      const testResult = await this.testExecutor.runFeatureFileWithOutput({
        filePath,
        tags,
      });

      // Update test status based on actual result
      if (testResult.success) {
        this.updateTestStatusForTags(filePath, tags, "passed");
        this.logger.info("Feature execution with tags completed successfully", {
          duration: testResult.duration,
          outputLength: testResult.output.length,
        });
      } else {
        this.updateTestStatusForTags(filePath, tags, "failed");
        this.logger.error("Feature execution with tags failed", {
          error: testResult.error,
          output: testResult.output,
          duration: testResult.duration,
        });
        throw new Error(`Test failed: ${testResult.error ?? "Unknown error"}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to run feature with tags", {
        error: errorMessage,
        args,
      });

      // Update test status to failed
      this.updateTestStatusForTags(filePath, tags, "failed");
      throw error;
    }
  }

  /**
   * Run a scenario with specific tags
   */
  private async runScenarioWithTags(...args: CommandArguments): Promise<void> {
    try {
      const [filePath, lineNumber, scenarioName, tags] = args as [
        string,
        number,
        string,
        string
      ];

      if (!filePath) {
        throw new Error("File path is required");
      }

      if (!tags) {
        throw new Error("Tags are required");
      }

      this.logger.info(
        `Running scenario with tags: ${scenarioName ?? "unnamed"}`,
        {
          filePath,
          lineNumber,
          scenarioName,
          tags,
        }
      );

      await this.testExecutor.runScenario({
        filePath,
        lineNumber,
        scenarioName,
        tags,
      });

      this.logger.info("Scenario execution with tags started successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to run scenario with tags", {
        error: errorMessage,
        args,
      });
      throw error;
    }
  }

  /**
   * Run all tests in parallel
   */
  private async runAllTestsParallel(): Promise<void> {
    try {
      this.logger.info("Running all behave tests in parallel");

      await this.testExecutor.runAllTestsInParallel();

      this.logger.info("All tests parallel execution started successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to run all tests in parallel", {
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Run a scenario with context (from editor)
   */
  private async runScenarioWithContext(
    ...args: CommandArguments
  ): Promise<void> {
    try {
      const [filePath, lineNumber, scenarioName] = args as [
        string,
        number,
        string
      ];

      if (!filePath) {
        throw new Error("File path is required");
      }

      this.logger.info(
        `Running scenario with context: ${scenarioName ?? "unnamed"}`,
        {
          filePath,
          lineNumber,
          scenarioName,
        }
      );

      // First, run the scenario in the terminal to show output to user
      await this.testExecutor.runScenario({
        filePath,
        lineNumber,
        ...(scenarioName ? { scenarioName } : {}),
      });

      const testResult = await this.testExecutor.runScenarioWithOutput({
        filePath,
        lineNumber,
        ...(scenarioName ? { scenarioName } : {}),
      });

      if (testResult.success) {
        this.logger.info(
          "Scenario execution with context completed successfully",
          {
            duration: testResult.duration,
            outputLength: testResult.output.length,
          }
        );
      } else {
        this.logger.error("Scenario execution with context failed", {
          error: testResult.error,
          output: testResult.output,
          duration: testResult.duration,
        });
        throw new Error(`Test failed: ${testResult.error ?? "Unknown error"}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to run scenario with context", {
        error: errorMessage,
        args,
      });
      throw error;
    }
  }

  /**
   * Debug a scenario with context (from editor)
   */
  private async debugScenarioWithContext(
    ...args: CommandArguments
  ): Promise<void> {
    try {
      const [filePath, lineNumber, scenarioName] = args as [
        string,
        number,
        string
      ];

      if (!filePath) {
        throw new Error("File path is required");
      }

      this.logger.info(
        `Debugging scenario with context: ${scenarioName ?? "unnamed"}`,
        {
          filePath,
          lineNumber,
          scenarioName,
        }
      );

      await this.testExecutor.debugScenario({
        filePath,
        lineNumber,
        scenarioName,
      });

      this.logger.info("Scenario debug with context started successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to debug scenario with context", {
        error: errorMessage,
        args,
      });
      throw error;
    }
  }

  /**
   * Run a feature file with context (from editor)
   */
  private async runFeatureFileWithContext(
    ...args: CommandArguments
  ): Promise<void> {
    try {
      const [filePath] = args as [string];

      if (!filePath) {
        throw new Error("File path is required");
      }

      this.logger.info(`Running feature file with context: ${filePath}`);

      // First, run the feature file in the terminal to show output to user
      await this.testExecutor.runFeatureFile({
        filePath,
      });

      const testResult = await this.testExecutor.runFeatureFileWithOutput({
        filePath,
      });

      if (testResult.success) {
        this.logger.info(
          "Feature execution with context completed successfully",
          {
            duration: testResult.duration,
            outputLength: testResult.output.length,
          }
        );
      } else {
        this.logger.error("Feature execution with context failed", {
          error: testResult.error,
          output: testResult.output,
          duration: testResult.duration,
        });
        throw new Error(`Test failed: ${testResult.error ?? "Unknown error"}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to run feature file with context", {
        error: errorMessage,
        args,
      });
      throw error;
    }
  }

  /**
   * Show an error message to the user
   */
  private showErrorMessage(message: string): void {
    vscode.window.showErrorMessage(message);
  }

  /**
   * Get all registered command IDs
   */
  public getRegisteredCommands(): string[] {
    return Array.from(this.commands.keys());
  }

  /**
   * Check if a command is registered
   */
  public isCommandRegistered(commandId: string): boolean {
    return this.commands.has(commandId);
  }

  /**
   * Execute a command by ID
   */
  public async executeCommand(
    commandId: string,
    ...args: CommandArguments
  ): Promise<void> {
    try {
      if (!this.isCommandRegistered(commandId)) {
        throw new Error(`Command not registered: ${commandId}`);
      }

      this.logger.debug(`Executing command by ID: ${commandId}`, { args });
      await vscode.commands.executeCommand(commandId, ...args);
      this.logger.debug(`Command executed successfully by ID: ${commandId}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to execute command by ID: ${commandId}`, {
        error: errorMessage,
        args,
      });
      throw error;
    }
  }

  /**
   * Dispose of all registered commands
   */
  public dispose(): void {
    try {
      this.logger.info("Disposing command manager...");

      for (const [commandId, disposable] of this.commands) {
        try {
          disposable.dispose();
          this.logger.debug(`Disposed command: ${commandId}`);
        } catch (error) {
          this.logger.error(`Failed to dispose command: ${commandId}`, {
            error,
          });
        }
      }

      this.commands.clear();
      this.logger.info("Command manager disposed successfully");
    } catch (error) {
      this.logger.error("Failed to dispose command manager", { error });
    }
  }

  /**
   * Clear commands without logging (for internal use)
   */
  private clearCommands(): void {
    for (const [, disposable] of this.commands) {
      try {
        disposable.dispose();
      } catch {
        // Silent cleanup
      }
    }
    this.commands.clear();
  }

  /**
   * Reset the command manager to allow re-registration
   */
  public reset(): void {
    try {
      this.logger.info("Resetting command manager...");
      this.commands.clear();
      this.logger.info("Command manager reset successfully");
    } catch (error) {
      this.logger.error("Failed to reset command manager", { error });
    }
  }

  /**
   * Clear the singleton instance (for testing or cleanup)
   */
  public static clearInstance(): void {
    if (CommandManager.instance) {
      CommandManager.instance.dispose();
      CommandManager.instance = undefined;
    }
  }

  /**
   * Set organization strategy with a picker
   */
  private async setOrganizationStrategy(): Promise<void> {
    try {
      const strategies = [
        {
          label: "Tag-based",
          description: "Group scenarios by their tags",
          value: "tag",
        },
        {
          label: "File-based",
          description: "Group scenarios by their file location",
          value: "file",
        },
        {
          label: "Scenario Type",
          description: "Group by regular scenarios vs scenario outlines",
          value: "scenarioType",
        },
        {
          label: "Flat",
          description: "No grouping, all scenarios in one list",
          value: "flat",
        },
      ];

      const selected = await vscode.window.showQuickPick(strategies, {
        placeHolder: "Select organization strategy",
        canPickMany: false,
      });

      if (selected) {
        await this.setStrategyByValue(selected.value);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to set organization strategy", { error });
      this.showErrorMessage(
        `Failed to set organization strategy: ${errorMessage}`
      );
    }
  }

  /**
   * Set tag-based organization
   */
  private async setTagBasedOrganization(): Promise<void> {
    await this.setStrategyByValue("tag");
  }

  /**
   * Set file-based organization
   */
  private async setFileBasedOrganization(): Promise<void> {
    await this.setStrategyByValue("file");
  }

  /**
   * Set scenario type organization
   */
  private async setScenarioTypeOrganization(): Promise<void> {
    await this.setStrategyByValue("scenarioType");
  }

  /**
   * Set flat organization
   */
  private async setFlatOrganization(): Promise<void> {
    await this.setStrategyByValue("flat");
  }

  /**
   * Set strategy by value and refresh tests
   */
  private async setStrategyByValue(strategyValue: string): Promise<void> {
    try {
      if (!this.testProvider) {
        throw new Error("Test provider not available");
      }

      // Get the organization manager from the test provider
      const organizationManager = (this.testProvider as any)
        .organizationManager;
      if (!organizationManager) {
        throw new Error("Organization manager not available");
      }

      // Get available strategies
      const availableStrategies = organizationManager.getAvailableStrategies();
      let strategy: any;
      switch (strategyValue) {
        case "tag":
          strategy = availableStrategies.find(
            (s: { strategy: any }) =>
              s.strategy.strategyType === "TagBasedOrganization"
          );
          break;
        case "file":
          strategy = availableStrategies.find(
            (s: { strategy: any }) =>
              s.strategy.strategyType === "FileBasedOrganization"
          );
          break;
        case "scenarioType":
          strategy = availableStrategies.find(
            (s: { strategy: any }) =>
              s.strategy.strategyType === "ScenarioTypeOrganization"
          );
          break;
        case "flat":
          strategy = availableStrategies.find(
            (s: { strategy: any }) =>
              s.strategy.strategyType === "FlatOrganization"
          );
          break;
        case "feature":
          strategy = availableStrategies.find(
            (s: { strategy: any }) =>
              s.strategy.strategyType === "FeatureBasedOrganization"
          );
          break;
        default:
          strategy = availableStrategies[0];
      }

      if (!strategy) {
        throw new Error(`Strategy not found: ${strategyValue}`);
      }

      this.logger.info("Changing test organization strategy", {
        from: organizationManager.getStrategy().strategyType,
        to: strategy.strategy.strategyType,
      });

      // Set the strategy
      organizationManager.setStrategy(strategy.strategy);

      // Clear the discovery cache to force a fresh discovery
      const discoveryManager = (this.testProvider as any).discoveryManager;
      if (discoveryManager?.clearCache) {
        discoveryManager.clearCache();
        this.logger.info("Cleared test discovery cache");
      }

      // Wait a moment for the strategy change to take effect
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Refresh tests to apply the new organization - wait for completion
      this.logger.info("Starting test discovery with new strategy");
      await this.testProvider.discoverTests();

      // Wait a moment for the discovery to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Force refresh the Test Explorer view
      this.logger.info("Forcing Test Explorer refresh");
      await (this.testProvider as any).forceRefreshTestExplorer();

      // Wait a moment for the refresh to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Also trigger VS Code's built-in test refresh command
      try {
        await vscode.commands.executeCommand("testing.refreshTests");
      } catch (error) {
        this.logger.debug("Built-in test refresh command not available", {
          error,
        });
      }

      this.logger.info(`Organization strategy changed to: ${strategy.name}`);
      vscode.window.showInformationMessage(
        `Organization strategy changed to: ${strategy.name}`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to set strategy", { error, strategyValue });
      this.showErrorMessage(`Failed to set strategy: ${errorMessage}`);
    }
  }

  /**
   * Debug the current organization strategy
   */
  private debugOrganization(): void {
    try {
      if (!this.testProvider) {
        throw new Error("Test provider not available");
      }

      const organizationManager = (this.testProvider as any)
        .organizationManager;
      if (!organizationManager) {
        throw new Error("Organization manager not available");
      }

      const currentStrategy = organizationManager.getStrategy();
      const availableStrategies = organizationManager.getAvailableStrategies();

      this.logger.info("Current Organization Strategy:", {
        name: currentStrategy.strategyType,
        description: currentStrategy.getDescription(),
      });

      this.logger.info("Available Strategies:");
      availableStrategies.forEach((s: any) => {
        this.logger.debug(
          `- ${s.name} (${s.description}) - Strategy: ${s.strategy.strategyType}`
        );
      });

      vscode.window.showInformationMessage(
        `Current Organization Strategy: ${currentStrategy.strategyType}`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to debug organization strategy", { error });
      this.showErrorMessage(
        `Failed to debug organization strategy: ${errorMessage}`
      );
    }
  }

  /**
   * Set feature-based organization
   */
  private async setFeatureBasedOrganization(): Promise<void> {
    await this.setStrategyByValue("feature");
  }
}
