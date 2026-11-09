import { InvocationContext } from "./command-invocation";
import * as vscode from "vscode";
import { BehaveTestRunnerConfig, ConfigurationChangeListener } from "../types";
import { PythonDetector } from "../utils/python-detector";

export class ExtensionConfig {
  private static instance: ExtensionConfig | undefined;
  private config: vscode.WorkspaceConfiguration;
  private changeListeners: ConfigurationChangeListener[] = [];
  private readonly pythonDetector: PythonDetector;
  private configurationSubscription: vscode.Disposable | undefined;
  private disposed = false;

  constructor(
    workspaceConfig?: vscode.WorkspaceConfiguration,
    pythonDetector?: PythonDetector,
    setupChangeListener = true
  ) {
    this.config = workspaceConfig ?? vscode.workspace.getConfiguration("behaveTestRunner");
    this.pythonDetector = pythonDetector ?? PythonDetector.getInstance();
    if (setupChangeListener) {this.setupConfigurationChangeListener();}
  }

  public static create(
    workspaceConfig?: vscode.WorkspaceConfiguration,
    pythonDetector?: PythonDetector,
    setupChangeListener = true
  ): ExtensionConfig {
    return new ExtensionConfig(workspaceConfig, pythonDetector, setupChangeListener);
  }

  /** Capture resource settings once so an admitted operation cannot change underneath a launch. */
  public static forResource(resource: vscode.Uri): ExtensionConfig {
    const source = vscode.workspace.getConfiguration("behaveTestRunner", resource);
    const names = ["behaveCommand", "workingDirectory", "autoDiscoverTests", "testFilePattern", "parallelExecution",
      "maxParallelProcesses", "outputFormat", "tags", "dryRun", "framework", "autoDetectFramework", "pytestCommand",
      "stepDefinitionPaths"];
    const values = new Map(names.map((name) => [name, source.get(name)]));
    const framework = source.inspect<string>("framework");
    const explicit = framework && [framework.globalValue, framework.workspaceValue, framework.workspaceFolderValue,
      framework.globalLanguageValue, framework.workspaceLanguageValue, framework.workspaceFolderLanguageValue].some((value) => value !== undefined);
    const snapshot = ExtensionConfig.create({
      get: (name: string, fallback: unknown) => values.get(name) ?? fallback,
    } as vscode.WorkspaceConfiguration, PythonDetector.create(), false);
    snapshot.explicitFramework = Boolean(explicit);
    return snapshot;
  }

  private explicitFramework: boolean | undefined;

  public hasExplicitFramework(): boolean {
    if (this.explicitFramework !== undefined) {return this.explicitFramework;}
    const setting = this.config.inspect<string>("framework");
    return Boolean(setting && [setting.globalValue, setting.workspaceValue, setting.workspaceFolderValue].some((value) => value !== undefined));
  }

  public static getInstance(): ExtensionConfig {
    ExtensionConfig.instance ??= new ExtensionConfig();
    return ExtensionConfig.instance;
  }

  private setupConfigurationChangeListener(): void {
    this.configurationSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (this.disposed) {return;}
      if (event.affectsConfiguration("behaveTestRunner")) {
        this.config = vscode.workspace.getConfiguration("behaveTestRunner");
        this.notifyChangeListeners();
      }
    });
  }

  public addChangeListener(listener: ConfigurationChangeListener): vscode.Disposable {
    this.changeListeners.push(listener);
    return new vscode.Disposable(() => this.removeChangeListener(listener));
  }

  public removeChangeListener(listener: ConfigurationChangeListener): void {
    const index = this.changeListeners.indexOf(listener);
    if (index > -1) {this.changeListeners.splice(index, 1);}
  }

  private notifyChangeListeners(): void {
    this.changeListeners.forEach((listener) => listener());
  }

  public get behaveCommand(): string {
    return this.config.get<string>("behaveCommand", "behave");
  }

  public async getIntelligentBehaveCommand(context?: InvocationContext): Promise<string> {
    const configured = this.behaveCommand;
    if (configured !== "behave") {return configured;}
    return this.pythonDetector.getBestBehaveCommand(context);
  }

  public get workingDirectory(): string {
    return this.config.get<string>("workingDirectory", "");
  }

  public get autoDiscoverTests(): boolean {
    return this.config.get<boolean>("autoDiscoverTests", true);
  }

  public get enableCodeLens(): boolean {
    return this.config.get<boolean>("enableCodeLens", true);
  }

  public get testFilePattern(): string {
    return this.config.get<string>("testFilePattern", "**/*.feature");
  }

  public get parallelExecution(): boolean {
    return this.config.get<boolean>("parallelExecution", false);
  }

  public get maxParallelProcesses(): number {
    return this.config.get<number>("maxParallelProcesses", 4);
  }

  public get outputFormat(): string {
    return this.config.get<string>("outputFormat", "pretty");
  }

  public static resolveBehaveOutputFormat(override?: string, configured?: string): string {
    const format = override ?? configured ?? "pretty";
    const supported = ["pretty", "plain", "json", "junit", "progress", "steps"];
    if (!supported.includes(format)) {
      throw new Error(`Unsupported Behave outputFormat '${format}'. Choose one of: ${supported.join(", ")}.`);
    }
    return format;
  }

  public get tags(): string {
    return this.config.get<string>("tags", "");
  }

  public get dryRun(): boolean {
    return this.config.get<boolean>("dryRun", false);
  }

  public getAllConfig(): BehaveTestRunnerConfig {
    return {
      behaveCommand: this.behaveCommand,
      workingDirectory: this.workingDirectory,
      autoDiscoverTests: this.autoDiscoverTests,
      enableCodeLens: this.enableCodeLens,
      testFilePattern: this.testFilePattern,
      parallelExecution: this.parallelExecution,
      maxParallelProcesses: this.maxParallelProcesses,
      outputFormat: this.outputFormat,
      tags: this.tags,
      dryRun: this.dryRun,
    };
  }

  public validate(): void {
    const errors: string[] = [];
    if (!this.testFilePattern || this.testFilePattern.trim() === "") {
      errors.push("testFilePattern cannot be empty");
    }
    if (!this.behaveCommand || this.behaveCommand.trim() === "") {
      errors.push("behaveCommand cannot be empty");
    }
    if (this.maxParallelProcesses < 1 || this.maxParallelProcesses > 16) {
      errors.push("maxParallelProcesses must be between 1 and 16");
    }
    if (this.getFramework() === "behave") {
      try {ExtensionConfig.resolveBehaveOutputFormat(undefined, this.outputFormat);}
      catch (error) {errors.push(error instanceof Error ? error.message : String(error));}
    }
    if (errors.length > 0) {
      throw new Error(`Configuration validation failed: ${errors.join(", ")}`);
    }
  }

  public isValid(): boolean {
    try {
      this.validate();
      return true;
    } catch {
      return false;
    }
  }

  public getValidationErrors(): string[] {
    try {
      this.validate();
      return [];
    } catch (error) {
      return error instanceof Error ? [error.message] : [];
    }
  }

  public reload(): void {
    this.config = vscode.workspace.getConfiguration("behaveTestRunner");
    this.notifyChangeListeners();
  }

  public dispose(): void {
    if (this.disposed) {return;}
    this.disposed = true;
    this.configurationSubscription?.dispose();
    this.changeListeners = [];
    if (ExtensionConfig.instance === this) {ExtensionConfig.instance = undefined;}
  }

  public getFramework(): string {
    return this.config.get<string>("framework", "behave");
  }

  public getPytestCommand(): string {
    const custom = this.config.get<string>("pytestCommand", "");
    return custom || "python3 -m pytest";
  }

  public isFrameworkAutoDetectionEnabled(): boolean {
    return this.config.get<boolean>("autoDetectFramework", true);
  }

  public get stepDefinitionPaths(): string[] {
    return this.config.get<string[]>("stepDefinitionPaths", [
      "features/steps/**/*.py",
      "tests/**/*.py",
      "tests/steps/**/*.py",
    ]);
  }

  public get enableStepDefinitionNavigation(): boolean {
    return this.config.get<boolean>("enableStepDefinitionNavigation", true);
  }

  public async setFramework(framework: string): Promise<void> {
    await this.config.update("framework", framework, vscode.ConfigurationTarget.Workspace);
  }
}
