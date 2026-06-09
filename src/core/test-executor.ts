import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import {
  TestExecutionOptions,
  TestRunResult,
  ParallelExecutionOptions,
  FeatureExecutionOptions,
  BehaveExtensionContext,
} from "../types/index";
import { Logger } from "../utils/logger";
import { ExtensionConfig } from "./extension-config";
import { BehaveJsonParser } from "../utils/behave-json-parser";
import { CucumberJsonParser } from "../utils/cucumber-json-parser";

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error occurred";
}

type CommandResult = { success: boolean; output: string; error: string; returnCode: number; display?: string };

/** A TestRunResult plus the per-scenario status and output maps parsed from Behave's JSON. */
type ScenarioRunResult = TestRunResult & {
  scenarioResults?: Record<string, string>;
  scenarioOutputs?: Record<string, string>;
};

export class TestExecutor {
  private readonly config: ExtensionConfig;
  private readonly logger: Logger;
  private readonly workspace: typeof vscode.workspace;
  private readonly window: typeof vscode.window;
  private readonly debug: typeof vscode.debug;
  private terminal: vscode.Terminal | undefined;
  private readonly behaveJsonParser: BehaveJsonParser;
  private readonly cucumberJsonParser: CucumberJsonParser;
  private context?: BehaveExtensionContext;

  public static create(
    workspace?: typeof vscode.workspace,
    window?: typeof vscode.window,
    debug?: typeof vscode.debug,
    config?: ExtensionConfig,
    logger?: Logger,
    behaveJsonParser?: BehaveJsonParser,
    cucumberJsonParser?: CucumberJsonParser
  ): TestExecutor {
    return new TestExecutor(workspace, window, debug, config, logger, behaveJsonParser, cucumberJsonParser);
  }

  constructor(
    workspace: typeof vscode.workspace = vscode.workspace,
    window: typeof vscode.window = vscode.window,
    debug: typeof vscode.debug = vscode.debug,
    config?: ExtensionConfig,
    logger?: Logger,
    behaveJsonParser?: BehaveJsonParser,
    cucumberJsonParser?: CucumberJsonParser
  ) {
    this.workspace = workspace;
    this.window = window;
    this.debug = debug;
    this.config = config ?? ExtensionConfig.create();
    this.logger = logger ?? Logger.create();
    this.behaveJsonParser = behaveJsonParser ?? BehaveJsonParser.create(logger);
    this.cucumberJsonParser = cucumberJsonParser ?? CucumberJsonParser.create(logger);
  }

  public setContext(context: BehaveExtensionContext): void {
    this.context = context;
  }

  public reloadConfiguration(): void {
    this.config.reload();
  }

  private getCurrentFramework(): string {
    return this.context?.commandBuilder?.getFrameworkName() ?? "behave";
  }

  public isBehaveFramework(): boolean {
    return this.getCurrentFramework() === "behave";
  }

  /** Absolute paths for the per-run Behave JSON results and completion marker. */
  private behaveOutPaths(): { json: string; done: string; pretty: string } {
    const dir = os.tmpdir();
    return {
      json: path.join(dir, "behave-test-runner-results.json"),
      done: path.join(dir, "behave-test-runner-results.done"),
      pretty: path.join(dir, "behave-test-runner-results.pretty"),
    };
  }

  /**
   * Run a Behave command ONCE in the reused terminal so the user sees Behave's
   * native (pretty) output, while a second `json` formatter writes machine-
   * readable results to a file we parse for the Test Explorer status icons.
   *
   * A terminal `sendText` gives no completion callback, so the command also
   * writes its exit code to a marker file once Behave exits; we poll for that
   * marker, then read the (now fully-written) JSON file. This replaces both the
   * old approach of running Behave twice (once to display, once to capture) and
   * the unreliable parse-and-render-into-a-pseudoterminal path.
   */
  private async runBehaveCapture(
    baseCommand: string,
    workingDir: string
  ): Promise<CommandResult & { scenarioResults: Record<string, string>; scenarioOutputs: Record<string, string> }> {
    const { json: jsonFile, done: doneFile, pretty: prettyFile } = this.behaveOutPaths();
    for (const f of [jsonFile, doneFile, prettyFile]) {
      try { if (fs.existsSync(f)) { fs.unlinkSync(f); } } catch { /* best effort */ }
    }

    // Force three formatters: json -> file (machine-readable results), pretty ->
    // file (captured for the Test Results panel), pretty -> stdout (native
    // terminal display). Strip any formatter the command builder/config may have
    // added so the formatter/outfile pairing stays deterministic.
    const cleaned = baseCommand
      .replace(/\s--format=\S+/g, "")
      .replace(/\s-f\s+\S+/g, "");
    const command = `${cleaned} -f json -o "${jsonFile}" -f pretty -o "${prettyFile}" -f pretty`;

    this.executeBehaveWithMarker(command, doneFile, workingDir);

    const { output, returnCode } = await this.readBehaveResults(jsonFile, doneFile);
    const scenarioResults = output ? await this.parseTestResults(output) : {};
    const scenarioOutputs = output ? this.parseScenarioOutputs(output) : {};
    let display = "";
    try {
      if (fs.existsSync(prettyFile)) { display = fs.readFileSync(prettyFile, "utf8"); }
    } catch { /* pretty capture is best effort */ }
    return { success: returnCode === 0, output, error: "", returnCode, scenarioResults, scenarioOutputs, display };
  }

  /** Send a Behave command to the reused terminal, appending an exit-code marker. */
  private executeBehaveWithMarker(command: string, doneFile: string, workingDir: string): void {
    this.terminal ??= this.window.createTerminal("Behave Test Runner");
    this.terminal.show();
    this.terminal.sendText("clear");
    if (workingDir && workingDir !== process.cwd()) {
      this.terminal.sendText(`cd "${workingDir}"`);
    }
    this.terminal.sendText(`${command} ; echo "$?" > "${doneFile}"`);
  }

  /**
   * Poll for the completion marker written after Behave exits, then read the
   * JSON results file. Returns empty output (and a non-zero code) if the run
   * never signals completion within the timeout — in that case the user still
   * sees Behave's native output in the terminal. Overridable in tests.
   */
  protected async readBehaveResults(
    jsonFile: string,
    doneFile: string,
    timeoutMs = 900000,
    intervalMs = 300
  ): Promise<{ output: string; returnCode: number }> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (fs.existsSync(doneFile)) {
        let returnCode = 0;
        try {
          const code = Number.parseInt(fs.readFileSync(doneFile, "utf8").trim(), 10);
          returnCode = Number.isFinite(code) ? code : 0;
        } catch { /* marker not flushed yet */ }
        let output = "";
        try {
          if (fs.existsSync(jsonFile)) { output = fs.readFileSync(jsonFile, "utf8"); }
        } catch { /* behave produced no JSON (e.g. a feature parse error) */ }
        return { output, returnCode };
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    this.logger.warn("Behave run did not signal completion within timeout", { doneFile });
    return { output: "", returnCode: 1 };
  }

  private async parseTestResults(output: string): Promise<Record<string, string>> {
    if (this.getCurrentFramework() === "pytest-bdd") {
      return this.parsePytestBddResults();
    }
    try {
      const parsed = this.behaveJsonParser.parseBehaveJsonOutput(output);
      const results: Record<string, string> = {};
      for (const s of parsed) {
        if (s.filePath && s.lineNumber) {
          results[`${s.filePath}:${s.lineNumber}`] = s.status;
        }
      }
      return results;
    } catch (error) {
      this.logger.error("Failed to parse Behave JSON output", { error });
      return {};
    }
  }

  /**
   * Build a map of per-scenario rendered output keyed identically to
   * `parseTestResults` (so the provider can resolve a scenario's output with the
   * same key/matcher it uses for status). Behave only.
   */
  private parseScenarioOutputs(output: string): Record<string, string> {
    if (this.getCurrentFramework() === "pytest-bdd") {
      return {};
    }
    try {
      const parsed = this.behaveJsonParser.parseBehaveJsonOutput(output);
      const outputs: Record<string, string> = {};
      for (const s of parsed) {
        if (s.filePath && s.lineNumber && s.output) {
          outputs[`${s.filePath}:${s.lineNumber}`] = s.output;
        }
      }
      return outputs;
    } catch (error) {
      this.logger.error("Failed to parse Behave scenario outputs", { error });
      return {};
    }
  }

  private async parsePytestBddResults(): Promise<Record<string, string>> {
    const cucumberJsonPath = path.join(process.cwd(), "cucumber-output.json");
    const retryDelay = 100;
    for (let i = 0; i < 3; i++) {
      if (fs.existsSync(cucumberJsonPath)) {
        try {
          const content = fs.readFileSync(cucumberJsonPath, "utf8");
          return this.cucumberJsonParser.parseCucumberJsonWithMultipleKeys(content);
        } catch (error) {
          this.logger.error("Failed to parse cucumber JSON", { error });
          return {};
        }
      }
      await new Promise((r) => setTimeout(r, retryDelay));
    }
    this.logger.warn("Cucumber JSON file not found after retries");
    return {};
  }

  /** Build a `file.feature[:line]` test target. */
  private fileTarget(filePath: string, lineNumber?: number): string {
    return lineNumber ? `${filePath}:${lineNumber}` : filePath;
  }

  private buildScenarioCommandLegacy(behaveCommand: string, options: TestExecutionOptions, addJson = false): string {
    const { filePath, lineNumber, scenarioName, tags, outputFormat, dryRun } = options;
    const isExample = this.isScenarioOutlineExample(filePath, lineNumber, scenarioName);
    const isOutlineRun = scenarioName && !isExample && filePath && fs.existsSync(filePath);

    let command: string;
    if (isOutlineRun) {
      command = `${behaveCommand} "${filePath}" --name="${scenarioName}"`;
    } else {
      command = `${behaveCommand} "${this.fileTarget(filePath, lineNumber)}"`;
      if (scenarioName) {
        const name = isExample ? this.extractOriginalOutlineName(scenarioName) : scenarioName;
        command += ` --name="${name}"`;
      }
    }
    command += this.tagsSuffix(tags);
    command += this.formatSuffix(outputFormat, addJson);
    if (dryRun || this.config.dryRun) {command += " --dry-run";}
    return command;
  }

  private buildFeatureCommandLegacy(behaveCommand: string, options: FeatureExecutionOptions, addJson = false): string {
    let command = `${behaveCommand} "${options.filePath}"`;
    command += this.tagsSuffix(options.tags, false);
    command += this.formatSuffix(options.outputFormat, addJson);
    if (options.dryRun || this.config.dryRun) {command += " --dry-run";}
    return command;
  }

  private tagsSuffix(tags: string | undefined, useConfigFallback = true): string {
    const effective = tags ?? (useConfigFallback ? this.config.tags : "");
    return effective ? ` --tags="${effective}" --no-skipped` : "";
  }

  private formatSuffix(outputFormat: string | undefined, addJson: boolean): string {
    if (addJson) {return " --format=json";}
    const format = outputFormat ?? this.config.outputFormat;
    return format && format !== "pretty" ? ` --format=${format}` : "";
  }

  public async runScenario(options: TestExecutionOptions): Promise<void> {
    const workingDir = this.getWorkingDirectory();
    if (this.context?.commandBuilder) {
      const command = await this.context.commandBuilder.buildScenarioCommand(options);
      this.executeCommand(command, workingDir);
      return;
    }
    const behaveCommand = await this.config.getIntelligentBehaveCommand();
    this.executeCommand(this.buildScenarioCommandLegacy(behaveCommand, options), workingDir);
  }

  public async debugScenario(options: TestExecutionOptions): Promise<void> {
    try {
      const workingDir = this.getWorkingDirectory();

      // Build the launch configuration. A debug session MUST be started through
      // vscode.debug.startDebugging (not run as a terminal command) for the
      // Python debugger to attach and honor breakpoints.
      const debugConfig = this.context?.commandBuilder
        ? await this.context.commandBuilder.buildDebugConfiguration(options)
        : this.buildLegacyBehaveDebugConfig(options);

      // Resolve the correct debugger type for the installed Python tooling. The
      // builders default to "debugpy"; override centrally so legacy setups that
      // only expose the older "python" type still work.
      debugConfig.type = this.resolveDebugType();

      // The builders omit cwd; inject the resolved working directory here.
      debugConfig["cwd"] ??= workingDir;

      // Pass the workspace folder so debugpy can resolve breakpoint paths.
      const folder = this.workspace.workspaceFolders?.[0];
      await this.debug.startDebugging(folder, debugConfig);
    } catch (error) {
      const msg = errMsg(error);
      this.logger.error(`Failed to start debug session: ${msg}`, {
        filePath: options.filePath,
        lineNumber: options.lineNumber,
        scenarioName: options.scenarioName,
      });
      await this.window.showErrorMessage(
        `Failed to start debug session: ${msg}. Please ensure Python and behave are properly configured.`
      );
    }
  }

  /**
   * Resolve the VSCode debugger type compatible with the installed Python
   * tooling. The Python extension renamed its debugger from the legacy "python"
   * type to "debugpy" (split into the standalone ms-python.debugpy extension in
   * the 2024.x releases). We prefer "debugpy" and only fall back to "python"
   * when an older Python extension without debugpy is detected.
   */
  private resolveDebugType(): string {
    try {
      if (vscode.extensions.getExtension("ms-python.debugpy")) {
        return "debugpy";
      }

      const pythonExt = vscode.extensions.getExtension("ms-python.python");
      const version: unknown = pythonExt?.packageJSON?.version;
      if (typeof version === "string") {
        const major = Number.parseInt(version.split(".")[0] ?? "", 10);
        // The "python" debug type was removed in Python extension 2024.x.
        if (Number.isFinite(major) && major > 0 && major < 2024) {
          return "python";
        }
      }
    } catch {
      // Fall through to the modern default.
    }
    return "debugpy";
  }

  /**
   * Legacy fallback debug configuration for behave, used when no framework
   * CommandBuilder is wired into the execution context.
   */
  private buildLegacyBehaveDebugConfig(options: TestExecutionOptions): vscode.DebugConfiguration {
    const { filePath, lineNumber, scenarioName } = options;
    if (!filePath || filePath.trim() === "") {
      throw new Error("File path is required for debugging");
    }

    const isExample = this.isScenarioOutlineExample(filePath, lineNumber, scenarioName);
    const isOutlineRun = scenarioName && !isExample && fs.existsSync(filePath);

    const args: string[] = isOutlineRun
      ? [filePath, "--name", scenarioName]
      : [this.fileTarget(filePath, lineNumber)];

    if (!isOutlineRun && scenarioName) {
      args.push("--name", isExample ? this.extractOriginalOutlineName(scenarioName) : scenarioName);
    }

    return {
      name: `Debug: ${scenarioName ?? "Test Scenario"}`,
      type: "debugpy",
      request: "launch",
      module: "behave",
      args,
      console: "integratedTerminal",
      justMyCode: false,
    };
  }

  public async runFeatureFile(options: FeatureExecutionOptions): Promise<void> {
    const workingDir = this.getWorkingDirectory();
    if (this.context?.commandBuilder) {
      const command = await this.context.commandBuilder.buildFeatureCommand(options);
      this.executeCommand(command, workingDir);
      return;
    }
    const behaveCommand = await this.config.getIntelligentBehaveCommand();
    this.executeCommand(this.buildFeatureCommandLegacy(behaveCommand, options), workingDir);
  }

  public async runAllTests(): Promise<void> {
    const workingDir = this.getWorkingDirectory();
    const behaveCommand = await this.config.getIntelligentBehaveCommand();
    let command = behaveCommand;
    command += this.tagsSuffix(undefined);
    command += this.formatSuffix(undefined, false);
    if (this.config.dryRun) {command += " --dry-run";}
    this.executeCommand(command, workingDir);
  }

  /**
   * Run the entire suite once with JSON output captured, so results can be
   * rendered (see {@link renderResults}). Behave only.
   */
  public async runAllTestsWithOutput(): Promise<ScenarioRunResult> {
    const startTime = Date.now();
    const workingDir = this.getWorkingDirectory();
    try {
      const behaveCommand = await this.config.getIntelligentBehaveCommand();
      let base = `${behaveCommand}${this.tagsSuffix(undefined)}`;
      if (this.config.dryRun) {base += " --dry-run";}

      const r = await this.runBehaveCapture(base, workingDir);
      return {
        success: r.success,
        output: r.output,
        display: r.display,
        error: r.error,
        duration: Math.max(1, Date.now() - startTime),
        scenarioResults: r.scenarioResults,
        scenarioOutputs: r.scenarioOutputs,
      };
    } catch (error) {
      return { success: false, output: "", error: errMsg(error), duration: Math.max(1, Date.now() - startTime) };
    }
  }

  public runTestsInParallel(options: ParallelExecutionOptions): void {
    const workingDir = this.getWorkingDirectory();
    const maxProcesses = options.maxProcesses ?? this.config.maxParallelProcesses;

    this.window.showInformationMessage(
      `Running ${options.featureFiles.length} feature files in parallel (max ${maxProcesses} workers)`
    );

    const scriptContent = this.createParallelExecutionScript(
      options.featureFiles,
      this.config.behaveCommand,
      maxProcesses,
      options.tags,
      options.outputFormat ?? undefined,
      options.dryRun ?? undefined
    );

    const scriptPath = path.join(workingDir, "parallel_behave_runner.py");
    fs.writeFileSync(scriptPath, scriptContent);
    this.executeCommand(`python "${scriptPath}"`, workingDir);
  }

  private createParallelExecutionScript(
    featureFiles: string[],
    behaveCommand: string,
    maxProcesses: number,
    tags?: string,
    outputFormat?: string,
    dryRun?: boolean
  ): string {
    const cmdArgs: string[] = [];
    if (tags) {cmdArgs.push("--tags", tags, "--no-skipped");}
    if (outputFormat && outputFormat !== "pretty") {cmdArgs.push("--format", outputFormat);}
    if (dryRun) {cmdArgs.push("--dry-run");}
    const cmdArgsStr = cmdArgs.length > 0 ? ` + ${JSON.stringify(cmdArgs)}` : "";

    return String.raw`
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

    print(f"\nSummary: {passed} passed, {failed} failed")

    if failed > 0:
        sys.exit(1)
    else:
        sys.exit(0)

if __name__ == "__main__":
    main()
`;
  }

  private executeCommand(command: string, workingDir: string): void {
    try {
      if (!command || command.trim() === "") {throw new Error("Command cannot be empty");}

      this.terminal ??= this.window.createTerminal("Behave Test Runner");
      this.terminal.show();
      this.terminal.sendText("clear");
      if (workingDir && workingDir !== process.cwd()) {
        this.terminal.sendText(`cd "${workingDir}"`);
      }
      this.terminal.sendText(command);
    } catch (error) {
      const msg = errMsg(error);
      this.logger.error(`Failed to execute command: ${msg}`, { command, workingDir });
      this.window.showErrorMessage(`Failed to execute test command: ${msg}`);
    }
  }

  private async executeCommandWithOutput(command: string, workingDir: string): Promise<CommandResult> {
    return new Promise((resolve) => {
      if (!command || command.trim() === "") {
        resolve({ success: false, output: "", error: "Command cannot be empty", returnCode: 1 });
        return;
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { spawn } = require("node:child_process");
        const parts = command.split(" ");
        const executable = parts[0];
        const args = parts.slice(1);

        const childProcess = spawn(executable, args, {
          cwd: workingDir,
          shell: true,
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        childProcess.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
        childProcess.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

        childProcess.on("close", (code: number | null) => {
          const returnCode = typeof code === "number" ? code : 1;
          resolve({ success: returnCode === 0, output: stdout, error: stderr, returnCode });
        });

        childProcess.on("error", (error: Error) => {
          this.logger.error(`Command execution error: ${error.message}`, { command, workingDir });
          resolve({ success: false, output: "", error: error.message, returnCode: 1 });
        });
      } catch (error) {
        const msg = errMsg(error);
        this.logger.error(`Failed to execute command with output: ${msg}`, { command, workingDir });
        resolve({ success: false, output: "", error: msg, returnCode: 1 });
      }
    });
  }

  private getWorkingDirectory(): string {
    if (this.config.workingDirectory) {return this.config.workingDirectory;}
    return this.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  }

  public async executeTestWithOutput(options: TestExecutionOptions): Promise<TestRunResult> {
    const startTime = Date.now();
    try {
      await this.runScenario(options);
      return { success: true, output: "Test executed successfully", duration: Math.max(1, Date.now() - startTime) };
    } catch (error) {
      return { success: false, output: `Test failed: ${error}`, duration: Math.max(1, Date.now() - startTime) };
    }
  }

  public async runScenarioWithOutput(
    options: TestExecutionOptions
  ): Promise<ScenarioRunResult> {
    const startTime = Date.now();
    const workingDir = this.getWorkingDirectory();
    const elapsed = (): number => Math.max(1, Date.now() - startTime);

    try {
      // Behave: run once in the terminal (native output) + JSON to a file.
      if (this.isBehaveFramework()) {
        const base = this.context?.commandBuilder
          ? await this.context.commandBuilder.buildScenarioCommand(options)
          : this.buildScenarioCommandLegacy(await this.config.getIntelligentBehaveCommand(), options);
        const r = await this.runBehaveCapture(base, workingDir);
        return { success: r.success, output: r.output, display: r.display, error: r.error, duration: elapsed(), scenarioResults: r.scenarioResults, scenarioOutputs: r.scenarioOutputs };
      }

      // Other frameworks (e.g. pytest-bdd): capture native output via spawn.
      const command = this.context?.commandBuilder
        ? await this.context.commandBuilder.buildScenarioCommand(options)
        : this.buildScenarioCommandLegacy(await this.config.getIntelligentBehaveCommand(), options, true);
      const result = await this.executeCommandWithOutput(command, workingDir);
      const scenarioResults = await this.parseTestResults(result.output);
      return { success: result.success, output: result.output, display: result.output, error: result.error, duration: elapsed(), scenarioResults };
    } catch (error) {
      return { success: false, output: "", error: errMsg(error), duration: elapsed() };
    }
  }

  public async runFeatureFileWithOutput(
    options: FeatureExecutionOptions
  ): Promise<ScenarioRunResult> {
    const startTime = Date.now();
    const workingDir = this.getWorkingDirectory();
    const elapsed = (): number => Math.max(1, Date.now() - startTime);

    try {
      // Behave: run once in the terminal (native output) + JSON to a file.
      if (this.isBehaveFramework()) {
        const base = this.context?.commandBuilder
          ? await this.context.commandBuilder.buildFeatureCommand(options)
          : this.buildFeatureCommandLegacy(await this.config.getIntelligentBehaveCommand(), options);
        const r = await this.runBehaveCapture(base, workingDir);
        return { success: r.success, output: r.output, display: r.display, error: r.error, duration: elapsed(), scenarioResults: r.scenarioResults, scenarioOutputs: r.scenarioOutputs };
      }

      // Other frameworks (e.g. pytest-bdd): capture native output via spawn.
      const command = this.context?.commandBuilder
        ? await this.context.commandBuilder.buildFeatureCommand(options)
        : this.buildFeatureCommandLegacy(await this.config.getIntelligentBehaveCommand(), options, true);
      const result = await this.executeCommandWithOutput(command, workingDir);
      const scenarioResults = await this.parseTestResults(result.output);
      return { success: result.success, output: result.output, display: result.output, error: result.error, duration: elapsed(), scenarioResults };
    } catch (error) {
      return { success: false, output: "", error: errMsg(error), duration: elapsed() };
    }
  }

  public async discoverFeatureFiles(): Promise<string[]> {
    try {
      const pattern = this.config.testFilePattern;
      if (!pattern || pattern.trim() === "") {
        throw new Error("Test file pattern is empty or invalid");
      }
      const files = await this.workspace.findFiles(pattern);
      return files?.map((f) => f.fsPath) ?? [];
    } catch (error) {
      const msg = errMsg(error);
      this.logger.error(`Failed to discover feature files: ${msg}`, {
        pattern: this.config.testFilePattern,
      });
      await this.window.showErrorMessage(
        `Test discovery failed: ${msg}. Please check your test file pattern configuration.`
      );
      return [];
    }
  }

  public async runAllTestsInParallel(): Promise<void> {
    try {
      const featureFiles = await this.discoverFeatureFiles();
      if (featureFiles.length === 0) {
        await this.window.showWarningMessage("No feature files found to run in parallel");
        return;
      }
      this.runTestsInParallel({
        featureFiles,
        maxProcesses: this.config.maxParallelProcesses,
        tags: this.config.tags,
        outputFormat: this.config.outputFormat,
        dryRun: this.config.dryRun,
      });
    } catch (error) {
      const msg = errMsg(error);
      this.logger.error(`Failed to run tests in parallel: ${msg}`);
      await this.window.showErrorMessage(
        `Failed to run tests in parallel: ${msg}. Please check your configuration and try again.`
      );
    }
  }

  public validateBehaveInstallation(): boolean {
    this.terminal ??= this.window.createTerminal("Behave Test Runner");
    this.terminal.show();
    this.terminal.sendText("behave --version");
    return true;
  }

  private isScenarioOutlineExample(_filePath: string, _lineNumber?: number, scenarioName?: string): boolean {
    if (!scenarioName) {return false;}
    return /^\d+:\s*.+\s*-\s*/.test(scenarioName);
  }

  private extractOriginalOutlineName(scenarioName: string): string {
    const match = /^(\d+):\s*(.*?)\s*-\s*/.exec(scenarioName);
    const extracted = match?.[2]?.trim();
    if (!extracted) {return scenarioName;}
    return extracted;
  }

  public dispose(): void {
    if (this.terminal) {
      this.terminal.dispose();
      this.terminal = undefined;
    }
  }

  public async runAllTestsWithTags(tag: string): Promise<void> {
    const workingDir = this.getWorkingDirectory();
    if (this.context?.commandBuilder) {
      const command = await this.context.commandBuilder.buildTagCommand(tag);
      this.executeCommand(command, workingDir);
      return;
    }
    const behaveCommand = await this.config.getIntelligentBehaveCommand();
    this.executeCommand(`${behaveCommand} --tags="${tag}" --no-skipped`, workingDir);
  }

  public async runAllTestsWithTagsOutput(
    tag: string
  ): Promise<ScenarioRunResult> {
    const startTime = Date.now();
    const workingDir = this.getWorkingDirectory();
    const elapsed = (): number => Math.max(1, Date.now() - startTime);

    try {
      // Behave: run once in the terminal (native output) + JSON to a file.
      if (this.isBehaveFramework()) {
        const base = this.context?.commandBuilder
          ? await this.context.commandBuilder.buildTagCommand(tag)
          : `${await this.config.getIntelligentBehaveCommand()} --tags="${tag}" --no-skipped`;
        const r = await this.runBehaveCapture(base, workingDir);
        return { success: r.success, output: r.output, display: r.display, error: r.error, duration: elapsed(), scenarioResults: r.scenarioResults, scenarioOutputs: r.scenarioOutputs };
      }

      // Other frameworks (e.g. pytest-bdd): capture native output via spawn.
      const command = this.context?.commandBuilder
        ? await this.context.commandBuilder.buildTagCommand(tag)
        : `${await this.config.getIntelligentBehaveCommand()} --tags="${tag}" --no-skipped --format=json`;
      const result = await this.executeCommandWithOutput(command, workingDir);
      const scenarioResults = await this.parseTestResults(result.output);
      return { success: result.success, output: result.output, display: result.output, error: result.error, duration: elapsed(), scenarioResults };
    } catch (error) {
      return { success: false, output: "", error: errMsg(error), duration: elapsed() };
    }
  }
}
