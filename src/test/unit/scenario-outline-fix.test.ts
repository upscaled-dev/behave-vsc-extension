import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CommandManager } from "../../commands/command-manager";

suite("Scenario Outline Fix Tests", () => {
  let commandManager: CommandManager;
  let testFeaturePath: string;

  // Self-contained feature file written with explicit `\n` so the test does not
  // depend on the working directory, the repo layout, or the checkout's line
  // endings (CRLF on Windows would otherwise make this flaky). Line numbers
  // below are referenced by the assertions: line 8 is the regular Scenario,
  // line 14 is the Scenario Outline.
  const FEATURE_CONTENT = [
    "@feature @test-scenario-outline", // 1
    "Feature: Test Scenario Outline Detection", // 2
    "  As a test developer", // 3
    "  I want to test scenario outline detection", // 4
    "  So that I can validate the detection logic", // 5
    "", // 6
    "  @smoke @regular", // 7
    "  Scenario: Regular scenario", // 8
    "    Given I am on the test page", // 9
    "    When I click the test button", // 10
    "    Then I should see the test result", // 11
    "", // 12
    "  @smoke @outline", // 13
    "  Scenario Outline: Test with different values", // 14
    '    Given I have a "<input>" value', // 15
    "    When I process the input", // 16
    '    Then I should get "<expected>" result', // 17
    "", // 18
    "    Examples:", // 19
    "      | input | expected |", // 20
    "      | hello | world    |", // 21
  ].join("\n");

  setup(() => {
    commandManager = CommandManager.getInstance();
    testFeaturePath = path.join(os.tmpdir(), "scenario-outline-fix.test.feature");
    fs.writeFileSync(testFeaturePath, FEATURE_CONTENT, "utf-8");
  });

  teardown(() => {
    CommandManager.clearInstance();
    try {
      fs.unlinkSync(testFeaturePath);
    } catch {
      /* best effort cleanup */
    }
  });

  test("Should detect scenario outline correctly", () => {
    // Line 14 = "Scenario Outline: Test with different values"
    const isOutline = (commandManager as any).isScenarioOutline(
      testFeaturePath,
      14,
      "Test with different values"
    );

    assert.strictEqual(
      isOutline,
      true,
      "Should detect scenario outline correctly"
    );
  });

  test("Should not detect regular scenario as outline", () => {
    // Line 8 = "Scenario: Regular scenario"
    const isOutline = (commandManager as any).isScenarioOutline(
      testFeaturePath,
      8,
      "Regular scenario"
    );

    assert.strictEqual(
      isOutline,
      false,
      "Should not detect regular scenario as outline"
    );
  });

  test("Should handle non-existent file gracefully", () => {
    const nonExistentPath = path.join(os.tmpdir(), "definitely-not-here.feature");
    const isOutline = (commandManager as any).isScenarioOutline(
      nonExistentPath,
      10,
      "Some scenario"
    );

    assert.strictEqual(
      isOutline,
      false,
      "Should handle non-existent file gracefully"
    );
  });
});
