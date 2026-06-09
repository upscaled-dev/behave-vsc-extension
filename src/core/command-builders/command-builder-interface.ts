import * as vscode from "vscode";
import { TestExecutionOptions, FeatureExecutionOptions } from "../../types";

/**
 * Command Builder Interface (Adapter Target)
 * 
 * This interface defines the contract that all framework-specific command builders must implement.
 * It uses the Adapter Pattern to provide a unified interface for different BDD frameworks
 * (behave, pytest-bdd, etc.) while allowing each framework to have its own command syntax.
 */
export interface CommandBuilder {
  /**
   * Build a command to run a specific scenario
   * @param options - Test execution options including file path, line number, scenario name
   * @returns Promise resolving to command string to execute the scenario
   */
  buildScenarioCommand(options: TestExecutionOptions): Promise<string>;

  /**
   * Build a command to run an entire feature file
   * @param options - Feature execution options including file path
   * @returns Promise resolving to command string to execute the feature file
   */
  buildFeatureCommand(options: FeatureExecutionOptions): Promise<string>;

  /**
   * Build a command to run tests with specific tags/markers
   * @param tag - Tag to filter tests (e.g., "@smoke", "@regression")
   * @returns Promise resolving to command string to execute tests with the specified tag
   */
  buildTagCommand(tag: string): Promise<string>;

  /**
   * Build a command to debug a specific scenario
   * @param options - Test execution options including file path, line number, scenario name
   * @returns Promise resolving to command string to debug the scenario
   */
  buildDebugCommand(options: TestExecutionOptions): Promise<string>;

  /**
   * Build a VSCode debug configuration to launch a debug session for a scenario.
   *
   * Unlike buildDebugCommand (which produces a shell command string), this returns
   * a launch configuration passed to vscode.debug.startDebugging so the Python
   * debugger attaches and breakpoints are honored. The `cwd` may be omitted; the
   * caller (TestExecutor) injects the working directory.
   *
   * @param options - Test execution options including file path, line number, scenario name
   * @returns Promise resolving to a VSCode debug configuration
   */
  buildDebugConfiguration(options: TestExecutionOptions): Promise<vscode.DebugConfiguration>;

  /**
   * Validate that the framework is properly installed and available
   * @returns True if the framework is available, false otherwise
   */
  validateInstallation(): boolean;

  /**
   * Get the name of the framework this builder supports
   * @returns Framework name (e.g., "behave", "pytest-bdd")
   */
  getFrameworkName(): string;
} 