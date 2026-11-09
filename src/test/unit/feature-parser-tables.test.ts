import * as assert from "assert";
import * as path from "node:path";
import { FeatureParser } from "../../parsers/feature-parser.js";

suite("FeatureParser Background tables", () => {
  test("keeps feature and Rule Background collection active through table rows", () => {
    const file = path.resolve(__dirname, "../../../src/test/fixtures/tables/background-tables.feature");
    const parsed = FeatureParser.create().parseFeatureFile(file);
    assert.ok(parsed);
    const scenarios = [...parsed.scenarios].sort((a, b) => a.lineNumber - b.lineNumber);
    assert.deepStrictEqual(scenarios.map((scenario) => [scenario.lineNumber, scenario.outlineLineNumber,
      scenario.examplesBlockLineNumber, scenario.ruleName, scenario.tags]), [
      [22, 18, 20, "Left table scope", ["@table_feature", "@left_rule", "@left_outline"]],
      [23, 18, 20, "Left table scope", ["@table_feature", "@left_rule", "@left_outline"]],
      [34, undefined, undefined, "Right table scope", ["@table_feature", "@right_rule", "@right_leaf"]],
    ]);
    assert.deepStrictEqual(scenarios.map((scenario) => scenario.backgroundSteps), [
      ["Given I receive table setup \"feature\":", "And I retain table setup \"feature\"", "Given I receive table setup \"left\":", "But I retain table setup \"left\""],
      ["Given I receive table setup \"feature\":", "And I retain table setup \"feature\"", "Given I receive table setup \"left\":", "But I retain table setup \"left\""],
      ["Given I receive table setup \"feature\":", "And I retain table setup \"feature\"", "Given I receive table setup \"right\":", "And I retain table setup \"right\""],
    ]);
  });
});
