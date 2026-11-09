import type * as vscode from "vscode";
import type { Scenario, TestExecutionOptions } from "../types";

interface LogicalScenario {
  readonly scenario: Scenario;
  readonly aliases: vscode.TestItem[];
}

interface ExecutionUnit {
  readonly kind: "file" | "scenario";
  readonly options: TestExecutionOptions;
  readonly scenarios: LogicalScenario[];
}

function scenarioKey(scenario: Scenario): string {
  return `${scenario.filePath}:${scenario.lineNumber}`;
}

/** Expand UI projections into exact logical scenarios before deciding what can share a launch. */
export function testExplorerRunPlan(
  request: vscode.TestRunRequest,
  roots: readonly vscode.TestItem[],
  scenarioFor: (id: string) => Scenario | undefined
): ExecutionUnit[] {
  const known = new Map<string, LogicalScenario>();
  const visit = (item: vscode.TestItem, accept: (scenario: Scenario, item: vscode.TestItem) => void): void => {
    if (item.children.size > 0) {item.children.forEach((child) => visit(child, accept));}
    else {
      const scenario = scenarioFor(item.id);
      if (scenario) {accept(scenario, item);}
    }
  };
  for (const root of roots) {
    visit(root, (scenario, item) => {
      const key = scenarioKey(scenario);
      const logical = known.get(key) ?? { scenario, aliases: [] };
      logical.aliases.push(item);
      known.set(key, logical);
    });
  }
  const excluded = new Set<string>();
  for (const root of request.exclude ?? []) {visit(root, (scenario) => excluded.add(scenarioKey(scenario)));}
  const selected = new Set<string>();
  for (const root of request.include ?? roots) {
    visit(root, (scenario) => {
      const key = scenarioKey(scenario);
      if (!excluded.has(key) && known.has(key)) {selected.add(key);}
    });
  }

  const files = new Map<string, LogicalScenario[]>();
  for (const logical of known.values()) {
    const file = logical.scenario.filePath;
    const scenarios = files.get(file) ?? [];
    scenarios.push(logical);
    files.set(file, scenarios);
  }
  const units: ExecutionUnit[] = [];
  for (const [filePath, all] of files) {
    const chosen = all.filter(({ scenario }) => selected.has(scenarioKey(scenario)));
    if (chosen.length === 0) {continue;}
    if (chosen.length === all.length) {
      units.push({ kind: "file", options: { filePath }, scenarios: chosen });
      continue;
    }
    for (const logical of chosen) {
      units.push({ kind: "scenario", options: { filePath, lineNumber: logical.scenario.lineNumber }, scenarios: [logical] });
    }
  }
  return units;
}
