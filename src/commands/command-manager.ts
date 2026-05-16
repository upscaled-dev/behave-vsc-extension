import * as vscode from "vscode";
import * as fs from "fs";
import { TestExecutor } from "../core/test-executor";
import { ExtensionConfig } from "../core/extension-config";
import { Logger } from "../utils/logger";
import { TestDiscoveryManager } from "../core/test-discovery-manager";
import { TestOrganizationManager } from "../core/test-organization";
import { FeatureParser } from "../parsers/feature-parser";
import { BehaveJsonParser } from "../utils/behave-json-parser";
import { PytestResultParser } from "../utils/pytest-result-parser";
import { CucumberJsonParser } from "../utils/cucumber-json-parser";
import { TestItemMapping } from "../utils/test-item-mapping";
import { CommandArguments, CommandHandler, BehaveExtensionContext } from "../types";
import { FrameworkFactory } from "../core/framework-factory";

interface OrganizationStrategy {
  strategyType: string;
  getDescription(): string;
}
interface OrganizationManagerLike {
  getAvailableStrategies(): Array<{ name: string; description: string; strategy: OrganizationStrategy }>;
  getStrategy(): OrganizationStrategy;
  setStrategy(strategy: OrganizationStrategy): void;
}
interface DiscoveryManagerLike {
  clearCache(): void;
}
interface TestProviderLike {
  organizationManager?: OrganizationManagerLike;
  discoveryManager?: DiscoveryManagerLike;
  discoverTests?: () => Promise<void>;
  forceRefreshTestExplorer?: () => Promise<void>;
}

export interface CommandOptions {
  command: string;
  title: string;
  category?: string;
  when?: string;
  handler: CommandHandler;
}

type TestStatus = "started" | "passed" | "failed";

const STRATEGY_TYPE_BY_VALUE: Record<string, string> = {
  tag: "TagBasedOrganization",
  file: "FileBasedOrganization",
  scenarioType: "ScenarioTypeOrganization",
  flat: "FlatOrganization",
  feature: "FeatureBasedOrganization",
};

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export class CommandManager {
  private static instance: CommandManager | undefined;
  private readonly commands = new Map<string, vscode.Disposable>();
  private readonly context: BehaveExtensionContext;
  private testProvider: unknown;
  private readonly testItemMap = new Map<string, vscode.TestItem>();
  private isTestRunning = false;

  public static create(context?: BehaveExtensionContext): CommandManager {
    return new CommandManager(context);
  }

  public static getInstance(): CommandManager {
    CommandManager.instance ??= new CommandManager();
    return CommandManager.instance;
  }

  public static clearInstance(): void {
    if (CommandManager.instance) {
      CommandManager.instance.dispose();
      CommandManager.instance = undefined;
    }
  }

  private constructor(context?: BehaveExtensionContext) {
    this.context = context ?? this.createDefaultContext();
  }

  private createDefaultContext(): BehaveExtensionContext {
    const logger = Logger.create();
    const config = ExtensionConfig.create();
    return {
      logger,
      config,
      testExecutor: TestExecutor.create(),
      discoveryManager: TestDiscoveryManager.create(),
      organizationManager: TestOrganizationManager.create(),
      featureParser: FeatureParser.create(logger),
      behaveJsonParser: BehaveJsonParser.create(logger),
      pytestResultParser: PytestResultParser.create(logger),
      cucumberJsonParser: CucumberJsonParser.create(logger),
      testItemMapping: TestItemMapping.create(),
      commandBuilder: FrameworkFactory.createCommandBuilder(config.getFramework(), config),
    };
  }

  private get logger(): Logger {
    return this.context.logger;
  }

  private getFrameworkName(): string {
    return this.context.commandBuilder?.getFrameworkName() ?? "behave";
  }

  private getFrameworkDisplayName(): string {
    return this.getFrameworkName() === "pytest-bdd" ? "Pytest-BDD" : "Behave";
  }

  public setTestProvider(testProvider: unknown): void {
    this.testProvider = testProvider;
  }

  private getTestController(): vscode.TestController | undefined {
    return (this.testProvider as { testController?: vscode.TestController })?.testController;
  }

  private updateTestStatus(filePath: string, lineNumber?: number, status: TestStatus = "passed"): void {
    const testController = this.getTestController();
    if (!testController) {return;}

    try {
      const testItem = lineNumber
        ? this.findTestItemByLineNumber(testController, filePath, lineNumber)
        : testController.items.get(filePath);

      if (!testItem) {return;}
      this.applyStatusRecursive(testController, testItem, status);
    } catch (error) {
      this.logger.error("Failed to update test status", { error });
    }
  }

  private updateTestStatusForTags(filePath: string, tags: string, status: TestStatus = "passed"): void {
    const testController = this.getTestController();
    if (!testController) {return;}

    try {
      const matchingItems: vscode.TestItem[] = [];
      this.findTestItemsByTags(testController, filePath, tags, matchingItems);
      if (matchingItems.length === 0) {return;}

      const run = testController.createTestRun(new vscode.TestRunRequest(matchingItems));
      for (const item of matchingItems) {
        this.applyStatusToRun(run, item, status);
      }
      run.end();
    } catch (error) {
      this.logger.error("Failed to update test status for tags", { error });
    }
  }

  private applyStatusRecursive(controller: vscode.TestController, item: vscode.TestItem, status: TestStatus): void {
    const run = controller.createTestRun(new vscode.TestRunRequest([item]));
    this.applyStatusToRun(run, item, status);
    run.end();
    item.children?.forEach?.((child) => this.applyStatusRecursive(controller, child, status));
  }

  private applyStatusToRun(run: vscode.TestRun, item: vscode.TestItem, status: TestStatus): void {
    if (status === "started") {run.started(item);}
    else if (status === "passed") {run.passed(item);}
    else {run.failed(item, new vscode.TestMessage("Test failed"));}
  }

  private findTestItemByLineNumber(
    testController: vscode.TestController,
    filePath: string,
    lineNumber: number
  ): vscode.TestItem | undefined {
    const find = (items: vscode.TestItemCollection | undefined): vscode.TestItem | undefined => {
      if (!items || typeof (items as Iterable<[string, vscode.TestItem]>)[Symbol.iterator] !== "function") {return undefined;}
      for (const [, item] of items as Iterable<[string, vscode.TestItem]>) {
        if (item.uri?.fsPath === filePath && item.range?.start.line === lineNumber - 1) {
          return item;
        }
        const child = find(item.children);
        if (child) {return child;}
      }
      return undefined;
    };
    return find(testController.items);
  }

  private findTestItemsByTags(
    testController: vscode.TestController,
    filePath: string,
    tags: string,
    matchingItems: vscode.TestItem[]
  ): void {
    const search = (items: vscode.TestItemCollection | undefined): void => {
      if (!items || typeof (items as Iterable<[string, vscode.TestItem]>)[Symbol.iterator] !== "function") {return;}
      for (const [, item] of items as Iterable<[string, vscode.TestItem]>) {
        if (item.uri?.fsPath === filePath && this.tagsMatch(this.extractTagsFromTestItem(item), tags)) {
          matchingItems.push(item);
        }
        search(item.children);
      }
    };
    search(testController.items);
  }

  private extractTagsFromTestItem(testItem: vscode.TestItem): string[] {
    const text = `${testItem.description ?? ""} ${testItem.label ?? ""}`;
    return Array.from(text.matchAll(/@\w+/g), (m) => m[0]);
  }

  private tagsMatch(itemTags: string[], requestedTags: string): boolean {
    const requested = requestedTags
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter((t) => t.startsWith("@"));
    return requested.some((r) => itemTags.includes(r));
  }

  private isScenarioOutlineExample(scenarioName?: string): boolean {
    if (!scenarioName) {return false;}
    return /^\d+:\s*.+\s*-\s*/.test(scenarioName);
  }

  public isScenarioOutline(filePath: string, lineNumber: number, scenarioName?: string): boolean {
    try {
      if (scenarioName && this.isScenarioOutlineExample(scenarioName)) {return false;}
      const lines = fs.readFileSync(filePath, "utf-8").split("\n");
      if (lineNumber < 1 || lineNumber > lines.length) {return false;}
      return lines[lineNumber - 1]?.trim().startsWith("Scenario Outline:") ?? false;
    } catch (error) {
      this.logger.warn(`Could not read feature file: ${filePath}`, { error: errMsg(error) });
      return false;
    }
  }

  public registerCommands(context: vscode.ExtensionContext): void {
    try {
      this.clearCommands();
      const fw = this.getFrameworkDisplayName();
      const category = `${fw} Test Runner`;

      const commands: CommandOptions[] = [
        { command: "behaveTestRunner.runScenario", title: `Run ${fw} Scenario`, category, handler: this.runScenario.bind(this) },
        { command: "behaveTestRunner.runFeatureFile", title: `Run ${fw} Feature File`, category, handler: this.runFeature.bind(this) },
        { command: "behaveTestRunner.runAllTests", title: `Run All ${fw} Tests`, category, handler: this.runAllTests.bind(this) },
        { command: "behaveTestRunner.debugScenario", title: `Debug ${fw} Scenario`, category, handler: this.debugScenario.bind(this) },
        { command: "behaveTestRunner.debugFeature", title: `Debug ${fw} Feature`, category, handler: this.debugFeature.bind(this) },
        { command: "behaveTestRunner.refreshTests", title: `Refresh ${fw} Tests`, category, handler: this.refreshTests.bind(this) },
        { command: "behaveTestRunner.showOutput", title: `Show ${fw} Test Output`, category, handler: this.showOutput.bind(this) },
        { command: "behaveTestRunner.validateConfiguration", title: `Validate ${fw} Configuration`, category, handler: this.validateConfiguration.bind(this) },
        { command: "behaveTestRunner.discoverTests", title: `Discover ${fw} Tests`, category, handler: this.discoverTests.bind(this) },
        { command: "behaveTestRunner.runFeatureFileWithTags", title: `Run ${fw} Feature File with Tags`, category, handler: this.runFeatureWithTags.bind(this) },
        { command: "behaveTestRunner.runScenarioWithTags", title: `Run ${fw} Scenario with Tags`, category, handler: this.runScenarioWithTags.bind(this) },
        { command: "behaveTestRunner.runAllTestsParallel", title: `Run All ${fw} Tests in Parallel`, category, handler: this.runAllTestsParallel.bind(this) },
        { command: "behaveTestRunner.runScenarioWithContext", title: `Run ${fw} Scenario (Context)`, category, handler: this.runScenarioWithContext.bind(this) },
        { command: "behaveTestRunner.debugScenarioWithContext", title: `Debug ${fw} Scenario (Context)`, category, handler: this.debugScenarioWithContext.bind(this) },
        { command: "behaveTestRunner.runFeatureFileWithContext", title: `Run ${fw} Feature File (Context)`, category, handler: this.runFeatureFileWithContext.bind(this) },
        { command: "behaveTestRunner.setOrganizationStrategy", title: "Set Organization Strategy", category, handler: this.setOrganizationStrategy.bind(this) },
        { command: "behaveTestRunner.setTagBasedOrganization", title: "Organize by Tags", category, handler: () => this.setStrategyByValue("tag") },
        { command: "behaveTestRunner.setFileBasedOrganization", title: "Organize by File", category, handler: () => this.setStrategyByValue("file") },
        { command: "behaveTestRunner.setScenarioTypeOrganization", title: "Organize by Scenario Type", category, handler: () => this.setStrategyByValue("scenarioType") },
        { command: "behaveTestRunner.setFlatOrganization", title: "Flat Organization", category, handler: () => this.setStrategyByValue("flat") },
        { command: "behaveTestRunner.setFeatureBasedOrganization", title: "Feature-Based (Hierarchical) Organization", category, handler: () => this.setStrategyByValue("feature") },
        { command: "behaveTestRunner.debugOrganization", title: "Debug Organization Strategy", category, handler: this.debugOrganization.bind(this) },
      ];

      for (const cmd of commands) {
        this.registerCommand(context, cmd);
      }

      this.logger.info(`Registered ${commands.length} commands`);
    } catch (error) {
      const msg = errMsg(error);
      this.logger.error(`Failed to register commands: ${msg}`, { error });
      throw new Error(`Command registration failed: ${msg}`);
    }
  }

  private registerCommand(context: vscode.ExtensionContext, options: CommandOptions): void {
    const disposable = vscode.commands.registerCommand(options.command, async (...args: CommandArguments) => {
      try {
        await options.handler(...args);
      } catch (error) {
        const msg = errMsg(error);
        this.logger.error(`Command failed: ${options.command}`, { error: msg, args });
        this.showErrorMessage(`Failed to execute ${options.title}: ${msg}`);
      }
    });
    this.commands.set(options.command, disposable);
    context.subscriptions.push(disposable);
  }

  private async runScenarioCore(
    filePath: string,
    lineNumber: number | undefined,
    scenarioName: string | undefined,
    tags?: string
  ): Promise<import("../types").TestRunResult> {
    if (!lineNumber) {
      await this.context.testExecutor.runFeatureFile({ filePath, ...(tags ? { tags } : {}) });
      return this.context.testExecutor.runFeatureFileWithOutput({ filePath, ...(tags ? { tags } : {}) });
    }

    const opts: import("../types").TestExecutionOptions = {
      filePath,
      lineNumber,
      ...(scenarioName !== undefined ? { scenarioName } : {}),
      ...(tags ? { tags } : {}),
    };
    await this.context.testExecutor.runScenario(opts);
    return this.context.testExecutor.runScenarioWithOutput(opts);
  }

  private logResult(label: string, result: import("../types").TestRunResult): void {
    if (result.success) {
      this.logger.info(`${label} completed`, { duration: result.duration, outputLength: result.output.length });
    } else {
      this.logger.error(`${label} failed`, { error: result.error, duration: result.duration });
    }
  }

  private async runScenario(...args: CommandArguments): Promise<void> {
    const [filePath, lineNumber, scenarioName] = args as [string, number | undefined, string | undefined];
    if (!filePath) {throw new Error("File path is required");}

    this.updateTestStatus(filePath, lineNumber, "started");
    try {
      const result = await this.runScenarioCore(filePath, lineNumber, scenarioName);
      this.updateTestStatus(filePath, lineNumber, result.success ? "passed" : "failed");
      this.logResult("Scenario", result);
      if (!result.success) {throw new Error(`Test failed: ${result.error ?? "Unknown error"}`);}
    } catch (error) {
      this.updateTestStatus(filePath, lineNumber, "failed");
      throw error;
    }
  }

  private async runFeature(...args: CommandArguments): Promise<void> {
    const [filePath] = args as [string];
    if (!filePath) {throw new Error("File path is required");}

    this.updateTestStatus(filePath, undefined, "started");
    try {
      await this.context.testExecutor.runFeatureFile({ filePath });
      const result = await this.context.testExecutor.runFeatureFileWithOutput({ filePath });
      this.updateTestStatus(filePath, undefined, result.success ? "passed" : "failed");
      this.logResult("Feature", result);
      if (!result.success) {throw new Error(`Test failed: ${result.error ?? "Unknown error"}`);}
    } catch (error) {
      this.updateTestStatus(filePath, undefined, "failed");
      throw error;
    }
  }

  private async runAllTests(): Promise<void> {
    this.logger.info(`Running all ${this.getFrameworkName()} tests`);
    await this.context.testExecutor.runAllTests();
  }

  private async debugScenario(...args: CommandArguments): Promise<void> {
    const [filePath, lineNumber, scenarioName] = args as [string, number | undefined, string | undefined];
    if (!filePath) {throw new Error("File path is required");}

    this.logger.info(`Debugging scenario: ${scenarioName ?? "unnamed"}`, { filePath, lineNumber });
    await this.context.testExecutor.debugScenario({
      filePath,
      ...(lineNumber !== undefined ? { lineNumber } : {}),
      ...(scenarioName ? { scenarioName } : {}),
    });
  }

  private async debugFeature(...args: CommandArguments): Promise<void> {
    const [filePath] = args as [string];
    if (!filePath) {throw new Error("File path is required");}
    await this.context.testExecutor.runFeatureFile({ filePath });
  }

  private refreshTests(): void {
    if (!this.testProvider) {
      this.showErrorMessage("Failed to refresh tests: Test provider not available");
      return;
    }
    const provider = this.testProvider as TestProviderLike;
    provider.discoverTests?.().catch((error) => {
      this.logger.error("Failed to refresh tests after organization change", { error: errMsg(error) });
    });
  }

  private showOutput(): void {
    this.logger.showOutput();
  }

  private validateConfiguration(): void {
    const errors = this.context.config.getValidationErrors();
    if (errors.length > 0) {
      this.showErrorMessage(`Configuration validation failed:\n${errors.join("\n")}`);
    } else {
      vscode.window.showInformationMessage("Configuration is valid");
    }
  }

  private discoverTests(): void {
    vscode.window.showInformationMessage("Test discovery started");
  }

  private async runFeatureWithTags(...args: CommandArguments): Promise<void> {
    const [filePath, tags] = args as [string, string];
    if (!filePath) {throw new Error("File path is required");}
    if (!tags) {throw new Error("Tags are required");}

    this.updateTestStatusForTags(filePath, tags, "started");
    try {
      await this.context.testExecutor.runFeatureFile({ filePath, tags });
      const result = await this.context.testExecutor.runFeatureFileWithOutput({ filePath, tags });
      this.updateTestStatusForTags(filePath, tags, result.success ? "passed" : "failed");
      this.logResult("Feature with tags", result);
      if (!result.success) {throw new Error(`Test failed: ${result.error ?? "Unknown error"}`);}
    } catch (error) {
      this.updateTestStatusForTags(filePath, tags, "failed");
      throw error;
    }
  }

  private async runScenarioWithTags(...args: CommandArguments): Promise<void> {
    const [filePath, lineNumber, scenarioName, tags] = args as [string, number, string, string];
    if (!filePath) {throw new Error("File path is required");}
    if (!tags) {throw new Error("Tags are required");}

    await this.context.testExecutor.runScenario({ filePath, lineNumber, scenarioName, tags });
  }

  private async runAllTestsParallel(): Promise<void> {
    this.logger.info(`Running all ${this.getFrameworkName()} tests in parallel`);
    await this.context.testExecutor.runAllTestsInParallel();
  }

  private async runScenarioWithContext(...args: CommandArguments): Promise<void> {
    const [filePath, lineNumber, scenarioName] = args as [string, number, string];
    if (!filePath) {throw new Error("File path is required");}

    const opts = { filePath, lineNumber, ...(scenarioName ? { scenarioName } : {}) };
    await this.context.testExecutor.runScenario(opts);
    const result = await this.context.testExecutor.runScenarioWithOutput(opts);
    this.logResult("Scenario with context", result);
    if (!result.success) {throw new Error(`Test failed: ${result.error ?? "Unknown error"}`);}
  }

  private async debugScenarioWithContext(...args: CommandArguments): Promise<void> {
    const [filePath, lineNumber, scenarioName] = args as [string, number, string];
    if (!filePath) {throw new Error("File path is required");}

    await this.context.testExecutor.debugScenario({
      filePath,
      lineNumber,
      ...(scenarioName ? { scenarioName } : {}),
      debug: true,
    });
  }

  private async runFeatureFileWithContext(...args: CommandArguments): Promise<void> {
    const [filePath] = args as [string];
    if (!filePath) {throw new Error("File path is required");}

    await this.context.testExecutor.runFeatureFile({ filePath });
    const result = await this.context.testExecutor.runFeatureFileWithOutput({ filePath });
    this.logResult("Feature with context", result);
    if (!result.success) {throw new Error(`Test failed: ${result.error ?? "Unknown error"}`);}
  }

  private showErrorMessage(message: string): void {
    vscode.window.showErrorMessage(message);
  }

  public getRegisteredCommands(): string[] {
    return Array.from(this.commands.keys());
  }

  public isCommandRegistered(commandId: string): boolean {
    return this.commands.has(commandId);
  }

  public async executeCommand(commandId: string, ...args: CommandArguments): Promise<void> {
    if (!this.isCommandRegistered(commandId)) {
      throw new Error(`Command not registered: ${commandId}`);
    }
    await vscode.commands.executeCommand(commandId, ...args);
  }

  public dispose(): void {
    for (const [, disposable] of this.commands) {
      try { disposable.dispose(); } catch { /* ignore */ }
    }
    this.commands.clear();
  }

  private clearCommands(): void {
    this.dispose();
  }

  public reset(): void {
    this.commands.clear();
  }

  private async setOrganizationStrategy(): Promise<void> {
    const strategies = [
      { label: "Tag-based", description: "Group scenarios by their tags", value: "tag" },
      { label: "File-based", description: "Group scenarios by their file location", value: "file" },
      { label: "Scenario Type", description: "Group by regular scenarios vs scenario outlines", value: "scenarioType" },
      { label: "Flat", description: "No grouping, all scenarios in one list", value: "flat" },
    ];
    const selected = await vscode.window.showQuickPick(strategies, {
      placeHolder: "Select organization strategy",
      canPickMany: false,
    });
    if (selected) {await this.setStrategyByValue(selected.value);}
  }

  private async setStrategyByValue(strategyValue: string): Promise<void> {
    try {
      const provider = this.testProvider as TestProviderLike | undefined;
      const organizationManager = provider?.organizationManager;
      if (!organizationManager) {throw new Error("Organization manager not available");}

      const targetType = STRATEGY_TYPE_BY_VALUE[strategyValue];
      const available = organizationManager.getAvailableStrategies();
      const strategy = (targetType && available.find((s) => s.strategy.strategyType === targetType)) ?? available[0];
      if (!strategy) {throw new Error(`Strategy not found: ${strategyValue}`);}

      this.logger.info("Changing organization strategy", {
        from: organizationManager.getStrategy().strategyType,
        to: strategy.strategy.strategyType,
      });
      organizationManager.setStrategy(strategy.strategy);
      provider?.discoveryManager?.clearCache();

      await new Promise((r) => setTimeout(r, 100));
      await provider?.discoverTests?.();
      await new Promise((r) => setTimeout(r, 100));
      await provider?.forceRefreshTestExplorer?.();
      await new Promise((r) => setTimeout(r, 100));

      try {
        await vscode.commands.executeCommand("testing.refreshTests");
      } catch {
        /* command may be unavailable */
      }

      vscode.window.showInformationMessage(`Organization strategy changed to: ${strategy.name}`);
    } catch (error) {
      const msg = errMsg(error);
      this.logger.error("Failed to change organization strategy", { error: msg });
      this.showErrorMessage(`Failed to change organization strategy: ${msg}`);
    }
  }

  private debugOrganization(): void {
    try {
      const provider = this.testProvider as TestProviderLike | undefined;
      const organizationManager = provider?.organizationManager;
      if (!organizationManager) {throw new Error("Organization manager not available");}

      const current = organizationManager.getStrategy();
      this.logger.info("Current Organization Strategy", {
        name: current.strategyType,
        description: current.getDescription(),
      });
      vscode.window.showInformationMessage(`Current Organization Strategy: ${current.strategyType}`);
    } catch (error) {
      const msg = errMsg(error);
      this.logger.error("Failed to debug organization strategy", { error: msg });
      this.showErrorMessage(`Failed to debug organization strategy: ${msg}`);
    }
  }

  public clearTestItemMap(): void {
    this.testItemMap.clear();
  }

  public addTestItemToMap(
    filePath: string,
    lineNumber: number | undefined,
    scenarioName: string | undefined,
    testItem: vscode.TestItem
  ): void {
    this.testItemMap.set(this.getTestItemMapKey(filePath, lineNumber, scenarioName), testItem);
  }

  public getTestItemFromMap(
    filePath: string,
    lineNumber: number | undefined,
    scenarioName: string | undefined
  ): vscode.TestItem | undefined {
    return this.testItemMap.get(this.getTestItemMapKey(filePath, lineNumber, scenarioName));
  }

  private getTestItemMapKey(filePath: string, lineNumber: number | undefined, scenarioName: string | undefined): string {
    return `${filePath}:${lineNumber ?? ""}:${scenarioName ?? ""}`;
  }

  public setTestDiscoveryInProgress(inProgress: boolean): void {
    this.isTestRunning = inProgress;
  }

  public getIsTestRunning(): boolean {
    return this.isTestRunning;
  }
}
