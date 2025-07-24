// Behave JSON output parser utility
// Given Behave's --format=json output, extract scenario results by file and line

import { Logger } from "./logger";

export interface BehaveScenarioResult {
  filePath: string;
  lineNumber: number;
  name: string;
  status: string; // 'passed', 'failed', etc.
}

export function parseBehaveJsonOutput(jsonOutput: string): BehaveScenarioResult[] {
  try {
    // Extract only the JSON array from the output
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
        Logger.getInstance().error('Could not find JSON array in Behave output', { jsonOutput });
        throw new Error('Could not find JSON array in Behave output');
      }
    }
    Logger.getInstance().info("Extracted Behave JSON part", { jsonPart });
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonPart);
    } catch (e) {
      Logger.getInstance().error("Failed to parse Behave JSON output", { error: e, jsonPart });
      throw new Error(`Failed to parse Behave JSON output: ${e}`);
    }
    Logger.getInstance().info("Parsed Behave JSON array", {
      length: Array.isArray(parsed) ? parsed.length : 'not array',
      first: Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : undefined
    });
    if (!Array.isArray(parsed)) {
      Logger.getInstance().error("Behave JSON output is not an array", { parsed });
      throw new Error("Behave JSON output is not an array");
    }
    const results: BehaveScenarioResult[] = [];
    for (const feature of parsed as Array<Record<string, unknown>>) {
      const filePath = (feature['filename'] ?? feature['location'] ?? "") as string;
      if (!Array.isArray(feature['elements'])) {
        continue;
      }
      for (const scenario of feature['elements'] as Array<Record<string, unknown>>) {
        // Only consider scenarios and scenario outlines (not backgrounds, etc.)
        if (scenario['type'] !== "scenario" && scenario['type'] !== "scenario_outline") {
          continue;
        }
        let lineNumber = 0;
        if (typeof scenario['line'] === 'number') {
          lineNumber = scenario['line'] as number;
        } else if (typeof scenario['location'] === 'string') {
          const match = scenario['location'].match(/:(\d+)$/);
          if (match?.[1]) {
            lineNumber = parseInt(match[1], 10);
          }
        } else if (scenario['location'] && typeof (scenario['location'] as Record<string, unknown>)['line'] === 'number') {
          lineNumber = (scenario['location'] as Record<string, unknown>)['line'] as number;
        }
        const name = (scenario['name'] ?? "") as string;
        let status = scenario['status'] as string | undefined;
        if (!status) {
          if (Array.isArray(scenario['steps']) && (scenario['steps'] as Array<Record<string, unknown>>).some((s) => (s['result'] && (s['result'] as Record<string, unknown>)['status'] === "failed"))) {
            status = "failed";
          } else {
            status = "passed";
          }
        }
        results.push({ filePath, lineNumber, name, status });
      }
    }
    Logger.getInstance().info("Returning parsed scenario results", { results });
    return results;
  } catch (err) {
    Logger.getInstance().error("Error in parseBehaveJsonOutput", { error: err, input: jsonOutput });
    throw err;
  }
} 