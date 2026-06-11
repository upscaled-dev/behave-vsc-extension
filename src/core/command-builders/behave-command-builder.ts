import * as vscode from "vscode";
import { CommandBuilder } from "./command-builder-interface";
import { TestExecutionOptions, FeatureExecutionOptions } from "../../types";
import { ExtensionConfig } from "../extension-config";
import { escapeBehaveNameArg, escapeBehaveNameRegex } from "../../utils/behave-name-escape";
import { isScenarioOutlineExampleName, extractOutlineName } from "../../utils/scenario-outline";
import * as fs from "fs";

/**
 * Behave Command Builder (Behave Adapter)
 * 
 * This class implements the CommandBuilder interface for the behave framework.
 * It extracts the command building logic from TestExecutor to provide a clean
 * separation between framework-specific command syntax and the core execution logic.
 */
export class BehaveCommandBuilder implements CommandBuilder {
  constructor(private config: ExtensionConfig) {}

  /**
   * Build a command to run a specific scenario using behave syntax
   */
  public async buildScenarioCommand(options: TestExecutionOptions): Promise<string> {
    const { filePath, lineNumber, scenarioName, tags, outputFormat, dryRun } = options;
    const behaveCommand = await this.config.getIntelligentBehaveCommand();

    // Check if this is a scenario outline example
    const isScenarioOutlineExample = isScenarioOutlineExampleName(scenarioName);

    // If scenarioName is a scenario outline (not an example), run all examples in one command
    if (
      scenarioName &&
      !isScenarioOutlineExample &&
      filePath &&
      fs.existsSync(filePath)
    ) {
      // Run a single command with --name="<outline name>"
      let command = `${behaveCommand} "${filePath}" --name="${escapeBehaveNameArg(scenarioName)}"`;
      
      // Add tags
      if (tags) {
        command += ` --tags="${tags}" --no-skipped`;
      } else if (this.config.tags) {
        command += ` --tags="${this.config.tags}" --no-skipped`;
      }
      
      // Add output format
      const format = outputFormat ?? this.config.outputFormat;
      if (format && format !== "pretty") {
        command += ` --format=${format}`;
      }
      
      // Add dry run option
      if (dryRun || this.config.dryRun) {
        command += " --dry-run";
      }
      
      return command;
    }

    // Build command for individual scenario or scenario outline example
    let command = `${behaveCommand} "${filePath}${lineNumber ? `:${lineNumber}` : ""}"`;

    if (scenarioName) {
      // For scenario outline examples, we need to use the original outline name
      if (isScenarioOutlineExample) {
        const originalOutlineName = extractOutlineName(scenarioName);
        command += ` --name="${escapeBehaveNameArg(originalOutlineName)}"`;
      } else {
        command += ` --name="${escapeBehaveNameArg(scenarioName)}"`;
      }
    }

    // Add tags if specified
    if (tags) {
      command += ` --tags="${tags}" --no-skipped`;
    } else if (this.config.tags) {
      command += ` --tags="${this.config.tags}" --no-skipped`;
    }

    // Add output format
    const format = outputFormat ?? this.config.outputFormat;
    if (format && format !== "pretty") {
      command += ` --format=${format}`;
    }

    // Add dry run option
    if (dryRun || this.config.dryRun) {
      command += " --dry-run";
    }

    return command;
  }

  /**
   * Build a command to run an entire feature file using behave syntax
   */
  public async buildFeatureCommand(options: FeatureExecutionOptions): Promise<string> {
    const behaveCommand = await this.config.getIntelligentBehaveCommand();
    let command = `${behaveCommand} "${options.filePath}"`;

    // Add tags if specified
    if (options.tags) {
      command += ` --tags="${options.tags}" --no-skipped`;
    }

    // Add output format
    const outputFormat = options.outputFormat ?? this.config.outputFormat;
    if (outputFormat && outputFormat !== "pretty") {
      command += ` --format=${outputFormat}`;
    }

    // Add dry run option
    if (options.dryRun || this.config.dryRun) {
      command += " --dry-run";
    }

    return command;
  }

  /**
   * Build a command to run tests with specific tags using behave syntax
   */
  public async buildTagCommand(tag: string): Promise<string> {
    const behaveCommand = await this.config.getIntelligentBehaveCommand();
    return `${behaveCommand} --tags="${tag}" --no-skipped`;
  }

  /**
   * Build a command to run the entire suite using behave syntax
   */
  public async buildRunAllCommand(): Promise<string> {
    let command = await this.config.getIntelligentBehaveCommand();
    if (this.config.tags) {
      command += ` --tags="${this.config.tags}" --no-skipped`;
    }
    const format = this.config.outputFormat;
    if (format && format !== "pretty") {
      command += ` --format=${format}`;
    }
    if (this.config.dryRun) {
      command += " --dry-run";
    }
    return command;
  }

  /**
   * Build a command to debug a specific scenario using behave syntax
   * For behave, debug mode uses --no-capture to show print statements
   */
  public async buildDebugCommand(options: TestExecutionOptions): Promise<string> {
    const baseCommand = await this.buildScenarioCommand(options);
    return `${baseCommand} --no-capture`;
  }

  /**
   * Build a VSCode debug configuration that launches behave under the Python
   * debugger so breakpoints are honored. `cwd` is intentionally omitted and
   * injected by the caller (TestExecutor).
   */
  public buildDebugConfiguration(options: TestExecutionOptions): Promise<vscode.DebugConfiguration> {
    const { filePath, lineNumber, scenarioName } = options;
    if (!filePath || filePath.trim() === "") {
      throw new Error("File path is required for debugging");
    }

    const isExample = isScenarioOutlineExampleName(scenarioName);
    const isOutlineRun = Boolean(scenarioName) && !isExample && fs.existsSync(filePath);

    const args: string[] = isOutlineRun
      ? [filePath, "--name", escapeBehaveNameRegex(scenarioName as string)]
      : [`${filePath}${lineNumber ? `:${lineNumber}` : ""}`];

    if (!isOutlineRun && scenarioName) {
      args.push(
        "--name",
        escapeBehaveNameRegex(isExample ? extractOutlineName(scenarioName) : scenarioName)
      );
    }

    // Show print/stdout while debugging (behave captures it by default).
    args.push("--no-capture");

    return Promise.resolve({
      name: `Debug: ${scenarioName ?? "Test Scenario"}`,
      type: "debugpy",
      request: "launch",
      module: "behave",
      args,
      console: "integratedTerminal",
      justMyCode: false,
    });
  }

  /**
   * Validate that behave is properly installed and available
   */
  public validateInstallation(): boolean {
    try {
      // This is a simplified validation - in a real implementation,
      // you would execute 'behave --version' or similar
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the framework name
   */
  public getFrameworkName(): string {
    return "behave";
  }

}