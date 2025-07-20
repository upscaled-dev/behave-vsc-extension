import * as assert from "assert";
import * as vscode from "vscode";
import { BehaveTestProvider } from "../../test-providers/behave-test-provider";

suite("Test Provider Scenario Outline Unit Tests", () => {
  let testProvider: BehaveTestProvider;
  let mockTestController: any;

  setup(() => {
    // Create a mock test controller
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
        started: () => {},
        passed: () => {},
        failed: () => {},
        end: () => {},
      }),
      createRunProfile: (
        _label: string,
        _kind: vscode.TestRunProfileKind,
        _handler: any
      ) => ({
        configureHandler: () => {},
      }),
      items: new Map(),
    };

    // Create a test provider instance
    testProvider = new BehaveTestProvider(mockTestController);
  });

  test("Should detect scenario outline examples correctly", () => {
    // Test scenario outline example detection
    const isExample1 = (testProvider as any).isScenarioOutlineExample(
      "1: Load testing with multiple users - user_count: 10, max_response_time: 2"
    );
    const isExample2 = (testProvider as any).isScenarioOutlineExample(
      "2: Login with different credentials - username: admin, password: admin123, expected_result: dashboard"
    );
    const isRegularScenario = (testProvider as any).isScenarioOutlineExample(
      "Basic smoke test"
    );
    const isUndefined = (testProvider as any).isScenarioOutlineExample(
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
    const original1 = (testProvider as any).extractOriginalOutlineName(
      "1: Load testing with multiple users - user_count: 10, max_response_time: 2"
    );
    const original2 = (testProvider as any).extractOriginalOutlineName(
      "2: Login with different credentials - username: admin, password: admin123, expected_result: dashboard"
    );
    const regularScenario = (testProvider as any).extractOriginalOutlineName(
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
    const original = (testProvider as any).extractOriginalOutlineName(
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
    const original = (testProvider as any).extractOriginalOutlineName(
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
    const emptyName = (testProvider as any).isScenarioOutlineExample("");
    const nullName = (testProvider as any).isScenarioOutlineExample(
      null as any
    );
    const malformedName = (testProvider as any).isScenarioOutlineExample(
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
    const emptyName = (testProvider as any).extractOriginalOutlineName("");
    const malformedName = (testProvider as any).extractOriginalOutlineName(
      "Just a regular name without pattern"
    );
    const onlyNumber = (testProvider as any).extractOriginalOutlineName(
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

  test("Should group scenarios by outline correctly", () => {
    // Test scenario grouping functionality
    const scenarios = [
      {
        name: "1: Load testing with multiple users - user_count: 10, max_response_time: 2",
        lineNumber: 10,
        isScenarioOutline: true,
      },
      {
        name: "2: Load testing with multiple users - user_count: 50, max_response_time: 5",
        lineNumber: 15,
        isScenarioOutline: true,
      },
      {
        name: "Basic smoke test",
        lineNumber: 5,
        isScenarioOutline: false,
      },
    ];

    const groups = (testProvider as any).groupScenariosByOutline(scenarios);

    assert.strictEqual(groups.size, 2, "Should create 2 groups");
    assert.ok(
      groups.has("Load testing with multiple users"),
      "Should have outline group"
    );
    assert.ok(
      groups.has("scenario_5_Basic_smoke_test"),
      "Should have regular scenario group"
    );

    const outlineGroup = groups.get("Load testing with multiple users");
    assert.strictEqual(
      outlineGroup?.length,
      2,
      "Should have 2 examples in outline group"
    );
  });
});
