import * as vscode from "vscode";

/**
 * Represents a parsed feature file with its scenarios
 */
export interface ParsedFeature {
  feature: string;
  scenarios: Scenario[];
  filePath: string;
  featureLineNumber?: number;
}

/**
 * Represents a scenario in a feature file
 */
export interface Scenario {
  name: string;
  line: number;
  range: vscode.Range;
  lineNumber: number;
  steps: string[];
  tags?: string[];
  filePath: string;
  isScenarioOutline: boolean;
  outlineLineNumber?: number; // Line number of the parent scenario outline (for examples)
  featureLineNumber?: number; // Line number of the Feature: keyword
}

/**
 * Configuration for the Behave Test Runner extension
 */
export interface BehaveTestRunnerConfig {
  behaveCommand: string;
  workingDirectory: string;
  autoDiscoverTests: boolean;
  enableCodeLens: boolean;
  enableTestExplorer: boolean;
  priority: string;
  testFilePattern: string;
  parallelExecution: boolean;
  maxParallelProcesses: number;
  outputFormat: string;
  tags: string;
  dryRun: boolean;
}

/**
 * Result of running a test
 */
export interface TestRunResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
}

/**
 * Test execution options
 */
export interface TestExecutionOptions {
  filePath: string;
  lineNumber?: number;
  scenarioName?: string;
  debug?: boolean;
  tags?: string;
  parallel?: boolean;
  outputFormat?: string;
  dryRun?: boolean;
}

/**
 * Parallel execution options
 */
export interface ParallelExecutionOptions {
  featureFiles: string[];
  maxProcesses: number;
  tags?: string;
  outputFormat?: string;
  dryRun?: boolean;
}

/**
 * Feature file execution options
 */
export interface FeatureExecutionOptions {
  filePath: string;
  tags?: string;
  parallel?: boolean;
  outputFormat?: string;
  dryRun?: boolean;
}

/**
 * Command registration interface
 */
export interface CommandRegistration {
  command: string;
  callback: (...args: CommandArguments) => Promise<void> | void;
  title?: string;
}

/**
 * Command arguments - union type for all possible command argument patterns
 */
export type CommandArguments = unknown[];

/**
 * Command handler function type
 */
export type CommandHandler = (
  ...args: CommandArguments
) => Promise<void> | void;

/**
 * Extension context with additional utilities
 */
export interface ExtensionContext extends vscode.ExtensionContext {
  subscriptions: vscode.Disposable[];
}

/**
 * Test discovery options
 */
export interface TestDiscoveryOptions {
  pattern?: string;
  workspaceFolder?: vscode.WorkspaceFolder;
  forceRefresh?: boolean;
}

/**
 * Log data type for logger methods
 */
export type LogData =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null
  | undefined;

/**
 * Test organization strategy interface
 */
export interface TestOrganizationStrategy {
  readonly strategyType: string;
  organizeTests(scenarios: Scenario[]): TestGroup[];
  getGroupLabel(group: TestGroup): string;
  getGroupDescription(group: TestGroup): string;
  getDescription(): string;
}

/**
 * Test group for organization strategies
 */
export interface TestGroup {
  id: string;
  label: string;
  description: string;
  scenarios: Scenario[];
}

/**
 * Cache entry for test discovery
 */
export interface CacheEntry<T> {
  timestamp: number;
  data: T;
}

/**
 * Discovery options for test discovery manager
 */
export interface DiscoveryOptions {
  pattern?: string;
  maxCacheAge?: number;
  forceRefresh?: boolean;
}

/**
 * Error context for better error handling
 */
export interface ErrorContext {
  operation: string;
  filePath?: string;
  lineNumber?: number;
  scenarioName?: string;
  tags?: string;
  additionalData?: LogData;
}

/**
 * Validation result for configuration
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Test execution context
 */
export interface TestExecutionContext {
  filePath: string;
  lineNumber?: number;
  scenarioName?: string;
  tags?: string;
  debug?: boolean;
  parallel?: boolean;
  outputFormat?: string;
  dryRun?: boolean;
  workingDirectory?: string;
}

/**
 * Test discovery result
 */
export interface TestDiscoveryResult {
  files: string[];
  scenarios: Scenario[];
  totalScenarios: number;
  totalFiles: number;
  discoveryTime: number;
}

/**
 * Configuration change listener type
 */
export type ConfigurationChangeListener = () => void;

/**
 * Test run context for VS Code test API
 */
export interface TestRunContext {
  request: vscode.TestRunRequest;
  run: vscode.TestRun;
  testController: vscode.TestController;
}

/**
 * File system event types
 */
export type FileSystemEvent = "create" | "change" | "delete";

/**
 * Test item metadata
 */
export interface TestItemMetadata {
  filePath: string;
  lineNumber?: number;
  scenarioName?: string;
  tags?: string[];
  isFeatureFile: boolean;
  isScenarioOutline: boolean;
}
