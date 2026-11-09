import { Logger } from "./logger";

export interface CucumberStep {
  keyword: string;
  name: string;
  line: number;
  match: { location: string };
  result: {
    status: "passed" | "failed" | "skipped" | "undefined";
    duration?: number;
    error_message?: string;
  };
}

export interface CucumberScenario {
  keyword: string;
  id: string;
  name: string;
  line: number;
  description: string;
  tags: Array<{ name: string; line: number }>;
  type: string;
  steps: CucumberStep[];
}

export interface CucumberFeature {
  keyword: string;
  uri: string;
  name: string;
  id: string;
  line: number;
  description: string;
  language: string;
  tags: Array<{ name: string; line: number }>;
  elements: CucumberScenario[];
}

export interface CucumberTestResult {
  filePath: string;
  lineNumber: number;
  name: string;
  id?: string; // Add ID field for scenario outline examples
  status: "passed" | "failed" | "skipped" | "undefined";
  duration?: number;
  error?: string;
  steps: Array<{
    name: string;
    status: "passed" | "failed" | "skipped" | "undefined";
    duration?: number;
    error?: string;
  }>;
}

export interface CucumberTestSuite {
  tests: CucumberTestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    undefined: number;
  };
}

/**
 * Parser for cucumber JSON output from pytest-bdd
 * This provides much more reliable parsing than text output
 */
export class CucumberJsonParser {
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? Logger.create();
  }

  public static create(logger?: Logger): CucumberJsonParser {
    return new CucumberJsonParser(logger);
  }

  /**
   * Parse cucumber JSON output and extract test results
   * @param jsonOutput - Raw cucumber JSON output
   * @returns Parsed test results
   */
  public parseCucumberJson(jsonOutput: string, workspaceRoot?: string): CucumberTestSuite {

    try {
      const data: CucumberFeature[] = JSON.parse(jsonOutput);
      if (!Array.isArray(data)) {throw new Error("Expected a feature array");}

      const tests: CucumberTestResult[] = [];

      for (const feature of data) {
        if (!feature || typeof feature.uri !== "string" || !feature.uri || !Array.isArray(feature.elements)) {
          throw new Error("Expected a feature URI and elements array");
        }

        for (const scenario of feature.elements) {
          if (!scenario || typeof scenario.name !== "string" || !Number.isInteger(scenario.line) || scenario.line <= 0 ||
            !Array.isArray(scenario.steps) || scenario.steps.some((step) => !step || typeof step.name !== "string" ||
              !step.result || !["passed", "failed", "skipped", "undefined"].includes(step.result.status))) {
            throw new Error("Expected a scenario name, line, steps and recognized results");
          }

          // Determine overall scenario status
          const stepStatuses = scenario.steps.map(step => step.result.status);
          const overallStatus = this.determineOverallStatus(stepStatuses);

          // Calculate total duration
          const totalDuration = scenario.steps.reduce((sum, step) => sum + (step.result.duration ?? 0), 0);

          // Get error message from failed steps
          const failedStep = scenario.steps.find(step => step.result.status === 'failed');
          const errorMessage = failedStep?.result.error_message;

          // Extract file path and line number from scenario
          const filePath = this.extractFilePath(feature.uri, workspaceRoot);
          const lineNumber = scenario.line;

          tests.push({
            filePath,
            lineNumber,
            name: scenario.name,
            id: scenario.id,
            status: overallStatus,
            ...(totalDuration && { duration: totalDuration }),
            ...(errorMessage && { error: errorMessage }),
            steps: scenario.steps.map(step => ({
              name: step.name,
              status: step.result.status,
              ...(step.result.duration && { duration: step.result.duration }),
              ...(step.result.error_message && { error: step.result.error_message })
            }))
          });
        }
      }

      const summary = {
        total: tests.length,
        passed: tests.filter(t => t.status === 'passed').length,
        failed: tests.filter(t => t.status === 'failed').length,
        skipped: tests.filter(t => t.status === 'skipped').length,
        undefined: tests.filter(t => t.status === 'undefined').length
      };

      this.logger.debug("Parsed cucumber report", summary);
      return { tests, summary };
    } catch {
      this.logger.error("Invalid cucumber report", { bytes: Buffer.byteLength(jsonOutput) });
      throw new Error("Invalid cucumber report: expected feature locations and scenario names, lines, steps and recognized results.");
    }
  }

  /**
   * Parse cucumber JSON output and return results in behave-compatible format
   * This method returns results with filePath and lineNumber like behave does
   * For scenario outlines, it also creates outline parent entries
   */
  public parseCucumberJsonAsBehaveCompatible(jsonOutput: string): Array<{ filePath: string; lineNumber: number; name: string; status: string }> {

    const suite = this.parseCucumberJson(jsonOutput);
    const results: Array<{ filePath: string; lineNumber: number; name: string; status: string }> = [];

    for (const test of suite.tests) {
      // Add the regular scenario result
      const result = {
        filePath: test.filePath,
        lineNumber: test.lineNumber,
        name: test.name,
        status: test.status
      };
      results.push(result);

      // For scenario outlines, also create an outline parent entry
      // This helps with TestItemMapping lookup for outline parents
      if (test.name.includes('[') && test.name.includes(']')) {
        // This looks like a scenario outline example (e.g., "Login with different user types[guest-guest_user-guest_pass-Welcome Guest]")
        const outlineName = test.name.split('[')[0]?.trim();
        if (outlineName) {
          const outlineResult = {
            filePath: test.filePath,
            lineNumber: test.lineNumber, // Use same line number for outline parent
            name: outlineName,
            status: test.status
          };
          results.push(outlineResult);
        }
      }
    }

    return results;
  }

  /**
   * Parse cucumber JSON output and create multiple keys for each scenario to handle all TestItemMapping patterns
   * This method creates a comprehensive set of keys that the TestItemMapping can use
   */
  public parseCucumberJsonWithMultipleKeys(jsonOutput: string, workspaceRoot?: string): Record<string, string> {

    const suite = this.parseCucumberJson(jsonOutput, workspaceRoot);
    const scenarioResults: Record<string, string> = {};

    for (const test of suite.tests) {
      // Create the standard key: filePath:lineNumber
      const standardKey = `${test.filePath}:${test.lineNumber}`;
      scenarioResults[standardKey] = test.status;

      // For scenario outline examples, create additional keys
      // Check if this is a scenario outline example by looking at the ID (which contains the parameters)
      if (test.id && test.id.includes('[') && test.id.includes(']')) {
        // Extract the outline name from the test name (not the ID)
        const outlineName = test.name;
        if (outlineName) {
          // Create outline parent key: filePath:outline:name
          const outlineKey = `${test.filePath}:outline:${outlineName}`;
          scenarioResults[outlineKey] = test.status;

          // Create feature line + scenario line key: filePath:featureLine:scenarioLine
          // Since pytest-bdd doesn't provide feature line, we'll use the scenario line for both
          const featureScenarioKey = `${test.filePath}:${test.lineNumber}:${test.lineNumber}`;
          scenarioResults[featureScenarioKey] = test.status;
        }
      }
    }

    return scenarioResults;
  }

  /**
   * Determine overall status from step statuses
   */
  private determineOverallStatus(stepStatuses: string[]): "passed" | "failed" | "skipped" | "undefined" {
    if (stepStatuses.includes('failed')) {
      return 'failed';
    }
    if (stepStatuses.includes('undefined')) {
      return 'undefined';
    }
    if (stepStatuses.includes('skipped')) {
      return 'skipped';
    }
    return 'passed';
  }

  /**
   * Extract file path from feature URI
   * Convert absolute paths to relative paths (forward-slashed) to match the
   * workspace-relative keys TestItemMapping builds.
   */
  private extractFilePath(uri: string, workspaceRoot?: string): string {

    // Normalise Windows backslashes so keys always use forward slashes.
    const normalizedUri = uri.replace(/\\/g, "/");

    // Relativize against the run's working directory (the cwd pytest ran in),
    // not the extension host's process.cwd().
    const root = (workspaceRoot ?? process.cwd()).replace(/\\/g, "/");

    if (normalizedUri.startsWith(`${root}/`)) {
      const relativePath = normalizedUri.slice(root.length + 1);
      return relativePath;
    }

    // If it's already a relative path, return as is
    return normalizedUri;
  }

  /**
   * Get status from exit code (for compatibility with other parsers)
   */
  public getStatusFromExitCode(exitCode: number): "passed" | "failed" {
    return exitCode === 0 ? "passed" : "failed";
  }
}
