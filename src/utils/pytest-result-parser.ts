import { Logger } from "./logger";

export interface PytestTestResult {
  name: string;
  status: "passed" | "failed" | "skipped" | "error";
  duration?: number;
  error?: string;
  stdout?: string;
  stderr?: string;
  filePath?: string;
  lineNumber?: number;
}

export interface PytestTestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
}

export interface PytestTestSuite {
  tests: PytestTestResult[];
  summary: PytestTestSummary;
}

type Status = PytestTestResult["status"];

const STATUS_WORD = "(PASSED|FAILED|SKIPPED|ERROR)";
const DURATION_SUFFIX = "(?:\\s+\\[.*\\])?(?:\\s+(\\d+\\.\\d+)s)?\\s*$";

const TEST_LINE_RE = new RegExp(`^([^:]+)::([^[]+)(?:\\[([^\\]]+)\\])?\\s+${STATUS_WORD}${DURATION_SUFFIX}`);
const SIMPLE_TEST_LINE_RE = new RegExp(`^([a-zA-Z_][a-zA-Z0-9_]*)\\s+${STATUS_WORD}${DURATION_SUFFIX}`);
const FAILED_SUMMARY_RE = /^FAILED\s+([^:]+)::([^[]+)(?:\[([^\]]+)\])?\s+-\s+(.+)$/;
const SUMMARY_RE = /=+\s+(?:(\d+)\s+failed,\s+(\d+)\s+passed|(\d+)\s+passed,\s+(\d+)\s+failed)(?:\s+in\s+\d+\.\d+s)?\s+=+/;

const STATUS_MAP: Record<string, Status> = {
  PASSED: "passed",
  FAILED: "failed",
  SKIPPED: "skipped",
  ERROR: "error",
  ERRORS: "error",
};

function mapStatus(status: string): Status {
  return STATUS_MAP[status.toUpperCase()] ?? "failed";
}

function emptySummary(): PytestTestSummary {
  return { total: 0, passed: 0, failed: 0, skipped: 0, errors: 0 };
}

function summarizeTests(tests: PytestTestResult[]): PytestTestSummary {
  return {
    total: tests.length,
    passed: tests.filter((t) => t.status === "passed").length,
    failed: tests.filter((t) => t.status === "failed").length,
    skipped: tests.filter((t) => t.status === "skipped").length,
    errors: tests.filter((t) => t.status === "error").length,
  };
}

export class PytestResultParser {
  private readonly logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? Logger.create();
  }

  public static create(logger?: Logger): PytestResultParser {
    return new PytestResultParser(logger);
  }

  public parsePytestOutput(output: string): PytestTestSuite {
    const lines = output.split("\n");
    const tests: PytestTestResult[] = [];
    const summaryFromOutput = this.parseSummaryLine(output);
    const shortSummaryTests = this.parseShortTestSummaryInfo(output);
    tests.push(...shortSummaryTests);

    let currentTest: PytestTestResult | null = null;
    let inTestOutput = false;
    let testOutput: string[] = [];

    const flushCurrent = (): void => {
      if (currentTest) {
        currentTest.stdout = testOutput.join("\n");
        tests.push(currentTest);
      }
    };

    for (const line of lines) {
      const detailedMatch = TEST_LINE_RE.exec(line);
      if (detailedMatch) {
        flushCurrent();
        const [, filePath, testName, parameters, status, duration] = detailedMatch;
        const fullName = parameters ? `${testName}[${parameters}]` : (testName ?? "unknown_test");
        currentTest = {
          name: fullName,
          status: mapStatus(status ?? "FAILED"),
          stdout: "",
          stderr: "",
          ...(filePath && { filePath }),
        };
        if (duration) {currentTest.duration = parseFloat(duration);}
        testOutput = [];
        inTestOutput = true;
        continue;
      }

      if (!currentTest) {
        const simpleMatch = SIMPLE_TEST_LINE_RE.exec(line);
        if (simpleMatch) {
          const [, testName, status, duration] = simpleMatch;
          currentTest = {
            name: testName ?? "unknown_test",
            status: mapStatus(status ?? "FAILED"),
            stdout: "",
            stderr: "",
          };
          if (duration) {currentTest.duration = parseFloat(duration);}
          testOutput = [];
          inTestOutput = true;
          continue;
        }
      }

      if (currentTest && inTestOutput) {
        if (line.trim() && !line.startsWith("=")) {
          testOutput.push(line);
        }
      }

      if (line.startsWith("=") && currentTest) {
        inTestOutput = false;
      }
    }

    flushCurrent();

    if (tests.length === 0 && summaryFromOutput) {
      tests.push(...this.synthesizeTests(summaryFromOutput));
    }

    const summary = summaryFromOutput ?? summarizeTests(tests);
    return { tests, summary };
  }

  private synthesizeTests(summary: PytestTestSummary): PytestTestResult[] {
    const tests: PytestTestResult[] = [];
    const make = (status: Status, count: number, prefix: string): void => {
      for (let i = 0; i < count; i++) {
        tests.push({ name: `${prefix}_${i + 1}`, status, stdout: "", stderr: "" });
      }
    };
    make("passed", summary.passed, "test_passed");
    make("failed", summary.failed, "test_failed");
    make("skipped", summary.skipped, "test_skipped");
    return tests;
  }

  private parseSummaryLine(output: string): PytestTestSummary | null {
    const match = SUMMARY_RE.exec(output);
    if (!match) {return null;}
    const [, failedFirst, passedFirst, passedAlt, failedAlt] = match;
    const failed = parseInt(failedFirst ?? failedAlt ?? "0");
    const passed = parseInt(passedFirst ?? passedAlt ?? "0");
    return { total: failed + passed, passed, failed, skipped: 0, errors: 0 };
  }

  private parseShortTestSummaryInfo(output: string): PytestTestResult[] {
    const tests: PytestTestResult[] = [];
    let inShortSummary = false;

    for (const line of output.split("\n")) {
      if (line.includes("short test summary info")) {
        inShortSummary = true;
        continue;
      }
      if (inShortSummary && line.startsWith("=")) {
        inShortSummary = false;
        continue;
      }
      if (!inShortSummary || !line.trim()) {continue;}

      const match = FAILED_SUMMARY_RE.exec(line);
      if (match) {
        const [, filePath, testFunction, parameters, errorMessage] = match;
        const fullName = parameters ? `${testFunction}[${parameters}]` : testFunction;
        tests.push({
          name: `${filePath}::${fullName}`,
          status: "failed",
          error: errorMessage ?? "",
          stdout: "",
          stderr: "",
        });
      }
    }

    return tests;
  }

  public parsePytestJsonOutput(jsonOutput: string): PytestTestSuite {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = JSON.parse(jsonOutput);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const source: any[] = data.tests ?? data.test_results ?? [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tests: PytestTestResult[] = source.map((test: any) => ({
        name: test.nodeid ?? test.name,
        status: mapStatus(test.outcome ?? test.status ?? "FAILED"),
        duration: test.duration,
        error: test.call?.longrepr ?? test.longrepr ?? test.error,
        stdout: test.stdout,
        stderr: test.stderr,
      }));
      return { tests, summary: summarizeTests(tests) };
    } catch (error) {
      this.logger.error("Failed to parse pytest JSON output", { error });
      return { tests: [], summary: emptySummary() };
    }
  }

  public parsePytestOutputAsBehaveCompatible(
    output: string
  ): Array<{ filePath: string; lineNumber: number; name: string; status: string }> {
    const suite = this.parsePytestOutput(output);
    const results: Array<{ filePath: string; lineNumber: number; name: string; status: string }> = [];

    for (const test of suite.tests) {
      let filePath = test.filePath;
      let scenarioName = test.name;

      if (!filePath) {
        const fileMatch = /^([^:]+)::([^[]+)(?:\[([^\]]+)\])?$/.exec(test.name);
        if (fileMatch) {
          const [, extractedFilePath, testFunction, parameters] = fileMatch;
          filePath = extractedFilePath;
          scenarioName = parameters ? `${testFunction}[${parameters}]` : (testFunction ?? "unknown_test");
        }
      }

      if (filePath) {
        results.push({
          filePath: this.mapTestFileToFeatureFile(filePath),
          lineNumber: 1,
          name: scenarioName ?? "unknown_scenario",
          status: test.status,
        });
      } else {
        results.push({ filePath: "unknown.feature", lineNumber: 1, name: test.name, status: test.status });
      }
    }

    return results;
  }

  private mapTestFileToFeatureFile(testFile: string): string {
    if (testFile.includes("test_pytest_bdd_example.py")) {
      return "tests/features/pytest_bdd_example.feature";
    }
    const baseName = testFile.replace(/\.py$/, "").replace(/^test_/, "");
    return `tests/features/${baseName}.feature`;
  }

  public getStatusFromExitCode(exitCode: number): "passed" | "failed" {
    return exitCode === 0 ? "passed" : "failed";
  }
}
