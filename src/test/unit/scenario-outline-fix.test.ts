import * as assert from "assert";
import * as path from "path";
import { CommandManager } from "../../commands/command-manager";

suite("Scenario Outline Fix Tests", () => {
  let commandManager: CommandManager;

  setup(() => {
    commandManager = CommandManager.getInstance();
  });

  teardown(() => {
    CommandManager.clearInstance();
  });

  test("Should detect scenario outline correctly", () => {
    // Test with a real feature file - use path relative to project root
    const testFeaturePath = path.join(
      process.cwd(),
      "features/test-scenario-outline.feature"
    );

    // Test scenario outline detection
    const isOutline = (commandManager as any).isScenarioOutline(
      testFeaturePath,
      14, // Line number of "Scenario Outline: Test with different values"
      "Test with different values"
    );

    assert.strictEqual(
      isOutline,
      true,
      "Should detect scenario outline correctly"
    );
  });

  test("Should not detect regular scenario as outline", () => {
    const testFeaturePath = path.join(
      process.cwd(),
      "features/test-scenario-outline.feature"
    );

    // Test regular scenario detection
    const isOutline = (commandManager as any).isScenarioOutline(
      testFeaturePath,
      8, // Line number of "Scenario: Regular scenario"
      "Regular scenario"
    );

    assert.strictEqual(
      isOutline,
      false,
      "Should not detect regular scenario as outline"
    );
  });

  test("Should handle non-existent file gracefully", () => {
    const nonExistentPath = "/path/to/nonexistent.feature";
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
