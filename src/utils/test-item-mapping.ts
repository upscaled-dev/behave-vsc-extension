import * as vscode from "vscode";

type ItemRef = { id: string; uri?: vscode.Uri | undefined };

/**
 * Per-run lookup over a scenario-result map (key -> status/output).
 *
 * Construction indexes every key once (O(keys)); each `get` is then a
 * constant-time query. The provider resolves one value per leaf test item per
 * run, so querying the raw map with linear scans (the old behaviour) was
 * O(leaves x keys) per run.
 *
 * Matching semantics, in order:
 * 1. Exact hit on the key constructed from the child/parent ids.
 * 2. A key with the same file path and trailing line, ignoring the feature
 *    line in the middle.
 * 3. A unique key that ends with the child's line and mentions its file.
 */
export class ScenarioResultLookup {
  private readonly results: Record<string, string>;
  private readonly workspaceRoot: string;
  /** (first key segment, last key segment) -> first matching key's value. */
  private readonly byPathAndLastSegment = new Map<string, string>();
  /** last key segment -> all keys with that suffix, in insertion order. */
  private readonly byLastSegment = new Map<string, Array<{ key: string; value: string }>>();

  constructor(scenarioResults: Record<string, string>, workspaceRoot: string) {
    this.results = scenarioResults;
    this.workspaceRoot = workspaceRoot;

    for (const [key, value] of Object.entries(scenarioResults)) {
      const lastColon = key.lastIndexOf(":");
      if (lastColon === -1) {
        continue; // a key without segments can never suffix-match
      }
      const lastSegment = key.slice(lastColon + 1);
      const firstSegment = key.slice(0, key.indexOf(":"));

      const pathLineKey = `${firstSegment}\u0000${lastSegment}`;
      if (!this.byPathAndLastSegment.has(pathLineKey)) {
        this.byPathAndLastSegment.set(pathLineKey, value);
      }

      const bucket = this.byLastSegment.get(lastSegment) ?? [];
      bucket.push({ key, value });
      this.byLastSegment.set(lastSegment, bucket);
    }
  }

  public get(child: ItemRef, parent: ItemRef): string | undefined {
    // Try to extract parent info (feature path and line)
    let featurePath = "";
    let featureLine = "";
    const match = /(.*\.feature)(?::(\d+))?/.exec(parent.id);
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
      if (!absPath) {
        return undefined;
      }
      relativePath = absPath.startsWith(this.workspaceRoot)
        ? absPath.slice(this.workspaceRoot.length + 1).replace(/\\/g, "/")
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
    if (constructedKey && this.results[constructedKey] !== undefined) {
      return this.results[constructedKey];
    }

    // 2. Try matching just file and scenario line (ignore feature line)
    const pathAndLine = this.byPathAndLastSegment.get(`${relativePath}\u0000${scenarioLine}`);
    if (pathAndLine !== undefined) {
      return pathAndLine;
    }

    // 3. Final fallback: extract relative path and scenario line from
    // child.id, match any unique key
    let fallbackRelPath = relativePath;
    let fallbackScenarioLine = scenarioLine;
    if (!fallbackRelPath || !fallbackScenarioLine) {
      const idMatch = /(?:.*\/)?([^/]+\.feature):(\d+)$/.exec(child.id);
      if (idMatch) {
        fallbackRelPath = idMatch[1] ?? "";
        fallbackScenarioLine = idMatch[2] ?? "";
      }
    }
    if (fallbackRelPath && fallbackScenarioLine) {
      const candidates = this.byLastSegment.get(fallbackScenarioLine) ?? [];
      const possible = candidates.filter((c) => c.key.includes(fallbackRelPath));
      if (possible.length === 1 && possible[0]) {
        return possible[0].value;
      }
    }
    return undefined;
  }
}

/**
 * Utility for mapping test items to scenario results
 */
export class TestItemMapping {
  public static create(): TestItemMapping {
    return new TestItemMapping();
  }

  /**
   * Build a per-run lookup for a result map. Prefer this over repeated
   * `getScenarioStatusForTestItem` calls when resolving many items against
   * the same map (the indices are built once instead of per query).
   */
  public createLookup(
    scenarioResults: Record<string, string>,
    workspaceRoot: string
  ): ScenarioResultLookup {
    return new ScenarioResultLookup(scenarioResults, workspaceRoot);
  }

  /**
   * Given a child test item, its parent, scenario results, and workspace root,
   * construct the correct scenario result key and return the status.
   */
  public getScenarioStatusForTestItem(
    child: ItemRef,
    parent: ItemRef,
    scenarioResults: Record<string, string>,
    workspaceRoot: string
  ): string | undefined {
    return this.createLookup(scenarioResults, workspaceRoot).get(child, parent);
  }
}

// Backward compatibility function
const sharedMapping = TestItemMapping.create();
export function getScenarioStatusForTestItem(
  child: ItemRef,
  parent: ItemRef,
  scenarioResults: Record<string, string>,
  workspaceRoot: string
): string | undefined {
  return sharedMapping.getScenarioStatusForTestItem(child, parent, scenarioResults, workspaceRoot);
}
