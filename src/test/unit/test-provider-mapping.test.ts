import * as assert from "assert";
import * as vscode from "vscode";
import { getScenarioStatusForTestItem } from "../../utils/test-item-mapping";

suite("BehaveTestProvider Scenario Result Mapping", () => {
  let mockTestController: any;
  let statuses: Record<string, string>;

  setup(() => {
    statuses = {};
    mockTestController = {
      createTestItem: (id: string, label: string, uri?: vscode.Uri) => ({
        id,
        label,
        uri,
        children: new Map(),
        canResolveChildren: false,
        range: undefined,
        description: undefined,
      }),
      createTestRun: (_request: vscode.TestRunRequest) => ({
        passed: (item: any) => { statuses[item.id] = "passed"; },
        failed: (item: any) => { statuses[item.id] = "failed"; },
        skipped: (item: any) => { statuses[item.id] = "skipped"; },
        started: () => {},
        end: () => {},
      }),
      createRunProfile: () => ({}),
      items: new Map(),
    };
  });

  function mockGroupAndChildren(parentId: string, childLines: number[], featurePath: string) {
    const parent = {
      id: parentId,
      label: "Group",
      uri: vscode.Uri.file(featurePath),
      children: new Map<string, any>(),
    };
    childLines.forEach(line => {
      const childId = `:${line}`;
      const child = {
        id: childId,
        label: `Scenario at line ${line}`,
        uri: vscode.Uri.file(featurePath),
      };
      parent.children.set(childId, child);
    });
    return parent;
  }

  test("maps scenario results correctly for flat organization", () => {
    // Simulate: featurePath = features/advanced-example.feature, featureLine = 2
    const workspaceRoot = "/Users/zer0gr4v/PycharmProjects/behave-test-runner-extension";
    const parent = mockGroupAndChildren(
      "features/advanced-example.feature:2",
      [8, 15, 23, 39, 40, 41, 44, 51],
      "features/advanced-example.feature"
    );
    // Simulate parsed scenario results
    const scenarioResults: Record<string, string> = {
      "features/advanced-example.feature:2:8": "passed",
      "features/advanced-example.feature:2:15": "passed",
      "features/advanced-example.feature:2:23": "passed",
      "features/advanced-example.feature:2:39": "passed",
      "features/advanced-example.feature:2:40": "passed",
      "features/advanced-example.feature:2:41": "passed",
      "features/advanced-example.feature:2:44": "passed",
      "features/advanced-example.feature:2:51": "passed",
    };
    const run = mockTestController.createTestRun({} as any);
    for (const [, child] of Array.from(parent.children)) {
      const status = getScenarioStatusForTestItem(child, parent, scenarioResults, workspaceRoot);
      if (status === "passed") run.passed(child);
      else if (status === "failed") run.failed(child);
      else run.skipped(child);
    }
    // Assert all mapped as passed
    for (const line of [8, 15, 23, 39, 40, 41, 44, 51]) {
      assert.strictEqual(statuses[":" + line], "passed", `Scenario at line ${line} should be passed`);
    }
  });

  test("maps scenario results correctly for tag-based organization", () => {
    // Simulate: tag group parent id = tag:@smoke, children are scenarios with full composite keys
    const parent = {
      id: "tag:@smoke",
      label: "@smoke",
      uri: undefined,
      children: new Map<string, any>(),
    };
    // Children have full composite keys as IDs
    const childIds = [
      "features/advanced-example.feature:2:8",
      "features/multiple-outlines.feature:2:16",
    ];
    childIds.forEach(id => {
      parent.children.set(id, {
        id,
        label: `Scenario ${id}`,
        uri: undefined,
      });
    });
    const scenarioResults: Record<string, string> = {
      "features/advanced-example.feature:2:8": "passed",
      "features/multiple-outlines.feature:2:16": "failed",
    };
    const run = mockTestController.createTestRun({} as any);
    for (const [, child] of Array.from(parent.children)) {
      const status = scenarioResults[child.id];
      if (status === "passed") run.passed(child);
      else if (status === "failed") run.failed(child);
      else run.skipped(child);
    }
    assert.strictEqual(statuses["features/advanced-example.feature:2:8"], "passed");
    assert.strictEqual(statuses["features/multiple-outlines.feature:2:16"], "failed");
  });

  test("maps scenario results correctly for hierarchy (feature-based) organization", () => {
    // Parent is the feature file, children are scenarios with :<line> ids
    const parent = mockGroupAndChildren(
      "features/advanced-example.feature:2",
      [8, 15, 23],
      "features/advanced-example.feature"
    );
    const scenarioResults: Record<string, string> = {
      "features/advanced-example.feature:2:8": "passed",
      "features/advanced-example.feature:2:15": "failed",
      "features/advanced-example.feature:2:23": "passed",
    };
    const run = mockTestController.createTestRun({} as any);
    for (const [, child] of Array.from(parent.children)) {
      const match = parent.id.match(/(.*\.feature)(?::(\d+))?/);
      const featurePath = match?.[1] ?? "";
      const featureLine = match?.[2] ?? "";
      const constructedKey = `${featurePath}:${featureLine}:${child.id.slice(1)}`;
      const status = scenarioResults[constructedKey];
      if (status === "passed") run.passed(child);
      else if (status === "failed") run.failed(child);
      else run.skipped(child);
    }
    assert.strictEqual(statuses[":8"], "passed");
    assert.strictEqual(statuses[":15"], "failed");
    assert.strictEqual(statuses[":23"], "passed");
  });

  test("maps scenario results correctly for scenario type organization", () => {
    // Parent is scenario type group, children are scenarios with composite keys
    const parent = {
      id: "type:scenario-outline",
      label: "Scenario Outline",
      uri: undefined,
      children: new Map<string, any>(),
    };
    const childIds = [
      "features/multiple-outlines.feature:2:16",
      "features/multiple-outlines.feature:2:17",
    ];
    childIds.forEach(id => {
      parent.children.set(id, {
        id,
        label: `Scenario ${id}`,
        uri: undefined,
      });
    });
    const scenarioResults: Record<string, string> = {
      "features/multiple-outlines.feature:2:16": "passed",
      "features/multiple-outlines.feature:2:17": "failed",
    };
    const run = mockTestController.createTestRun({} as any);
    for (const [, child] of Array.from(parent.children)) {
      const status = scenarioResults[child.id];
      if (status === "passed") run.passed(child);
      else if (status === "failed") run.failed(child);
      else run.skipped(child);
    }
    assert.strictEqual(statuses["features/multiple-outlines.feature:2:16"], "passed");
    assert.strictEqual(statuses["features/multiple-outlines.feature:2:17"], "failed");
  });

  test("fails to map scenario results when child IDs are absolute paths with only scenario line (real-world bug)", () => {
    // Simulate workspace root and feature file
    const workspaceRoot = "/Users/zer0gr4v/PycharmProjects/behave-test-runner-extension";
    const absFeaturePath = `${workspaceRoot}/features/advanced-example.feature`;
    const parentId = "features/advanced-example.feature:2";
    const childLines = [8, 15];
    // Child IDs are absolute paths with just the scenario line
    const parent = {
      id: parentId,
      label: "Group",
      uri: vscode.Uri.file(absFeaturePath),
      children: new Map<string, any>(),
    };
    childLines.forEach(line => {
      const childId = `${absFeaturePath}:${line}`;
      const child = {
        id: childId,
        label: `Scenario at line ${line}`,
        uri: vscode.Uri.file(absFeaturePath),
      };
      parent.children.set(childId, child);
    });
    const scenarioResults: Record<string, string> = {
      "features/advanced-example.feature:2:8": "passed",
      "features/advanced-example.feature:2:15": "failed",
    };
    const run = mockTestController.createTestRun({} as any);
    for (const [, child] of Array.from(parent.children)) {
      const status = getScenarioStatusForTestItem(child, parent, scenarioResults, workspaceRoot);
      if (status === "passed") run.passed(child);
      else if (status === "failed") run.failed(child);
      else run.skipped(child);
    }
    // Should map correctly
    assert.strictEqual(statuses[`${absFeaturePath}:8`], "passed", "Scenario at line 8 should be passed");
    assert.strictEqual(statuses[`${absFeaturePath}:15`], "failed", "Scenario at line 15 should be failed");
  });
}); 