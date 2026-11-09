import * as assert from "assert";
import * as vscode from "vscode";
import { BehaveTestProvider } from "../../test-providers/behave-test-provider.js";
import { createCheckedOutputChannel } from "../output-channel";

suite("BehaveTestProvider Integration", () => {
  let testController: vscode.TestController;
  let testProvider: BehaveTestProvider;
  let createOutputChannel: typeof vscode.window.createOutputChannel;

  setup(() => {
    createOutputChannel = vscode.window.createOutputChannel;
    vscode.window.createOutputChannel = createCheckedOutputChannel as typeof vscode.window.createOutputChannel;
    testController = vscode.tests.createTestController(
      "integration",
      "Integration"
    );
    testProvider = BehaveTestProvider.create(testController);
  });

  teardown(() => {
    testProvider.dispose();
    testController.dispose();
    vscode.window.createOutputChannel = createOutputChannel;
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

  test("Parsed scenario metadata retains its exact executable line", () => {
    const file = vscode.Uri.file("/path/to/file.feature");
    const parsed = testProvider["context"].featureParser.parseFeatureContent("Feature: Exact lines\n\n\n\n\n\n\n\n\n  Scenario: Named scenario\n    Given a step\n");
    assert.ok(parsed?.scenarios[0]);
    const scenario = parsed.scenarios[0];
    scenario.filePath = file.fsPath;
    const builder = testProvider["treeBuilder"];
    const item = builder.createScenarioTestItem(file, scenario);
    assert.strictEqual(builder.scenarioFor(item.id)?.lineNumber, 10);
    assert.strictEqual(builder.scenarioFor(file.fsPath), undefined);
  });

  test("TestExecutor is properly initialized", () => {
    const testExecutor = testProvider["context"]["testExecutor"];
    assert.ok(testExecutor, "TestExecutor should be initialized");
    assert.ok(
      typeof testExecutor.runScenario === "function",
      "TestExecutor should have runScenario method"
    );
  });
});
