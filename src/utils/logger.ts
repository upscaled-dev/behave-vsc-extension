import * as vscode from "vscode";
import { LogData } from "../types";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private static instance: Logger;
  private readonly outputChannel: vscode.OutputChannel;
  private logLevel: LogLevel;

  constructor(outputChannel?: vscode.OutputChannel, initialLogLevel?: LogLevel) {
    this.outputChannel = outputChannel ?? vscode.window.createOutputChannel("Behave Test Runner");
    this.logLevel = initialLogLevel ?? LogLevel.INFO;
  }

  public static create(outputChannel?: vscode.OutputChannel, initialLogLevel?: LogLevel): Logger {
    if (!outputChannel) {return Logger.getInstance();}
    return new Logger(outputChannel, initialLogLevel);
  }

  public static getInstance(): Logger {
    Logger.instance ??= new Logger();
    return Logger.instance;
  }

  public setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  public getLogLevel(): LogLevel {
    return this.logLevel;
  }

  public debug(message: string, data?: LogData): void {
    if (this.logLevel <= LogLevel.DEBUG) {this.log("DEBUG", message, data);}
  }

  public info(message: string, data?: LogData): void {
    if (this.logLevel <= LogLevel.INFO) {this.log("INFO", message, data);}
  }

  public warn(message: string, data?: LogData): void {
    if (this.logLevel <= LogLevel.WARN) {this.log("WARN", message, data);}
  }

  public error(message: string, data?: LogData): void {
    if (this.logLevel <= LogLevel.ERROR) {this.log("ERROR", message, data);}
  }

  private log(level: string, message: string, data?: LogData): void {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] [${level}] ${message}`);
    if (data) {this.outputChannel.appendLine(JSON.stringify(data, null, 2));}
  }

  public showOutput(): void {
    this.outputChannel.show();
  }

  public clearOutput(): void {
    this.outputChannel.clear();
  }

  public dispose(): void {
    this.outputChannel.dispose();
  }
}
