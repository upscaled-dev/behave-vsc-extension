// Behave JSON output parser utility
// Given Behave's --format=json output, extract scenario results by file and line

import { Logger } from "./logger";

export interface BehaveScenarioResult {
  filePath: string;
  lineNumber: number;
  name: string;
  status: string; // 'passed', 'failed', etc.
  output: string; // Human-readable per-scenario step/status/error rendering
}

export class BehaveJsonParser {
  private readonly logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? Logger.create();
  }

  public static create(logger?: Logger): BehaveJsonParser {
    return new BehaveJsonParser(logger);
  }

  /**
   * Extract and parse the JSON array that Behave's `--format=json` emits. The
   * raw output may be wrapped in other text (progress lines, summary, etc.), so
   * we slice from the first `[` to the matching closing `]`.
   */
  private extractJsonArray(jsonOutput: string): Array<Record<string, unknown>> {
    const startIdx = jsonOutput.indexOf('[');
    const endIdx = jsonOutput.indexOf(']\n'); // closing bracket followed by newline
    let jsonPart: string;
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      jsonPart = jsonOutput.slice(startIdx, endIdx + 1); // include the closing ]
    } else {
      // fallback: try to find just the last closing bracket
      const lastBracket = jsonOutput.lastIndexOf(']');
      if (startIdx !== -1 && lastBracket !== -1 && lastBracket > startIdx) {
        jsonPart = jsonOutput.slice(startIdx, lastBracket + 1);
      } else {
        this.logger.error('Could not find JSON array in Behave output', { bytes: Buffer.byteLength(jsonOutput) });
        throw new Error('Could not find JSON array in Behave output');
      }
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonPart);
    } catch {
      this.logger.error("Failed to parse Behave JSON output", { bytes: Buffer.byteLength(jsonPart) });
      throw new Error("Failed to parse Behave JSON output");
    }
    if (!Array.isArray(parsed)) {
      this.logger.error("Behave JSON output is not an array");
      throw new Error("Behave JSON output is not an array");
    }
    return parsed as Array<Record<string, unknown>>;
  }

  public parseBehaveJsonOutput(jsonOutput: string): BehaveScenarioResult[] {
    try {
      const parsed = this.extractJsonArray(jsonOutput);
      const results: BehaveScenarioResult[] = [];
      for (const feature of parsed) {
        results.push(...this.parseFeatureScenarios(feature));
      }
      this.logger.debug("Parsed Behave report", { features: parsed.length, scenarios: results.length });
      return results;
    } catch (err) {
      this.logger.error("Invalid Behave report", { bytes: Buffer.byteLength(jsonOutput) });
      throw err;
    }
  }

  /** Extract scenario/scenario-outline results from a single feature node. */
  private parseFeatureScenarios(feature: Record<string, unknown>): BehaveScenarioResult[] {
    const elements = feature?.['elements'];
    const filePath = feature?.['filename'] ?? feature?.['location'];
    if (!Array.isArray(elements) || typeof filePath !== "string" || !filePath) {
      throw new Error("Invalid Behave report: each feature requires a file location and elements array.");
    }
    const results: BehaveScenarioResult[] = [];
    const statuses = new Set(["unknown", "untested", "executing", "skipped", "passed", "xfailed", "xpassed", "failed", "error", "hook_error", "cleanup_error", "undefined", "pending", "pending_warn", "untested_pending", "untested_undefined"]);
    for (const scenario of elements as Array<Record<string, unknown>>) {
      if (scenario?.['type'] === "background") {continue;}
      const steps = scenario?.['steps'];
      const line = scenario ? this.extractScenarioLine(scenario) : 0;
      if ((scenario?.['type'] !== "scenario" && scenario?.['type'] !== "scenario_outline") ||
        typeof scenario['name'] !== "string" || !Number.isInteger(line) || line <= 0 || !Array.isArray(steps) ||
        steps.some((step: Record<string, unknown> | null) => !step || typeof step['name'] !== "string" ||
          (step['result'] !== undefined && (!step['result'] || !statuses.has((step['result'] as Record<string, unknown>)['status'] as string)))) ||
        (scenario['status'] !== undefined ? !statuses.has(scenario['status'] as string) :
          steps.length === 0 || steps.some((step: Record<string, unknown>) => !step['result']))) {
        throw new Error("Invalid Behave report: each scenario requires a name, line, steps and recognized results.");
      }
      results.push({
        filePath,
        lineNumber: line,
        name: (scenario['name'] ?? "") as string,
        status: this.extractScenarioStatus(scenario),
        output: this.renderScenarioOutput(scenario),
      });
    }
    return results;
  }

  /** Render a scenario's steps, per-step status and any error message as text. */
  private renderScenarioOutput(scenario: Record<string, unknown>): string {
    const keyword = (scenario['keyword'] ?? "Scenario") as string;
    const name = (scenario['name'] ?? "") as string;
    const status = this.extractScenarioStatus(scenario);
    const lines: string[] = [`${keyword}: ${name}  [${status}]`];

    const steps = scenario['steps'];
    if (Array.isArray(steps)) {
      for (const step of steps as Array<Record<string, unknown>>) {
        const result = (step['result'] ?? {}) as Record<string, unknown>;
        const stepStatus = (result['status'] ?? "skipped") as string;
        const stepKeyword = (step['keyword'] ?? "") as string;
        const stepName = (step['name'] ?? "") as string;
        lines.push(`  ${stepKeyword} ${stepName} ... ${stepStatus}`.replace(/\s+/g, " ").trimEnd());

        const errorText = this.errorMessageText(result['error_message']);
        if (errorText) {
          for (const errLine of errorText.split(/\r?\n/)) {
            lines.push(`      ${errLine}`);
          }
        }
      }
    }
    return lines.join("\n");
  }

  /** Normalise Behave's `error_message` (string or array of strings) to text. */
  private errorMessageText(errorMessage: unknown): string {
    if (!errorMessage) { return ""; }
    if (Array.isArray(errorMessage)) { return errorMessage.join("\n"); }
    if (typeof errorMessage === "string") { return errorMessage; }
    return JSON.stringify(errorMessage);
  }

  /** Resolve a scenario's feature-file line from its `line` or `location` field. */
  private extractScenarioLine(scenario: Record<string, unknown>): number {
    const line = scenario['line'];
    if (typeof line === 'number') {
      return line;
    }
    const location = scenario['location'];
    if (typeof location === 'string') {
      const match = /:(\d+)$/.exec(location);
      return match?.[1] ? Number.parseInt(match[1], 10) : 0;
    }
    if (location && typeof (location as Record<string, unknown>)['line'] === 'number') {
      return (location as Record<string, unknown>)['line'] as number;
    }
    return 0;
  }

  /** Resolve a scenario's status, inferring `failed`/`passed` from steps when absent. */
  private extractScenarioStatus(scenario: Record<string, unknown>): string {
    const status = scenario['status'] as string | undefined;
    if (status) {
      return status;
    }
    const steps = scenario['steps'];
    const hasFailedStep = Array.isArray(steps) &&
      (steps as Array<Record<string, unknown>>).some(
        (s) => s['result'] && (s['result'] as Record<string, unknown>)['status'] === "failed"
      );
    return hasFailedStep ? "failed" : "passed";
  }
}

// Backward compatibility function
export function parseBehaveJsonOutput(jsonOutput: string): BehaveScenarioResult[] {
  return BehaveJsonParser.create().parseBehaveJsonOutput(jsonOutput);
} 