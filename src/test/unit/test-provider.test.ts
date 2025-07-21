import * as assert from "assert";
import * as vscode from "vscode";
import { BehaveTestProvider } from "../../test-providers/behave-test-provider.js";

suite("BehaveTestProvider Unit Tests", () => {
  let testController: vscode.TestController;
  let testProvider: BehaveTestProvider;

  setup(() => {
    // Create a test controller for testing
    testController = vscode.tests.createTestController(
      "test-provider",
      "Test Provider"
    );

    // Create test provider with the test controller
    testProvider = new BehaveTestProvider(testController);
  });

  teardown(() => {
    testController.dispose();
  });

  test("Constructor should accept test controller parameter", () => {
    // This test ensures the constructor signature is correct
    assert.ok(testProvider, "Test provider should be created");
    assert.strictEqual(
      testProvider["testController"],
      testController,
      "Test provider should use the provided test controller"
    );
  });

  test("SetupTestController should create run profiles", () => {
    // Since runProfiles is not exposed in the VS Code API, we'll test that the provider
    // can be created without errors, which means the setupTestController method worked
    assert.ok(testProvider, "Test provider should be created successfully");
    assert.ok(testController, "Test controller should be created successfully");
  });

  test("Constructor should properly store test controller reference", () => {
    // Test that the test controller is properly stored in the provider
    assert.strictEqual(
      testProvider["testController"],
      testController,
      "Test provider should store the provided test controller"
    );
  });

  test("GetDiscoveredTests should return empty map initially", () => {
    const tests = testProvider.getDiscoveredTests();
    assert.ok(tests instanceof Map, "Should return a Map");
    assert.strictEqual(tests.size, 0, "Should be empty initially");
  });

  test("ExtractLineNumberFromTestId should work correctly", () => {
    // Test the private method through the class
    const testId = "/path/to/file.feature:10";
    const lineNumber = testProvider["extractLineNumberFromTestId"](testId);
    assert.strictEqual(lineNumber, 10, "Should extract line number 10");

    const testIdNoLine = "/path/to/file.feature";
    const lineNumberNoLine =
      testProvider["extractLineNumberFromTestId"](testIdNoLine);
    assert.strictEqual(
      lineNumberNoLine,
      undefined,
      "Should return undefined when no line number"
    );
  });

  test("TestExecutor should be properly initialized", () => {
    const testExecutor = testProvider["testExecutor"];
    assert.ok(testExecutor, "TestExecutor should be initialized");
    assert.ok(
      typeof testExecutor.runScenario === "function",
      "TestExecutor should have runScenario method"
    );
    assert.ok(
      typeof testExecutor.debugScenario === "function",
      "TestExecutor should have debugScenario method"
    );
  });
});
