import * as assert from "assert";
import * as vscode from "vscode";
import {
  TestOrganizationManager,
  TagBasedOrganization,
  FileBasedOrganization,
  ScenarioTypeOrganization,
  FlatOrganization,
} from "../../core/test-organization";
import { Scenario, TestGroup } from "../../types";

suite("Test Organization Unit Tests", () => {
  let organizationManager: TestOrganizationManager;

  setup(() => {
    organizationManager = TestOrganizationManager.getInstance();
  });

  teardown(() => {
    // Reset to default strategy
    organizationManager.setStrategy(new TagBasedOrganization());
  });

  test("Should create singleton instance", () => {
    const instance1 = TestOrganizationManager.getInstance();
    const instance2 = TestOrganizationManager.getInstance();
    assert.strictEqual(instance1, instance2);
  });

  test("Should organize tests by tags", () => {
    const strategy = new TagBasedOrganization();
    const scenarios: Scenario[] = [
      {
        name: "Test Scenario 1",
        line: 5,
        lineNumber: 5,
        range: new vscode.Range(4, 0, 4, 0),
        steps: [],
        filePath: "test.feature",
        tags: ["@smoke", "@regression"],
        isScenarioOutline: false,
      },
      {
        name: "Test Scenario 2",
        line: 10,
        lineNumber: 10,
        range: new vscode.Range(9, 0, 9, 0),
        steps: [],
        filePath: "test.feature",
        tags: ["@smoke"],
        isScenarioOutline: false,
      },
      {
        name: "Test Scenario 3",
        line: 15,
        lineNumber: 15,
        range: new vscode.Range(14, 0, 14, 0),
        steps: [],
        filePath: "test.feature",
        tags: [],
        isScenarioOutline: false,
      },
    ];

    const groups = strategy.organizeTests(scenarios);

    assert.strictEqual(groups.length, 3); // @smoke, @regression, untagged
    assert.strictEqual(groups[0]?.scenarios.length, 2); // @smoke group
    assert.strictEqual(groups[1]?.scenarios.length, 1); // @regression group
    assert.strictEqual(groups[2]?.scenarios.length, 1); // untagged group
  });

  test("Should organize tests by file", () => {
    const strategy = new FileBasedOrganization();
    const scenarios: Scenario[] = [
      {
        name: "Test Scenario 1",
        line: 5,
        lineNumber: 5,
        range: new vscode.Range(4, 0, 4, 0),
        steps: [],
        filePath: "file1.feature",
        tags: [],
        isScenarioOutline: false,
      },
      {
        name: "Test Scenario 2",
        line: 10,
        lineNumber: 10,
        range: new vscode.Range(9, 0, 9, 0),
        steps: [],
        filePath: "file2.feature",
        tags: [],
        isScenarioOutline: false,
      },
      {
        name: "Test Scenario 3",
        line: 15,
        lineNumber: 15,
        range: new vscode.Range(14, 0, 14, 0),
        steps: [],
        filePath: "file1.feature",
        tags: [],
        isScenarioOutline: false,
      },
    ];

    const groups = strategy.organizeTests(scenarios);

    assert.strictEqual(groups.length, 2); // file1.feature, file2.feature
    assert.strictEqual(groups[0]?.scenarios.length, 2); // file1.feature
    assert.strictEqual(groups[1]?.scenarios.length, 1); // file2.feature
  });

  test("Should organize tests by scenario type", () => {
    const strategy = new ScenarioTypeOrganization();
    const scenarios: Scenario[] = [
      {
        name: "Regular Scenario 1",
        line: 5,
        lineNumber: 5,
        range: new vscode.Range(4, 0, 4, 0),
        steps: [],
        filePath: "test.feature",
        tags: [],
        isScenarioOutline: false,
      },
      {
        name: "Regular Scenario 2",
        line: 10,
        lineNumber: 10,
        range: new vscode.Range(9, 0, 9, 0),
        steps: [],
        filePath: "test.feature",
        tags: [],
        isScenarioOutline: false,
      },
      {
        name: "Outline Scenario",
        line: 15,
        lineNumber: 15,
        range: new vscode.Range(14, 0, 14, 0),
        steps: [],
        filePath: "test.feature",
        tags: [],
        isScenarioOutline: true,
      },
    ];

    const groups = strategy.organizeTests(scenarios);

    assert.strictEqual(groups.length, 2); // Regular Scenarios, Scenario Outlines
    assert.strictEqual(groups[0]?.scenarios.length, 2); // Regular scenarios
    assert.strictEqual(groups[1]?.scenarios.length, 1); // Scenario outlines
  });

  test("Should use flat organization", () => {
    const strategy = new FlatOrganization();
    const scenarios: Scenario[] = [
      {
        name: "Test Scenario 1",
        line: 5,
        lineNumber: 5,
        range: new vscode.Range(4, 0, 4, 0),
        steps: [],
        filePath: "test.feature",
        tags: ["@smoke"],
        isScenarioOutline: false,
      },
      {
        name: "Test Scenario 2",
        line: 10,
        lineNumber: 10,
        range: new vscode.Range(9, 0, 9, 0),
        steps: [],
        filePath: "test.feature",
        tags: ["@regression"],
        isScenarioOutline: true,
      },
    ];

    const groups = strategy.organizeTests(scenarios);

    assert.strictEqual(groups.length, 1); // All scenarios in one group
    assert.strictEqual(groups[0]?.scenarios.length, 2);
    assert.strictEqual(groups[0]?.label, "All Scenarios");
  });

  test("Should change organization strategy", () => {
    const originalStrategy = organizationManager.getStrategy();
    const newStrategy = new FileBasedOrganization();

    organizationManager.setStrategy(newStrategy);

    assert.strictEqual(organizationManager.getStrategy(), newStrategy);
    assert.notStrictEqual(organizationManager.getStrategy(), originalStrategy);
  });

  test("Should get available strategies", () => {
    const strategies = organizationManager.getAvailableStrategies();

    assert.strictEqual(strategies.length, 5);
    assert.strictEqual(strategies[0]?.name, "Feature-based (Hierarchical)");
    assert.strictEqual(strategies[1]?.name, "Tag-based");
    assert.strictEqual(strategies[2]?.name, "File-based");
    assert.strictEqual(strategies[3]?.name, "Scenario Type");
    assert.strictEqual(strategies[4]?.name, "Flat");
  });

  test("Should handle empty scenarios array", () => {
    const strategy = new TagBasedOrganization();
    const groups = strategy.organizeTests([]);

    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0]?.scenarios.length, 0);
    assert.strictEqual(groups[0]?.label, "All Scenarios");
  });

  test("Should handle scenarios with no tags", () => {
    const strategy = new TagBasedOrganization();
    const scenarios: Scenario[] = [
      {
        name: "Test Scenario 1",
        line: 5,
        lineNumber: 5,
        range: new vscode.Range(4, 0, 4, 0),
        steps: [],
        filePath: "test.feature",
        tags: [],
        isScenarioOutline: false,
      },
      {
        name: "Test Scenario 2",
        line: 10,
        lineNumber: 10,
        range: new vscode.Range(9, 0, 9, 0),
        steps: [],
        filePath: "test.feature",
        tags: [],
        isScenarioOutline: false,
      },
    ];

    const groups = strategy.organizeTests(scenarios);

    assert.strictEqual(groups.length, 1); // Only untagged group
    assert.strictEqual(groups[0]?.label, "Untagged");
    assert.strictEqual(groups[0]?.scenarios.length, 2);
  });

  test("Should handle mixed scenario types", () => {
    const strategy = new ScenarioTypeOrganization();
    const scenarios: Scenario[] = [
      {
        name: "Regular Scenario",
        line: 5,
        lineNumber: 5,
        range: new vscode.Range(4, 0, 4, 0),
        steps: [],
        filePath: "test.feature",
        tags: [],
        isScenarioOutline: false,
      },
      {
        name: "Outline Scenario",
        line: 10,
        lineNumber: 10,
        range: new vscode.Range(9, 0, 9, 0),
        steps: [],
        filePath: "test.feature",
        tags: [],
        isScenarioOutline: true,
      },
    ];

    const groups = strategy.organizeTests(scenarios);

    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[0]?.label, "Regular Scenarios");
    assert.strictEqual(groups[1]?.label, "Scenario Outlines");
  });

  test("Should provide group labels and descriptions", () => {
    const strategy = new TagBasedOrganization();
    const group: TestGroup = {
      id: "test-group",
      label: "Test Group",
      description: "Test Description",
      scenarios: [],
    };

    const label = strategy.getGroupLabel(group);
    const description = strategy.getGroupDescription(group);

    assert.strictEqual(label, "Test Group");
    assert.strictEqual(description, "Test Description");
  });
});
