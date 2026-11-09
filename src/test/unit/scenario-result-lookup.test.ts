import * as assert from "assert";
import * as vscode from "vscode";
import { ScenarioResultLookup, TestItemMapping } from "../../utils/test-item-mapping";

suite("ScenarioResultLookup Unit Tests", () => {
  const workspaceRoot = "/work/space";

  test("resolves the exact constructed key (parent feature line + child line)", () => {
    const lookup = new ScenarioResultLookup(
      { "features/login.feature:2:8": "passed" },
      workspaceRoot
    );
    const status = lookup.get(
      { id: ":8" },
      { id: "features/login.feature:2" }
    );
    assert.strictEqual(status, "passed");
  });

  test("falls back to file + scenario line when the feature line differs", () => {
    // Result was keyed with feature line 3, but the tree thinks it's line 2.
    const lookup = new ScenarioResultLookup(
      { "features/login.feature:3:8": "failed" },
      workspaceRoot
    );
    const status = lookup.get(
      { id: ":8" },
      { id: "features/login.feature:2" }
    );
    assert.strictEqual(status, "failed");
  });

  test("relativizes absolute child ids against the workspace root", () => {
    const lookup = new ScenarioResultLookup(
      { "features/login.feature:2:8": "passed" },
      workspaceRoot
    );
    const status = lookup.get(
      { id: `${workspaceRoot}/features/login.feature:8` },
      { id: "features/login.feature:2" }
    );
    assert.strictEqual(status, "passed");
  });

  test("unique-suffix fallback matches when the child path is a suffix of the key path", () => {
    // Result key is rooted deeper (tests/...) than the workspace-relative
    // child path; only the unique includes() fallback can reconcile them.
    const lookup = new ScenarioResultLookup(
      { "tests/features/login.feature:12": "failed" },
      workspaceRoot
    );
    const status = lookup.get(
      { id: `${workspaceRoot}/features/login.feature:12` },
      { id: "group:all" }
    );
    assert.strictEqual(status, "failed");
  });

  test("unique-suffix fallback refuses ambiguous matches", () => {
    const lookup = new ScenarioResultLookup(
      {
        "a/features/login.feature:12": "passed",
        "b/features/login.feature:12": "failed",
      },
      workspaceRoot
    );
    const status = lookup.get(
      { id: `${workspaceRoot}/features/login.feature:12` },
      { id: "group:all" }
    );
    assert.strictEqual(status, undefined);
  });

  test("does not match a different line on the same file", () => {
    const lookup = new ScenarioResultLookup(
      { "features/login.feature:2:112": "passed" },
      workspaceRoot
    );
    const status = lookup.get(
      { id: ":12" },
      { id: "features/login.feature:2" }
    );
    assert.strictEqual(status, undefined);
  });

  test("resolves outline keys via the composite child id", () => {
    const lookup = new ScenarioResultLookup(
      { "features/login.feature:outline:Login flow": "passed" },
      workspaceRoot
    );
    const status = lookup.get(
      { id: `${workspaceRoot}/features/login.feature:outline:Login flow` },
      { id: "features/login.feature:2" }
    );
    assert.strictEqual(status, "passed");
  });

  test("createLookup agrees with getScenarioStatusForTestItem", () => {
    const results = {
      "features/a.feature:2:8": "passed",
      "features/a.feature:3:15": "failed",
      "features/b.feature:10": "passed",
    };
    const mapping = TestItemMapping.create();
    const lookup = mapping.createLookup(results, workspaceRoot);

    const cases: Array<[{ id: string; uri?: vscode.Uri }, { id: string }]> = [
      [{ id: ":8" }, { id: "features/a.feature:2" }],
      [{ id: ":15" }, { id: "features/a.feature:2" }],
      [{ id: `${workspaceRoot}/features/b.feature:10` }, { id: "features/b.feature" }],
      [{ id: ":99" }, { id: "features/a.feature:2" }],
    ];
    for (const [child, parent] of cases) {
      assert.strictEqual(
        lookup.get(child, parent),
        mapping.getScenarioStatusForTestItem(child, parent, results, workspaceRoot),
        `lookup and one-shot matcher disagree for ${child.id}`
      );
    }
  });
});
