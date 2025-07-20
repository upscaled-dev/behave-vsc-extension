import * as assert from "assert";
import { FeatureParser } from "../parsers/feature-parser.js";

suite("Parser Test Suite", () => {
  test("Should parse valid feature file", () => {
    const featureContent = `
Feature: Calculator
  In order to avoid silly mistakes
  As a math idiot
  I want to be told the sum of two numbers

  Scenario: Add two numbers
    Given I have entered 50 into the calculator
    And I have entered 70 into the calculator
    When I press add
    Then the result should be 120 on the screen

  Scenario: Add two negative numbers
    Given I have entered -10 into the calculator
    And I have entered -20 into the calculator
    When I press add
    Then the result should be -30 on the screen
`;

    const result = FeatureParser.parseFeatureContent(featureContent);

    assert.ok(result);
    assert.strictEqual(result?.feature, "Calculator");
    assert.strictEqual(result?.scenarios.length, 2);
    assert.strictEqual(result?.scenarios?.[0]?.name, "Add two numbers");
    assert.strictEqual(
      result?.scenarios?.[1]?.name,
      "Add two negative numbers"
    );
  });

  test("Should handle scenario outlines", () => {
    const featureContent = `
Feature: Calculator
  Scenario Outline: Add two numbers
    Given I have entered <a> into the calculator
    And I have entered <b> into the calculator
    When I press add
    Then the result should be <result> on the screen

    Examples:
      | a | b | result |
      | 1 | 2 | 3      |
      | 5 | 5 | 10     |
`;

    const result = FeatureParser.parseFeatureContent(featureContent);

    assert.ok(result);
    assert.strictEqual(result?.feature, "Calculator");
    assert.strictEqual(result?.scenarios.length, 2); // 2 Examples = 2 scenarios
    assert.strictEqual(
      result?.scenarios?.[0]?.name,
      "1: Add two numbers - a: 1, b: 2, result: 3"
    );
    assert.strictEqual(
      result?.scenarios?.[1]?.name,
      "2: Add two numbers - a: 5, b: 5, result: 10"
    );
  });

  test("Should handle Scenario Outline with Examples correctly", () => {
    const featureContent = `Feature: Scenario Outline Test
  Scenario: Regular scenario
    Given I am on a page
    When I do something
    Then I see a result

  Scenario Outline: Load testing with multiple users
    Given I have <user_count> concurrent users
    When they all access the application simultaneously
    Then the response time should be less than <max_response_time> seconds
    And the system should remain stable

    Examples:
      | user_count | max_response_time |
      | 10         | 2                 |
      | 50         | 5                 |
      | 100        | 10                |

  Scenario: Another regular scenario
    Given some condition
    When something happens
    Then something else should happen`;

    const result = FeatureParser.parseFeatureContent(featureContent);

    assert.ok(result, "Should parse feature content");
    assert.strictEqual(
      result.feature,
      "Scenario Outline Test",
      "Should have correct feature name"
    );

    // Should have 5 scenarios total: 1 regular + 3 from Scenario Outline + 1 regular
    assert.strictEqual(
      result.scenarios.length,
      5,
      "Should have 5 scenarios total"
    );

    // Check that Scenario Outline examples are properly expanded
    const scenarioNames = result.scenarios.map((s) => s.name);

    // Should have the regular scenarios
    assert.ok(
      scenarioNames.includes("Regular scenario"),
      "Should have first regular scenario"
    );
    assert.ok(
      scenarioNames.includes("Another regular scenario"),
      "Should have second regular scenario"
    );

    // Should have the expanded Scenario Outline scenarios
    assert.ok(
      scenarioNames.includes(
        "1: Load testing with multiple users - user_count: 10, max_response...: 2"
      ),
      "Should have first example"
    );
    assert.ok(
      scenarioNames.includes(
        "2: Load testing with multiple users - user_count: 50, max_response...: 5"
      ),
      "Should have second example"
    );
    assert.ok(
      scenarioNames.includes(
        "3: Load testing with multiple users - user_count: 100, max_response...: 10"
      ),
      "Should have third example"
    );
  });

  test("Should handle Scenario Outline without Examples", () => {
    const featureContent = `Feature: Scenario Outline Without Examples
  Scenario Outline: Test without examples
    Given I have a test
    When I run it
    Then it should work`;

    const result = FeatureParser.parseFeatureContent(featureContent);

    assert.ok(result, "Should parse feature content");
    assert.strictEqual(result.scenarios.length, 1, "Should have 1 scenario");
    assert.strictEqual(
      result.scenarios[0]?.name,
      "Test without examples",
      "Should have correct scenario name"
    );
  });

  test("Should return null for invalid feature file", () => {
    const invalidContent = `
# This is not a feature file
Some random content here
No Feature: line found
`;

    const result = FeatureParser.parseFeatureContent(invalidContent);
    assert.strictEqual(result, null);
  });

  test("Should generate CodeLenses for scenarios", () => {
    const featureContent = `
Feature: Calculator
  Scenario: Add two numbers
    Given I have entered 50 into the calculator
    And I have entered 70 into the calculator
    When I press add
    Then the result should be 120 on the screen

  Scenario Outline: Add two numbers
    Given I have entered <a> into the calculator
    When I press add
    Then the result should be <result> on the screen

    Examples:
      | a | result |
      | 1 | 1      |
`;

    const codeLenses = FeatureParser.provideScenarioCodeLenses(
      featureContent,
      "/test.feature"
    );

    // Should have:
    // - 1 regular scenario * 2 CodeLenses = 2
    // - 1 scenario outline * 2 CodeLenses = 2
    // - 1 example * 2 CodeLenses = 2
    // - 1 feature CodeLens = 1
    // Total: 7 CodeLenses
    assert.strictEqual(codeLenses.length, 7);

    // Check that CodeLenses have correct commands
    const runCommands = codeLenses.filter(
      (lens: any) => lens.command?.command === "behaveTestRunner.runScenario"
    );
    const debugCommands = codeLenses.filter(
      (lens: any) => lens.command?.command === "behaveTestRunner.debugScenario"
    );
    const featureCommands = codeLenses.filter(
      (lens: any) => lens.command?.command === "behaveTestRunner.runFeatureFile"
    );

    assert.strictEqual(runCommands.length, 3); // 1 regular + 1 outline + 1 example
    assert.strictEqual(debugCommands.length, 3); // 1 regular + 1 outline + 1 example
    assert.strictEqual(featureCommands.length, 1);
  });

  test("Should validate feature file extensions", () => {
    assert.strictEqual(
      FeatureParser.isValidFeatureFile("/path/to/test.feature"),
      true
    );
    assert.strictEqual(
      FeatureParser.isValidFeatureFile("/path/to/test.FEATURE"),
      true
    );
    assert.strictEqual(
      FeatureParser.isValidFeatureFile("/path/to/test.txt"),
      false
    );
    assert.strictEqual(
      FeatureParser.isValidFeatureFile("/path/to/test"),
      false
    );
  });

  test("Should handle empty feature content", () => {
    const result = FeatureParser.parseFeatureContent("");
    assert.strictEqual(result, null);
  });

  test("Should handle feature with no scenarios", () => {
    const featureContent = `
Feature: Empty Feature
  This feature has no scenarios
`;

    const result = FeatureParser.parseFeatureContent(featureContent);

    assert.ok(result);
    assert.strictEqual(result?.feature, "Empty Feature");
    assert.strictEqual(result?.scenarios.length, 0);
  });
});
