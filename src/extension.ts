import * as vscode from "vscode";
import { Logger } from "./utils/logger";
import { BehaveTestProvider } from "./test-providers/behave-test-provider";
import { CommandManager } from "./commands/command-manager";
import { ExtensionConfig } from "./core/extension-config";
import { FeatureParser } from "./parsers/feature-parser";

let testProvider: BehaveTestProvider | undefined;
let commandManager: CommandManager | undefined;
let isActivated = false;
let testController: vscode.TestController | undefined;

/**
 * Activate the extension
 */
export function activate(context: vscode.ExtensionContext): void {
  const logger = Logger.getInstance();
  const config = ExtensionConfig.getInstance();

  // Note: VS Code doesn't provide direct access to existing test controllers
  // We'll rely on the unique ID approach to avoid conflicts

  // Force cleanup of any existing instances
  if (isActivated) {
    logger.warn(
      "Extension already activated, forcing cleanup of previous instance"
    );
    deactivate();
  }

  // Note: VS Code doesn't provide direct access to existing test controllers
  // We'll rely on the unique ID approach to avoid conflicts

  logger.info("🚀 Behave Test Runner extension is now active!");
  console.log("Behave Test Runner extension activating..."); // Direct console log

  // Skip activation if running in test mode
  if (process.env["VSCODE_TEST"] === "true") {
    logger.info("Running in test mode - skipping full activation");
    return;
  }

  try {
    // Validate configuration
    if (!config.isValid()) {
      const errors = config.getValidationErrors();
      logger.warn("Configuration validation failed during activation", {
        errors,
      });
      vscode.window.showWarningMessage(
        `Behave Test Runner configuration has issues: ${errors.join(", ")}`
      );
    }

    // Get configuration for feature flags
    const enableTestExplorer = config.enableTestExplorer;
    const enableCodeLens = true; // Always enable CodeLens for now

    logger.info(
      `Configuration: TestExplorer=${enableTestExplorer}, CodeLens=${enableCodeLens}`
    );

    // Create test controller only if Test Explorer is enabled
    if (enableTestExplorer) {
      logger.info("Creating test controller for Test Explorer integration");

      // Create test controller with a stable ID
      const controllerId = "behaveTestRunner";

      logger.info("Creating test controller", { controllerId });

      try {
        testController = vscode.tests.createTestController(
          controllerId,
          "Behave Tests"
        );

        logger.info("Test controller created successfully", {
          controllerId: testController.id,
          controllerLabel: testController.label,
        });

        context.subscriptions.push(testController);
        testProvider = new BehaveTestProvider(testController);
        context.subscriptions.push(testProvider);

        logger.info("Test provider created and registered");

        // Trigger initial test discovery
        if (testProvider) {
          testProvider.discoverTests().catch((error) => {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error";
            logger.error("Error during initial test discovery:", {
              error: errorMessage,
            });
          });
        }
      } catch (controllerError) {
        const errorMessage =
          controllerError instanceof Error
            ? controllerError.message
            : "Unknown error";
        logger.error("Failed to create test controller", {
          error: errorMessage,
          controllerId,
        });

        // If test controller creation fails, still try to register commands
        // but skip Test Explorer integration
        logger.warn(
          "Skipping Test Explorer integration due to controller creation failure"
        );
      }
    } else {
      logger.warn(
        "Test Explorer integration is disabled - no test controller created"
      );
    }

    // Register commands using the centralized command manager
    commandManager = CommandManager.getInstance();
    commandManager.registerCommands(context);
    context.subscriptions.push(commandManager);

    // Set the test provider reference in the command manager for status updates
    if (testProvider && commandManager) {
      commandManager.setTestProvider(testProvider);
    }

    // Register CodeLens provider for feature files
    if (enableCodeLens) {
      const codeLensProvider = vscode.languages.registerCodeLensProvider(
        {
          pattern: "**/*.feature",
          scheme: "file",
        },
        {
          provideCodeLenses: (
            document: vscode.TextDocument
          ): vscode.CodeLens[] => {
            const codeLenses = FeatureParser.provideScenarioCodeLenses(
              document.getText(),
              document.uri.fsPath
            );
            return codeLenses;
          },
        }
      );
      context.subscriptions.push(codeLensProvider);
    }

    isActivated = true;
    logger.info("✅ Extension components initialized successfully");
    console.log("Behave Test Runner extension activated successfully!"); // Direct console log
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error("❌ Error during extension activation:", {
      error: errorMessage,
    });
    console.error("Extension activation error:", errorMessage); // Direct console log
    vscode.window.showErrorMessage(
      `Failed to activate Behave Test Runner: ${errorMessage}`
    );
  }
}

/**
 * Extension deactivation function
 */
export function deactivate(): void {
  const logger = Logger.getInstance();
  logger.info("👋 Behave Test Runner extension is deactivating");

  // Clean up resources
  if (testProvider) {
    testProvider.dispose();
    testProvider = undefined;
  }

  if (testController) {
    testController.dispose();
    testController = undefined;
  }

  if (commandManager) {
    commandManager.dispose();
    commandManager = undefined;
  }

  // Clear the singleton instance
  CommandManager.clearInstance();

  isActivated = false;
  logger.info("✅ Extension cleanup completed");
}
