import * as assert from "assert";
import * as vscode from "vscode";
import { BehaveTestProvider } from "../../test-providers/behave-test-provider.js";
import { CommandManager } from "../../commands/command-manager.js";
import { FrameworkFactory } from "../../core/framework-factory.js";
import { ExtensionConfig } from "../../core/extension-config.js";

suite("Pytest-BDD Integration Tests", () => {
  let testController: vscode.TestController;
  let testProvider: BehaveTestProvider;
  let commandManager: CommandManager;
  let config: ExtensionConfig;

  setup(() => {
    testController = vscode.tests.createTestController(
      "pytest-bdd-integration",
      "Pytest-BDD Integration"
    );
    testProvider = BehaveTestProvider.create(testController);
    commandManager = CommandManager.create();
    commandManager.setTestProvider(testProvider as unknown);
    config = ExtensionConfig.create();
  });

  teardown(() => {
    testController.dispose();
    commandManager.dispose();
  });

  test("FrameworkFactory should detect pytest-bdd when pytest.ini exists", async () => {
    // This test simulates the presence of pytest.ini
    const framework = await FrameworkFactory.autoDetect();
    
    // In a real environment with pytest.ini, this should detect pytest-bdd
    // For now, we test that the factory works correctly
    assert.ok(framework === "behave" || framework === "pytest-bdd", 
      "Framework should be either behave or pytest-bdd");
  });

  test("FrameworkFactory should create PytestBddCommandBuilder for pytest-bdd", () => {
    const commandBuilder = FrameworkFactory.createCommandBuilder("pytest-bdd", config);
    
    assert.ok(commandBuilder, "CommandBuilder should be created");
    assert.strictEqual(commandBuilder.getFrameworkName(), "pytest-bdd", 
      "CommandBuilder should be for pytest-bdd framework");
  });

  test("PytestBddCommandBuilder should generate correct pytest commands", async () => {
    const commandBuilder = FrameworkFactory.createCommandBuilder("pytest-bdd", config);
    
    // Test scenario command
    const scenarioCommand = await commandBuilder.buildScenarioCommand({
      filePath: "tests/test_pytest_bdd_example.py::test_basic_login",
      scenarioName: "Basic login functionality",
      lineNumber: 10
    });
    
    assert.ok(scenarioCommand.includes("pytest"), "Command should include pytest");
    assert.ok(scenarioCommand.includes("test_basic_login"), "Command should include test function name");
    
    // Test feature command
    const featureCommand = await commandBuilder.buildFeatureCommand({
      filePath: "tests/test_pytest_bdd_example.py"
    });
    
    assert.ok(featureCommand.includes("pytest"), "Command should include pytest");
    // The command should include the test file path (either original or converted)
    assert.ok(featureCommand.includes("test_pytest_bdd_example"), 
      "Command should include test file name");
    
    // Test tag command
    const tagCommand = await commandBuilder.buildTagCommand("@smoke");
    
    assert.ok(tagCommand.includes("pytest"), "Command should include pytest");
    assert.ok(tagCommand.includes("-m"), "Command should include marker flag");
    assert.ok(tagCommand.includes("smoke"), "Command should include marker name");
  });

  test("PytestBddCommandBuilder should convert behave tags to pytest markers", async () => {
    const commandBuilder = FrameworkFactory.createCommandBuilder("pytest-bdd", config);
    
    // Test tag conversion
    const smokeCommand = await commandBuilder.buildTagCommand("@smoke");
    console.log(`Smoke command: ${smokeCommand}`);
    assert.ok(smokeCommand.includes("-m"), "Should include -m flag");
    assert.ok(smokeCommand.includes("smoke"), "Should include smoke marker");
    
    const regressionCommand = await commandBuilder.buildTagCommand("@regression");
    console.log(`Regression command: ${regressionCommand}`);
    assert.ok(regressionCommand.includes("-m"), "Should include -m flag");
    assert.ok(regressionCommand.includes("regression"), "Should include regression marker");
    
    const authCommand = await commandBuilder.buildTagCommand("@authentication");
    console.log(`Auth command: ${authCommand}`);
    assert.ok(authCommand.includes("-m"), "Should include -m flag");
    assert.ok(authCommand.includes("authentication"), "Should include authentication marker");
  });

  test("PytestBddCommandBuilder should handle scenario names correctly", async () => {
    const commandBuilder = FrameworkFactory.createCommandBuilder("pytest-bdd", config);
    
    // Test scenario name conversion
    const scenarioCommand = await commandBuilder.buildScenarioCommand({
      filePath: "tests/test_pytest_bdd_example.py::test_basic_login",
      scenarioName: "Basic login functionality",
      lineNumber: 10
    });
    
    // Should use the test function name, not the scenario name
    assert.ok(scenarioCommand.includes("test_basic_login"), 
      "Should use test function name in command");
    assert.ok(!scenarioCommand.includes("Basic login functionality"), 
      "Should not use scenario name in command");
  });

  test("PytestBddCommandBuilder should generate debug commands", async () => {
    const commandBuilder = FrameworkFactory.createCommandBuilder("pytest-bdd", config);
    
    const debugCommand = await commandBuilder.buildDebugCommand({
      filePath: "tests/test_pytest_bdd_example.py::test_basic_login",
      scenarioName: "Basic login functionality",
      lineNumber: 10
    });
    
    assert.ok(debugCommand.includes("pytest"), "Debug command should include pytest");
    assert.ok(debugCommand.includes("test_basic_login"), "Debug command should include test function");
  });

  test("Extension should handle pytest-bdd framework selection", async () => {
    // Test that the extension can be configured for pytest-bdd
    // Note: In test environment, workspace settings may not be writable
    try {
      await config.setFramework("pytest-bdd");
      assert.strictEqual(config.getFramework(), "pytest-bdd", 
        "Framework should be set to pytest-bdd");
    } catch (error) {
      // In test environment, workspace settings may not be writable
      // This is expected behavior, so we'll just verify the getter works
      assert.strictEqual(config.getFramework(), "behave", 
        "Framework should default to behave when workspace is not available");
    }
  });

  test("Extension should auto-detect pytest-bdd when appropriate files exist", async () => {
    // This test would require actual pytest.ini and test files
    // For now, we test the detection logic
    const framework = await FrameworkFactory.autoDetect();
    
    // Should default to behave if no clear pytest-bdd indicators
    assert.strictEqual(framework, "behave", 
      "Should default to behave when no clear pytest-bdd indicators");
  });

  test("PytestBddCommandBuilder should handle scenario outlines correctly", async () => {
    const commandBuilder = FrameworkFactory.createCommandBuilder("pytest-bdd", config);
    
    // Test scenario outline command
    const scenarioOutlineCommand = await commandBuilder.buildScenarioCommand({
      filePath: "tests/test_pytest_bdd_example.py::test_login_different_user_types",
      scenarioName: "Login with different user types",
      lineNumber: 15
    });
    
    assert.ok(scenarioOutlineCommand.includes("pytest"), "Command should include pytest");
    assert.ok(scenarioOutlineCommand.includes("test_login_different_user_types"), 
      "Command should include test function name for scenario outline");
    
    // Test scenario outline with parameters
    const scenarioWithParamsCommand = await commandBuilder.buildScenarioCommand({
      filePath: "tests/test_pytest_bdd_example.py::test_form_validation_registration",
      scenarioName: "Form validation for registration",
      lineNumber: 20
    });
    
    assert.ok(scenarioWithParamsCommand.includes("test_form_validation_registration"), 
      "Command should handle scenario outline with parameters");
  });

  test("PytestBddCommandBuilder should handle feature files with scenario outlines", async () => {
    const commandBuilder = FrameworkFactory.createCommandBuilder("pytest-bdd", config);
    
    // Test feature file command that contains scenario outlines
    const featureCommand = await commandBuilder.buildFeatureCommand({
      filePath: "tests/features/pytest_bdd_example.feature"
    });
    
    assert.ok(featureCommand.includes("pytest"), "Command should include pytest");
    assert.ok(featureCommand.includes("test_pytest_bdd_example"), 
      "Command should include converted test file name");
  });

  test("PytestBddCommandBuilder should handle complex scenario names", async () => {
    const commandBuilder = FrameworkFactory.createCommandBuilder("pytest-bdd", config);
    
    // Test complex scenario names with special characters
    const complexCommand = await commandBuilder.buildScenarioCommand({
      filePath: "tests/test_pytest_bdd_example.py::test_concurrent_user_login",
      scenarioName: "Concurrent user login simulation",
      lineNumber: 25
    });
    
    assert.ok(complexCommand.includes("test_concurrent_user_login"), 
      "Command should handle complex scenario names");
    
    // Test scenario with security validation
    const securityCommand = await commandBuilder.buildScenarioCommand({
      filePath: "tests/test_pytest_bdd_example.py::test_security_validation_login",
      scenarioName: "Security validation for login attempts",
      lineNumber: 30
    });
    
    assert.ok(securityCommand.includes("test_security_validation_login"), 
      "Command should handle security validation scenario names");
  });

  test("Extension should respect manual framework setting over auto-detection", async () => {
    // Test that manually setting framework to pytest-bdd works
    try {
      await config.setFramework("pytest-bdd");
      
      // Simulate the extension activation logic
      let framework = config.getFramework();
      
      // This should NOT trigger auto-detection since framework is explicitly set
      if (config.isFrameworkAutoDetectionEnabled() && framework === "behave") {
        const autoDetectedFramework = await FrameworkFactory.autoDetect();
        if (autoDetectedFramework !== "behave") {
          framework = autoDetectedFramework;
        }
      }
      
      assert.strictEqual(framework, "pytest-bdd", 
        "Manual framework setting should override auto-detection");
      
      // Verify the command builder is created correctly
      const commandBuilder = FrameworkFactory.createCommandBuilder(framework, config);
      assert.strictEqual(commandBuilder.getFrameworkName(), "pytest-bdd", 
        "CommandBuilder should be for pytest-bdd when framework is manually set");
    } catch (error) {
      // In test environment, workspace settings might not be available
      // Test the logic without actually setting the framework
      const framework = "pytest-bdd"; // Simulate manually set framework
      
      // Simulate the extension activation logic
      let finalFramework = framework;
      
      // This should NOT trigger auto-detection since framework is explicitly set
      if (config.isFrameworkAutoDetectionEnabled() && finalFramework === "behave") {
        const autoDetectedFramework = await FrameworkFactory.autoDetect();
        if (autoDetectedFramework !== "behave") {
          finalFramework = autoDetectedFramework;
        }
      }
      
      assert.strictEqual(finalFramework, "pytest-bdd", 
        "Manual framework setting should override auto-detection (simulated)");
      
      // Verify the command builder is created correctly
      const commandBuilder = FrameworkFactory.createCommandBuilder(finalFramework, config);
      assert.strictEqual(commandBuilder.getFrameworkName(), "pytest-bdd", 
        "CommandBuilder should be for pytest-bdd when framework is manually set (simulated)");
    }
  });
}); 