import * as assert from "assert";
import { FeatureParser } from "../../parsers/feature-parser.js";

suite("FeatureParser Unit Tests", () => {
  test("Should parse valid feature file with scenarios", () => {
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
    assert.strictEqual(result?.scenarios[0]?.name, "Add two numbers");
    assert.strictEqual(result?.scenarios[1]?.name, "Add two negative numbers");
    assert.strictEqual(result?.scenarios[0]?.line, 7); // Line 7 because content starts with newline
    assert.strictEqual(result?.scenarios[1]?.line, 13); // Line 13 because content starts with newline
  });

  test("Should parse scenario outlines correctly", () => {
    const featureContent = `
Feature: Login Tests
  Scenario Outline: Login with different credentials
    Given I am on the login page
    When I enter "<username>" and "<password>"
    Then I should see "<result>"

    Examples:
      | username | password | result |
      | admin    | secret   | success |
      | user     | wrong    | error |
`;

    const result = FeatureParser.parseFeatureContent(featureContent);

    assert.ok(result);
    assert.strictEqual(result?.feature, "Login Tests");
    assert.strictEqual(result?.scenarios.length, 2); // 2 individual scenarios (one for each example)
    assert.strictEqual(
      result?.scenarios[0]?.name,
      "1: Login with different credentials - username: admin, password: secret, result: success"
    );
    assert.strictEqual(
      result?.scenarios[1]?.name,
      "2: Login with different credentials - username: user, password: wrong, result: error"
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

  test("Should return null for empty content", () => {
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

  test("Should generate CodeLenses for scenarios", () => {
    const featureContent = `
Feature: Calculator
  Scenario: Add two numbers
    Given I have entered 50 into the calculator
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
      (lens) => lens.command?.command === "behaveTestRunner.runScenario"
    );
    const debugCommands = codeLenses.filter(
      (lens) => lens.command?.command === "behaveTestRunner.debugScenario"
    );
    const featureCommands = codeLenses.filter(
      (lens) => lens.command?.command === "behaveTestRunner.runFeatureFile"
    );

    assert.strictEqual(runCommands.length, 3); // 1 regular + 1 outline + 1 example
    assert.strictEqual(debugCommands.length, 3); // 1 regular + 1 outline + 1 example
    assert.strictEqual(featureCommands.length, 1);

    // Check command arguments
    const firstRunCommand = runCommands[0];
    assert.strictEqual(firstRunCommand?.command?.arguments?.length, 3);
    assert.strictEqual(
      firstRunCommand?.command?.arguments?.[0],
      "/test.feature"
    );
    assert.strictEqual(
      typeof firstRunCommand?.command?.arguments?.[1],
      "number"
    );
    assert.strictEqual(
      typeof firstRunCommand?.command?.arguments?.[2],
      "string"
    );
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
    assert.strictEqual(FeatureParser.isValidFeatureFile(""), false);
  });

  test("Should handle complex scenario outlines with multiple examples", () => {
    const featureContent = `
Feature: Shopping Cart
  Scenario Outline: Add items to cart
    Given I am on the product page
    When I add "<item>" to cart
    Then the cart should contain "<item>"

    Examples:
      | item |
      | apple |
      | banana |
      | orange |
      | book |
      | pen |
`;

    const result = FeatureParser.parseFeatureContent(featureContent);

    assert.ok(result);
    assert.strictEqual(result?.feature, "Shopping Cart");
    assert.strictEqual(result?.scenarios.length, 5); // 5 individual scenarios (one for each example)
  });

  test("Should handle scenarios with special characters in names", () => {
    const featureContent = `
Feature: Special Characters
  Scenario: Test with "quotes" and 'apostrophes'
    Given I have a test
    When I run it
    Then it should work

  Scenario: Test with numbers 123 and symbols @#$%
    Given I have another test
    When I run it
    Then it should also work
`;

    const result = FeatureParser.parseFeatureContent(featureContent);

    assert.ok(result);
    assert.strictEqual(result?.scenarios.length, 2);
    assert.strictEqual(
      result?.scenarios[0]?.name,
      "Test with \"quotes\" and 'apostrophes'"
    );
    assert.strictEqual(
      result?.scenarios[1]?.name,
      "Test with numbers 123 and symbols @#$%"
    );
  });

  test("Should handle malformed feature content gracefully", () => {
    const malformedContent = `
Feature: Test
  Scenario: Test
    Given I have a test
    When I run it
    Then it should work

  Scenario: Another test
    Given I have another test
    When I run it
    Then it should also work

  # This is a comment
  Background:
    Given I am logged in

  # Another comment
`;

    const result = FeatureParser.parseFeatureContent(malformedContent);

    assert.ok(result);
    assert.strictEqual(result?.feature, "Test");
    assert.strictEqual(result?.scenarios.length, 2);
  });

  test("Should parse file with CRLF line endings", () => {
    const featureContent =
      "Feature: Test\r\n  Scenario: Test\r\n    Given I have a test\r\n    When I run it\r\n    Then it should work\r\n";

    const result = FeatureParser.parseFeatureContent(featureContent);

    assert.ok(result);
    assert.strictEqual(result?.feature, "Test");
    assert.strictEqual(result?.scenarios.length, 1);
    assert.strictEqual(result?.scenarios[0]?.name, "Test");
  });
});
