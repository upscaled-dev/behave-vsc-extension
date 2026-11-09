import * as assert from "assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractStepText, StepDefinitionProvider } from "../../providers/step-definition-provider.js";
import { scanBehaveEnvironment, scanPythonStepDefinitions } from "../../providers/python-step-definition-scanner.js";
import { FeatureParser } from "../../parsers/feature-parser.js";
import { resolveGherkinKeywords } from "../../utils/gherkin-keywords.js";

suite("StepDefinitionProvider Matching", () => {
  test("English keyword wildcard extractStepText strips the keyword and indentation", () => {
    assert.strictEqual(extractStepText("  Given I am on the page"), "I am on the page");
    assert.strictEqual(extractStepText("  * wildcard continuation"), "wildcard continuation");
    assert.strictEqual(extractStepText("  Scenario: Foo"), undefined);
  });

  test("localized step extraction uses the document dialect", () => {
    const keywords = resolveGherkinKeywords("# language: fr\nFonctionnalité: navigation\n");
    assert.strictEqual(extractStepText("  Soit une étape", keywords), "une étape");
    assert.strictEqual(extractStepText("  Given an English step", keywords), undefined);
  });

  test("scanner recognizes aliases, typed fields, and source-ordered Behave matchers", () => {
    const source = [
      "from behave import given as setup, when, then, use_step_matcher",
      "@setup('I am on the login page')",
      "def start(context): pass",
      "use_step_matcher('cfparse')",
      "@when(\"I enter {word:w}\")",
      "def enter(context): pass",
      "use_step_matcher('re')",
      "@then(r'I should see (?P<value>\\d+)')",
      "def finish(context): pass",
    ].join("\n");
    const defs = scanPythonStepDefinitions(source);
    assert.strictEqual(defs.length, 3);
    assert.ok(defs[0]?.matches("I am on the login page"));
    assert.ok(defs[1]?.matches("I enter café"));
    assert.ok(!defs[1]?.matches("I enter two words"));
    assert.ok(defs[2]?.matches("I should see 42"));
    assert.ok(!defs[2]?.matches("I should see 42 now"));
  });

  test("scanner distinguishes pytest literals from explicit parser forms", () => {
    const source = [
      "from pytest_bdd import given, parsers as p",
      "@given('I enter {name}')",
      "def literal(): pass",
      "@given(p.parse('I enter {name:d}'))",
      "def parsed(): pass",
    ].join("\n");
    const defs = scanPythonStepDefinitions(source);
    assert.strictEqual(defs.length, 2);
    assert.ok(defs[0]?.matches("I enter {name}"));
    assert.ok(!defs[0]?.matches("I enter Ada"));
    assert.ok(defs[1]?.matches("I enter 12"));
    assert.ok(!defs[1]?.matches("I enter twelve"));
  });

  test("scanner declines dynamic, fake, and unsupported syntax", () => {
    const source = [
      "from behave import given, use_step_matcher",
      "''' @given('fake') '''",
      "use_step_matcher(MATCHER)",
      "@given('not guessed')",
      "use_step_matcher('re0')",
      "@given(r'prefix')",
      "use_step_matcher('re')",
      "@given(r'one|two')",
    ].join("\n");
    assert.deepStrictEqual(scanPythonStepDefinitions(source), []);
  });

  test("scanner does not treat an unresolved inherited matcher as parse", () => {
    const source = "from behave import given\n@given('not guessed')\ndef step(context): pass";
    assert.deepStrictEqual(scanPythonStepDefinitions(source, null), []);
  });

  test("scanner retains real decorators after one-line docstrings and skips fake strings independently", () => {
    const real = ["\"\"\"step bindings\"\"\"", "from behave import given", "@given('hello')", "def hello(context): pass"].join("\n");
    assert.strictEqual(scanPythonStepDefinitions(real).length, 1);
    const fake = ["''' @given('fake') '''", "from behave import given", "@given('real')", "def real(context): pass"].join("\n");
    const defs = scanPythonStepDefinitions(fake);
    assert.strictEqual(defs.length, 1);
    assert.ok(defs[0]?.matches("real"));
  });

  test("scanner applies framework-specific regex and strict decorator shapes", () => {
    const behave = ["from behave import given, use_step_matcher", "use_step_matcher('re')", "@given(r'^ghost$')", "def ghost(context): pass"].join("\n");
    assert.deepStrictEqual(scanPythonStepDefinitions(behave), []);
    const pytest = ["from pytest_bdd import given, parsers", "@given(parsers.re(r'^ghost$'))", "def ghost(): pass"].join("\n");
    assert.ok(scanPythonStepDefinitions(pytest)[0]?.matches("ghost"));
    const extra = ["from behave import given", "@given('ghost', object())", "def ghost(context): pass"].join("\n");
    assert.deepStrictEqual(scanPythonStepDefinitions(extra), []);
  });

  test("scanner respects repeated fields and ordinary versus raw literals", () => {
    const repeated = ["from pytest_bdd import given, parsers", "@given(parsers.parse('pair {value:d} {value:d}'))", "def pair(): pass"].join("\n");
    const definition = scanPythonStepDefinitions(repeated)[0];
    assert.ok(definition?.matches("pair 1 1"));
    assert.ok(!definition?.matches("pair 1 2"));
    const strings = ["from pytest_bdd import given", "@given('tab\\tvalue')", "def ordinary(): pass", "@given(r'tab\\tvalue')", "def raw(): pass"].join("\n");
    const defs = scanPythonStepDefinitions(strings);
    assert.ok(defs[0]?.matches("tab\tvalue"));
    assert.ok(!defs[0]?.matches("tab\\tvalue"));
    assert.ok(defs[1]?.matches("tab\\tvalue"));
  });

  test("implicit Behave decorators require the selected Behave context and cannot be shadowed", () => {
    const implicit = "@given('hello')\ndef hello(context): pass";
    assert.strictEqual(scanPythonStepDefinitions(implicit, undefined, false, true).length, 1);
    assert.deepStrictEqual(scanPythonStepDefinitions(implicit), []);
    const shadowed = "from helpers import given\n@given('hello')\ndef hello(context): pass";
    assert.deepStrictEqual(scanPythonStepDefinitions(shadowed, undefined, false, true), []);
  });

  test("scanner accepts literal pytest target fixtures but declines converter and local type uncertainty", () => {
    const targetFixture = "from pytest_bdd import given\n@given('bonjour', target_fixture='setup')\ndef setup(): pass";
    assert.strictEqual(scanPythonStepDefinitions(targetFixture).length, 1);
    const converter = "from pytest_bdd import given\n@given('bonjour', converters={})\ndef setup(): pass";
    assert.deepStrictEqual(scanPythonStepDefinitions(converter), []);
    const custom = "from behave import given, register_type\nregister_type(d=str)\n@given('value {value:d}')\ndef value(context): pass";
    assert.deepStrictEqual(scanPythonStepDefinitions(custom), []);
  });

  test("scanner uses the installed f spellings and declines incompatible or unknown parse fields", () => {
    const float = "from pytest_bdd import given, parsers\n@given(parsers.parse('value {value:f}'))\ndef value(): pass";
    const floatDefinition = scanPythonStepDefinitions(float)[0];
    assert.ok(floatDefinition?.matches("value NAN"));
    assert.ok(floatDefinition?.matches("value NaN"));
    const incompatible = "from pytest_bdd import given, parsers\n@given(parsers.parse('pair {value:d} {value:w}'))\ndef pair(): pass";
    assert.deepStrictEqual(scanPythonStepDefinitions(incompatible), []);
    const unknown = "from pytest_bdd import given, parsers\n@given(parsers.parse('value {value:Unknown} and {count:d}'))\ndef value(): pass";
    assert.deepStrictEqual(scanPythonStepDefinitions(unknown), []);
  });

  test("scanner retains generic steps and accepts one trailing comma", () => {
    const source = ["from pytest_bdd import step, parsers", "@step(parsers.parse(", "    'value {:d}',", "))", "def value(): pass"].join("\n");
    const definition = scanPythonStepDefinitions(source)[0];
    assert.strictEqual(definition?.keyword, "step");
    assert.ok(definition?.matches("value 0x10"));
  });

  test("scanner ignores triple delimiters in ordinary strings and closes commented triple content", () => {
    const quoted = ["marker = '\"\"\"'", "from behave import given", "@given('real')", "def real(context): pass"].join("\n");
    assert.strictEqual(scanPythonStepDefinitions(quoted).length, 1);
    const closed = ["'''open", "# '''", "from behave import given", "@given('real')", "def real(context): pass"].join("\n");
    assert.strictEqual(scanPythonStepDefinitions(closed).length, 1);
  });

  test("scanner folds source bindings and conditional state conservatively", () => {
    const restored = ["from helpers import other as setup", "from behave import given as setup", "@setup('real')", "def real(context): pass"].join("\n");
    assert.strictEqual(scanPythonStepDefinitions(restored).length, 1);
    const shadowed = ["from behave import given as setup", "from helpers import other as setup", "@setup('ghost')", "def ghost(context): pass"].join("\n");
    assert.deepStrictEqual(scanPythonStepDefinitions(shadowed), []);
    const conditional = ["from behave import given, use_step_matcher", "if enabled:", "    use_step_matcher('re')", "@given('not guessed')", "def guessed(context): pass"].join("\n");
    assert.deepStrictEqual(scanPythonStepDefinitions(conditional), []);
    const parserShadow = ["from pytest_bdd import given, parsers as p", "from helpers import replacement as p", "@given(p.parse('ghost {value:d}'))", "def ghost(): pass"].join("\n");
    assert.deepStrictEqual(scanPythonStepDefinitions(parserShadow), []);
    const invalidPrefix = "from behave import given\n@given(ru'ghost')\ndef ghost(context): pass";
    assert.deepStrictEqual(scanPythonStepDefinitions(invalidPrefix), []);
  });

  test("scanner invalidates aliases across conditional, class, foreign, and environment statements", () => {
    const conditional = ["from behave import given", "if enabled:", "    given = custom", "@given('ghost')", "def ghost(context): pass"].join("\n");
    assert.deepStrictEqual(scanPythonStepDefinitions(conditional, undefined, false, true), []);
    const classShadow = ["from behave import given", "class given:", "    pass", "@given('ghost')", "def ghost(context): pass"].join("\n");
    assert.deepStrictEqual(scanPythonStepDefinitions(classShadow, undefined, false, true), []);
    const matcherShadow = ["from behave import given, use_step_matcher as select", "select('re')", "from helpers import select", "@given('value \\d+')", "def value(context): pass"].join("\n");
    assert.deepStrictEqual(scanPythonStepDefinitions(matcherShadow), []);
    assert.deepStrictEqual(scanBehaveEnvironment(matcherShadow), { matcher: undefined, customTypes: false });
    const registrarShadow = ["from behave import register_type as register", "from helpers import register", "register(value=str)"].join("\n");
    assert.deepStrictEqual(scanBehaveEnvironment(registrarShadow), { matcher: "parse", customTypes: true });
  });

  test("scanner keeps known parser aliases and handles ordinary comments", () => {
    const parser = ["from pytest_bdd import given", "import pytest_bdd.parsers as p", "@given(p.parse('value {value:d}'))", "def value(): pass"].join("\n");
    assert.ok(scanPythonStepDefinitions(parser)[0]?.matches("value 12"));
    assert.ok(scanPythonStepDefinitions(parser.replace("import pytest_bdd.parsers as p", "import os, pytest_bdd.parsers as p"))[0]?.matches("value 12"));
    const commented = ["from behave import given", "@given( # decorator", "  'real' # literal", ") # close", "def real(context): pass"].join("\n");
    assert.ok(scanPythonStepDefinitions(commented)[0]?.matches("real"));
    const unknownBehave = ["from behave import fixture as given", "@given('ghost')", "def ghost(context): pass"].join("\n");
    assert.deepStrictEqual(scanPythonStepDefinitions(unknownBehave, undefined, false, true), []);
  });

  test("binding map preserves only source-proven roles", () => {
    const cases: ReadonlyArray<readonly [string, string, number]> = [
      ["conditional assignment", ["from behave import given", "if enabled:", "    given = custom", "@given('ghost')", "def ghost(context): pass"].join("\n"), 0],
      ["parser-as-decorator", ["from pytest_bdd import parsers as given", "@given('ghost')", "def ghost(context): pass"].join("\n"), 0],
      ["foreign no-as matcher", ["from behave import given, use_step_matcher as select", "select('re')", "from helpers import select", "@given('value \\d+')", "def value(context): pass"].join("\n"), 0],
      ["class without bases", ["from behave import given", "class given:", "    pass", "@given('ghost')", "def ghost(context): pass"].join("\n"), 0],
      ["supported parser import", ["from pytest_bdd import given", "import pytest_bdd.parsers as p", "@given(p.parse('value {value:d}'))", "def value(): pass"].join("\n"), 1],
      ["commented multiline decorator", ["from behave import given", "@given( # opening", "", "  'real' # literal", ") # close", "def real(context): pass"].join("\n"), 1],
    ];
    for (const [name, source, count] of cases) {assert.strictEqual(scanPythonStepDefinitions(source, undefined, false, true).length, count, name);}
    assert.deepStrictEqual(scanBehaveEnvironment(["from behave import register_type as register", "from helpers import register", "register(value=str)"].join("\n")), { matcher: "parse", customTypes: true });
  });

  test("binding fold preserves literal equals and recognized keyword calls", () => {
    const target = ["from pytest_bdd import given", "@given('value=a', target_fixture='setup')", "def setup(): pass"].join("\n");
    assert.ok(scanPythonStepDefinitions(target)[0]?.matches("value=a"));
    const literal = ["from behave import given", "@given('a=b')", "def value(context): pass"].join("\n");
    assert.ok(scanPythonStepDefinitions(literal)[0]?.matches("a=b"));
    assert.deepStrictEqual(scanBehaveEnvironment(["from behave import register_type", "register_type(value=str)"].join("\n")), { matcher: "parse", customTypes: true });
  });

  test("scanner retains every English fixture binding after function-body assignments", () => {
    const fixture = fs.readFileSync(path.resolve(__dirname, "../../../src/test/fixtures/keywords/behave_english_aliases.py"), "utf8");
    assert.deepStrictEqual(scanPythonStepDefinitions(fixture).map((definition) => definition.line + 1), [11, 16, 21, 26]);
  });

  test("binding fold invalidates loop, manager, and deletion targets", () => {
    for (const statement of ["for given in decorators:", "with manager() as given:", "del given"]) {
      const source = ["from behave import given", statement, "@given('ghost')", "def ghost(context): pass"].join("\n");
      assert.deepStrictEqual(scanPythonStepDefinitions(source, undefined, false, true), [], statement);
    }
  });

  test("incomplete matcher calls cannot retain a prior matcher", () => {
    const trailing = ["from behave import given, use_step_matcher", "use_step_matcher('re');", "@given(r'value \\d+')", "def value(context): pass"].join("\n");
    assert.strictEqual(scanPythonStepDefinitions(trailing)[0]?.pattern, "value \\d+");
    const multiline = ["from behave import given, use_step_matcher", "use_step_matcher(", "  're'", ")", "@given('value')", "def value(context): pass"].join("\n");
    assert.deepStrictEqual(scanPythonStepDefinitions(multiline), []);
  });

  test("logical declaration framing distinguishes module rebindings from helper locals", () => {
    const cases: ReadonlyArray<readonly [string, string, string, number]> = [
      ["tuple assignment", "given, other = replacement, None", "ghost", 0],
      ["tuple loop", "for given, other in decorators:\n    pass", "ghost", 0],
      ["tuple deletion", "del given, other", "ghost", 0],
      ["async declaration", "async def given():\n    pass", "ghost", 0],
      ["async helper local", "async def helper():\n    given = replacement", "real", 1],
      ["multiline helper local", "def helper(\n):\n    given = replacement", "real", 1],
    ];
    for (const [name, body, text, expected] of cases) {
      const source = ["from behave import given", body, `@given('${text}')`, "def step(context): pass"].join("\n");
      assert.strictEqual(scanPythonStepDefinitions(source, undefined, false, true).filter((definition) => definition.matches(text)).length, expected, name);
    }
  });

  test("logical framing isolates helper state and resolves only binding targets", () => {
    const helperEnvironment = [
      "from behave import register_type, use_step_matcher",
      "async def helper():",
      "    register_type = replacement",
      "    register_type(value=str)",
      "    use_step_matcher = replacement",
      "    use_step_matcher('re')",
      "def second(",
      "):",
      "    register_type(value=str)",
      "    use_step_matcher('re')",
    ].join("\n");
    assert.deepStrictEqual(scanBehaveEnvironment(helperEnvironment), { matcher: "parse", customTypes: false });
    assert.deepStrictEqual(scanBehaveEnvironment(["from behave import register_type, use_step_matcher", "use_step_matcher('re')", "register_type(value=str)"].join("\n")), { matcher: "re", customTypes: true });

    const cases: ReadonlyArray<readonly [string, string, number]> = [
      ["one-line helper local", "def helper(): given = replacement", 1],
      ["nested assignment target", "((given, [other]), *rest) = replacement", 0],
      ["nested loop target", "for (given, [other]), *rest in decorators:\n    pass", 0],
      ["nested deletion target", "del (given, [other])", 0],
      ["annotated unrelated target", "other: object = replacement", 1],
      ["annotated decorator target", "given: object = replacement", 0],
      ["chained decorator target", "other = given = replacement", 0],
      ["quoted and keyword equals", "helper(value=given)\nmessage = 'given=a'", 1],
    ];
    for (const [name, body, expected] of cases) {
      const source = ["from behave import given", body, "@given('real')", "def step(context): pass"].join("\n");
      assert.strictEqual(scanPythonStepDefinitions(source, undefined, false, true).length, expected, name);
    }
  });

  test("expression effects conservatively update module bindings and matcher state", () => {
    for (const body of ["(given := replacement)", "if (given := replacement):", "other = (given := replacement)"]) {
      const source = ["from behave import given", body, "@given('ghost')", "def step(context): pass"].join("\n");
      assert.deepStrictEqual(scanPythonStepDefinitions(source, undefined, false, true), [], body);
      assert.deepStrictEqual(scanBehaveEnvironment(source), { matcher: "parse", customTypes: false }, body);
    }

    const conditionalMatcher = ["from behave import given, use_step_matcher", "if use_step_matcher('re'):", "@given(r'value \\d+')", "def value(context): pass"].join("\n");
    assert.deepStrictEqual(scanPythonStepDefinitions(conditionalMatcher), []);
    assert.deepStrictEqual(scanBehaveEnvironment(conditionalMatcher), { matcher: undefined, customTypes: false });
    const conditionalRegistrar = ["from behave import given, register_type", "if register_type(d=custom):", "@given('value {value:d}')", "def value(context): pass"].join("\n");
    assert.deepStrictEqual(scanPythonStepDefinitions(conditionalRegistrar), []);
    assert.deepStrictEqual(scanBehaveEnvironment(conditionalRegistrar), { matcher: "parse", customTypes: true });

    const matcherEffects: ReadonlyArray<readonly [string, string]> = [
      ["right-hand call", "other = use_step_matcher('re')"],
      ["nested call", "nested(use_step_matcher('cfparse'))"],
      ["helper default", "use_step_matcher('re')\ndef helper(mode=use_step_matcher('parse')): pass"],
    ];
    for (const [name, body] of matcherEffects) {
      assert.deepStrictEqual(scanBehaveEnvironment(["from behave import use_step_matcher", body].join("\n")), { matcher: undefined, customTypes: false }, name);
    }
    for (const [name, body] of [["right-hand registrar", "other = register_type(d=custom)"], ["nested registrar", "nested(register_type(f=custom))"], ["helper default registrar", "def helper(value=register_type(w=custom)): pass"]] as const) {
      assert.deepStrictEqual(scanBehaveEnvironment(["from behave import register_type", body].join("\n")), { matcher: "parse", customTypes: true }, name);
    }

    const quotedNames = ["from behave import use_step_matcher", "marker = ':='", "message = \"use_step_matcher('re')\""].join("\n");
    assert.deepStrictEqual(scanBehaveEnvironment(quotedNames), { matcher: "parse", customTypes: false });
    const helperWalrus = ["from behave import given", "def helper(): (given := replacement)", "@given('real')", "def value(context): pass"].join("\n");
    assert.strictEqual(scanPythonStepDefinitions(helperWalrus).length, 1);
    const directMatcher = ["from behave import given, use_step_matcher", "use_step_matcher('re')", "@given(r'value \\d+')", "def value(context): pass"].join("\n");
    assert.strictEqual(scanPythonStepDefinitions(directMatcher)[0]?.pattern, "value \\d+");
    assert.deepStrictEqual(scanBehaveEnvironment(directMatcher), { matcher: "re", customTypes: false });
  });

  test("conditional state respects quoted and bracketed colons and inline loop bodies", () => {
    for (const header of ["if values[1:]:", "if 'x:y':", "for value in values:", "with manager() as value:"]) {
      const matcher = ["from behave import given, use_step_matcher", `${header} use_step_matcher('re')`, "@given('value')", "def value(context): pass"].join("\n");
      assert.deepStrictEqual(scanPythonStepDefinitions(matcher), [], header);
      assert.strictEqual(scanBehaveEnvironment(matcher).matcher, undefined, header);
      const registrar = ["from behave import given, register_type", `${header} register_type(d=custom)`, "@given('value {value:d}')", "def value(context): pass"].join("\n");
      assert.deepStrictEqual(scanPythonStepDefinitions(registrar), [], header);
      assert.strictEqual(scanBehaveEnvironment(registrar).customTypes, true, header);
    }
  });

  test("continuations stop at section boundaries and unresolved outline values", () => {
    const provider = new StepDefinitionProvider([]) as unknown as { stepContext(content: string, line: number, parser: FeatureParser): unknown };
    const parser = FeatureParser.create();
    const nextScenario = ["Feature: boundaries", "  Then previous", "  Scenario: next", "    And current"].join("\n");
    assert.strictEqual(provider.stepContext(nextScenario, 3, parser), undefined);
    const unresolvedOutline = ["Feature: outline", "  Scenario Outline: row", "    Given I have <count>", "    Examples:", "      | other |", "      | 1 |"].join("\n");
    assert.strictEqual(provider.stepContext(unresolvedOutline, 2, parser), undefined);
    const angleValue = ["Feature: outline", "  Scenario Outline: row", "    Given I have <value>", "    Examples:", "      | value |", "      | <7> |"].join("\n");
    assert.deepStrictEqual(provider.stepContext(angleValue, 2, parser), { kind: "given", texts: ["I have <7>"] });
  });
});
