import * as vscode from "vscode";
import { BehaveTestRunnerConfig, ConfigurationChangeListener } from "../types";
import { PythonDetector } from "../utils/python-detector";

export class ExtensionConfig {
  private static instance: ExtensionConfig | undefined;
  private config: vscode.WorkspaceConfiguration;
  private changeListeners: ConfigurationChangeListener[] = [];
  private readonly pythonDetector: PythonDetector;

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

  public static getInstance(): ExtensionConfig {
    ExtensionConfig.instance ??= new ExtensionConfig();
    return ExtensionConfig.instance;
  }

  private setupConfigurationChangeListener(): void {
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("behaveTestRunner")) {
        this.config = vscode.workspace.getConfiguration("behaveTestRunner");
        this.notifyChangeListeners();
      }
    });
  }

  public addChangeListener(listener: ConfigurationChangeListener): void {
    this.changeListeners.push(listener);
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

  public async getIntelligentBehaveCommand(): Promise<string> {
    const configured = this.behaveCommand;
    if (configured !== "behave") {return configured;}
    return this.pythonDetector.getBestBehaveCommand();
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
    const validFormats = ["pretty", "plain", "json", "junit"];
    if (!validFormats.includes(this.outputFormat)) {
      errors.push(`outputFormat must be one of: ${validFormats.join(", ")}`);
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
    this.changeListeners = [];
    ExtensionConfig.instance = undefined;
  }

  public getFramework(): string {
    return this.config.get<string>("framework", "behave");
  }

  public getPytestCommand(): string {
    const custom = this.config.get<string>("pytestCommand", "");
    return custom || "python3 -m pytest";
  }

  public getPytestBddFilePattern(): string {
    return this.config.get<string>("pytestBddFilePattern", "**/*_test.py");
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
