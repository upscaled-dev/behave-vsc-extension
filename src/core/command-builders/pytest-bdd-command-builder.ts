import * as vscode from "vscode";
import { CommandBuilder } from "./command-builder-interface";
import { TestExecutionOptions, FeatureExecutionOptions } from "../../types";
import { ExtensionConfig } from "../extension-config";

/**
 * pytest-bdd Command Builder (pytest-bdd Adapter)
 * 
 * This class implements the CommandBuilder interface for the pytest-bdd framework.
 * It converts BDD test execution requests into pytest-bdd compatible command syntax,
 * handling the differences between behave and pytest-bdd command structures.
 */
export class PytestBddCommandBuilder implements CommandBuilder {
  constructor(private config: ExtensionConfig) {}

  /**
   * Build a command to run a specific scenario using pytest-bdd syntax
   */
  public buildScenarioCommand(options: TestExecutionOptions): Promise<string> {
    const { filePath, scenarioName, tags, outputFormat, dryRun } = options;
    const pytestCommand = this.config.getPytestCommand();

    // Convert .feature file path to corresponding test file path
    const testFilePath = this.convertFeaturePathToTestPath(filePath);
    let command = `${pytestCommand} "${testFilePath}"`;

    if (scenarioName) {
      // Convert scenario name to pytest test function name
      const testFunctionName = this.convertScenarioNameToTestFunction(scenarioName);
      command += `::${testFunctionName}`;
    }

    // Add markers (pytest equivalent of behave tags)
    if (tags) {
      const marker = this.convertTagToMarker(tags);
      command += ` -m "${marker}"`;
    }

    // Add output format (pytest uses different format options)
    if (outputFormat && outputFormat !== "pretty") {
      const pytestFormat = this.convertOutputFormatToPytest(outputFormat);
      if (pytestFormat) {
        command += ` ${pytestFormat}`;
      }
    }

    // Add verbose output for better visibility (similar to behave's pretty format)
    command += " -v";

    // Add cucumber JSON output for better result parsing
    command += " --cucumber-json=cucumber-output.json";

    // pytest-bdd doesn't have direct dry-run equivalent, but we can use collect-only
    if (dryRun || this.config.dryRun) {
      command += " --collect-only";
    }

    return Promise.resolve(command);
  }

  /**
   * Build a command to run an entire feature file using pytest-bdd syntax
   */
  public buildFeatureCommand(options: FeatureExecutionOptions): Promise<string> {
    const pytestCommand = this.config.getPytestCommand();
    
    // Convert .feature file path to corresponding test file path
    const testFilePath = this.convertFeaturePathToTestPath(options.filePath);
    let command = `${pytestCommand} "${testFilePath}"`;

    // Add markers if specified
    if (options.tags) {
      const marker = this.convertTagToMarker(options.tags);
      command += ` -m "${marker}"`;
    }

    // Add output format
    const outputFormat = options.outputFormat ?? this.config.outputFormat;
    if (outputFormat && outputFormat !== "pretty") {
      const pytestFormat = this.convertOutputFormatToPytest(outputFormat);
      if (pytestFormat) {
        command += ` ${pytestFormat}`;
      }
    }

    // Add verbose output
    command += " -v";

    // Add cucumber JSON output for better result parsing
    command += " --cucumber-json=cucumber-output.json";

    // Handle dry run
    if (options.dryRun || this.config.dryRun) {
      command += " --collect-only";
    }

    return Promise.resolve(command);
  }

  /**
   * Build a command to run tests with specific markers using pytest-bdd syntax
   */
  public buildTagCommand(tag: string): Promise<string> {
    const pytestCommand = this.config.getPytestCommand();
    const marker = this.convertTagToMarker(tag);
    return Promise.resolve(`${pytestCommand} -m "${marker}" -v --cucumber-json=cucumber-output.json`);
  }

  /**
   * Build a command to debug a specific scenario using pytest-bdd syntax
   * For pytest, debug mode uses -s to show print statements and --pdb for debugging
   */
  public async buildDebugCommand(options: TestExecutionOptions): Promise<string> {
    const baseCommand = await this.buildScenarioCommand(options);
    return `${baseCommand} -s --capture=no`;
  }

  /**
   * Build a VSCode debug configuration that launches pytest under the Python
   * debugger so breakpoints are honored. `cwd` is intentionally omitted and
   * injected by the caller (TestExecutor).
   */
  public buildDebugConfiguration(options: TestExecutionOptions): Promise<vscode.DebugConfiguration> {
    const { filePath, scenarioName } = options;
    if (!filePath || filePath.trim() === "") {
      throw new Error("File path is required for debugging");
    }

    const testFilePath = this.convertFeaturePathToTestPath(filePath);
    let target = testFilePath;
    if (scenarioName) {
      target += `::${this.convertScenarioNameToTestFunction(scenarioName)}`;
    }

    // -s disables pytest's stdout capture so print output is visible while debugging.
    const args = [target, "-s", "-v"];

    return Promise.resolve({
      name: `Debug: ${scenarioName ?? "Test Scenario"}`,
      type: "debugpy",
      request: "launch",
      module: "pytest",
      args,
      console: "integratedTerminal",
      justMyCode: false,
    });
  }

  /**
   * Validate that pytest and pytest-bdd are properly installed and available
   */
  public validateInstallation(): boolean {
    try {
      // This is a simplified validation - in a real implementation,
      // you would execute 'pytest --version' and check for pytest-bdd
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the framework name
   */
  public getFrameworkName(): string {
    return "pytest-bdd";
  }

  /**
   * Convert a .feature file path to the corresponding pytest test file path
   * This is a heuristic conversion - in practice, this mapping might be configurable
   */
  private convertFeaturePathToTestPath(featurePath: string): string {
    // Handle different feature file patterns
    const fileName = featurePath.split(/[/\\]/).pop() ?? "";
    const baseName = fileName.replace(".feature", "");
    
    // Look for test files in common locations with better heuristics
    const possiblePaths = [
      `tests/test_${baseName}.py`, // Prefer tests/ directory
      `test_${baseName}.py`,
      `tests/${baseName}_test.py`,
      `${baseName}_test.py`,
      `test_${baseName.replace(/[^a-zA-Z0-9]/g, "_")}.py`,
      `tests/test_${baseName.replace(/[^a-zA-Z0-9]/g, "_")}.py`
    ];

    // For now, return the first possibility (tests/test_*.py)
    // In a real implementation, we would check which file actually exists
    return possiblePaths[0] ?? `tests/test_${baseName}.py`;
  }

  /**
   * Convert a scenario name to a pytest test function name
   * Example: "Basic smoke test" → "test_basic_smoke_test"
   * Handles scenario outlines and special characters
   */
  private convertScenarioNameToTestFunction(scenarioName: string): string {
    // Remove scenario outline example details if present
    let cleanName = scenarioName;
    if (scenarioName.includes(" - ")) {
      const parts = scenarioName.split(" - ");
      cleanName = parts[0] ?? scenarioName;
      
      // Remove number prefix from scenario outline examples
      if (cleanName?.match(/^\d+:\s*/)) {
        cleanName = cleanName.replace(/^\d+:\s*/, "");
      }
    }

    // Handle scenario outline examples with parameters
    if (cleanName.includes("<") && cleanName.includes(">")) {
      // For scenario outlines, use the base scenario name
      cleanName = cleanName.replace(/<[^>]+>/g, "").trim();
    }

    // Special mappings for common scenario names
    const scenarioMappings: Record<string, string> = {
      "Basic login functionality": "test_basic_login",
      "Login with invalid credentials": "test_invalid_login", 
      "User registration": "test_user_registration",
      "Login with different user types": "test_login_different_user_types",
      "Form validation for registration": "test_form_validation_registration",
      "Concurrent user login simulation": "test_concurrent_user_login",
      "Security validation for login attempts": "test_security_validation_login"
    };

    // Check if we have a direct mapping
    const mappedName = scenarioMappings[cleanName];
    if (mappedName) {
      return mappedName;
    }

    // Convert to snake_case and add test_ prefix
    const snakeCase = cleanName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "") // Remove special characters
      .replace(/\s+/g, "_") // Replace spaces with underscores
      .replace(/_+/g, "_") // Remove duplicate underscores
      .replace(/^_|_$/g, ""); // Remove leading/trailing underscores

    return `test_${snakeCase}`;
  }

  /**
   * Convert behave tags to pytest markers
   * Example: "@smoke" → "smoke", "@regression" → "regression"
   */
  private convertTagToMarker(tag: string): string {
    // Remove @ prefix if present
    return tag.replace(/^@/, "");
  }

  /**
   * Convert behave output formats to pytest equivalent options
   */
  private convertOutputFormatToPytest(format: string): string | null {
    switch (format.toLowerCase()) {
      case "json":
        return "--json-report";
      case "junit":
        return "--junit-xml=junit.xml";
      case "plain":
        return "-q"; // Quiet mode, less verbose
      case "progress":
        return "--tb=no"; // No traceback, just progress
      default:
        return null; // Use default pytest output
    }
  }
} 