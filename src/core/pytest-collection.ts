import * as path from "node:path";

/** Fold actual collected nodes into the source locations already owned by Test Explorer. */
export function parsePytestCollectionReport(text: string, projectRoot: string): {
  scenarioResults: Record<string, string>; scenarioOutputs: Record<string, string>;
} {
  let records: unknown;
  try {records = JSON.parse(text);} catch {throw new Error("Invalid pytest collection report: invalid JSON.");}
  const priority = ["passed", "skipped", "failed", "errored"];
  const scenarioResults: Record<string, string> = {};
  const scenarioOutputs: Record<string, string> = {};
  const outputChunks = new Map<string, string[]>();
  let detailBytes = 0;
  const nodes = new Set<string>();
  if (!Array.isArray(records) || records.length > 10000) {throw new Error("Invalid pytest collection report: expected at most 10,000 nodes.");}
  for (const entry of records) {
    if (!entry || typeof entry.featurePath !== "string" || !path.isAbsolute(entry.featurePath) ||
      !Number.isInteger(entry.scenarioLine) || entry.scenarioLine <= 0 || !Number.isInteger(entry.lineNumber) || entry.lineNumber <= 0 ||
      typeof entry.nodeId !== "string" || !entry.nodeId || !priority.includes(entry.status) || typeof entry.detail !== "string") {
      throw new Error("Invalid pytest collection report: expected collected node identity, source location and outcome.");
    }
    if (nodes.has(entry.nodeId)) {throw new Error("Invalid pytest collection report: duplicate node identity.");}
    nodes.add(entry.nodeId);
    const relative = path.relative(projectRoot, entry.featurePath);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Invalid pytest collection report: feature is outside the admitted project.");
    }
    detailBytes += Buffer.byteLength(entry.detail);
    if (detailBytes > 1024 * 1024) {throw new Error("Invalid pytest collection report: details exceed the 1 MiB limit.");}
    const key = `${entry.featurePath}:${entry.lineNumber}`;
    const previous = scenarioResults[key];
    if (previous === undefined || priority.indexOf(entry.status) > priority.indexOf(previous)) {scenarioResults[key] = entry.status;}
    if (entry.detail) {
      const chunks = outputChunks.get(key) ?? [];
      chunks.push(`${entry.nodeId}\n${entry.detail}\n`);
      outputChunks.set(key, chunks);
    }
  }
  for (const [key, chunks] of outputChunks) {scenarioOutputs[key] = chunks.join("");}
  return { scenarioResults, scenarioOutputs };
}
