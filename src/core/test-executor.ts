import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  TestExecutionOptions,
  TestRunResult,
  ParallelExecutionOptions,
  FeatureExecutionOptions,
} from "../types/index";
import { Logger } from "../utils/logger";
import { ExtensionConfig } from "./extension-config";

/**
 * Handles execution of Behave tests
 */
export class TestExecutor {
  private config: ExtensionConfig;
  private workspace: typeof vscode.workspace;
  private window: typeof vscode.window;
  private debug: typeof vscode.debug;
  private terminal: vscode.Terminal | undefined;

  constructor(
    workspace: typeof vscode.workspace = vscode.workspace,
    window: typeof vscode.window = vscode.window,
    debug: typeof vscode.debug = vscode.debug
  ) {
    this.workspace = workspace;
    this.window = window;
    this.debug = debug;
    this.config = ExtensionConfig.getInstance();
  }

  /**
   * Reload configuration from VS Code settings
   */
  public reloadConfiguration(): void {
    this.config.reload();
  }

  /**
   * Run a specific scenario with enhanced options
   * @param options - Test execution options
   */
  public async runScenario(options: TestExecutionOptions): Promise<void> {
    const { filePath, lineNumber, scenarioName, tags, outputFormat, dryRun } = options;
    const workingDir = this.getWorkingDirectory();
    const behaveCommand = await this.config.getIntelligentBehaveCommand();

    // Check if this is a scenario outline example
    const isScenarioOutlineExample = this.isScenarioOutlineExample(
      filePath,
      lineNumber,
      scenarioName
    );

    // If scenarioName is a scenario outline (not an example), run all examples in one command
    if (
      scenarioName &&
      !isScenarioOutlineExample &&
      filePath &&
      fs.existsSync(filePath)
    ) {
      // Run a single command with --name="<outline name>"
      let command = `${behaveCommand} "${filePath}" --name="${scenarioName}"`;
      if (tags) {
        command += ` --tags="${tags}"`;
        command += " --no-skipped";
      } else if (this.config.tags) {
        command += ` --tags="${this.config.tags}"`;
        command += " --no-skipped";
      }
      const format = outputFormat ?? this.config.outputFormat;
      if (format && format !== "pretty") {
        command += ` --format=${format}`;
      }
      if (dryRun || this.config.dryRun) {
        command += " --dry-run";
      }
      this.executeCommand(command, workingDir);
      return;
    }

    let command = `${behaveCommand} "${filePath}${lineNumber ? `:${lineNumber}` : ""}"`;

    if (scenarioName) {
      // For scenario outline examples, we need to use the original outline name
      if (isScenarioOutlineExample) {
        const originalOutlineName = this.extractOriginalOutlineName(scenarioName);
        command += ` --name="${originalOutlineName}"`;
      } else {
        command += ` --name="${scenarioName}"`;
      }
    }
    // If no scenarioName is provided, behave will run all scenarios in the file
    // This is used for scenario outlines to iterate over all examples

    // Add tags if specified
    if (tags) {
      command += ` --tags="${tags}"`;
      command += " --no-skipped";
    } else if (this.config.tags) {
      command += ` --tags="${this.config.tags}"`;
      command += " --no-skipped";
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

    this.executeCommand(command, workingDir);
  }

  /**
   * Debug a specific scenario
   * @param options - Test execution options
   */
  public async debugScenario(options: TestExecutionOptions): Promise<void> {
    try {
      const { filePath, lineNumber, scenarioName } = options;

      if (!filePath || filePath.trim() === "") {
        throw new Error("File path is required for debugging");
      }

      const workingDir = this.getWorkingDirectory();

      // Check if this is a scenario outline example
      const isScenarioOutlineExample = this.isScenarioOutlineExample(
        filePath,
        lineNumber,
        scenarioName
      );

      // If scenarioName is a scenario outline (not an example), debug all examples in one command
      if (
        scenarioName &&
        !isScenarioOutlineExample &&
        filePath &&
        fs.existsSync(filePath)
      ) {
        // Debug a single command with --name="<outline name>" (without line number)
        const args = [filePath, "--name", scenarioName];
        
        const debugConfig = {
          name: `Debug: ${scenarioName}`,
          type: "python",
          request: "launch",
          module: "behave",
          args,
          cwd: workingDir,
          console: "integratedTerminal",
          justMyCode: false,
        };

        await this.debug.startDebugging(undefined, debugConfig);
        return;
      }

      // Build args array similar to runScenario method
      const args = [`${filePath}${lineNumber ? `:${lineNumber}` : ""}`];

      // Add scenario name filter if provided
      if (scenarioName) {
        // For scenario outline examples, we need to use the original outline name
        if (isScenarioOutlineExample) {
          const originalOutlineName = this.extractOriginalOutlineName(scenarioName);
          args.push("--name", originalOutlineName);
        } else {
          args.push("--name", scenarioName);
        }
      }

      const debugConfig = {
        name: `Debug: ${scenarioName ?? "Test Scenario"}`,
        type: "python",
        request: "launch",
        module: "behave",
        args,
        cwd: workingDir,
        console: "integratedTerminal",
        justMyCode: false,
      };

      await this.debug.startDebugging(undefined, debugConfig);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      Logger.getInstance().error(
        `Failed to start debug session: ${errorMessage}`,
        {
          filePath: options.filePath,
          lineNumber: options.lineNumber,
          scenarioName: options.scenarioName,
        }
      );

      await this.window.showErrorMessage(
        `Failed to start debug session: ${errorMessage}. Please ensure Python and behave are properly configured.`
      );
    }
  }

  /**
   * Run a feature file with enhanced options
   * @param options - Feature execution options
   */
  public async runFeatureFile(options: FeatureExecutionOptions): Promise<void> {
    const workingDir = this.getWorkingDirectory();
    const behaveCommand = await this.config.getIntelligentBehaveCommand();
    let command = `${behaveCommand} "${options.filePath}"`;

    // Add tags if specified
    if (options.tags) {
      command += ` --tags="${options.tags}"`;
      command += " --no-skipped";
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

    this.executeCommand(command, workingDir);
  }

  /**
   * Run a feature file (legacy method for backward compatibility)
   * @param filePath - Path to the feature file
   */
  public async runFeatureFileLegacy(filePath: string): Promise<void> {
    await this.runFeatureFile({ filePath });
  }

  /**
   * Run all tests in the workspace
   */
  public async runAllTests(): Promise<void> {
    const workingDir = this.getWorkingDirectory();
    const behaveCommand = await this.config.getIntelligentBehaveCommand();
    let command = `${behaveCommand}`;

    // Add tags if specified in config
    if (this.config.tags) {
      command += ` --tags="${this.config.tags}"`;
      command += " --no-skipped";
    }

    // Add output format
    if (this.config.outputFormat && this.config.outputFormat !== "pretty") {
      command += ` --format=${this.config.outputFormat}`;
    }

    // Add dry run option
    if (this.config.dryRun) {
      command += " --dry-run";
    }

    this.executeCommand(command, workingDir);
  }

  /**
   * Run tests in parallel
   * @param options - Parallel execution options
   */
  public runTestsInParallel(options: ParallelExecutionOptions): void {
    const workingDir = this.getWorkingDirectory();
    const behaveCommand = this.config.behaveCommand;
    const maxProcesses =
      options.maxProcesses ?? this.config.maxParallelProcesses;

    // Log the number of workers being used

    this.window.showInformationMessage(
      `Running ${options.featureFiles.length} feature files in parallel (max ${maxProcesses} workers)`
    );

    // Create a script to run tests in parallel
    const scriptContent = this.createParallelExecutionScript(
      options.featureFiles,
      behaveCommand,
      maxProcesses,
      options.tags,
      options.outputFormat ?? undefined,
      options.dryRun ?? undefined
    );

    const scriptPath = path.join(workingDir, "parallel_behave_runner.py");

    // Write the script to a temporary file
    fs.writeFileSync(scriptPath, scriptContent);

    // Execute the parallel script
    const command = `python "${scriptPath}"`;
    this.executeCommand(command, workingDir);
  }

  /**
   * Create a Python script for parallel execution
   */
  private createParallelExecutionScript(
    featureFiles: string[],
    behaveCommand: string,
    maxProcesses: number,
    tags?: string,
    outputFormat?: string,
    dryRun?: boolean
  ): string {
    // Build the command arguments properly for Python
    const cmdArgs = [];
    if (tags) {
      cmdArgs.push("--tags", tags);
      cmdArgs.push("--no-skipped");
    }
    if (outputFormat && outputFormat !== "pretty") {
      cmdArgs.push("--format", outputFormat);
    }
    if (dryRun) {
      cmdArgs.push("--dry-run");
    }

    const cmdArgsStr =
      cmdArgs.length > 0 ? ` + ${JSON.stringify(cmdArgs)}` : "";

    return `
import subprocess
import concurrent.futures
import sys
import os

def run_behave_file(feature_file):
    """Run behave for a single feature file"""
    try:
        cmd = ['${behaveCommand}', feature_file]${cmdArgsStr}
        result = subprocess.run(cmd, capture_output=True, text=True, cwd='${this.getWorkingDirectory()}')
        return {
            'file': feature_file,
            'success': result.returncode == 0,
            'output': result.stdout,
            'error': result.stderr,
            'returncode': result.returncode
        }
    except Exception as e:
        return {
            'file': feature_file,
            'success': False,
            'output': '',
            'error': str(e),
            'returncode': 1
        }

def main():
    feature_files = ${JSON.stringify(featureFiles)}

    print(f"Running {len(feature_files)} feature files in parallel (max {${maxProcesses}} processes)")

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=${maxProcesses}) as executor:
        future_to_file = {executor.submit(run_behave_file, file): file for file in feature_files}

        for future in concurrent.futures.as_completed(future_to_file):
            result = future.result()
            results.append(result)

            status = "✓ PASS" if result['success'] else "✗ FAIL"
            print(f"{status} {result['file']}")

            if not result['success'] and result['error']:
                print(f"  Error: {result['error']}")

    # Summary
    passed = sum(1 for r in results if r['success'])
    failed = len(results) - passed

    print(f"\\nSummary: {passed} passed, {failed} failed")

    if failed > 0:
        sys.exit(1)
    else:
        sys.exit(0)

if __name__ == "__main__":
    main()
`;
  }

  /**
   * Execute a command in the terminal
   * @param command - Command to execute
   * @param workingDir - Working directory
   */
  private executeCommand(command: string, workingDir: string): void {
    try {
      if (!command || command.trim() === "") {
        throw new Error("Command cannot be empty");
      }

      // Reuse existing terminal or create a new one if it doesn't exist
      this.terminal ??= this.window.createTerminal("Behave Test Runner");

      this.terminal.show();

      // Clear the terminal for a clean run
      this.terminal.sendText("clear");

      // Change to working directory if specified
      if (workingDir && workingDir !== process.cwd()) {
        this.terminal.sendText(`cd "${workingDir}"`);
      }

      this.terminal.sendText(command);

      Logger.getInstance().info(`Executed command: ${command}`, { workingDir });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      Logger.getInstance().error(`Failed to execute command: ${errorMessage}`, {
        command,
        workingDir,
      });

      this.window.showErrorMessage(
        `Failed to execute test command: ${errorMessage}`
      );
    }
  }

  /**
   * Execute a command and capture the output and return code
   * @param command - Command to execute
   * @param workingDir - Working directory
   * @returns Promise with command execution result
   */
  private async executeCommandWithOutput(
    command: string,
    workingDir: string
  ): Promise<{
    success: boolean;
    output: string;
    error: string;
    returnCode: number;
  }> {
    return new Promise((resolve) => {
      try {
        if (!command || command.trim() === "") {
          resolve({
            success: false,
            output: "",
            error: "Command cannot be empty",
            returnCode: 1,
          });
          return;
        }

        // Import child_process dynamically to avoid issues in extension context
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { spawn } = require("child_process");

        // Split command into parts for spawn
        const commandParts = command.split(" ");
        const executable = commandParts[0];
        const args = commandParts.slice(1);

        Logger.getInstance().info(
          `Executing command with output capture: ${command}`,
          { workingDir }
        );

        const childProcess = spawn(executable, args, {
          cwd: workingDir,
          shell: true,
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        childProcess.stdout?.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        childProcess.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        childProcess.on("close", (code: number) => {
          const returnCode = code ?? 1;
          const success = returnCode === 0;

          Logger.getInstance().info(
            `Command completed with return code: ${returnCode}`,
            {
              command,
              success,
              stdoutLength: stdout.length,
              stderrLength: stderr.length,
            }
          );

          resolve({
            success,
            output: stdout,
            error: stderr,
            returnCode,
          });
        });

        childProcess.on("error", (error: Error) => {
          Logger.getInstance().error(
            `Command execution error: ${error.message}`,
            {
              command,
              workingDir,
            }
          );

          resolve({
            success: false,
            output: "",
            error: error.message,
            returnCode: 1,
          });
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";
        Logger.getInstance().error(
          `Failed to execute command with output: ${errorMessage}`,
          {
            command,
            workingDir,
          }
        );

        resolve({
          success: false,
          output: "",
          error: errorMessage,
          returnCode: 1,
        });
      }
    });
  }

  /**
   * Get the working directory for test execution
   */
  private getWorkingDirectory(): string {
    // Use configured working directory if set
    if (this.config.workingDirectory) {
      return this.config.workingDirectory;
    }

    // Fall back to workspace folder or current directory
    const workspaceFolders = this.workspace.workspaceFolders;
    return workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  }

  /**
   * Execute a test with output capture
   * @param options - Test execution options
   * @returns Test execution result
   */
  public async executeTestWithOutput(options: TestExecutionOptions): Promise<TestRunResult> {
    const startTime = Date.now();

    try {
      await this.runScenario(options);
      const duration = Math.max(1, Date.now() - startTime);

      return {
        success: true,
        output: "Test executed successfully",
        duration,
      };
    } catch (error) {
      const duration = Math.max(1, Date.now() - startTime);

      return {
        success: false,
        output: `Test failed: ${error}`,
        duration,
      };
    }
  }

  /**
   * Run a scenario with output capture and return actual results
   * @param options - Test execution options
   * @returns Promise with test execution result
   */
  public async runScenarioWithOutput(
    options: TestExecutionOptions
  ): Promise<TestRunResult> {
    const startTime = Date.now();
    const { filePath, lineNumber, scenarioName, tags, outputFormat, dryRun } =
      options;
    const workingDir = this.getWorkingDirectory();
    const behaveCommand = await this.config.getIntelligentBehaveCommand();

    try {
      // Check if this is a scenario outline example
      const isScenarioOutlineExample = this.isScenarioOutlineExample(
        filePath,
        lineNumber,
        scenarioName
      );

      let command = `${behaveCommand} "${filePath}${
        lineNumber ? `:${lineNumber}` : ""
      }"`;

      if (scenarioName) {
        // For scenario outline examples, we need to use the original outline name
        if (isScenarioOutlineExample) {
          const originalOutlineName =
            this.extractOriginalOutlineName(scenarioName);
          command += ` --name="${originalOutlineName}"`;
        } else {
          command += ` --name="${scenarioName}"`;
        }
      }

      // Add tags if specified
      if (tags) {
        command += ` --tags="${tags}"`;
        command += " --no-skipped";
      } else if (this.config.tags) {
        command += ` --tags="${this.config.tags}"`;
        command += " --no-skipped";
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

      const result = await this.executeCommandWithOutput(command, workingDir);
      const duration = Math.max(1, Date.now() - startTime);

      return {
        success: result.success,
        output: result.output,
        error: result.error,
        duration,
      };
    } catch (error) {
      const duration = Math.max(1, Date.now() - startTime);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      return {
        success: false,
        output: "",
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * Run a feature file with output capture and return actual results
   * @param options - Feature execution options
   * @returns Promise with test execution result
   */
  public async runFeatureFileWithOutput(
    options: FeatureExecutionOptions
  ): Promise<TestRunResult> {
    const startTime = Date.now();
    const workingDir = this.getWorkingDirectory();
    const behaveCommand = await this.config.getIntelligentBehaveCommand();

    try {
      let command = `${behaveCommand} "${options.filePath}"`;

      // Add tags if specified
      if (options.tags) {
        command += ` --tags="${options.tags}"`;
        command += " --no-skipped";
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

      const result = await this.executeCommandWithOutput(command, workingDir);
      const duration = Math.max(1, Date.now() - startTime);

      return {
        success: result.success,
        output: result.output,
        error: result.error,
        duration,
      };
    } catch (error) {
      const duration = Math.max(1, Date.now() - startTime);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      return {
        success: false,
        output: "",
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * Discover all feature files in the workspace
   * @returns Array of feature file paths
   */
  public async discoverFeatureFiles(): Promise<string[]> {
    try {
      const pattern = this.config.testFilePattern;

      if (!pattern || pattern.trim() === "") {
        throw new Error("Test file pattern is empty or invalid");
      }

      const files = await this.workspace.findFiles(pattern);

      if (!files || files.length === 0) {
        // This is not an error, just no files found
        return [];
      }

      return files.map((file) => file.fsPath);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      Logger.getInstance().error(
        `Failed to discover feature files: ${errorMessage}`,
        {
          pattern: this.config.testFilePattern,
          workspaceFolders: this.workspace.workspaceFolders?.length ?? 0,
        }
      );

      // Show user-friendly error message
      await this.window.showErrorMessage(
        `Test discovery failed: ${errorMessage}. Please check your test file pattern configuration.`
      );

      return [];
    }
  }

  /**
   * Run all feature files in parallel
   */
  public async runAllTestsInParallel(): Promise<void> {
    try {
      const featureFiles = await this.discoverFeatureFiles();

      if (featureFiles.length === 0) {
        await this.window.showWarningMessage(
          "No feature files found to run in parallel"
        );
        return;
      }

      Logger.getInstance().info(
        `Starting parallel execution of ${featureFiles.length} feature files`,
        {
          maxProcesses: this.config.maxParallelProcesses,
          tags: this.config.tags,
          outputFormat: this.config.outputFormat,
        }
      );

      this.runTestsInParallel({
        featureFiles,
        maxProcesses: this.config.maxParallelProcesses,
        tags: this.config.tags,
        outputFormat: this.config.outputFormat,
        dryRun: this.config.dryRun,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      Logger.getInstance().error(
        `Failed to run tests in parallel: ${errorMessage}`
      );

      await this.window.showErrorMessage(
        `Failed to run tests in parallel: ${errorMessage}. Please check your configuration and try again.`
      );
    }
  }

  /**
   * Validate that behave is installed
   * @returns True if behave is available
   */
  public validateBehaveInstallation(): boolean {
    // Use the existing terminal if available, otherwise create a new one
    this.terminal ??= this.window.createTerminal("Behave Test Runner");
    this.terminal.show();
    this.terminal.sendText("behave --version");
    return true;
  }

  /**
   * Check if a scenario is a scenario outline example
   */
  private isScenarioOutlineExample(
    _filePath: string,
    _lineNumber?: number,
    scenarioName?: string
  ): boolean {
    if (!scenarioName) {
      return false;
    }

    // Check if the scenario name follows the pattern of scenario outline examples
    // Pattern: "1: Scenario Name - param1: value1, param2: value2"
    return /^\d+:\s*.+\s*-\s*/.test(scenarioName);
  }

  /**
   * Extract the original outline name from a scenario outline example name
   */
  private extractOriginalOutlineName(scenarioName: string): string {
    const match = scenarioName.match(/^(\d+):\s*(.*?)\s*-\s*/);
    if (match?.[2]) {
      return match[2].trim();
    }
    return scenarioName;
  }

  /**
   * Dispose of the terminal when the executor is no longer needed
   */
  public dispose(): void {
    if (this.terminal) {
      this.terminal.dispose();
      this.terminal = undefined;
    }
  }
}
