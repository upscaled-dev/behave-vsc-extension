import * as assert from "assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { FeatureParser } from "../../parsers/feature-parser.js";
import { Logger } from "../../utils/logger";

suite("FeatureParser Advanced Gherkin Features", () => {
  const featureParser = FeatureParser.create();

  test("English keyword aliases retain scenario, outline row, tag and wildcard identities", () => {
    const source = `@feature_alias
Feature: English aliases

  Background:
    Given prepare alias setup
    * continue alias setup

  @example_alias
  Example: Alias example
    Given begin alias example
    * finish alias example

  @template_alias
  Scenario Template: Alias template
    Given begin alias <entry>
    * finish alias <entry>

    @rows_alias
    Scenarios: Alias rows
      | entry |
      | one   |
      | two   |

  Scenario: Original scenario
    Given original scenario

  Scenario Outline: Original outline
    Given original outline <entry>
    Examples:
      | entry |
      | three |
`;

    const parsed = featureParser.parseFeatureContent(source);

    assert.ok(parsed);
    assert.deepStrictEqual(parsed.scenarios.map((scenario) => [scenario.name, scenario.lineNumber, scenario.outlineLineNumber,
      scenario.examplesBlockLineNumber, scenario.tags, scenario.steps, scenario.backgroundSteps]), [
      ["Alias example", 9, undefined, undefined, ["@feature_alias", "@example_alias"],
        ["Given begin alias example", "* finish alias example"], ["Given prepare alias setup", "* continue alias setup"]],
      ["Original scenario", 24, undefined, undefined, ["@feature_alias"], ["Given original scenario"],
        ["Given prepare alias setup", "* continue alias setup"]],
      ["1: Alias template - entry: one", 21, 14, 19, ["@feature_alias", "@template_alias", "@rows_alias"],
        ["Given begin alias <entry>", "* finish alias <entry>"], ["Given prepare alias setup", "* continue alias setup"]],
      ["2: Alias template - entry: two", 22, 14, 19, ["@feature_alias", "@template_alias", "@rows_alias"],
        ["Given begin alias <entry>", "* finish alias <entry>"], ["Given prepare alias setup", "* continue alias setup"]],
      ["1: Original outline - entry: three", 31, 27, 29, ["@feature_alias"], ["Given original outline <entry>"],
        ["Given prepare alias setup", "* continue alias setup"]],
    ]);
  });

  test("catalog dialects keep English aliases, French rows and Japanese no-space steps distinct", () => {
    for (const feature of ["Business Need", "Ability"]) {
      const parsed = featureParser.parseFeatureContent(`${feature}: English alias\n  Scenario: visible\n    Given a step\n`);
      assert.strictEqual(parsed?.feature, "English alias");
      assert.deepStrictEqual(parsed?.scenarios.map((scenario) => scenario.name), ["visible"]);
    }
    const french = featureParser.parseFeatureContent(`# language: fr\n@feature\nFonctionnalité: Français\n  Contexte:\n    Soit préparé\n  @leaf\n  Scénario: choisi\n    Alors terminé\n  Plan du scénario: valeurs\n    Soit <valeur>\n    Exemples:\n      | valeur |\n      | un |\n`);
    assert.deepStrictEqual(french?.scenarios.map((scenario) => [scenario.name, scenario.lineNumber, scenario.tags, scenario.backgroundSteps]), [
      ["choisi", 7, ["@feature", "@leaf"], ["Soit préparé"]], ["1: valeurs - valeur: un", 13, ["@feature"], ["Soit préparé"]],
    ]);
    const japanese = featureParser.parseFeatureContent("# language: ja\n機能: 日本語\n  シナリオ: 空白なし\n    前提値\n");
    assert.deepStrictEqual(japanese?.scenarios.map((scenario) => [scenario.name, scenario.steps]), [["空白なし", ["前提値"]]]);
    const scouse = featureParser.parseFeatureContent("# language: en-Scouse\nFeature: Scouse\n  The thing of it is: visible\n    Givun a step\n");
    assert.deepStrictEqual(scouse?.scenarios.map((scenario) => scenario.name), ["visible"]);
  });

  test("invalid and docstring language directives do not fall back or change an established document dialect", () => {
    assert.strictEqual(featureParser.parseFeatureContent("# language: unknown\nFeature: not English\n  Scenario: hidden\n    Given hidden\n"), null);
    assert.strictEqual(featureParser.parseFeatureContent("# language: fr.invalid\nFeature: also hidden\n  Scenario: hidden\n    Given hidden\n"), null);
    const parsed = featureParser.parseFeatureContent(`Feature: English\n  Scenario: real\n    Given payload\n      \"\"\"\n      # language: fr\n      Scénario: phantom\n      \"\"\"\n    Then complete\n  Scénario: not a second English scenario\n`);
    assert.deepStrictEqual(parsed?.scenarios.map((scenario) => [scenario.name, scenario.steps]), [["real", ["Given payload", "Then complete"]]]);
  });

  test("Docstring description fences retain Feature, Scenario and Rule targets beside real step payloads", () => {
    const file = path.resolve(__dirname, "../../../src/test/fixtures/docstrings/descriptions.feature");
    const parsed = featureParser.parseFeatureFile(file);
    assert.ok(parsed);
    assert.deepStrictEqual(parsed.scenarios.map((scenario) => [scenario.name, scenario.lineNumber, scenario.ruleName, scenario.tags]), [
      ["Read boundary payload", 15, undefined, ["@real"]],
      ["Following boundary scenario", 37, "Quoted rule", ["@after"]],
    ]);
    assert.deepStrictEqual(parsed.scenarios[0]?.steps, ["Given a boundary payload", "Then the boundary payload is intact"]);
    for (const scenario of parsed.scenarios) {
      assert.deepStrictEqual(scenario.backgroundSteps, ["Given a boundary setup payload", "And boundary setup continues"]);
    }
  });

  test("Docstring boundaries preserve real scenarios, rows, Background continuation and physical lines", () => {
    const file = path.resolve(__dirname, "../../../src/test/fixtures/docstrings/boundaries.feature");
    const parsed = featureParser.parseFeatureFile(file);
    assert.ok(parsed);
    assert.deepStrictEqual(parsed.scenarios.map((scenario) => [scenario.name, scenario.lineNumber]), [
      ["Read boundary payload", 11], ["Following boundary scenario", 41],
      ["1: Boundary row - value: one", 37], ["2: Boundary row - value: two", 38],
    ]);
    for (const scenario of parsed.scenarios) {
      assert.deepStrictEqual(scenario.backgroundSteps, ["Given a boundary setup payload", "And boundary setup continues"]);
      assert.ok(!scenario.tags?.some((tag) => tag.startsWith("@phantom")));
    }
    assert.deepStrictEqual(parsed.scenarios[0]?.steps, ["Given a boundary payload", "Then the boundary payload is intact"]);
    assert.deepStrictEqual(parsed.scenarios[2]?.steps, ['Given a boundary row "<value>"', 'Then boundary row is "<value>"']);
    assert.deepStrictEqual(parsed.scenarios.slice(2).map((scenario) => [scenario.outlineLineNumber, scenario.examplesBlockLineNumber]), [[26, 35], [26, 35]]);
  });

  for (const delimiter of ['"""', "'''", "```"] as const) {
    test(`Docstring boundaries use matching ${delimiter} fences and preserve CRLF line numbers`, () => {
      const other = delimiter === '"""' ? "```" : '"""';
      const source = ["Feature: Fences", "  Scenario: Real", "    Given a payload", `      ${delimiter}text/plain`,
        `      ${other}`, "      Scenario: Phantom", "      @phantom", `      ${delimiter}`,
        "    Then a result", "  @real", "  Scenario: Following", "    Given a result"].join("\r\n");
      const parsed = featureParser.parseFeatureContent(source);
      assert.ok(parsed);
      assert.deepStrictEqual(parsed.scenarios.map((scenario) => [scenario.name, scenario.lineNumber, scenario.tags]), [["Real", 2, []], ["Following", 11, ["@real"]]]);
      assert.deepStrictEqual(parsed.scenarios[0]?.steps, ["Given a payload", "Then a result"]);
      const lenses = featureParser.provideScenarioCodeLenses(source, "/fences.feature");
      assert.deepStrictEqual(lenses.filter((lens) => lens.command?.command === "behaveTestRunner.runScenario").map((lens) => lens.command?.arguments?.[1]), [2, 11]);
      assert.deepStrictEqual(lenses.filter((lens) => lens.command?.command === "behaveTestRunner.runFeatureFileWithTags").map((lens) => lens.command?.arguments?.[1]), ["@real"]);
    });
  }

  test("Docstring boundaries hide unfinished body targets until the matching fence is repaired", () => {
    const prefix = 'Feature: Editing\n  Scenario: Real\n    Given a payload\n      """\n';
    const body = "      Scenario: Phantom\n      @phantom\n";
    const suffix = "  Scenario: Following\n    Given a result\n";
    const pending = featureParser.parseFeatureContent(prefix + body + suffix);
    assert.deepStrictEqual(pending?.scenarios.map((scenario) => scenario.name), ["Real"]);
    assert.deepStrictEqual(featureParser.provideScenarioCodeLenses(prefix + body + suffix, "/editing.feature")
      .filter((lens) => lens.command?.command === "behaveTestRunner.runScenario").map((lens) => lens.command?.arguments?.[1]), [2]);
    const repaired = featureParser.parseFeatureContent(prefix + body + '      """\n' + suffix);
    assert.deepStrictEqual(repaired?.scenarios.map((scenario) => [scenario.name, scenario.lineNumber, scenario.tags]), [["Real", 2, []], ["Following", 8, []]]);
  });

  test("Examples columns retain blank values, escaped pipes and physical block lines", () => {
    const file = path.resolve(__dirname, "../../../src/test/fixtures/examples/columns.feature");
    const result = featureParser.parseFeatureFile(file);
    assert.ok(result);
    const values = [
      ["", "center", "end"], ["start", "", "end"], ["start", "center", ""],
      ["", "", ""], ["left|right", "center", "end"],
    ];
    assert.deepStrictEqual(result.scenarios.map((scenario) => scenario.name), values.map((row, index) =>
      `${index + 1}: Column values - first: ${row[0]}, middle: ${row[1]}, last: ${row[2]}`));
    assert.deepStrictEqual(result.scenarios.map((scenario) => [scenario.lineNumber, scenario.outlineLineNumber,
      scenario.examplesBlockLineNumber, scenario.examplesBlockName, scenario.examplesBlockTags]), [
      [8, 2, 6, "Empty positions", ["@primary"]], [9, 2, 6, "Empty positions", ["@primary"]],
      [10, 2, 6, "Empty positions", ["@primary"]], [11, 2, 6, "Empty positions", ["@primary"]],
      [16, 2, 14, "Escaped separator", ["@secondary"]],
    ]);
  });

  for (const [row, count] of [["| first | middle |", 2], ["| first | middle | last | extra |", 4]] as const) {
    test(`Examples columns reject ${count} cells against three headers with a line diagnostic and permit retry`, () => {
      const messages: string[] = [];
      const logger = new Logger({ appendLine: (message: string) => {messages.push(message);} } as vscode.OutputChannel);
      const parser = FeatureParser.create(logger);
      const valid = "| first | middle | last |";
      const source = `Feature: Width integrity
  Scenario Outline: Values
    Given values <first> <middle> <last>
    Examples:
      | first | middle | last |
      ${valid}
      ${row}
`;
      assert.strictEqual(parser.parseFeatureContent(source), null, "Reject the entire malformed feature without returning partial rows");
      assert.strictEqual(messages.length, 1, "The existing logger must render the error message directly");
      assert.ok(messages[0]?.includes(`Examples row at line 7 has ${count} cells; expected 3`), messages.join("\n"));
      const corrected = parser.parseFeatureContent(source.replace(`      ${row}\n`, `      ${valid}\n`));
      assert.ok(corrected);
      assert.strictEqual(corrected.scenarios.length, 2);
      assert.deepStrictEqual(corrected.scenarios.map((scenario) => scenario.lineNumber), [6, 7]);
    });
  }

  test("Examples columns retain Behave separator behavior after repeated backslashes", () => {
    const source = String.raw`Feature: Escaped separators
  Scenario Outline: Values
    Given value <first>
    Examples:
      | first | middle | last |
      | a\\|b | center | tail |
      | a\\  | center | tail |
`;
    const parsed = featureParser.parseFeatureContent(source);
    assert.ok(parsed);
    assert.deepStrictEqual(parsed.scenarios.map((scenario) => scenario.name), [
      String.raw`1: Values - first: a\|b, middle: center, last: tail`,
      String.raw`2: Values - first: a\\, middle: center, last: tail`,
    ]);
  });

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
