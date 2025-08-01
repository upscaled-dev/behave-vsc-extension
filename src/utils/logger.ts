import * as vscode from "vscode";
import { LogData } from "../types";

/**
 * Log levels for the extension
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Logger utility for the extension
 */
export class Logger {
  private static instance: Logger;
  private outputChannel: vscode.OutputChannel;
  private logLevel: LogLevel = LogLevel.INFO;

  /**
   * Constructor for Logger with optional dependencies for testability
   * @param outputChannel - Optional output channel (for testing)
   * @param initialLogLevel - Optional initial log level (for testing)
   */
  constructor(outputChannel?: vscode.OutputChannel, initialLogLevel?: LogLevel) {
    this.outputChannel = outputChannel ?? vscode.window.createOutputChannel("Behave Test Runner");
    this.logLevel = initialLogLevel ?? LogLevel.INFO;
  }

  /**
   * Create a new Logger instance with optional dependencies for testability
   * @param outputChannel - Optional output channel (for testing)
   * @param initialLogLevel - Optional initial log level (for testing)
   * @returns A new Logger instance
   */
  public static create(outputChannel?: vscode.OutputChannel, initialLogLevel?: LogLevel): Logger {
    return new Logger(outputChannel, initialLogLevel);
  }

  /**
   * Get the singleton instance of the logger
   * @deprecated Use Logger.create() for new code or inject Logger via context
   */
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Set the log level
   * @param level - Log level to set
   */
  public setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * Get the current log level
   * @returns Current log level
   */
  public getLogLevel(): LogLevel {
    return this.logLevel;
  }

  /**
   * Log a debug message
   * @param message - Message to log
   * @param data - Optional data to include
   */
  public debug(message: string, data?: LogData): void {
    if (this.logLevel <= LogLevel.DEBUG) {
      this.log("DEBUG", message, data);
    }
  }

  /**
   * Log an info message
   * @param message - Message to log
   * @param data - Optional data to include
   */
  public info(message: string, data?: LogData): void {
    if (this.logLevel <= LogLevel.INFO) {
      this.log("INFO", message, data);
    }
  }

  /**
   * Log a warning message
   * @param message - Message to log
   * @param data - Optional data to include
   */
  public warn(message: string, data?: LogData): void {
    if (this.logLevel <= LogLevel.WARN) {
      this.log("WARN", message, data);
    }
  }

  /**
   * Log an error message
   * @param message - Message to log
   * @param data - Optional data to include
   */
  public error(message: string, data?: LogData): void {
    if (this.logLevel <= LogLevel.ERROR) {
      this.log("ERROR", message, data);
    }
  }

  /**
   * Internal logging method
   * @param level - Log level
   * @param message - Message to log
   * @param data - Optional data to include
   */
  private log(level: string, message: string, data?: LogData): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;

    // Log to output channel
    this.outputChannel.appendLine(logMessage);
    if (data) {
      this.outputChannel.appendLine(JSON.stringify(data, null, 2));
    }
  }

  /**
   * Show the output channel
   */
  public showOutput(): void {
    this.outputChannel.show();
  }

  /**
   * Clear the output channel
   */
  public clearOutput(): void {
    this.outputChannel.clear();
  }

  /**
   * Dispose of the logger
   */
  public dispose(): void {
    this.outputChannel.dispose();
  }
}
