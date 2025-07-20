import * as assert from "assert";
import { TestExecutor } from "../../core/test-executor";

suite("Test Executor Scenario Outline Unit Tests", () => {
  let testExecutor: TestExecutor;

  setup(() => {
    // Create a fresh test executor instance for each test
    testExecutor = new TestExecutor();
  });

  test("Should detect scenario outline examples correctly", () => {
    // Test scenario outline example detection
    const isExample1 = (testExecutor as any).isScenarioOutlineExample(
      "/test/feature.feature",
      10,
      "1: Load testing with multiple users - user_count: 10, max_response_time: 2"
    );
    const isExample2 = (testExecutor as any).isScenarioOutlineExample(
      "/test/feature.feature",
      15,
      "2: Login with different credentials - username: admin, password: admin123, expected_result: dashboard"
    );
    const isRegularScenario = (testExecutor as any).isScenarioOutlineExample(
      "/test/feature.feature",
      5,
      "Basic smoke test"
    );
    const isUndefined = (testExecutor as any).isScenarioOutlineExample(
      "/test/feature.feature",
      5,
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
    const original1 = (testExecutor as any).extractOriginalOutlineName(
      "1: Load testing with multiple users - user_count: 10, max_response_time: 2"
    );
    const original2 = (testExecutor as any).extractOriginalOutlineName(
      "2: Login with different credentials - username: admin, password: admin123, expected_result: dashboard"
    );
    const regularScenario = (testExecutor as any).extractOriginalOutlineName(
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
    const original = (testExecutor as any).extractOriginalOutlineName(
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
    const original = (testExecutor as any).extractOriginalOutlineName(
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
    const emptyName = (testExecutor as any).isScenarioOutlineExample(
      "/test/feature.feature",
      5,
      ""
    );
    const nullName = (testExecutor as any).isScenarioOutlineExample(
      "/test/feature.feature",
      5,
      null as any
    );
    const malformedName = (testExecutor as any).isScenarioOutlineExample(
      "/test/feature.feature",
      5,
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
    const emptyName = (testExecutor as any).extractOriginalOutlineName("");
    const malformedName = (testExecutor as any).extractOriginalOutlineName(
      "Just a regular name without pattern"
    );
    const onlyNumber = (testExecutor as any).extractOriginalOutlineName(
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
});
