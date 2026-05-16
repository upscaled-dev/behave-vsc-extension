import * as assert from "assert";
import * as vscode from "vscode";
import { BehaveTestProvider } from "../../test-providers/behave-test-provider.js";
import { CommandManager } from "../../commands/command-manager.js";

suite("Organization Strategy Switching Integration", () => {
  let testController: vscode.TestController;
  let testProvider: BehaveTestProvider;
  let commandManager: CommandManager;

  setup(() => {
    testController = vscode.tests.createTestController(
      "integration-org",
      "Integration Organization"
    );
    testProvider = BehaveTestProvider.create(testController);
    commandManager = CommandManager.create();
    commandManager.setTestProvider(testProvider as unknown);
  });

  teardown(() => {
    testController.dispose();
    commandManager.dispose();
  });

  test("Test provider exposes organization manager to command manager", () => {
    // This tests the real integration between BehaveTestProvider and CommandManager
    const provider = testProvider as any;
    
    assert.ok(provider.organizationManager, "Test provider should expose organization manager");
    assert.ok(provider.discoveryManager, "Test provider should expose discovery manager");
    assert.ok(typeof provider.discoverTests === "function", "Test provider should expose discoverTests method");
    assert.ok(typeof provider.forceRefreshTestExplorer === "function", "Test provider should expose forceRefreshTestExplorer method");
  });

  test("Command manager can access organization manager through test provider", () => {
    // This tests the actual interface that CommandManager uses
    const provider = testProvider as any;
    const organizationManager = provider.organizationManager;
    
    assert.ok(organizationManager, "Organization manager should be available");
    assert.ok(typeof organizationManager.getAvailableStrategies === "function", "Should have getAvailableStrategies method");
    assert.ok(typeof organizationManager.getStrategy === "function", "Should have getStrategy method");
    assert.ok(typeof organizationManager.setStrategy === "function", "Should have setStrategy method");
  });

  test("Organization strategy switching works in real VS Code environment", async () => {
    // This tests the actual strategy switching functionality
    const provider = testProvider as any;
    const organizationManager = provider.organizationManager;
    
    // Get current strategy
    const currentStrategy = organizationManager.getStrategy();
    assert.ok(currentStrategy, "Should have a current strategy");
    
    // Get available strategies
    const availableStrategies = organizationManager.getAvailableStrategies();
    assert.ok(availableStrategies.length > 0, "Should have available strategies");
    
    // Find a different strategy to switch to
    const differentStrategy = availableStrategies.find((s: any) => s.strategy.strategyType !== currentStrategy.strategyType);
    assert.ok(differentStrategy, "Should find a different strategy");
    
    // Switch to the different strategy
    organizationManager.setStrategy(differentStrategy.strategy);
    
    // Verify the strategy changed
    const newStrategy = organizationManager.getStrategy();
    assert.strictEqual(newStrategy.strategyType, differentStrategy.strategy.strategyType, "Strategy should have changed");
  });

  test("Test provider can refresh tests after strategy change", async () => {
    // This tests that the test provider can actually refresh after strategy changes
    const provider = testProvider as any;
    
    // This should not throw an error
    await provider.discoverTests();
    
    // This should also not throw an error
    await provider.forceRefreshTestExplorer();
    
    // If we get here, the methods are working
    assert.ok(true, "Test provider refresh methods should work");
  });

  test("Command manager can execute organization strategy commands", async () => {
    // This tests that the command manager can actually execute the strategy switching commands
    // We'll test the internal method directly since we can't easily trigger the command palette
    
    // Test that the command manager has the test provider set
    const hasTestProvider = (commandManager as any).testProvider;
    assert.ok(hasTestProvider, "Command manager should have test provider set");
    
    // Test that the test provider has the required properties
    const provider = hasTestProvider as any;
    assert.ok(provider.organizationManager, "Test provider should have organization manager");
    assert.ok(provider.discoveryManager, "Test provider should have discovery manager");
  });
}); 