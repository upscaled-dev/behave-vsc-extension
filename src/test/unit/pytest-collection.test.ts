import * as assert from "node:assert";
import { parsePytestCollectionReport } from "../../core/pytest-collection";

suite("Pytest collection report boundaries", () => {
  const node = (status: string, nodeId = "binding.py::test_case", detail = "") => ({ featurePath: "/project/features/example.feature",
    scenarioLine: 2, lineNumber: 7, nodeId, status, detail });
  test("folds all collected variants with failure precedence and retains source-row identity", () => {
    const report = [node("passed"), node("skipped", "second"), node("failed", "third", "actual failure"), node("errored", "fourth", "teardown failure")];
    const result = parsePytestCollectionReport(JSON.stringify(report), "/project");
    assert.strictEqual(result.scenarioResults["/project/features/example.feature:7"], "errored");
    assert.ok(result.scenarioOutputs["/project/features/example.feature:7"]?.includes("actual failure"));
    assert.ok(result.scenarioOutputs["/project/features/example.feature:7"]?.includes("teardown failure"));
    assert.strictEqual(Object.keys(result.scenarioResults).length, 1);
  });
  test("rejects missing, malformed, duplicate and foreign identity without report-body diagnostics", () => {
    for (const report of ["{secret-report-marker", "[{}]", JSON.stringify([node("unknown")]),
      JSON.stringify([node("passed"), node("passed")]), JSON.stringify([{ ...node("passed"), featurePath: "/other/example.feature" }])]) {
      assert.throws(() => parsePytestCollectionReport(report, "/project"), (error: Error) => !error.message.includes("secret-report-marker"));
    }
  });
  test("bounds mapped nodes and retained details", () => {
    assert.throws(() => parsePytestCollectionReport(JSON.stringify(Array.from({ length: 10001 }, (_, index) => node("passed", String(index)))), "/project"), /10,000/u);
    assert.throws(() => parsePytestCollectionReport(JSON.stringify([node("failed", "one", "x".repeat(1024 * 1024 + 1))]), "/project"), /1 MiB/u);
  });
  test("folds 10,000 failed bindings on one row while retaining every detail once", () => {
    const records = Array.from({ length: 10000 }, (_, index) => node(index === 5000 ? "errored" : "failed", `binding-${index}`, `failure-${index}`));
    const result = parsePytestCollectionReport(JSON.stringify(records), "/project");
    assert.deepStrictEqual(result.scenarioResults, { "/project/features/example.feature:7": "errored" });
    assert.strictEqual(result.scenarioOutputs["/project/features/example.feature:7"],
      records.map((entry) => `${entry.nodeId}\n${entry.detail}\n`).join(""));
  });
});
