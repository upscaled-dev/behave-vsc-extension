import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { CommandBuilder } from "./command-builder-interface";
import { TestExecutionOptions, FeatureExecutionOptions } from "../../types";
import { ExtensionConfig } from "../extension-config";
import { isScenarioOutlineExampleName, extractOutlineName } from "../../utils/scenario-outline";

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
   * Build a command to run the entire suite using pytest-bdd syntax
   */
  public buildRunAllCommand(): Promise<string> {
    const pytestCommand = this.config.getPytestCommand();
    let command = `${pytestCommand} -v --cucumber-json=cucumber-output.json`;
    if (this.config.tags) {
      command += ` -m "${this.convertTagToMarker(this.config.tags)}"`;
    }
    if (this.config.dryRun) {
      command += " --collect-only";
    }
    return Promise.resolve(command);
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
   * Convert a .feature file path to the corresponding pytest test file path.
   * Candidate locations are checked for existence against the workspace root
   * and the feature file's own directory tree before falling back to the
   * conventional `tests/test_<name>.py`.
   */
  private convertFeaturePathToTestPath(featurePath: string): string {
    // Handle different feature file patterns
    const fileName = featurePath.split(/[/\\]/).pop() ?? "";
    const baseName = fileName.replace(".feature", "");
    const sanitized = baseName.replace(/[^a-zA-Z0-9]/g, "_");

    // Look for test files in common locations
    const possiblePaths = [
      `tests/test_${baseName}.py`, // Prefer tests/ directory
      `test_${baseName}.py`,
      `tests/${baseName}_test.py`,
      `${baseName}_test.py`,
      `tests/test_${sanitized}.py`,
      `test_${sanitized}.py`,
      `tests/step_defs/test_${baseName}.py`,
      `tests/step_defs/test_${sanitized}.py`,
    ];

    // Roots to resolve the relative candidates against: the workspace root
    // (the command's working directory) plus the feature file's directory and
    // its parents (covers features/ next to tests/ layouts).
    const featureDir = path.dirname(featurePath);
    const roots = [
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      featureDir,
      path.dirname(featureDir),
      path.dirname(path.dirname(featureDir)),
    ].filter((root): root is string => Boolean(root));

    const workspaceRoot = roots[0];
    for (const root of roots) {
      for (const candidate of possiblePaths) {
        const absolute = path.join(root, candidate);
        try {
          if (fs.existsSync(absolute)) {
            // Keep the command's path relative to the working directory when
            // possible; otherwise use the absolute path.
            return workspaceRoot && absolute.startsWith(workspaceRoot)
              ? path.relative(workspaceRoot, absolute)
              : absolute;
          }
        } catch {
          // Unreadable root — try the next candidate.
        }
      }
    }

    // Nothing found: fall back to the conventional location.
    return possiblePaths[0] ?? `tests/test_${baseName}.py`;
  }

  /**
   * Convert a scenario name to a pytest test function name
   * Example: "Basic smoke test" → "test_basic_smoke_test"
   * Handles scenario outlines and special characters
   */
  private convertScenarioNameToTestFunction(scenarioName: string): string {
    // Remove scenario outline example details if present
    let cleanName = isScenarioOutlineExampleName(scenarioName)
      ? extractOutlineName(scenarioName)
      : scenarioName;

    // Handle scenario outline examples with parameters
    if (cleanName.includes("<") && cleanName.includes(">")) {
      // For scenario outlines, use the base scenario name
      cleanName = cleanName.replace(/<[^>]+>/g, "").trim();
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