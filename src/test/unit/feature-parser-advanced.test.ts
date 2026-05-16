import * as assert from "assert";
import { FeatureParser } from "../../parsers/feature-parser.js";

suite("FeatureParser Advanced Gherkin Features", () => {
  const featureParser = FeatureParser.create();

  test("Should parse named Examples block", () => {
    const featureContent = `
Feature: Account Operations
  Scenario Outline: Valid Withdrawals
    Given I have <balance> in my account
    When I withdraw <amount>
    Then my new balance should be <new_balance>

    Examples: Standard Amounts
      | balance | amount | new_balance |
      | 100     | 20     | 80          |
      | 50      | 50     | 0           |
`;
    const result = featureParser.parseFeatureContent(featureContent);

    assert.ok(result);
    assert.strictEqual(result?.scenarios.length, 2, "Expected 2 example scenarios");
    assert.strictEqual(result?.scenarios[0]?.examplesBlockName, "Standard Amounts");
    assert.strictEqual(result?.scenarios[1]?.examplesBlockName, "Standard Amounts");
  });

  test("Should parse multiple Examples blocks per outline", () => {
    const featureContent = `
Feature: Account Operations
  Scenario Outline: Valid Withdrawals
    Given I have <balance> in my account
    When I withdraw <amount>
    Then my new balance should be <new_balance>

    Examples: Standard Amounts
      | balance | amount | new_balance |
      | 100     | 20     | 80          |
      | 50      | 50     | 0           |

    Examples: High Value Amounts
      | balance | amount | new_balance |
      | 1000    | 500    | 500         |
`;
    const result = featureParser.parseFeatureContent(featureContent);

    assert.ok(result);
    assert.strictEqual(result?.scenarios.length, 3, "Expected 3 example scenarios across two blocks");

    const standard = result?.scenarios.filter((s) => s.examplesBlockName === "Standard Amounts");
    const highValue = result?.scenarios.filter((s) => s.examplesBlockName === "High Value Amounts");
    assert.strictEqual(standard?.length, 2);
    assert.strictEqual(highValue?.length, 1);
  });

  test("Should apply Examples-block tags only to scenarios in that block", () => {
    const featureContent = `
Feature: Account Operations
  @smoke
  Scenario Outline: Valid Withdrawals
    Given I have <balance> in my account
    When I withdraw <amount>
    Then my new balance should be <new_balance>

    Examples: Standard Amounts
      | balance | amount | new_balance |
      | 100     | 20     | 80          |

    @high_value
    Examples: High Value Amounts
      | balance | amount | new_balance |
      | 1000    | 500    | 500         |
`;
    const result = featureParser.parseFeatureContent(featureContent);

    assert.ok(result);
    const standard = result?.scenarios.find((s) => s.examplesBlockName === "Standard Amounts");
    const highValue = result?.scenarios.find((s) => s.examplesBlockName === "High Value Amounts");

    assert.ok(standard);
    assert.ok(highValue);

    // Both inherit the outline-level @smoke tag
    assert.ok(standard.tags?.includes("@smoke"), "standard should have @smoke from outline");
    assert.ok(highValue.tags?.includes("@smoke"), "high_value should have @smoke from outline");

    // Only the second block has @high_value
    assert.ok(!standard.tags?.includes("@high_value"), "standard should NOT have @high_value");
    assert.ok(highValue.tags?.includes("@high_value"), "high_value should have @high_value");

    // examplesBlockTags reflects only the block's own tags
    assert.deepStrictEqual(standard.examplesBlockTags, undefined);
    assert.deepStrictEqual(highValue.examplesBlockTags, ["@high_value"]);
  });

  test("Should parse Background and attach steps to subsequent scenarios", () => {
    const featureContent = `
Feature: Login

  Background:
    Given I navigate to the homepage
    And I clear my cookies

  Scenario: Login as admin
    When I enter admin credentials
    Then I see the admin dashboard
`;
    const result = featureParser.parseFeatureContent(featureContent);

    assert.ok(result);
    assert.strictEqual(result?.scenarios.length, 1);
    assert.deepStrictEqual(result?.scenarios[0]?.backgroundSteps, [
      "Given I navigate to the homepage",
      "And I clear my cookies",
    ]);
    // Background steps should NOT be part of the scenario's own steps
    assert.deepStrictEqual(result?.scenarios[0]?.steps, [
      "When I enter admin credentials",
      "Then I see the admin dashboard",
    ]);
  });

  test("Should attach ruleName to scenarios inside a Rule", () => {
    const featureContent = `
Feature: Banking

  Rule: Account holders may withdraw funds

    Scenario: Successful withdrawal
      Given I have 100 in my account
      When I withdraw 50
      Then my balance is 50

  Rule: Overdraft is forbidden

    Scenario: Rejected withdrawal
      Given I have 10 in my account
      When I try to withdraw 50
      Then I see an error
`;
    const result = featureParser.parseFeatureContent(featureContent);

    assert.ok(result);
    assert.strictEqual(result?.scenarios.length, 2);
    assert.strictEqual(result?.scenarios[0]?.ruleName, "Account holders may withdraw funds");
    assert.strictEqual(result?.scenarios[1]?.ruleName, "Overdraft is forbidden");
  });

  test("Should combine feature-level and rule-level Background for scenarios in a Rule", () => {
    const featureContent = `
Feature: Banking

  Background:
    Given the database is empty

  Rule: Holders may withdraw

    Background:
      Given I have an account

    Scenario: Withdraw funds
      When I withdraw 10
      Then it works
`;
    const result = featureParser.parseFeatureContent(featureContent);

    assert.ok(result);
    assert.strictEqual(result?.scenarios.length, 1);
    assert.deepStrictEqual(result?.scenarios[0]?.backgroundSteps, [
      "Given the database is empty",
      "Given I have an account",
    ]);
    assert.strictEqual(result?.scenarios[0]?.ruleName, "Holders may withdraw");
  });

  test("Should handle the exact user-provided example: Valid + Invalid Withdrawals", () => {
    const featureContent = `Feature: Account Operations

  Scenario Outline: Valid Withdrawals
    Given I have <balance> in my account
    When I withdraw <amount>
    Then my new balance should be <new_balance>

    Examples: Standard Amounts

      | balance | amount | new_balance |
      | 100     | 20     | 80          |
      | 50      | 50     | 0           |

    @high_value
    Examples: High Value Amounts

      | balance | amount | new_balance |
      | 1000    | 500    | 500         |

  Scenario Outline: Invalid Withdrawals
    Given I have <balance> in my account
    When I try to withdraw <amount>
    Then I should see an error: "<error>"

    Examples:

      | balance | amount | error               |
      | 10      | 20     | Insufficient Funds  |
      | 100     | -5     | Invalid Amount      |
`;
    const result = featureParser.parseFeatureContent(featureContent);

    assert.ok(result, "result should not be null");
    // 2 from Standard Amounts + 1 from High Value Amounts + 2 from Invalid Withdrawals = 5
    assert.strictEqual(result?.scenarios.length, 5);

    const standardCount = result?.scenarios.filter((s) => s.examplesBlockName === "Standard Amounts").length;
    const highValueCount = result?.scenarios.filter((s) => s.examplesBlockName === "High Value Amounts").length;
    const unnamedCount = result?.scenarios.filter((s) => !s.examplesBlockName).length;
    assert.strictEqual(standardCount, 2);
    assert.strictEqual(highValueCount, 1);
    assert.strictEqual(unnamedCount, 2);

    // @high_value should only be on High Value Amounts example
    const highValue = result?.scenarios.find((s) => s.examplesBlockName === "High Value Amounts");
    assert.ok(highValue?.tags?.includes("@high_value"));
  });

  test("Should preserve backward compat: unnamed single Examples block still works", () => {
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
    const result = featureParser.parseFeatureContent(featureContent);

    assert.ok(result);
    assert.strictEqual(result?.scenarios.length, 2);
    assert.strictEqual(
      result?.scenarios[0]?.name,
      "1: Login with different credentials - username: admin, password: secret, result: success"
    );
    // No block name on unnamed Examples
    assert.strictEqual(result?.scenarios[0]?.examplesBlockName, undefined);
  });
});
