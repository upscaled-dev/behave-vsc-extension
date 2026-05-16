import * as assert from "assert";
import {
  extractStepText,
  extractStepDefsFromSource,
  extractFirstString,
  patternToRegexSource,
} from "../../providers/step-definition-provider.js";

suite("StepDefinitionProvider Matching", () => {
  test("extractStepText strips the Given/When/Then keyword and indentation", () => {
    assert.strictEqual(extractStepText("  Given I am on the page"), "I am on the page");
    assert.strictEqual(extractStepText("  When I click submit"), "I click submit");
    assert.strictEqual(extractStepText("  Then I see success"), "I see success");
    assert.strictEqual(extractStepText("  And another condition"), "another condition");
    assert.strictEqual(extractStepText("  But not this"), "not this");
    assert.strictEqual(extractStepText("  Scenario: Foo"), undefined);
    assert.strictEqual(extractStepText(""), undefined);
  });

  test("extractFirstString unwraps single, double, and raw-prefixed strings", () => {
    assert.strictEqual(extractFirstString("'hello'"), "hello");
    assert.strictEqual(extractFirstString('"hello world"'), "hello world");
    assert.strictEqual(extractFirstString("r'raw'"), "raw");
    assert.strictEqual(extractFirstString('r"raw"'), "raw");
    assert.strictEqual(extractFirstString("'with \\'escape\\''"), "with \\'escape\\'");
    assert.strictEqual(extractFirstString("no string here"), undefined);
  });

  test("patternToRegexSource converts <param> and {param} to wildcard captures", () => {
    assert.strictEqual(patternToRegexSource("I have 5 users"), "I have 5 users");
    assert.strictEqual(patternToRegexSource("I have <count> users"), "I have .+? users");
    assert.strictEqual(patternToRegexSource("I enter {name}"), "I enter .+?");
    assert.strictEqual(patternToRegexSource("I have {count:d} of {item}"), "I have .+? of .+?");
    // Regex specials escaped
    assert.ok(patternToRegexSource("count is (5)").includes("\\("));
  });

  test("extractStepDefsFromSource picks up plain-string @given/@when/@then", () => {
    const src = [
      "from behave import given, when, then",
      "",
      "@given('I am on the login page')",
      "def step_impl(context):",
      "    pass",
      "",
      "@when(\"I enter valid credentials\")",
      "def step_impl(context):",
      "    pass",
      "",
      "@then('I should see the dashboard')",
      "def step_impl(context):",
      "    pass",
    ].join("\n");

    const defs = extractStepDefsFromSource(src);
    assert.strictEqual(defs.length, 3);
    assert.strictEqual(defs[0]?.pattern, "I am on the login page");
    assert.ok(defs[0]?.regex.test("I am on the login page"));
    assert.strictEqual(defs[1]?.pattern, "I enter valid credentials");
    assert.ok(defs[1]?.regex.test("I enter valid credentials"));
    assert.strictEqual(defs[2]?.pattern, "I should see the dashboard");
    assert.ok(defs[2]?.regex.test("I should see the dashboard"));
  });

  test("extractStepDefsFromSource matches behave <param> style against concrete values", () => {
    const src = "@given('I have <count> users in the system')\ndef step_impl(context, count): pass";
    const defs = extractStepDefsFromSource(src);
    assert.strictEqual(defs.length, 1);
    assert.ok(defs[0]?.regex.test("I have 5 users in the system"));
    assert.ok(defs[0]?.regex.test("I have lots of users in the system"));
    assert.ok(!defs[0]?.regex.test("I have users in the system")); // empty param doesn't match .+?
  });

  test("extractStepDefsFromSource matches pytest-bdd parsers.parse style", () => {
    const src = [
      "from pytest_bdd import given, parsers",
      "@given(parsers.parse('I enter {username} as username'))",
      "def step_impl(username): pass",
    ].join("\n");
    const defs = extractStepDefsFromSource(src);
    assert.strictEqual(defs.length, 1);
    assert.ok(defs[0]?.regex.test("I enter alice as username"));
    assert.ok(!defs[0]?.regex.test("I do something else"));
  });

  test("extractStepDefsFromSource honours parsers.re raw regex (no escaping)", () => {
    const src = "@then(parsers.re(r'^count is (\\d+)$'))\ndef step_impl(count): pass";
    const defs = extractStepDefsFromSource(src);
    assert.strictEqual(defs.length, 1);
    assert.ok(defs[0]?.regex.test("count is 42"));
    assert.ok(!defs[0]?.regex.test("count is forty"));
  });

  test("extractStepDefsFromSource handles @step (matches any keyword)", () => {
    const src = "@step('any keyword matches')\ndef step_impl(context): pass";
    const defs = extractStepDefsFromSource(src);
    assert.strictEqual(defs.length, 1);
    assert.ok(defs[0]?.regex.test("any keyword matches"));
  });

  test("extractStepDefsFromSource skips unparseable decorators gracefully", () => {
    const src = [
      "@given()",
      "@given(MY_CONSTANT)",
      "@given('valid one')",
    ].join("\n");
    const defs = extractStepDefsFromSource(src);
    assert.strictEqual(defs.length, 1, "only the literal-string decorator should parse");
    assert.strictEqual(defs[0]?.pattern, "valid one");
  });
});
