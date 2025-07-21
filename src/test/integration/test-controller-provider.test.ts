import * as assert from "assert";
import * as vscode from "vscode";
import { BehaveTestProvider } from "../../test-providers/behave-test-provider.js";

suite("BehaveTestProvider Integration", () => {
  let testController: vscode.TestController;
  let testProvider: BehaveTestProvider;

  setup(() => {
    testController = vscode.tests.createTestController(
      "integration",
      "Integration"
    );
    testProvider = new BehaveTestProvider(testController);
  });

  teardown(() => {
    testController.dispose();
  });

  test("Provider and extension use the same controller instance", () => {
    assert.strictEqual(
      (testProvider as any).testController,
      testController,
      "Provider should use the same controller instance"
    );
  });

  test("Test provider can be created without errors", () => {
    assert.ok(testProvider, "Test provider should be created");
    assert.ok(testController, "Test controller should be created");
  });

  test("Test provider stores test controller reference", () => {
    assert.strictEqual(
      testProvider["testController"],
      testController,
      "Test provider should store the provided test controller"
    );
  });

  test("GetDiscoveredTests returns empty map initially", () => {
    const tests = testProvider.getDiscoveredTests();
    assert.ok(tests instanceof Map, "Should return a Map");
    assert.strictEqual(tests.size, 0, "Should be empty initially");
  });

  test("ExtractLineNumberFromTestId works correctly", () => {
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

  test("TestExecutor is properly initialized", () => {
    const testExecutor = testProvider["testExecutor"];
    assert.ok(testExecutor, "TestExecutor should be initialized");
    assert.ok(
      typeof testExecutor.runScenario === "function",
      "TestExecutor should have runScenario method"
    );
  });
});
