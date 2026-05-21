import * as vscode from "vscode";
import { Logger } from "./utils/logger";
import { BehaveTestProvider } from "./test-providers/behave-test-provider";
import { CommandManager } from "./commands/command-manager";
import { ExtensionConfig } from "./core/extension-config";
import { FeatureParser } from "./parsers/feature-parser";
import { BehaveExtensionContext } from "./types";
import { TestExecutor } from "./core/test-executor";
import { TestDiscoveryManager } from "./core/test-discovery-manager";
import { TestOrganizationManager } from "./core/test-organization";
import { BehaveJsonParser } from "./utils/behave-json-parser";
import { PytestResultParser } from "./utils/pytest-result-parser";
import { CucumberJsonParser } from "./utils/cucumber-json-parser";
import { TestItemMapping } from "./utils/test-item-mapping";
import { FrameworkFactory } from "./core/framework-factory";
import { StepDefinitionProvider } from "./providers/step-definition-provider";

let testProvider: BehaveTestProvider | undefined;
let commandManager: CommandManager | undefined;
let isActivated = false;
let testController: vscode.TestController | undefined;

/**
 * Activate the extension
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Prevent multiple activations
  if (isActivated) {
    const logger = Logger.create();
    logger.warn("Extension already activated, skipping duplicate activation");
    return;
  }

  const logger = Logger.create();
  const config = ExtensionConfig.create();
  const featureParser = FeatureParser.create(logger);
  
  // Get framework setting - respect manual setting over auto-detection
  let framework = config.getFramework();
  
  // Only auto-detect if no framework is explicitly set (i.e., still using default "behave")
  if (config.isFrameworkAutoDetectionEnabled() && framework === "behave") {
    const autoDetectedFramework = await FrameworkFactory.autoDetect();
    
    // Only use auto-detected framework if it's different from the default
    if (autoDetectedFramework !== "behave") {
      framework = autoDetectedFramework;
      logger.info(`Auto-detected framework: ${framework}`);
    }
    
    // Validate framework setup and warn about conflicts
    const validation = await FrameworkFactory.validateFrameworkSetup();
    if (!validation.isValid) {
      logger.warn("Framework setup validation failed", {
        issues: validation.issues,
        recommendation: validation.recommendation
      });
    }
  }
  
  // Create the appropriate command builder
  const commandBuilder = FrameworkFactory.createCommandBuilder(framework, config);
  
  logger.info(`Extension activated with framework: ${framework}`, {
    autoDetection: config.isFrameworkAutoDetectionEnabled(),
    detectedFramework: framework
  });

  // Create TestExecutor and inject context
  const testExecutor = TestExecutor.create(
    undefined, // workspace (use default)
    undefined, // window (use default)
    undefined, // debug (use default)
    config,
    logger,
    BehaveJsonParser.create(logger),
    CucumberJsonParser.create(logger)
  );
  
  // Create shared context for dependency injection
  const sharedContext: BehaveExtensionContext = {
    logger,
    config,
    testExecutor,
    discoveryManager: TestDiscoveryManager.create(),
    organizationManager: TestOrganizationManager.create(),
    featureParser,
    behaveJsonParser: BehaveJsonParser.create(logger),
    pytestResultParser: PytestResultParser.create(logger),
    cucumberJsonParser: CucumberJsonParser.create(logger),
    testItemMapping: TestItemMapping.create(),
    commandBuilder
  };

  // Inject context into TestExecutor so it can use CommandBuilder
  testExecutor.setContext(sharedContext);

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
  logger.info("Behave Test Runner extension activating...");

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

    const enableCodeLens = config.enableCodeLens;
    logger.info(`Configuration: CodeLens=${enableCodeLens}`);

        // Always create test controller - Test Explorer is core functionality
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
        testProvider = BehaveTestProvider.create(testController, sharedContext);
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

        // If test controller creation fails, this is a critical error
        // since Test Explorer is core functionality
        throw new Error(`Failed to create test controller: ${errorMessage}`);
      }

    // Register commands using the centralized command manager
    commandManager = CommandManager.create(sharedContext);
    commandManager.registerCommands(context);
    context.subscriptions.push(commandManager);

    // Set the test provider reference in the command manager for status updates
    if (testProvider && commandManager) {
      logger.info("Setting test provider in command manager", {
        testProviderType: testProvider.constructor.name,
        hasOrganizationManager: !!(testProvider as unknown as { organizationManager?: unknown }).organizationManager,
        hasDiscoveryManager: !!(testProvider as unknown as { discoveryManager?: unknown }).discoveryManager
      });
      commandManager.setTestProvider(testProvider as unknown);
    } else {
      logger.error("Failed to set test provider in command manager", {
        hasTestProvider: !!testProvider,
        hasCommandManager: !!commandManager,
        testProviderType: testProvider?.constructor.name
      });
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
            const codeLenses = featureParser.provideScenarioCodeLenses(
              document.getText(),
              document.uri.fsPath
            );
            return codeLenses;
          },
        }
      );
      context.subscriptions.push(codeLensProvider);
    }

    // Register Definition provider for step navigation: .feature step -> Python @given/@when/@then
    if (config.enableStepDefinitionNavigation) {
      const stepDefProvider = new StepDefinitionProvider(config.stepDefinitionPaths, logger);
      const definitionRegistration = vscode.languages.registerDefinitionProvider(
        [
          { pattern: "**/*.feature", scheme: "file" },
          { language: "gherkin", scheme: "file" },
          { language: "feature", scheme: "file" },
        ],
        stepDefProvider
      );
      context.subscriptions.push(definitionRegistration);
      logger.info(`Step definition navigation enabled (paths: ${config.stepDefinitionPaths.join(", ")})`);
    }

    isActivated = true;
    logger.info("✅ Extension components initialized successfully");
    logger.info("Behave Test Runner extension activated successfully!");
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error("❌ Error during extension activation:", {
      error: errorMessage,
    });
    logger.error("Extension activation error:", { error: errorMessage });
    vscode.window.showErrorMessage(
      `Failed to activate Behave Test Runner: ${errorMessage}`
    );
  }
}

/**
 * Extension deactivation function
 */
export function deactivate(): void {
  const logger = Logger.create();
  logger.info("👋 Behave Test Runner extension is deactivating");

  try {
    // Clean up resources in reverse order of creation
    if (commandManager) {
      logger.info("Disposing command manager");
      commandManager.dispose();
      commandManager = undefined;
    }

    if (testProvider) {
      logger.info("Disposing test provider");
      testProvider.dispose();
      testProvider = undefined;
    }

    if (testController) {
      logger.info("Disposing test controller");
      testController.dispose();
      testController = undefined;
    }

    // Clear the singleton instance
    CommandManager.clearInstance();

    // Dispose the logger singleton to clean up the output channel
    try {
      Logger.getInstance().dispose();
    } catch {
      logger.debug("Logger already disposed or not available");
    }

    // Reset activation state
    isActivated = false;
    
    // Clear any remaining global references
    testProvider = undefined;
    commandManager = undefined;
    testController = undefined;
    
    logger.info("✅ Extension cleanup completed");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Error during extension deactivation", { error: errorMessage });
  }
}
