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
  public parseCucumberJson(jsonOutput: string): CucumberTestSuite {
    this.logger.debug("Parsing cucumber JSON output", { outputLength: jsonOutput.length });
    this.logger.debug("Raw JSON output:", { jsonOutput });

    try {
      const data: CucumberFeature[] = JSON.parse(jsonOutput);
      this.logger.debug("Parsed JSON data:", { 
        featureCount: data.length,
        features: data.map(f => ({ name: f.name, uri: f.uri, elementCount: f.elements.length }))
      });

      const tests: CucumberTestResult[] = [];

      for (const feature of data) {
        this.logger.debug("Processing feature:", { 
          name: feature.name, 
          uri: feature.uri, 
          elementCount: feature.elements.length 
        });

        for (const scenario of feature.elements) {
          this.logger.debug("Processing scenario:", { 
            name: scenario.name, 
            line: scenario.line, 
            stepCount: scenario.steps.length,
            stepStatuses: scenario.steps.map(s => ({ name: s.name, status: s.result.status }))
          });

          // Determine overall scenario status
          const stepStatuses = scenario.steps.map(step => step.result.status);
          const overallStatus = this.determineOverallStatus(stepStatuses);
          
          // Calculate total duration
          const totalDuration = scenario.steps.reduce((sum, step) => sum + (step.result.duration ?? 0), 0);
          
          // Get error message from failed steps
          const failedStep = scenario.steps.find(step => step.result.status === 'failed');
          const errorMessage = failedStep?.result.error_message;

          // Extract file path and line number from scenario
          const filePath = this.extractFilePath(feature.uri);
          const lineNumber = scenario.line;

          this.logger.debug("Created test result:", { 
            filePath, 
            lineNumber, 
            name: scenario.name, 
            status: overallStatus,
            totalDuration,
            errorMessage,
            stepCount: scenario.steps.length
          });

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

      this.logger.debug("Final test suite summary:", summary);
      this.logger.debug("All test results:", tests.map(t => ({ 
        filePath: t.filePath, 
        lineNumber: t.lineNumber, 
        name: t.name, 
        status: t.status 
      })));

      return { tests, summary };
    } catch (error) {
      this.logger.error("Failed to parse cucumber JSON output", { error, jsonOutput });
      return { tests: [], summary: { total: 0, passed: 0, failed: 0, skipped: 0, undefined: 0 } };
    }
  }

  /**
   * Parse cucumber JSON output and return results in behave-compatible format
   * This method returns results with filePath and lineNumber like behave does
   * For scenario outlines, it also creates outline parent entries
   */
  public parseCucumberJsonAsBehaveCompatible(jsonOutput: string): Array<{ filePath: string; lineNumber: number; name: string; status: string }> {
    this.logger.debug("Parsing cucumber JSON as behave-compatible format");
    
    const suite = this.parseCucumberJson(jsonOutput);
    const results: Array<{ filePath: string; lineNumber: number; name: string; status: string }> = [];
    
    this.logger.debug("Converting to behave-compatible format", { 
      totalTests: suite.tests.length,
      tests: suite.tests.map(t => ({ filePath: t.filePath, lineNumber: t.lineNumber, name: t.name, status: t.status }))
    });
    
    for (const test of suite.tests) {
      // Add the regular scenario result
      const result = {
        filePath: test.filePath,
        lineNumber: test.lineNumber,
        name: test.name,
        status: test.status
      };
      
      this.logger.debug("Adding behave-compatible result:", result);
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
          
          this.logger.debug("Adding outline parent result:", outlineResult);
          results.push(outlineResult);
        }
      }
    }
    
    this.logger.debug("Final behave-compatible results:", results);
    return results;
  }

  /**
   * Parse cucumber JSON output and create multiple keys for each scenario to handle all TestItemMapping patterns
   * This method creates a comprehensive set of keys that the TestItemMapping can use
   */
  public parseCucumberJsonWithMultipleKeys(jsonOutput: string): Record<string, string> {
    this.logger.debug("Parsing cucumber JSON with multiple keys for TestItemMapping");
    
    const suite = this.parseCucumberJson(jsonOutput);
    const scenarioResults: Record<string, string> = {};
    
    for (const test of suite.tests) {
      // Create the standard key: filePath:lineNumber
      const standardKey = `${test.filePath}:${test.lineNumber}`;
      scenarioResults[standardKey] = test.status;
      this.logger.debug("Added standard key:", { key: standardKey, status: test.status });
      
      // For scenario outline examples, create additional keys
      // Check if this is a scenario outline example by looking at the ID (which contains the parameters)
      if (test.id && test.id.includes('[') && test.id.includes(']')) {
        // Extract the outline name from the test name (not the ID)
        const outlineName = test.name;
        if (outlineName) {
          // Create outline parent key: filePath:outline:name
          const outlineKey = `${test.filePath}:outline:${outlineName}`;
          scenarioResults[outlineKey] = test.status;
          this.logger.debug("Added outline key:", { key: outlineKey, status: test.status });
          
          // Create feature line + scenario line key: filePath:featureLine:scenarioLine
          // Since pytest-bdd doesn't provide feature line, we'll use the scenario line for both
          const featureScenarioKey = `${test.filePath}:${test.lineNumber}:${test.lineNumber}`;
          scenarioResults[featureScenarioKey] = test.status;
          this.logger.debug("Added feature-scenario key:", { key: featureScenarioKey, status: test.status });
        }
      }
    }
    
    this.logger.debug("Final scenario results with multiple keys:", scenarioResults);
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
   * Convert absolute paths to relative paths to match behave format
   */
  private extractFilePath(uri: string): string {
    this.logger.debug("Extracting file path from URI", { uri });
    
    // Convert absolute path to relative path
    // Example: /Users/zer0gr4v/PycharmProjects/behave-test-runner-extension/tests/features/pytest_bdd_example.feature
    // Should become: tests/features/pytest_bdd_example.feature
    
    // Remove the workspace root if it's an absolute path
    const workspaceRoot = process.cwd();
    this.logger.debug("Workspace root", { workspaceRoot });
    
    if (uri.startsWith(workspaceRoot)) {
      const relativePath = uri.slice(workspaceRoot.length + 1); // +1 for the slash
      this.logger.debug("Converted absolute path to relative", { 
        absolute: uri, 
        relative: relativePath 
      });
      return relativePath;
    }
    
    // If it's already a relative path, return as is
    this.logger.debug("Path is already relative", { uri });
    return uri;
  }

  /**
   * Get status from exit code (for compatibility with other parsers)
   */
  public getStatusFromExitCode(exitCode: number): "passed" | "failed" {
    return exitCode === 0 ? "passed" : "failed";
  }
} 