import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { CommandBuilder } from "./command-builder-interface";
import { TestExecutionOptions, FeatureExecutionOptions } from "../../types";
import { ExtensionConfig } from "../extension-config";
import { CommandInvocation, InvocationContext, commandInvocation, debugPython, invocationContext, pythonPluginEnvironment } from "../command-invocation";
import { escapeBehaveNameRegex } from "../../utils/behave-name-escape";
import { isScenarioOutlineExampleName, extractOutlineName } from "../../utils/scenario-outline";
import { resolveGherkinKeywords, scenarioKeyword } from "../../utils/gherkin-keywords";
import { FeatureParser } from "../../parsers/feature-parser";

export class BehaveCommandBuilder implements CommandBuilder {
  constructor(private readonly config: ExtensionConfig) {}

  private targetLocations({ filePath, lineNumber }: TestExecutionOptions, cwd: string): string[] {
    if (!filePath) {return [];}
    if (!lineNumber) {return [filePath];}
    const target = `${filePath}:${lineNumber}`;
    let content: string;
    try {content = fs.readFileSync(path.resolve(cwd, filePath), "utf8");} catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {return [target];}
      throw error;
    }
    if (!scenarioKeyword(content.split("\n")[lineNumber - 1]?.trim() ?? "", resolveGherkinKeywords(content))?.isOutline) {return [target];}

    // Older Behave selects the preceding scenario for an outline heading. Rows are exact on both versions.
    const feature = FeatureParser.create().parseFeatureContent(content);
    if (!feature) {throw new Error(`Cannot resolve Examples rows for ${target}.`);}
    const rows = feature.scenarios.filter((scenario) => scenario.outlineLineNumber === lineNumber);
    if (rows.length > 0) {return rows.map((scenario) => `${filePath}:${scenario.lineNumber}`);}
    if (feature.scenarios.some((scenario) => scenario.isScenarioOutline && scenario.lineNumber === lineNumber)) {
      throw new Error(`Scenario outline at ${target} has no executable Examples rows.`);
    }
    return [target];
  }

  private args(options: TestExecutionOptions, cwd: string, captureOutput = false): string[] {
    const format = ExtensionConfig.resolveBehaveOutputFormat(options.outputFormat, this.config.outputFormat);
    const args = this.targetLocations(options, cwd);
    if (options.scenarioName && !options.lineNumber) {
      const name = isScenarioOutlineExampleName(options.scenarioName) ? extractOutlineName(options.scenarioName) : options.scenarioName;
      args.push("--name", escapeBehaveNameRegex(name));
    }
    const tags = options.tags ?? this.config.tags;
    if (tags) {args.push("--tags", tags, "--no-skipped");}
    if (options.dryRun || this.config.dryRun) {args.push("--dry-run");}
    const visible = format === "junit" ? "pretty" : format;
    args.push("-f", captureOutput ? "behave_capture:CaptureFormatter" : visible);
    if (captureOutput) {args.push("-D", `btr_format=${visible}`);}
    if (format === "junit") {args.push("--junit");}
    return args;
  }

  public async buildScenarioCommand(options: TestExecutionOptions, context?: InvocationContext): Promise<CommandInvocation> {
    const resolved = context ?? invocationContext(undefined, this.config.workingDirectory);
    const args = this.args(options, resolved.cwd, resolved.captureOutput);
    const prefix = commandInvocation(await this.config.getIntelligentBehaveCommand(resolved), resolved.cwd);
    return { ...prefix, args: [...prefix.args, ...args],
      ...(resolved.captureOutput ? { env: pythonPluginEnvironment("behave_capture.py") } : {}) };
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
    return { ...invocation, args: [...invocation.args, "--no-capture"] };
  }
  public buildDebugConfiguration(options: TestExecutionOptions, context?: InvocationContext): Promise<vscode.DebugConfiguration> {
    if (!options.filePath.trim()) {throw new Error("File path is required for debugging");}
    const cwd = context?.cwd ?? invocationContext(undefined, this.config.workingDirectory).cwd;
    const python = debugPython(commandInvocation(this.config.behaveCommand, cwd), "behave");
    return Promise.resolve({ name: `Debug: ${options.scenarioName ?? "Feature"}`, type: "debugpy", request: "launch",
      module: "behave", args: [...this.args(options, cwd), "--no-capture"], cwd,
      ...(python ? { python } : {}), console: "integratedTerminal", justMyCode: false });
  }
  public validateInstallation(): boolean {return true;}
  public getFrameworkName(): string {return "behave";}
}
