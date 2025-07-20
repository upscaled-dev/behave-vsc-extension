import * as vscode from "vscode";
import { BehaveTestRunnerConfig, ConfigurationChangeListener } from "../types";

/**
 * Centralized configuration management for the Behave Test Runner extension
 */
export class ExtensionConfig {
  private static instance: ExtensionConfig | undefined;
  private config: vscode.WorkspaceConfiguration;
  private changeListeners: ConfigurationChangeListener[] = [];

  private constructor() {
    this.config = vscode.workspace.getConfiguration("behaveTestRunner");
    this.setupConfigurationChangeListener();
  }

  /**
   * Get the singleton instance of the configuration
   */
  public static getInstance(): ExtensionConfig {
    ExtensionConfig.instance ??= new ExtensionConfig();
    return ExtensionConfig.instance;
  }

  /**
   * Setup listener for configuration changes
   */
  private setupConfigurationChangeListener(): void {
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("behaveTestRunner")) {
        this.config = vscode.workspace.getConfiguration("behaveTestRunner");
        this.notifyChangeListeners();
      }
    });
  }

  /**
   * Add a change listener
   * @param listener - Function to call when configuration changes
   */
  public addChangeListener(listener: ConfigurationChangeListener): void {
    this.changeListeners.push(listener);
  }

  /**
   * Remove a change listener
   * @param listener - Function to remove
   */
  public removeChangeListener(listener: ConfigurationChangeListener): void {
    const index = this.changeListeners.indexOf(listener);
    if (index > -1) {
      this.changeListeners.splice(index, 1);
    }
  }

  /**
   * Notify all change listeners
   */
  private notifyChangeListeners(): void {
    this.changeListeners.forEach((listener) => listener());
  }

  /**
   * Get the behave command
   */
  public get behaveCommand(): string {
    return this.config.get<string>("behaveCommand", "behave");
  }

  /**
   * Get the working directory
   */
  public get workingDirectory(): string {
    return this.config.get<string>("workingDirectory", "");
  }

  /**
   * Get auto discover tests setting
   */
  public get autoDiscoverTests(): boolean {
    return this.config.get<boolean>("autoDiscoverTests", true);
  }

  /**
   * Get enable CodeLens setting
   */
  public get enableCodeLens(): boolean {
    return this.config.get<boolean>("enableCodeLens", true);
  }

  /**
   * Get enable test explorer setting
   */
  public get enableTestExplorer(): boolean {
    return this.config.get<boolean>("enableTestExplorer", true);
  }

  /**
   * Get priority setting
   */
  public get priority(): string {
    return this.config.get<string>("priority", "normal");
  }

  /**
   * Get test file pattern
   */
  public get testFilePattern(): string {
    return this.config.get<string>("testFilePattern", "**/*.feature");
  }

  /**
   * Get parallel execution setting
   */
  public get parallelExecution(): boolean {
    return this.config.get<boolean>("parallelExecution", false);
  }

  /**
   * Get max parallel processes
   */
  public get maxParallelProcesses(): number {
    return this.config.get<number>("maxParallelProcesses", 4);
  }

  /**
   * Get output format
   */
  public get outputFormat(): string {
    return this.config.get<string>("outputFormat", "pretty");
  }

  /**
   * Get tags
   */
  public get tags(): string {
    return this.config.get<string>("tags", "");
  }

  /**
   * Get dry run setting
   */
  public get dryRun(): boolean {
    return this.config.get<boolean>("dryRun", false);
  }

  /**
   * Get all configuration as a BehaveTestRunnerConfig object
   */
  public getAllConfig(): BehaveTestRunnerConfig {
    return {
      behaveCommand: this.behaveCommand,
      workingDirectory: this.workingDirectory,
      autoDiscoverTests: this.autoDiscoverTests,
      enableCodeLens: this.enableCodeLens,
      enableTestExplorer: this.enableTestExplorer,
      priority: this.priority,
      testFilePattern: this.testFilePattern,
      parallelExecution: this.parallelExecution,
      maxParallelProcesses: this.maxParallelProcesses,
      outputFormat: this.outputFormat,
      tags: this.tags,
      dryRun: this.dryRun,
    };
  }

  /**
   * Validate all configuration values
   * @throws Error if validation fails
   */
  public validate(): void {
    const errors: string[] = [];

    // Validate test file pattern
    if (!this.testFilePattern || this.testFilePattern.trim() === "") {
      errors.push("testFilePattern cannot be empty");
    }

    // Validate behave command
    if (!this.behaveCommand || this.behaveCommand.trim() === "") {
      errors.push("behaveCommand cannot be empty");
    }

    // Validate max parallel processes
    if (this.maxParallelProcesses < 1 || this.maxParallelProcesses > 16) {
      errors.push("maxParallelProcesses must be between 1 and 16");
    }

    // Validate output format
    const validFormats = ["pretty", "plain", "json", "junit"];
    if (!validFormats.includes(this.outputFormat)) {
      errors.push(`outputFormat must be one of: ${validFormats.join(", ")}`);
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed: ${errors.join(", ")}`);
    }
  }

  /**
   * Check if configuration is valid
   * @returns True if configuration is valid
   */
  public isValid(): boolean {
    try {
      this.validate();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get configuration validation errors
   * @returns Array of validation error messages
   */
  public getValidationErrors(): string[] {
    const errors: string[] = [];

    try {
      this.validate();
    } catch (error) {
      if (error instanceof Error) {
        errors.push(error.message);
      }
    }

    return errors;
  }

  /**
   * Reload configuration from VS Code settings
   */
  public reload(): void {
    this.config = vscode.workspace.getConfiguration("behaveTestRunner");
    this.notifyChangeListeners();
  }

  /**
   * Dispose of the configuration instance
   */
  public dispose(): void {
    this.changeListeners = [];
    ExtensionConfig.instance = undefined;
  }
}
