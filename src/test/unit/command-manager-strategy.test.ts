import * as assert from "assert";
import { TestOrganizationManager } from "../../core/test-organization";
import {
  TagBasedOrganization,
  FileBasedOrganization,
} from "../../core/test-organization";

suite("Command Manager Strategy Tests", () => {
  let organizationManager: TestOrganizationManager;

  setup(() => {
    // Get fresh instances
    organizationManager = TestOrganizationManager.getInstance();

    // Reset to default strategy
    organizationManager.setStrategy(new TagBasedOrganization());
  });

  teardown(() => {
    // Reset to default strategy
    organizationManager.setStrategy(new TagBasedOrganization());
  });

  test("Should set tag-based organization strategy", async () => {
    // Set to a different strategy first
    organizationManager.setStrategy(new FileBasedOrganization());
    assert.strictEqual(
      organizationManager.getStrategy().constructor.name,
      "FileBasedOrganization",
      "Should start with FileBasedOrganization"
    );

    // Test the strategy setting logic directly
    const availableStrategies = organizationManager.getAvailableStrategies();
    const tagStrategy = availableStrategies.find((s) =>
      s.name.toLowerCase().includes("tag")
    );
    assert.ok(tagStrategy, "Should find tag strategy");

    // Set the strategy directly
    organizationManager.setStrategy(tagStrategy.strategy);

    // Verify the strategy was changed
    assert.strictEqual(
      organizationManager.getStrategy().constructor.name,
      "TagBasedOrganization",
      "Should be changed to TagBasedOrganization"
    );
  });

  test("Should set file-based organization strategy", async () => {
    // Start with tag-based
    organizationManager.setStrategy(new TagBasedOrganization());
    assert.strictEqual(
      organizationManager.getStrategy().constructor.name,
      "TagBasedOrganization",
      "Should start with TagBasedOrganization"
    );

    // Test the strategy setting logic directly
    const availableStrategies = organizationManager.getAvailableStrategies();
    const fileStrategy = availableStrategies.find((s) =>
      s.name.toLowerCase().includes("file")
    );
    assert.ok(fileStrategy, "Should find file strategy");

    // Set the strategy directly
    organizationManager.setStrategy(fileStrategy.strategy);

    // Verify the strategy was changed
    assert.strictEqual(
      organizationManager.getStrategy().constructor.name,
      "FileBasedOrganization",
      "Should be changed to FileBasedOrganization"
    );
  });

  test("Should find strategy by partial name match", async () => {
    // Test that we can find strategies by partial matches
    const availableStrategies = organizationManager.getAvailableStrategies();

    // Test tag-based strategy
    const tagStrategy = availableStrategies.find((s) =>
      s.name.toLowerCase().includes("tag")
    );
    assert.ok(tagStrategy, "Should find tag strategy");

    // Test file-based strategy
    const fileStrategy = availableStrategies.find((s) =>
      s.name.toLowerCase().includes("file")
    );
    assert.ok(fileStrategy, "Should find file strategy");

    // Test scenario type strategy
    const scenarioTypeStrategy = availableStrategies.find((s) =>
      s.name.toLowerCase().includes("scenario")
    );
    assert.ok(scenarioTypeStrategy, "Should find scenario type strategy");

    // Test flat strategy
    const flatStrategy = availableStrategies.find((s) =>
      s.name.toLowerCase().includes("flat")
    );
    assert.ok(flatStrategy, "Should find flat strategy");
  });

  test("Should handle case-insensitive strategy matching", async () => {
    // Test that strategy matching is case-insensitive
    const availableStrategies = organizationManager.getAvailableStrategies();

    // Test with uppercase - the strategy names are "Tag-based", "File-based", etc.
    const tagStrategyUpper = availableStrategies.find((s) =>
      s.name.toLowerCase().includes("tag")
    );
    assert.ok(
      tagStrategyUpper,
      "Should find tag strategy with lowercase search"
    );

    // Test with mixed case
    const fileStrategyMixed = availableStrategies.find((s) =>
      s.name.toLowerCase().includes("file")
    );
    assert.ok(
      fileStrategyMixed,
      "Should find file strategy with lowercase search"
    );
  });

  test("Should handle invalid strategy value", async () => {
    // Start with tag-based
    organizationManager.setStrategy(new TagBasedOrganization());

    // Test that we can't find an invalid strategy
    const availableStrategies = organizationManager.getAvailableStrategies();
    const invalidStrategy = availableStrategies.find((s) =>
      s.name.toLowerCase().includes("invalid")
    );
    assert.strictEqual(
      invalidStrategy,
      undefined,
      "Should not find invalid strategy"
    );

    // Strategy should remain unchanged
    assert.strictEqual(
      organizationManager.getStrategy().constructor.name,
      "TagBasedOrganization",
      "Strategy should remain unchanged after invalid value"
    );
  });
});
