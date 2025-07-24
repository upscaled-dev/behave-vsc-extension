import * as vscode from "vscode";

/**
 * Given a child test item, its parent, scenario results, and workspace root,
 * construct the correct scenario result key and return the status.
 */
export function getScenarioStatusForTestItem(
  child: { id: string; uri?: vscode.Uri },
  parent: { id: string; uri?: vscode.Uri },
  scenarioResults: Record<string, string>,
  workspaceRoot: string
): string | undefined {
  // Try to extract parent info (feature path and line)
  let featurePath = "";
  let featureLine = "";
  const match = parent.id.match(/(.*\.feature)(?::(\d+))?/);
  if (match) {
    featurePath = match[1] ?? "";
    featureLine = match[2] ?? "";
  }
  let constructedKey: string | undefined = undefined;
  let relativePath = "";
  let scenarioLine = "";
  if (child.id.startsWith(":")) {
    // Child id is just :<line>
    constructedKey = `${featurePath}:${featureLine}:${child.id.slice(1)}`;
    relativePath = featurePath;
    scenarioLine = child.id.slice(1);
  } else if (child.id.includes(":")) {
    // Child id is absolute path or composite key
    const [absPath, ...rest] = child.id.split(":");
    if (!absPath) { return undefined; }
    relativePath = absPath.startsWith(workspaceRoot)
      ? absPath.slice(workspaceRoot.length + 1).replace(/\\/g, "/")
      : absPath.replace(/\\/g, "/");
    scenarioLine = rest[rest.length - 1] ?? "";
    if (rest.length === 1 && featureLine) {
      // Only scenario line, need to add feature line
      constructedKey = `${relativePath}:${featureLine}:${rest[0]}`;
    } else {
      // Already composite key
      constructedKey = [relativePath, ...rest].join(":");
    }
  }
  // 1. Try full constructed key
  if (constructedKey && scenarioResults[constructedKey] !== undefined) {
    return scenarioResults[constructedKey];
  }
  // 2. Try matching just file and scenario line (ignore feature line)
  for (const key of Object.keys(scenarioResults)) {
    if (key.endsWith(`:${scenarioLine}`) && key.startsWith(`${relativePath}:`)) {
      return scenarioResults[key];
    }
  }
  // 3. Final fallback: extract relative path and scenario line from child.id, match any unique key
  let fallbackRelPath = relativePath;
  let fallbackScenarioLine = scenarioLine;
  if (!fallbackRelPath || !fallbackScenarioLine) {
    // Try to extract from child.id directly
    const idMatch = child.id.match(/(?:.*\/)?([^/]+\.feature):(\d+)$/);
    if (idMatch) {
      fallbackRelPath = idMatch[1] ?? "";
      fallbackScenarioLine = idMatch[2] ?? "";
    }
  }
  if (fallbackRelPath && fallbackScenarioLine) {
    const possibleKeys = Object.keys(scenarioResults).filter(
      key => key.endsWith(`:${fallbackScenarioLine}`) && key.includes(fallbackRelPath)
    );
    if (possibleKeys.length === 1 && possibleKeys[0]) {
      return scenarioResults[possibleKeys[0]];
    }
  }
  return undefined;
} 