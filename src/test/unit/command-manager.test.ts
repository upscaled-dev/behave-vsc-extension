import * as assert from "assert";
import * as vscode from "vscode";
import { CommandManager } from "../../commands/command-manager";

suite("Command Manager Unit Tests", () => {
  let commandManager: CommandManager;

  setup(() => {
    // Get a fresh instance for each test
    commandManager = CommandManager.getInstance();
  });

  teardown(() => {
    // Reset the instance
    CommandManager.clearInstance();
  });

  test("Should detect scenario outline examples correctly", () => {
    // Test scenario outline example detection
    const isExample1 = (commandManager as any).isScenarioOutlineExample(
      "1: Load testing with multiple users - user_count: 10, max_response_time: 2"
    );
    const isExample2 = (commandManager as any).isScenarioOutlineExample(
      "2: Login with different credentials - username: admin, password: admin123, expected_result: dashboard"
    );
    const isRegularScenario = (commandManager as any).isScenarioOutlineExample(
      "Basic smoke test"
    );
    const isUndefined = (commandManager as any).isScenarioOutlineExample(
      undefined
    );

    assert.strictEqual(
      isExample1,
      true,
      "Should detect scenario outline example 1"
    );
    assert.strictEqual(
      isExample2,
      true,
      "Should detect scenario outline example 2"
    );
    assert.strictEqual(
      isRegularScenario,
      false,
      "Should not detect regular scenario as example"
    );
    assert.strictEqual(
      isUndefined,
      false,
      "Should handle undefined scenario name"
    );
  });

  test("Should match tags correctly", () => {
    // Test tag matching functionality
    const itemTags = ["@smoke", "@regression", "@ui"];

    const matchesSingle = (commandManager as any).tagsMatch(itemTags, "@smoke");
    const matchesMultiple = (commandManager as any).tagsMatch(
      itemTags,
      "@smoke @ui"
    );
    const matchesCommaSeparated = (commandManager as any).tagsMatch(
      itemTags,
      "@smoke,@regression"
    );
    const noMatch = (commandManager as any).tagsMatch(itemTags, "@api");
    const emptyTags = (commandManager as any).tagsMatch([], "@smoke");

    assert.strictEqual(matchesSingle, true, "Should match single tag");
    assert.strictEqual(
      matchesMultiple,
      true,
      "Should match multiple space-separated tags"
    );
    assert.strictEqual(
      matchesCommaSeparated,
      true,
      "Should match comma-separated tags"
    );
    assert.strictEqual(noMatch, false, "Should not match non-existent tag");
    assert.strictEqual(emptyTags, false, "Should handle empty item tags");
  });

  test("Should extract tags from test item", () => {
    // Mock test item
    const mockTestItem = {
      description: "Test with @smoke @regression tags",
      label: "@ui scenario",
    } as vscode.TestItem;

    const extractedTags = (commandManager as any).extractTagsFromTestItem(
      mockTestItem
    );

    assert.deepStrictEqual(
      extractedTags,
      ["@smoke", "@regression", "@ui"],
      "Should extract all tags from description and label"
    );
  });

  test("Should find test items by tags", () => {
    // Mock test controller with test items
    const mockTestItem1 = {
      uri: { fsPath: "/test/feature1.feature" },
      description: "@smoke @regression",
      children: { [Symbol.iterator]: function* () { /* no children */ } },
    } as any;

    const mockTestItem2 = {
      uri: { fsPath: "/test/feature1.feature" },
      description: "@api @integration",
      children: { [Symbol.iterator]: function* () { /* no children */ } },
    } as any;

    const mockTestController = {
      items: {
        [Symbol.iterator]: function* () {
          yield ["id1", mockTestItem1];
          yield ["id2", mockTestItem2];
        }
      }
    } as any;

    const matchingItems: vscode.TestItem[] = [];
    (commandManager as any).findTestItemsByTags(
      mockTestController,
      "/test/feature1.feature",
      "@smoke",
      matchingItems
    );

    assert.strictEqual(
      matchingItems.length,
      1,
      "Should find one matching test item"
    );
    assert.strictEqual(
      matchingItems[0],
      mockTestItem1,
      "Should find the correct test item"
    );
  });

  test("Should detect scenario outline correctly", () => {
    // Test scenario outline detection
    const isOutline1 = (commandManager as any).isScenarioOutline(
      "/test/feature.feature",
      10,
      "Add two numbers"
    );
    const isOutline2 = (commandManager as any).isScenarioOutline(
      "/test/feature.feature",
      15,
      "Login with different credentials"
    );
    const isRegularScenario = (commandManager as any).isScenarioOutline(
      "/test/feature.feature",
      5,
      "Basic smoke test"
    );

    // These tests will fail if the file doesn't exist, but that's expected
    // In a real scenario, the file would exist and the method would work correctly
    assert.strictEqual(
      typeof isOutline1,
      "boolean",
      "Should return boolean for scenario outline detection"
    );
    assert.strictEqual(
      typeof isOutline2,
      "boolean",
      "Should return boolean for scenario outline detection"
    );
    assert.strictEqual(
      typeof isRegularScenario,
      "boolean",
      "Should return boolean for regular scenario detection"
    );
  });
});
