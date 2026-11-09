import * as assert from "assert";
import { BehaveCommandBuilder } from "../../core/command-builders/behave-command-builder";
import { ExtensionConfig } from "../../core/extension-config";
import { isScenarioOutlineExampleName, extractOutlineName } from "../../utils/scenario-outline";

suite("Test Executor Scenario Outline Unit Tests", () => {
  test("Should detect scenario outline examples correctly", () => {
    // Test scenario outline example detection
    const isExample1 = isScenarioOutlineExampleName(
      "1: Load testing with multiple users - user_count: 10, max_response_time: 2"
    );
    const isExample2 = isScenarioOutlineExampleName(
      "2: Login with different credentials - username: admin, password: admin123, expected_result: dashboard"
    );
    const isRegularScenario = isScenarioOutlineExampleName(
      "Basic smoke test"
    );
    const isUndefined = isScenarioOutlineExampleName(
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

  test("Should extract original outline name correctly", () => {
    // Test original outline name extraction
    const original1 = extractOutlineName(
      "1: Load testing with multiple users - user_count: 10, max_response_time: 2"
    );
    const original2 = extractOutlineName(
      "2: Login with different credentials - username: admin, password: admin123, expected_result: dashboard"
    );
    const regularScenario = extractOutlineName(
      "Basic smoke test"
    );

    assert.strictEqual(
      original1,
      "Load testing with multiple users",
      "Should extract correct outline name 1"
    );
    assert.strictEqual(
      original2,
      "Login with different credentials",
      "Should extract correct outline name 2"
    );
    assert.strictEqual(
      regularScenario,
      "Basic smoke test",
      "Should return original name for regular scenario"
    );
  });

  test("Should handle complex scenario outline names", () => {
    // Test with more complex scenario names
    const complexName =
      "1: API data validation with various input types - data_type: string, input_value: hello, validation_result: valid, status_code: 200";
    const original = extractOutlineName(
      complexName
    );

    assert.strictEqual(
      original,
      "API data validation with various input types",
      "Should extract correct outline name from complex scenario"
    );
  });

  test("Should handle scenario names with special characters", () => {
    // Test with scenario names containing special characters
    const specialName =
      "1: Test with \"quotes\" and 'apostrophes' - param1: value1, param2: value2";
    const original = extractOutlineName(
      specialName
    );

    assert.strictEqual(
      original,
      "Test with \"quotes\" and 'apostrophes'",
      "Should handle special characters in scenario names"
    );
  });

  test("Should handle edge cases in scenario outline detection", () => {
    // Test edge cases
    const emptyName = isScenarioOutlineExampleName(
      ""
    );
    const nullName = isScenarioOutlineExampleName(
      null as any
    );
    const malformedName = isScenarioOutlineExampleName(
      "Just a regular name without pattern"
    );

    assert.strictEqual(emptyName, false, "Should handle empty scenario name");
    assert.strictEqual(nullName, false, "Should handle null scenario name");
    assert.strictEqual(
      malformedName,
      false,
      "Should handle malformed scenario name"
    );
  });

  test("Should handle edge cases in outline name extraction", () => {
    // Test edge cases for name extraction
    const emptyName = extractOutlineName("");
    const malformedName = extractOutlineName(
      "Just a regular name without pattern"
    );
    const onlyNumber = extractOutlineName(
      "1: - param: value"
    );

    assert.strictEqual(emptyName, "", "Should handle empty scenario name");
    assert.strictEqual(
      malformedName,
      "Just a regular name without pattern",
      "Should handle malformed scenario name"
    );
    assert.strictEqual(
      onlyNumber,
      "1: - param: value",
      "Should return original name for malformed scenario outline example"
    );
  });

  test("outline and individual row use the builder's exact selection semantics", async () => {
    const builder = new BehaveCommandBuilder({ workingDirectory: "/project", getIntelligentBehaveCommand: async () => "behave", tags: "", dryRun: false } as unknown as ExtensionConfig);
    const outline = await builder.buildScenarioCommand({ filePath: "advanced.feature", scenarioName: "Load testing with multiple users" });
    assert.deepStrictEqual(outline.args, ["advanced.feature", "--name", "Load testing with multiple users", "-f", "pretty"]);
    const row = await builder.buildScenarioCommand({ filePath: "advanced.feature", lineNumber: 39, scenarioName: "1: Load testing with multiple users - users: 10" });
    assert.deepStrictEqual(row.args, ["advanced.feature:39", "-f", "pretty"]);
  });
});
