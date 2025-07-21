import * as assert from "assert";
import { TestOrganizationManager } from "../../core/test-organization";
import {
  TagBasedOrganization,
  FileBasedOrganization,
  ScenarioTypeOrganization,
  FlatOrganization,
} from "../../core/test-organization";
import { Scenario } from "../../types";

suite("Organization Strategies Unit Tests", () => {
  let organizationManager: TestOrganizationManager;

  setup(() => {
    // Get a fresh instance for each test
    organizationManager = TestOrganizationManager.getInstance();
  });

  teardown(() => {
    // Reset to default strategy
    organizationManager.setStrategy(new TagBasedOrganization());
  });

  // Helper function to create test scenarios
  function createTestScenarios(): Scenario[] {
    return [
      {
        name: "First scenario",
        lineNumber: 5,
        line: 5,
        range: {
          start: { line: 4, character: 0 },
          end: { line: 4, character: 0 },
        } as any,
        steps: [],
        tags: ["@smoke", "@regression"],
        filePath: "/test/feature1.feature",
        isScenarioOutline: false,
      },
      {
        name: "Second scenario",
        lineNumber: 10,
        line: 10,
        range: {
          start: { line: 9, character: 0 },
          end: { line: 9, character: 0 },
        } as any,
        steps: [],
        tags: ["@smoke"],
        filePath: "/test/feature1.feature",
        isScenarioOutline: false,
      },
      {
        name: "Third scenario",
        lineNumber: 15,
        line: 15,
        range: {
          start: { line: 14, character: 0 },
          end: { line: 14, character: 0 },
        } as any,
        steps: [],
        tags: ["@regression"],
        filePath: "/test/feature2.feature",
        isScenarioOutline: false,
      },
      {
        name: "Outline scenario",
        lineNumber: 20,
        line: 20,
        range: {
          start: { line: 19, character: 0 },
          end: { line: 19, character: 0 },
        } as any,
        steps: [],
        tags: ["@outline"],
        filePath: "/test/feature1.feature",
        isScenarioOutline: true,
      },
      {
        name: "Example 1",
        lineNumber: 25,
        line: 25,
        range: {
          start: { line: 24, character: 0 },
          end: { line: 24, character: 0 },
        } as any,
        steps: [],
        tags: ["@outline"],
        filePath: "/test/feature1.feature",
        isScenarioOutline: false,
      },
      {
        name: "Example 2",
        lineNumber: 30,
        line: 30,
        range: {
          start: { line: 29, character: 0 },
          end: { line: 29, character: 0 },
        } as any,
        steps: [],
        tags: ["@outline"],
        filePath: "/test/feature1.feature",
        isScenarioOutline: false,
      },
    ];
  }

  test("Should start with TagBasedOrganization as default", () => {
    const currentStrategy = organizationManager.getStrategy();
    assert.strictEqual(
      currentStrategy.constructor.name,
      "TagBasedOrganization",
      "Default strategy should be TagBasedOrganization"
    );
  });

  test("Should be able to switch to FileBasedOrganization", () => {
    organizationManager.setStrategy(new FileBasedOrganization());
    const currentStrategy = organizationManager.getStrategy();
    assert.strictEqual(
      currentStrategy.constructor.name,
      "FileBasedOrganization",
      "Strategy should be FileBasedOrganization"
    );
  });

  test("Should be able to switch to ScenarioTypeOrganization", () => {
    organizationManager.setStrategy(new ScenarioTypeOrganization());
    const currentStrategy = organizationManager.getStrategy();
    assert.strictEqual(
      currentStrategy.constructor.name,
      "ScenarioTypeOrganization",
      "Strategy should be ScenarioTypeOrganization"
    );
  });

  test("Should be able to switch to FlatOrganization", () => {
    organizationManager.setStrategy(new FlatOrganization());
    const currentStrategy = organizationManager.getStrategy();
    assert.strictEqual(
      currentStrategy.constructor.name,
      "FlatOrganization",
      "Strategy should be FlatOrganization"
    );
  });

  test("TagBasedOrganization should group scenarios by tags", () => {
    organizationManager.setStrategy(new TagBasedOrganization());
    const scenarios = createTestScenarios();
    const organizedGroups = organizationManager.organizeTests(scenarios);

    // Should have groups for each unique tag combination
    const groupLabels = organizedGroups.map((group) => group.label);

    // Should have groups for: @smoke, @regression, @outline (with @ symbol)
    assert.ok(groupLabels.includes("@smoke"), "Should have @smoke group");
    assert.ok(
      groupLabels.includes("@regression"),
      "Should have @regression group"
    );
    assert.ok(groupLabels.includes("@outline"), "Should have @outline group");

    // Check that scenarios are properly grouped
    const smokeGroup = organizedGroups.find(
      (group) => group.label === "@smoke"
    );
    assert.ok(smokeGroup, "@smoke group should exist");
    assert.strictEqual(
      smokeGroup.scenarios.length,
      2,
      "@smoke group should have 2 scenarios"
    );

    const regressionGroup = organizedGroups.find(
      (group) => group.label === "@regression"
    );
    assert.ok(regressionGroup, "@regression group should exist");
    assert.strictEqual(
      regressionGroup.scenarios.length,
      2,
      "@regression group should have 2 scenarios"
    );
  });

  test("FileBasedOrganization should group scenarios by file", () => {
    organizationManager.setStrategy(new FileBasedOrganization());
    const scenarios = createTestScenarios();
    const organizedGroups = organizationManager.organizeTests(scenarios);

    const groupLabels = organizedGroups.map((group) => group.label);

    // Should have groups for each file
    assert.ok(
      groupLabels.includes("feature1.feature"),
      "Should have feature1 group"
    );
    assert.ok(
      groupLabels.includes("feature2.feature"),
      "Should have feature2 group"
    );

    // Check that scenarios are properly grouped by file
    const feature1Group = organizedGroups.find(
      (group) => group.label === "feature1.feature"
    );
    assert.ok(feature1Group, "Feature1 group should exist");
    assert.strictEqual(
      feature1Group.scenarios.length,
      5,
      "Feature1 should have 5 scenarios"
    );

    const feature2Group = organizedGroups.find(
      (group) => group.label === "feature2.feature"
    );
    assert.ok(feature2Group, "Feature2 group should exist");
    assert.strictEqual(
      feature2Group.scenarios.length,
      1,
      "Feature2 should have 1 scenario"
    );
  });

  test("ScenarioTypeOrganization should group by scenario type", () => {
    organizationManager.setStrategy(new ScenarioTypeOrganization());
    const scenarios = createTestScenarios();
    const organizedGroups = organizationManager.organizeTests(scenarios);

    const groupLabels = organizedGroups.map((group) => group.label);

    // Should have groups for regular scenarios and outlines
    assert.ok(
      groupLabels.includes("Regular Scenarios"),
      "Should have regular scenarios group"
    );
    assert.ok(
      groupLabels.includes("Scenario Outlines"),
      "Should have outlines group"
    );

    // Check that scenarios are properly grouped by type
    const regularGroup = organizedGroups.find(
      (group) => group.label === "Regular Scenarios"
    );
    assert.ok(regularGroup, "Regular scenarios group should exist");
    assert.strictEqual(
      regularGroup.scenarios.length,
      5,
      "Should have 5 regular scenarios"
    );

    const outlineGroup = organizedGroups.find(
      (group) => group.label === "Scenario Outlines"
    );
    assert.ok(outlineGroup, "Outlines group should exist");
    assert.strictEqual(
      outlineGroup.scenarios.length,
      1,
      "Should have 1 outline scenario"
    );
  });

  test("FlatOrganization should not group scenarios", () => {
    organizationManager.setStrategy(new FlatOrganization());
    const scenarios = createTestScenarios();
    const organizedGroups = organizationManager.organizeTests(scenarios);

    // Should have only one group containing all scenarios
    assert.strictEqual(organizedGroups.length, 1, "Should have only one group");
    assert.ok(organizedGroups[0], "First group should exist");
    assert.strictEqual(
      organizedGroups[0].label,
      "All Scenarios",
      "Group should be named 'All Scenarios'"
    );
    assert.strictEqual(
      organizedGroups[0].scenarios.length,
      6,
      "Should contain all 6 scenarios"
    );
  });

  test("TagBasedOrganization should show full tag names with @ symbol", () => {
    organizationManager.setStrategy(new TagBasedOrganization());
    const scenarios = createTestScenarios();
    const organizedGroups = organizationManager.organizeTests(scenarios);

    // Should have groups for each unique tag
    const groupLabels = organizedGroups.map((group) => group.label);

    // Should have groups with full tag names including @ symbol
    assert.ok(groupLabels.includes("@smoke"), "Should have @smoke group");
    assert.ok(
      groupLabels.includes("@regression"),
      "Should have @regression group"
    );
    assert.ok(groupLabels.includes("@outline"), "Should have @outline group");

    // Check that scenarios are properly grouped
    const smokeGroup = organizedGroups.find(
      (group) => group.label === "@smoke"
    );
    assert.ok(smokeGroup, "@smoke group should exist");
    assert.strictEqual(
      smokeGroup.scenarios.length,
      2,
      "@smoke group should have 2 scenarios"
    );

    const regressionGroup = organizedGroups.find(
      (group) => group.label === "@regression"
    );
    assert.ok(regressionGroup, "@regression group should exist");
    assert.strictEqual(
      regressionGroup.scenarios.length,
      2,
      "@regression group should have 2 scenarios"
    );
  });

  test("Should get available strategies", () => {
    const availableStrategies = organizationManager.getAvailableStrategies();

    assert.ok(Array.isArray(availableStrategies), "Should return an array");
    assert.ok(
      availableStrategies.length >= 4,
      "Should have at least 4 strategies"
    );

    const strategyNames = availableStrategies.map((s) => s.name);
    assert.ok(
      strategyNames.includes("Tag-based"),
      "Should include Tag-based strategy"
    );
    assert.ok(
      strategyNames.includes("File-based"),
      "Should include File-based strategy"
    );
    assert.ok(
      strategyNames.includes("Scenario Type"),
      "Should include Scenario Type strategy"
    );
    assert.ok(strategyNames.includes("Flat"), "Should include Flat strategy");
  });

  test("Should find strategy by value", () => {
    const availableStrategies = organizationManager.getAvailableStrategies();

    const tagStrategy = availableStrategies.find((s) =>
      s.name.toLowerCase().includes("tag")
    );
    assert.ok(tagStrategy, "Should find tag strategy");
    assert.strictEqual(
      tagStrategy.strategy.constructor.name,
      "TagBasedOrganization"
    );

    const fileStrategy = availableStrategies.find((s) =>
      s.name.toLowerCase().includes("file")
    );
    assert.ok(fileStrategy, "Should find file strategy");
    assert.strictEqual(
      fileStrategy.strategy.constructor.name,
      "FileBasedOrganization"
    );
  });
});
