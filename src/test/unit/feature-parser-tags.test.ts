import * as assert from "node:assert";
import * as path from "node:path";
import { FeatureParser } from "../../parsers/feature-parser";

suite("Inherited tag scope Unit Tests", () => {
  const parser = FeatureParser.create();
  const fixture = (name: string) => parser.parseFeatureFile(path.resolve(__dirname, `../../../src/test/fixtures/tags/${name}.feature`))!;

  test("Inherited tag scope reaches every feature child without a Background in deterministic order", () => {
    const source = ["@feature @shared", "@feature", "# Between feature tags and heading", "Feature: Scope", "  @own @shared @own",
      "  Scenario: First", "    Given a result", "  # Between siblings", "  Scenario: Second", "    Given a result"].join("\r\n");
    const parsed = parser.parseFeatureContent(source)!;
    assert.deepStrictEqual(parsed.scenarios.map((scenario) => [scenario.lineNumber, scenario.tags]), [
      [6, ["@feature", "@shared", "@own"]], [9, ["@feature", "@shared"]],
    ]);
  });

  test("Inherited tag scope survives Background and merges only each Examples block's own tags", () => {
    const parsed = fixture("inherited");
    assert.deepStrictEqual(parsed.scenarios.map((scenario) => [scenario.lineNumber, scenario.tags]), [
      [8, ["@tag_feature", "@tag_shared", "@tag_direct"]], [11, ["@tag_feature", "@tag_shared"]],
      [29, ["@tag_feature", "@tag_shared"]],
      [21, ["@tag_feature", "@tag_shared", "@tag_outline", "@tag_left"]],
      [22, ["@tag_feature", "@tag_shared", "@tag_outline", "@tag_left"]],
      [27, ["@tag_feature", "@tag_shared", "@tag_outline", "@tag_right"]],
    ]);
    for (const scenario of parsed.scenarios) {assert.deepStrictEqual(scenario.backgroundSteps, ['Given tag scope setup "feature"']);}
    assert.deepStrictEqual(parsed.scenarios.filter((scenario) => scenario.isScenarioOutline).map((scenario) =>
      [scenario.outlineLineNumber, scenario.examplesBlockLineNumber, scenario.examplesBlockTags]), [
      [15, 19, ["@tag_left", "@tag_shared"]], [15, 19, ["@tag_left", "@tag_shared"]], [15, 25, ["@tag_right", "@tag_shared"]],
    ]);
  });

  test("Inherited tag scope resets at sibling Rules while retaining feature and block metadata", () => {
    const parsed = fixture("rules");
    const common = ["@tag_rule_feature", "@tag_shared"];
    assert.deepStrictEqual(parsed.scenarios.map((scenario) => [scenario.lineNumber, scenario.ruleName, scenario.tags, scenario.backgroundSteps]), [
      [6, undefined, common, ['Given tag scope setup "feature"']],
      [15, "Red scope", [...common, "@tag_red", "@tag_direct"], ['Given tag scope setup "feature"', 'Given tag scope setup "red"']],
      [37, "Blue scope", [...common, "@tag_blue"], ['Given tag scope setup "feature"', 'Given tag scope setup "blue"']],
      [44, "Plain scope", common, ['Given tag scope setup "feature"', 'Given tag scope setup "plain"']],
      [25, "Red scope", [...common, "@tag_red", "@tag_outline", "@tag_left"], ['Given tag scope setup "feature"', 'Given tag scope setup "red"']],
      [30, "Red scope", [...common, "@tag_red", "@tag_outline", "@tag_right"], ['Given tag scope setup "feature"', 'Given tag scope setup "red"']],
    ]);
  });

  test("Inherited tag scope is local to each parse and ignores tag-like docstring payloads", () => {
    fixture("rules");
    const parsed = parser.parseFeatureContent('Feature: Plain\n  Scenario: Real\n    Given a payload\n      """\n      @phantom\n      Rule: Phantom\n      """\n  Scenario: Following\n    Given a result\n')!;
    assert.deepStrictEqual(parsed.scenarios.map((scenario) => [scenario.name, scenario.tags, scenario.ruleName]), [["Real", [], undefined], ["Following", [], undefined]]);
  });
});
