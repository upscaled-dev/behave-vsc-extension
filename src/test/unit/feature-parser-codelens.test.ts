import * as assert from "assert";
import { FeatureParser } from "../../parsers/feature-parser";

suite("Feature Parser CodeLens Unit Tests", () => {
  test("Should generate CodeLenses for scenario outlines with examples", () => {
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
      | 5 | 5      |

  Scenario: Another regular scenario
    Given some condition
    When something happens
    Then something else should happen
`;

    const codeLenses = FeatureParser.provideScenarioCodeLenses(
      featureContent,
      "/test.feature"
    );

    // Should have:
    // - 2 regular scenarios * 2 CodeLenses each = 4
    // - 1 scenario outline * 2 CodeLenses = 2
    // - 2 examples * 2 CodeLenses each = 4
    // - 1 feature CodeLens = 1
    // Total: 11 CodeLenses
    assert.strictEqual(
      codeLenses.length,
      11,
      "Should generate correct number of CodeLenses"
    );

    // Check that scenario outline CodeLenses have correct titles
    const scenarioOutlineRunLens = codeLenses.find(
      (lens) => lens.command?.title === "▶️ Run Scenario Outline"
    );
    const scenarioOutlineDebugLens = codeLenses.find(
      (lens) => lens.command?.title === "🐛 Debug Scenario Outline"
    );

    assert.ok(
      scenarioOutlineRunLens,
      "Should have Run Scenario Outline CodeLens"
    );
    assert.ok(
      scenarioOutlineDebugLens,
      "Should have Debug Scenario Outline CodeLens"
    );

    // Check that example CodeLenses have correct titles
    const exampleRunLens = codeLenses.find(
      (lens) => lens.command?.title === "▶️ Run Example"
    );
    const exampleDebugLens = codeLenses.find(
      (lens) => lens.command?.title === "🐛 Debug Example"
    );

    assert.ok(exampleRunLens, "Should have Run Example CodeLens");
    assert.ok(exampleDebugLens, "Should have Debug Example CodeLens");

    // Check that regular scenario CodeLenses have correct titles
    const regularRunLens = codeLenses.find(
      (lens) => lens.command?.title === "▶️ Run Scenario"
    );
    const regularDebugLens = codeLenses.find(
      (lens) => lens.command?.title === "🐛 Debug Scenario"
    );

    assert.ok(regularRunLens, "Should have Run Scenario CodeLens");
    assert.ok(regularDebugLens, "Should have Debug Scenario CodeLens");
  });

  test("Should generate CodeLenses for feature with tags", () => {
    const featureContent = `
@feature @calculator
Feature: Calculator
  @smoke @critical
  Scenario: Add two numbers
    Given I have entered 50 into the calculator
    When I press add
    Then the result should be 120 on the screen

  @regression @ui
  Scenario Outline: Add two numbers
    Given I have entered <a> into the calculator
    When I press add
    Then the result should be <result> on the screen

    Examples:
      | a | result |
      | 1 | 1      |
      | 5 | 5      |
`;

    const codeLenses = FeatureParser.provideScenarioCodeLenses(
      featureContent,
      "/test.feature"
    );

    // Should have tag CodeLenses for each unique tag
    const tagCodeLenses = codeLenses.filter((lens) =>
      lens.command?.title?.startsWith("🏷️ Run with")
    );

    // Should have CodeLenses for: @feature, @calculator, @smoke, @critical, @regression, @ui
    assert.strictEqual(
      tagCodeLenses.length,
      6,
      "Should generate CodeLenses for all unique tags"
    );

    // Check that tag CodeLenses have correct commands
    const featureTagLens = tagCodeLenses.find(
      (lens) => lens.command?.title === "🏷️ Run with @feature"
    );
    const smokeTagLens = tagCodeLenses.find(
      (lens) => lens.command?.title === "🏷️ Run with @smoke"
    );

    assert.ok(featureTagLens, "Should have @feature tag CodeLens");
    assert.ok(smokeTagLens, "Should have @smoke tag CodeLens");
  });

  test("Should generate CodeLenses for complex scenario outlines", () => {
    const featureContent = `
Feature: API Testing
  Scenario Outline: Data validation with various inputs
    Given I have a valid API endpoint
    When I send "<data_type>" data with value "<input_value>"
    Then the response should contain "<validation_result>"
    And the status code should be "<status_code>"

    Examples:
      | data_type | input_value | validation_result | status_code |
      | string    | hello       | valid             | 200         |
      | number    | 42          | valid             | 200         |
      | email     | test@test   | invalid           | 400         |
      | empty     |             | invalid           | 400         |
`;

    const codeLenses = FeatureParser.provideScenarioCodeLenses(
      featureContent,
      "/test.feature"
    );

    // Should have:
    // - 1 scenario outline * 2 CodeLenses = 2
    // - 4 examples * 2 CodeLenses each = 8
    // - 1 feature CodeLens = 1
    // Total: 11 CodeLenses
    assert.strictEqual(
      codeLenses.length,
      11,
      "Should generate correct number of CodeLenses for complex outline"
    );

    // Check that example CodeLenses have correct arguments
    const exampleCodeLenses = codeLenses.filter(
      (lens) => lens.command?.title === "▶️ Run Example"
    );

    assert.strictEqual(
      exampleCodeLenses.length,
      4,
      "Should have 4 example CodeLenses"
    );

    // Check that example CodeLenses have correct scenario names
    const exampleNames = exampleCodeLenses.map(
      (lens) => lens.command?.arguments?.[2]
    );

    // Check that we have the expected number of examples
    assert.strictEqual(exampleNames.length, 4, "Should have 4 example names");

    // Check that the names follow the expected pattern
    const hasFirstExample = exampleNames.some(
      (name) =>
        name && name.startsWith("1: Data validation with various inputs")
    );
    const hasSecondExample = exampleNames.some(
      (name) =>
        name && name.startsWith("2: Data validation with various inputs")
    );

    assert.ok(hasFirstExample, "Should have first example");
    assert.ok(hasSecondExample, "Should have second example");
  });

  test("Should handle scenario outlines without examples", () => {
    const featureContent = `
Feature: Calculator
  Scenario Outline: Add two numbers
    Given I have entered <a> into the calculator
    When I press add
    Then the result should be <result> on the screen

  Scenario: Regular scenario
    Given some condition
    When something happens
    Then something else should happen
`;

    const codeLenses = FeatureParser.provideScenarioCodeLenses(
      featureContent,
      "/test.feature"
    );

    // Should have:
    // - 1 scenario outline * 2 CodeLenses = 2
    // - 1 regular scenario * 2 CodeLenses = 2
    // - 1 feature CodeLens = 1
    // Total: 5 CodeLenses
    assert.strictEqual(
      codeLenses.length,
      5,
      "Should generate correct number of CodeLenses for outline without examples"
    );

    // Should not have example CodeLenses
    const exampleCodeLenses = codeLenses.filter(
      (lens) => lens.command?.title === "▶️ Run Example"
    );
    assert.strictEqual(
      exampleCodeLenses.length,
      0,
      "Should not have example CodeLenses when no examples"
    );
  });

  test("Should handle multiple scenario outlines in same feature", () => {
    const featureContent = `
Feature: Multiple Outlines
  Scenario Outline: First outline
    Given condition <param1>
    When action <param2>
    Then result <param3>

    Examples:
      | param1 | param2 | param3 |
      | value1 | value2 | value3 |

  Scenario Outline: Second outline
    Given another condition <param1>
    When another action <param2>
    Then another result <param3>

    Examples:
      | param1 | param2 | param3 |
      | val1   | val2   | val3   |
      | val4   | val5   | val6   |
`;

    const codeLenses = FeatureParser.provideScenarioCodeLenses(
      featureContent,
      "/test.feature"
    );

    // Should have:
    // - 2 scenario outlines * 2 CodeLenses each = 4
    // - 3 examples * 2 CodeLenses each = 6
    // - 1 feature CodeLens = 1
    // Total: 11 CodeLenses
    assert.strictEqual(
      codeLenses.length,
      11,
      "Should generate correct number of CodeLenses for multiple outlines"
    );

    // Check that both outlines have CodeLenses
    const outlineRunLenses = codeLenses.filter(
      (lens) => lens.command?.title === "▶️ Run Scenario Outline"
    );
    assert.strictEqual(
      outlineRunLenses.length,
      2,
      "Should have CodeLenses for both outlines"
    );
  });
});
