import * as vscode from "vscode";
import { CommandBuilder } from "./command-builder-interface";
import { TestExecutionOptions, FeatureExecutionOptions } from "../../types";
import { ExtensionConfig } from "../extension-config";
import { CommandInvocation, InvocationContext, commandInvocation, debugPython, invocationContext, pythonPluginEnvironment } from "../command-invocation";

export class PytestBddCommandBuilder implements CommandBuilder {
  constructor(private readonly config: ExtensionConfig) {}

  private args(options: TestExecutionOptions, context: InvocationContext): string[] {
    const root = context.projectRoot ?? context.cwd;
    const args = ["-p", "behave_pytest_plugin", `--btr-project-root=${root}`];
    if (options.filePath) {
      args.push(`--btr-feature=${options.filePath}`);
      if (options.lineNumber !== undefined) {
        if (!Number.isInteger(options.lineNumber) || options.lineNumber <= 0) {throw new Error("Scenario line must be a positive integer.");}
        args.push(`--btr-line=${options.lineNumber}`);
      }
      else if (options.scenarioName) {args.push(`--btr-name=${options.scenarioName}`);}
    }
    const tags = options.tags ?? this.config.tags;
    if (tags) {args.push("-m", tags.replace(/^@/u, ""));}
    args.push("-v");
    if (options.dryRun || this.config.dryRun) {args.push("--collect-only");}
    return args;
  }
  public buildScenarioCommand(options: TestExecutionOptions, context?: InvocationContext): Promise<CommandInvocation> {
    const resolved = context ?? invocationContext(undefined, this.config.workingDirectory);
    const prefix = commandInvocation(this.config.getPytestCommand(), resolved.cwd);
    return Promise.resolve({ ...prefix, args: [...prefix.args, ...this.args(options, resolved)], env: pythonPluginEnvironment("behave_pytest_plugin.py") });
  }
  public buildFeatureCommand(options: FeatureExecutionOptions, context?: InvocationContext): Promise<CommandInvocation> {
    return this.buildScenarioCommand(options, context);
  }
  public buildTagCommand(tag: string, context?: InvocationContext): Promise<CommandInvocation> {
    return this.buildScenarioCommand({ filePath: "", tags: tag }, context);
  }
  public buildRunAllCommand(context?: InvocationContext): Promise<CommandInvocation> {
    return this.buildScenarioCommand({ filePath: "" }, context);
  }
  public async buildDebugCommand(options: TestExecutionOptions, context?: InvocationContext): Promise<CommandInvocation> {
    const invocation = await this.buildScenarioCommand(options, context);
    return { ...invocation, args: [...invocation.args, "-s", "--capture=no"] };
  }
  public buildDebugConfiguration(options: TestExecutionOptions, context?: InvocationContext): Promise<vscode.DebugConfiguration> {
    if (!options.filePath.trim()) {throw new Error("File path is required for debugging");}
    const resolved = context ?? invocationContext(undefined, this.config.workingDirectory);
    const python = debugPython(commandInvocation(this.config.getPytestCommand(), resolved.cwd), "pytest");
    return Promise.resolve({ name: `Debug: ${options.scenarioName ?? "Feature"}`, type: "debugpy", request: "launch",
      module: "pytest", args: [...this.args(options, resolved), "-s"], cwd: resolved.cwd, env: pythonPluginEnvironment("behave_pytest_plugin.py"),
      ...(python ? { python } : {}), console: "integratedTerminal", justMyCode: false });
  }
  public validateInstallation(): boolean {return true;}
  public getFrameworkName(): string {return "pytest-bdd";}
}
