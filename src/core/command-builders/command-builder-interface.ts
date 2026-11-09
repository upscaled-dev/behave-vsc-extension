import * as vscode from "vscode";
import { CommandInvocation, InvocationContext } from "../command-invocation";
import { TestExecutionOptions, FeatureExecutionOptions } from "../../types";

/** Framework syntax produces argv; the executor owns processes, reports and debug lifetimes. */
export interface CommandBuilder {
  buildScenarioCommand(options: TestExecutionOptions, context?: InvocationContext): Promise<CommandInvocation>;
  buildFeatureCommand(options: FeatureExecutionOptions, context?: InvocationContext): Promise<CommandInvocation>;
  buildTagCommand(tag: string, context?: InvocationContext): Promise<CommandInvocation>;
  buildRunAllCommand(context?: InvocationContext): Promise<CommandInvocation>;
  buildDebugCommand(options: TestExecutionOptions, context?: InvocationContext): Promise<CommandInvocation>;
  buildDebugConfiguration(options: TestExecutionOptions, context?: InvocationContext): Promise<vscode.DebugConfiguration>;
  validateInstallation(): boolean;
  getFrameworkName(): string;
}
