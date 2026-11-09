import * as assert from "assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { PythonDetector } from "../../utils/python-detector";
import { BehaveTestProvider } from "../../test-providers/behave-test-provider";

suite("Workspace trust acceptance", function () {
  suiteSetup(function () {if (process.env["TEST_WORKSPACE_TRUST"] !== "untrusted") {this.skip();}});
  test("the actual restricted host discovers populated items but refuses every execution route", async () => {
    assert.strictEqual(vscode.workspace.isTrusted, false, "This acceptance test must run in an actual untrusted host");
    const extension = vscode.extensions.getExtension("upscaled-dev.behave-test-runner");
    assert.ok(extension);
    const active = await extension.activate() as { testController: vscode.TestController; testProvider: BehaveTestProvider };
    await active.testProvider.discoverTests();
    const leaves: vscode.TestItem[] = [];
    const visit = (item: vscode.TestItem) => {if (!item.children.size) {leaves.push(item);} else {item.children.forEach(visit);}};
    active.testController.items.forEach(visit);
    const item = leaves.find((candidate) => candidate.label === "A discovered scenario");
    assert.ok(item, "The restricted host must discover the named populated scenario");
    const definitions = await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeDefinitionProvider", item.uri!, new vscode.Position(3, 4)) ?? [];
    assert.deepStrictEqual(definitions.map((location) => [path.basename(location.uri.fsPath), location.range.start.line]), [["baseline.py", 2]],
      "Restricted Mode navigation must stay passive and reach the static binding");
    const workspace = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
    const before = fs.readdirSync(workspace).sort();
    let debugStarts = 0;
    const debugListener = vscode.debug.onDidStartDebugSession(() => {debugStarts++;});
    const executor = active.testProvider["context"].testExecutor;
    for (const launch of [() => executor.runScenarioWithOutput({ filePath: item.uri!.fsPath }),
      () => executor.debugScenario({ filePath: item.uri!.fsPath }),
      () => executor.runTestsInParallel({ featureFiles: [item.uri!.fsPath], maxProcesses: 2 }),
      () => executor.validateBehaveInstallation(), () => PythonDetector.create().detectPythonCommand()]) {
      await assert.rejects(launch(), /Trust this workspace/u);
    }
    let ended = false;
    const create = active.testController.createTestRun.bind(active.testController);
    active.testController.createTestRun = (request) => {const native = create(request); return { ...native, end: () => {ended = true; native.end();} };};
    const showError = vscode.window.showErrorMessage;
    const errors: string[] = [];
    (vscode.window as any).showErrorMessage = (message: string) => {errors.push(message); return Promise.resolve(undefined);};
    try {
      await active.testProvider["runTests"](new vscode.TestRunRequest([item]));
      await vscode.commands.executeCommand("behaveTestRunner.runScenario", item.uri!.fsPath, 3, item.label);
      await vscode.commands.executeCommand("behaveTestRunner.debugFeature", item.uri!.fsPath);
      assert.ok(ended);
      assert.ok(errors.length >= 3 && errors.every((error) => error.includes("Trust this workspace")));
      assert.strictEqual(vscode.debug.activeDebugSession, undefined);
      assert.strictEqual(debugStarts, 0);
      assert.strictEqual(fs.existsSync(path.join(workspace, "process-ledger.txt")), false);
      assert.deepStrictEqual(fs.readdirSync(workspace).sort(), before, "No report or parallel runner may be generated in the restricted workspace");
    } finally {debugListener.dispose(); active.testController.createTestRun = create; (vscode.window as any).showErrorMessage = showError;}
  });
});
