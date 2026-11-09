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

let activation: Promise<{ testController: vscode.TestController | undefined; testProvider: BehaveTestProvider | undefined }> | undefined;
let resources: { dispose(): Promise<void> } | undefined;

export function activate(context: vscode.ExtensionContext): NonNullable<typeof activation> {
  if (!activation) {
    const pending = initialize(context);
    activation = pending;
    pending.catch(() => {if (activation === pending) {activation = undefined;}});
  }
  return activation;
}

async function initialize(context: vscode.ExtensionContext): NonNullable<typeof activation> {
  const owned: vscode.Disposable[] = [];
  let disposed = false;
  const own = <T extends vscode.Disposable>(resource: T): T => {
    owned.push(resource);
    return resource;
  };
  let drainage: Promise<void> | undefined;
  const lifetime = { dispose(): Promise<void> {
    if (drainage) {return drainage;}
    disposed = true;
    // Invalidate command continuations before cancelling the work they await.
    for (const resource of owned) {if (resource instanceof CommandManager) {resource.dispose();}}
    const activeOwners = owned.filter((resource): resource is TestExecutor | BehaveTestProvider =>
      resource instanceof TestExecutor || resource instanceof BehaveTestProvider);
    const pending = activeOwners.map((resource) => resource.dispose());
    drainage = (async () => {
      await Promise.all(pending);
      for (const resource of owned.reverse()) {
        try {await resource.dispose();} catch (error) {process.stderr.write(`Extension cleanup failed: ${String(error)}\n`);}
      }
      if (resources === lifetime) {resources = undefined; activation = undefined;}
    })();
    return drainage;
  } };
  resources = lifetime;
  context.subscriptions.push(lifetime);
  let activationLogger: Logger | undefined;

  try {
    const config = own(ExtensionConfig.create());
    const framework = config.getFramework();
    if (disposed) {throw new Error("Extension activation was disposed");}
    const commandBuilder = FrameworkFactory.createCommandBuilder(framework, config);
    const logger = activationLogger = own(new Logger());
    const featureParser = FeatureParser.create(logger);
    const testExecutor = own(TestExecutor.create(undefined, undefined, undefined, config, logger));
    const sharedContext: BehaveExtensionContext = {
      logger, config, testExecutor,
      discoveryManager: own(TestDiscoveryManager.create(logger, config)),
      organizationManager: TestOrganizationManager.create(logger),
      featureParser,
      behaveJsonParser: BehaveJsonParser.create(logger),
      pytestResultParser: PytestResultParser.create(logger),
      cucumberJsonParser: CucumberJsonParser.create(logger),
      testItemMapping: TestItemMapping.create(),
      commandBuilder,
    };
    let configuredFramework = config.getFramework();
    own(config.addChangeListener(() => {
      const next = config.getFramework();
      if (next !== configuredFramework) {
        configuredFramework = next;
        sharedContext.commandBuilder = FrameworkFactory.createCommandBuilder(next, config);
      }
    }));

    if (!config.isValid()) {
      vscode.window.showWarningMessage(`Behave Test Runner configuration has issues: ${config.getValidationErrors().join(", ")}`);
    }

    let testController: vscode.TestController | undefined;
    let testProvider: BehaveTestProvider | undefined;
    try {
      testController = vscode.tests.createTestController("behaveTestRunner", "Behave Tests");
      testProvider = BehaveTestProvider.create(testController, sharedContext);
      own(testController);
      own(testProvider);
    } catch (error) {
      testController?.dispose();
      testController = undefined;
      logger.error("Test Explorer initialization failed", { error: String(error) });
      vscode.window.showWarningMessage(`Behave Test Runner: Test Explorer unavailable (${String(error)}). Run/Debug commands and CodeLens remain available.`);
    }

    const commandManager = own(CommandManager.create(sharedContext));
    // The activation lifetime owns registrations through the command manager.
    commandManager.registerCommands();
    if (testProvider) {commandManager.setTestProvider(testProvider);}

    if (config.enableCodeLens) {
      own(vscode.languages.registerCodeLensProvider({ pattern: "**/*.feature", scheme: "file" }, {
        provideCodeLenses: (document) => featureParser.provideScenarioCodeLenses(document.getText(), document.uri.fsPath),
      }));
    }
    if (config.enableStepDefinitionNavigation) {
      own(vscode.languages.registerDefinitionProvider([
        { pattern: "**/*.feature", scheme: "file" },
        { language: "gherkin", scheme: "file" },
        { language: "feature", scheme: "file" },
      ], new StepDefinitionProvider(undefined, logger)));
    }
    if (testProvider && (vscode.workspace.workspaceFolders ?? []).some((folder) => ExtensionConfig.forResource(folder.uri).autoDiscoverTests)) {
      await testProvider.discoverTests().catch((error) => {
        if (disposed) {return;}
        logger.error("Initial test discovery failed", { error: String(error) });
        vscode.window.showErrorMessage(`Test discovery failed: ${String(error)}. Please check your configuration and refresh tests.`);
      });
    }
    if (disposed) {throw new Error("Extension activation was disposed");}
    logger.info("Behave Test Runner activated", { framework });
    return { testController, testProvider };
  } catch (error) {
    if (!disposed) {activationLogger?.error("Extension activation failed", { error: String(error) });}
    await lifetime.dispose();
    throw error;
  }
}

export function deactivate(): Promise<void> {
  return resources?.dispose() ?? Promise.resolve();
}
