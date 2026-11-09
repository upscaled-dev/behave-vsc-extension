import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { BehaveTestProvider } from "../../test-providers/behave-test-provider";

suite("Pytest collection identity acceptance", function () {
  this.timeout(30000);
  let extension: typeof import("../../extension");
  let active: { testController: vscode.TestController; testProvider: BehaveTestProvider };
  let project: string;
  let feature: string;
  const python = process.env["BEHAVE_TEST_PYTHON"] ?? "python3";
  const settings = vscode.workspace.getConfiguration("behaveTestRunner");
  const previous = new Map<string, unknown>();
  const values = { framework: "pytest-bdd", autoDetectFramework: false, pytestCommand: `${JSON.stringify(python)} -m pytest`,
    workingDirectory: "collection-project/runtime", testFilePattern: "collection-project/features/*.feature", autoDiscoverTests: true, tags: "", dryRun: false };

  function rows(file = feature): vscode.TestItem[] {
    const found: vscode.TestItem[] = [];
    const visit = (item: vscode.TestItem) => {if (item.children.size === 0 && item.uri?.fsPath === file) {found.push(item);} item.children.forEach(visit);};
    active.testController.items.forEach(visit);
    return found;
  }

  async function run(include?: vscode.TestItem[], debug = false, token?: vscode.CancellationToken, onOutput?: (text: string) => void) {
    const request = new vscode.TestRunRequest(include);
    const statuses = new Map<vscode.TestItem, string>();
    const details: string[] = [];
    const recordMessage = (message: vscode.TestMessage | readonly vscode.TestMessage[]) => {
      for (const entry of Array.isArray(message) ? message : [message]) {
        details.push(typeof entry.message === "string" ? entry.message : entry.message.value);
      }
    };
    let ended = false;
    const create = active.testController.createTestRun.bind(active.testController);
    active.testController.createTestRun = (requested) => {
      const native = create(requested);
      if (requested !== request) {return native;}
      return { ...native, passed: (item, duration) => {statuses.set(item, "passed"); native.passed(item, duration);},
        failed: (item, message, duration) => {statuses.set(item, "failed"); recordMessage(message); native.failed(item, message, duration);},
        skipped: (item) => {statuses.set(item, "skipped"); native.skipped(item);},
        errored: (item, message, duration) => {statuses.set(item, "errored"); recordMessage(message); native.errored(item, message, duration);},
        appendOutput: (text, location, item) => {details.push(text); onOutput?.(text); native.appendOutput(text, location, item);},
        end: () => {ended = true; native.end();} };
    };
    try {await active.testProvider[debug ? "debugTests" : "runTests"](request, token);} finally {active.testController.createTestRun = create;}
    assert.ok(ended, "The actual selected native TestRun must end");
    return { statuses, details: details.join("\n") };
  }

  suiteSetup(async () => {
    const installed = vscode.extensions.getExtension("upscaled-dev.behave-test-runner")!;
    await installed.activate();
    extension = require(path.join(installed.extensionPath, "dist/extension.js"));
    await extension.deactivate();
    const workspace = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
    project = path.join(workspace, "collection-project");
    feature = path.join(project, "features/catalog.feature");
    fs.cpSync(path.resolve(__dirname, "../../../src/test/fixtures/collection"), project, { recursive: true });
    for (const [name, value] of Object.entries(values)) {
      previous.set(name, settings.inspect(name)?.workspaceValue);
      await settings.update(name, value, vscode.ConfigurationTarget.Workspace);
    }
    active = await extension.activate({ subscriptions: [] } as unknown as vscode.ExtensionContext) as typeof active;
  });
  setup(() => {
    for (const file of ["ledger.txt", "native-ledger.txt", "fail-other", "skip-beta", "setup-error", "teardown-error", "wait-row"]) {
      fs.rmSync(path.join(project, "runtime", file), { force: true });
    }
  });
  suiteTeardown(async () => {
    await extension?.deactivate();
    for (const name of Object.keys(values)) {await settings.update(name, previous.get(name), vscode.ConfigurationTarget.Workspace);}
    if (project) {fs.rmSync(project, { recursive: true, force: true });}
  });

  test("a selected duplicate Examples row uses actual arbitrary bindings and custom parameter IDs", async () => {
    const discovered = rows();
    assert.strictEqual(discovered.length, 3);
    const selected = discovered.find((item) => item.range?.start.line === 6)!;
    assert.ok(selected, "The second identical Examples value must retain physical row line7");
    const result = await run([selected]);
    const ledger = fs.readFileSync(path.join(project, "runtime/ledger.txt"), "utf8").trim().split(/\r?\n/u);
    assert.strictEqual(ledger.length, 2, result.details);
    assert.ok(ledger.every((entry) => entry.includes("catalog_checks.py::test_binding_is_unrelated[same1-")), ledger.join("\n"));
    assert.ok(ledger.some((entry) => entry.includes("variant alpha")));
    assert.ok(ledger.some((entry) => entry.includes("variant::beta[]")));
    assert.strictEqual(result.statuses.get(selected), "passed", result.details);
    for (const other of discovered.filter((item) => item !== selected)) {assert.strictEqual(result.statuses.has(other), false);}
  });

  test("native collection settings and command overrides win over the deprecated extension pattern", async () => {
    const manifest = vscode.extensions.getExtension("upscaled-dev.behave-test-runner")!.packageJSON;
    const property = manifest.contributes.configuration.properties["behaveTestRunner.pytestBddFilePattern"];
    assert.match(property.deprecationMessage ?? "", /unused.*python_files.*testpaths/iu);
    const ini = path.join(project, "runtime/pytest.ini");
    const original = fs.readFileSync(ini, "utf8");
    const previousPattern = settings.inspect("pytestBddFilePattern")?.workspaceValue;
    const previousCommand = settings.inspect("pytestCommand")?.workspaceValue;
    const ledger = path.join(project, "runtime/ledger.txt");
    try {
      await settings.update("pytestBddFilePattern", "**/never_collect_this.py", vscode.ConfigurationTarget.Workspace);
      const selected = rows()[0]!;
      const initial = await run([selected]);
      assert.strictEqual(initial.statuses.get(selected), "passed", initial.details);
      assert.strictEqual(fs.readFileSync(ledger, "utf8").trim().split(/\r?\n/u).length, 2);
      fs.rmSync(ledger);

      fs.writeFileSync(ini, original.replace("python_files = *_checks.py", "python_files = native_checks.py"));
      const excluded = await run([selected]);
      assert.strictEqual(excluded.statuses.get(selected), "errored", excluded.details);
      assert.ok(excluded.details.includes("No collected pytest-bdd binding"), excluded.details);
      assert.strictEqual(fs.existsSync(ledger), false, "Excluded bindings execute no scenario bodies");

      await settings.update("pytestCommand", `${values.pytestCommand} --override-ini=python_files=*_checks.py`, vscode.ConfigurationTarget.Workspace);
      const retry = await run([selected]);
      assert.strictEqual(retry.statuses.get(selected), "passed", retry.details);
      const entries = fs.readFileSync(ledger, "utf8").trim().split(/\r?\n/u);
      assert.strictEqual(entries.length, 2);
      assert.ok(entries.every((entry) => entry.includes("catalog_checks.py::test_binding_is_unrelated[same0-")), entries.join("\n"));
      assert.strictEqual(fs.existsSync(path.join(project, "runtime/native-ledger.txt")), false);
      assert.ok(rows().includes(selected), "Collection settings preserve the original feature TestItem");
    } finally {
      fs.writeFileSync(ini, original);
      await settings.update("pytestBddFilePattern", previousPattern, vscode.ConfigurationTarget.Workspace);
      await settings.update("pytestCommand", previousCommand, vscode.ConfigurationTarget.Workspace);
    }
  });

  test("actual variants fold mixed row outcomes without painting another row failed", async () => {
    fs.writeFileSync(path.join(project, "runtime/fail-other"), "");
    const discovered = rows();
    const result = await run();
    for (const item of discovered) {
      assert.strictEqual(result.statuses.get(item), item.range?.start.line === 9 ? "failed" : "passed", result.details);
    }
    assert.strictEqual(fs.readFileSync(path.join(project, "runtime/ledger.txt"), "utf8").trim().split(/\r?\n/u).length, 6);
    assert.strictEqual(fs.existsSync(path.join(project, "runtime/native-ledger.txt")), false, "Feature selection must deselect ordinary pytest tests");
  });

  test("separate Python bindings execute once each and fold onto the original selected row", async () => {
    const selected = rows()[0]!;
    const binding = path.join(project, "bindings/catalog_checks.py");
    const original = fs.readFileSync(binding, "utf8");
    fs.writeFileSync(binding, original + `
@pytest.mark.parametrize("variant", ["secondary"])
@scenario("../features/catalog.feature", "Catalog line <value>")
def test_separately_declared_binding(variant):
    raise AssertionError("second binding failure")
`);
    try {
      const result = await run([selected]);
      const ledger = fs.readFileSync(path.join(project, "runtime/ledger.txt"), "utf8").trim().split(/\r?\n/u);
      assert.strictEqual(ledger.length, 3, result.details);
      assert.strictEqual(new Set(ledger).size, 3, "Each actual binding and variant must execute exactly once");
      assert.strictEqual(ledger.filter((entry) => entry.includes("catalog_checks.py::test_separately_declared_binding")).length, 1);
      assert.strictEqual(ledger.filter((entry) => entry.includes("catalog_checks.py::test_binding_is_unrelated")).length, 2);
      assert.strictEqual(result.statuses.get(selected), "failed", result.details);
      assert.ok(result.details.includes("second binding failure"));
      for (const other of rows().filter((item) => item !== selected)) {assert.strictEqual(result.statuses.has(other), false);}
    } finally {fs.writeFileSync(binding, original);}
  });

  test("name-only calls select a unique declaration and reject duplicate source names before bodies", async () => {
    const namedFeature = path.join(project, "features/names.feature");
    const binding = path.join(project, "bindings/names_checks.py");
    const ledger = path.join(project, "runtime/names-ledger.txt");
    fs.writeFileSync(namedFeature, "Feature: Named collection\n  Scenario: Unique selection\n    Given a named entry\n  Scenario: Duplicate selection\n    Given a named entry\n  Scenario: Duplicate selection\n    Given a named entry\n");
    fs.writeFileSync(binding, `from pathlib import Path
from pytest_bdd import given, scenario

@scenario("../features/names.feature", "Unique selection")
def test_unique_binding():
    pass

@scenario("../features/names.feature", "Duplicate selection")
def test_duplicate_binding():
    pass

@given("a named entry")
def record_name(request):
    with Path("names-ledger.txt").open("a") as ledger:
        ledger.write(request.node.nodeid + "\\n")
`);
    try {
      const executor = active.testProvider["context"].testExecutor;
      for (const attempt of [0, 1]) {
        const result = await executor.runScenarioWithOutput({ filePath: namedFeature, scenarioName: "Unique selection" });
        assert.ok(result.success, result.error);
        assert.strictEqual(result.scenarioResults?.[`${namedFeature}:2`], "passed");
        assert.strictEqual(fs.readFileSync(ledger, "utf8").trim().split(/\r?\n/u).length, 1);
        fs.rmSync(ledger);
        if (attempt === 0) {
          const duplicate = await executor.runScenarioWithOutput({ filePath: namedFeature, scenarioName: "Duplicate selection" });
          assert.strictEqual(duplicate.success, false);
          assert.ok((duplicate.display ?? "").includes("scenario name is ambiguous"));
          assert.strictEqual(fs.existsSync(ledger), false, "Ambiguous names must execute no test bodies");
          assert.strictEqual(fs.existsSync(path.join(project, "runtime/ledger.txt")), false);
          assert.strictEqual(fs.existsSync(path.join(project, "runtime/native-ledger.txt")), false);
        }
      }
    } finally {
      for (const file of [binding, namedFeature, ledger]) {fs.rmSync(file, { force: true });}
      await active.testProvider.discoverTests();
    }
  });

  test("real pytest-xdist options reject distributed execution before any body and allow retry", async () => {
    const selectedRow = () => {
      const item = rows().find((candidate) => candidate.range?.start.line === 5);
      assert.ok(item, "The request must retain physical Examples row line6");
      return item;
    };
    try {
      await settings.update("pytestCommand", `${JSON.stringify(python)} -m pytest -n 2`, vscode.ConfigurationTarget.Workspace);
      await active.testProvider.discoverTests();
      const selected = selectedRow();
      const result = await run([selected]);
      assert.strictEqual(result.statuses.get(selected), "errored");
      assert.ok(result.details.includes("does not support distributed pytest execution"), result.details);
      assert.strictEqual(fs.existsSync(path.join(project, "runtime/ledger.txt")), false);
      assert.strictEqual(fs.existsSync(path.join(project, "runtime/native-ledger.txt")), false);
    } finally {
      await settings.update("pytestCommand", `${JSON.stringify(python)} -m pytest`, vscode.ConfigurationTarget.Workspace);
      await active.testProvider.discoverTests();
    }
    const retry = selectedRow();
    assert.strictEqual((await run([retry])).statuses.get(retry), "passed");
    assert.deepStrictEqual(fs.readFileSync(path.join(project, "runtime/ledger.txt"), "utf8").trim().split(/\r?\n/u).sort(), [
      `${path.basename(project)}/bindings/catalog_checks.py::test_binding_is_unrelated[same0-variant alpha]`,
      `${path.basename(project)}/bindings/catalog_checks.py::test_binding_is_unrelated[same0-variant::beta[]]`,
    ].sort());
    assert.strictEqual(fs.existsSync(path.join(project, "runtime/native-ledger.txt")), false);
  });

  test("a symlink workspace preserves lexical report keys and settles its original native row", async function () {
    if (process.platform === "win32") {this.skip();}
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "behave-collection-alias-"));
    const alias = path.join(temporary, "lexical-project");
    fs.symlinkSync(project, alias, "dir");
    const uri = vscode.Uri.file(alias);
    let added = false;
    const changeFolder = async (remove: boolean) => {
      const index = remove ? vscode.workspace.workspaceFolders!.findIndex((folder) => folder.uri.toString() === uri.toString())
        : vscode.workspace.workspaceFolders!.length;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {subscription.dispose(); reject(new Error("The lexical workspace folder change did not complete"));}, 10000);
        const subscription = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
          if ((remove ? event.removed : event.added).some((folder) => folder.uri.toString() === uri.toString())) {
            clearTimeout(timeout); subscription.dispose(); resolve();
          }
        });
        if (!vscode.workspace.updateWorkspaceFolders(index, remove ? 1 : 0, ...(remove ? [] : [{ uri, name: "Lexical collection project" }]))) {
          clearTimeout(timeout); subscription.dispose(); reject(new Error("The lexical workspace folder change was refused"));
        }
      });
    };
    await extension.deactivate();
    try {
      await changeFolder(false); added = true;
      const scoped = vscode.workspace.getConfiguration("behaveTestRunner", uri);
      for (const [name, value] of Object.entries({ ...values, workingDirectory: "runtime", testFilePattern: "features/catalog.feature" })) {
        await scoped.update(name, value, vscode.ConfigurationTarget.WorkspaceFolder);
      }
      active = await extension.activate({ subscriptions: [] } as unknown as vscode.ExtensionContext) as typeof active;
      const lexicalFeature = path.join(alias, "features/catalog.feature");
      assert.notStrictEqual(lexicalFeature, fs.realpathSync(lexicalFeature), "The admitted path must actually differ from its physical target");
      const selected = rows(lexicalFeature).find((item) => item.range?.start.line === 6)!;
      assert.ok(selected, "Discovery must preserve the workspace's lexical feature path");
      const executor = active.testProvider["context"].testExecutor;
      const execute = executor.runScenarioWithOutput.bind(executor);
      let reportKeys: string[] = [];
      executor.runScenarioWithOutput = async (...args) => {
        const result = await execute(...args);
        reportKeys = Object.keys(result.scenarioResults ?? {});
        return result;
      };
      try {
        const result = await run([selected]);
        assert.deepStrictEqual(reportKeys, [`${lexicalFeature}:7`]);
        assert.strictEqual(result.statuses.get(selected), "passed", result.details);
        const ledger = fs.readFileSync(path.join(project, "runtime/ledger.txt"), "utf8").trim().split(/\r?\n/u);
        assert.strictEqual(ledger.length, 2);
        assert.strictEqual(new Set(ledger).size, 2);
      } finally {executor.runScenarioWithOutput = execute;}
    } finally {
      await extension.deactivate();
      if (added) {await changeFolder(true);}
      fs.rmSync(temporary, { recursive: true, force: true });
      fs.rmSync(path.join(project, ".vscode"), { recursive: true, force: true });
      active = await extension.activate({ subscriptions: [] } as unknown as vscode.ExtensionContext) as typeof active;
    }
  });

  test("marker-filtered bindings and dry collection skip selected items without executing bodies", async () => {
    const selected = rows()[0]!;
    try {
      await settings.update("tags", "not collection_case", vscode.ConfigurationTarget.Workspace);
      assert.strictEqual((await run([selected])).statuses.get(selected), "skipped");
      assert.strictEqual(fs.existsSync(path.join(project, "runtime/ledger.txt")), false);
      await settings.update("tags", "", vscode.ConfigurationTarget.Workspace);
      await settings.update("dryRun", true, vscode.ConfigurationTarget.Workspace);
      assert.strictEqual((await run([selected])).statuses.get(selected), "skipped");
      assert.strictEqual(fs.existsSync(path.join(project, "runtime/ledger.txt")), false);
    } finally {
      await settings.update("tags", "", vscode.ConfigurationTarget.Workspace);
      await settings.update("dryRun", false, vscode.ConfigurationTarget.Workspace);
    }
  });

  test("workspace commands preserve nested cwd testpaths and non-BDD tests", async () => {
    const ignored = path.join(project, "ignored_checks.py");
    fs.writeFileSync(ignored, 'def test_must_stay_outside_native_testpaths():\n    raise AssertionError("ignored testpaths sentinel")\n');
    try {
      const result = await active.testProvider["context"].testExecutor.runAllTestsWithOutput();
      assert.ok(result.success, result.error);
      assert.strictEqual(fs.readFileSync(path.join(project, "runtime/native-ledger.txt"), "utf8").trim(), "native");
      assert.strictEqual(fs.readFileSync(path.join(project, "runtime/ledger.txt"), "utf8").trim().split(/\r?\n/u).length, 6);
      fs.rmSync(path.join(project, "runtime/native-ledger.txt")); fs.rmSync(path.join(project, "runtime/ledger.txt"));
      await settings.update("dryRun", true, vscode.ConfigurationTarget.Workspace);
      assert.ok((await active.testProvider["context"].testExecutor.runAllTestsWithOutput()).success);
      assert.strictEqual(fs.existsSync(path.join(project, "runtime/native-ledger.txt")), false);
      assert.strictEqual(fs.existsSync(path.join(project, "runtime/ledger.txt")), false);
    } finally {fs.rmSync(ignored, { force: true }); await settings.update("dryRun", false, vscode.ConfigurationTarget.Workspace);}
  });

  test("missing bindings and unsupported metadata fail before any test body and allow retry", async () => {
    const selected = rows()[0]!;
    const executor = active.testProvider["context"].testExecutor;
    const missing = await executor.runScenarioWithOutput({ filePath: feature, lineNumber: 999 });
    assert.strictEqual(missing.success, false);
    assert.ok((missing.display ?? "").includes("No collected pytest-bdd binding"));
    const unsupported = path.join(project, "bindings/unsupported_checks.py");
    fs.writeFileSync(unsupported, 'def test_unknown_binding(_pytest_bdd_example):\n    raise AssertionError("body must not run")\n');
    try {
      const result = await run([selected]);
      assert.strictEqual(result.statuses.get(selected), "errored");
      assert.ok(result.details.includes("Unsupported pytest-bdd scenario metadata"));
      assert.strictEqual(fs.existsSync(path.join(project, "runtime/ledger.txt")), false);
      assert.strictEqual(fs.existsSync(path.join(project, "runtime/native-ledger.txt")), false);
    } finally {fs.rmSync(unsupported, { force: true });}
    assert.strictEqual((await run([selected])).statuses.get(selected), "passed");
  });

  test("setup and teardown errors and skipped variants retain their real native outcomes", async () => {
    const selected = rows()[0]!;
    for (const [flag, expected] of [["setup-error", "errored"], ["teardown-error", "errored"], ["skip-beta", "skipped"]]) {
      const file = path.join(project, "runtime", flag!);
      fs.writeFileSync(file, "");
      try {assert.strictEqual((await run([selected])).statuses.get(selected), expected);}
      finally {fs.rmSync(file, { force: true });}
    }
  });


  test("cancellation during an actual collected row skips its outcome and permits a clean retry", async () => {
    const selected = rows()[0]!;
    const cancellation = new vscode.CancellationTokenSource();
    const flag = path.join(project, "runtime/wait-row");
    fs.writeFileSync(flag, "");
    let ready = false;
    let output = "";
    const timeout = setTimeout(() => cancellation.cancel(), 10000);
    try {
      await settings.update("pytestCommand", `${JSON.stringify(python)} -m pytest -s`, vscode.ConfigurationTarget.Workspace);
      const result = await run([selected], false, cancellation.token, (text) => {
        output += text;
        if (!ready && output.includes("COLLECTION_WAIT_READY")) {ready = true; cancellation.cancel();}
      });
      assert.ok(ready, "The real selected Python step must signal readiness before cancellation");
      assert.strictEqual(result.statuses.get(selected), "skipped");
      assert.strictEqual(fs.existsSync(path.join(project, "runtime/ledger.txt")), false);
    } finally {
      clearTimeout(timeout); cancellation.cancel(); cancellation.dispose(); fs.rmSync(flag, { force: true });
      await settings.update("pytestCommand", `${JSON.stringify(python)} -m pytest`, vscode.ConfigurationTarget.Workspace);
    }
    assert.strictEqual((await run([selected])).statuses.get(selected), "passed");
  });

  test("debug stops in the distinct selected row and exposes its actual parameter value", async () => {
    const selected = rows().find((item) => item.range?.start.line === 9)!;
    assert.ok(selected);
    const step = path.join(project, "bindings/catalog_checks.py");
    const line = fs.readFileSync(step, "utf8").split("\n").findIndex((text) => text.includes('with Path("ledger.txt")'));
    const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(step), new vscode.Position(line, 0)));
    vscode.debug.addBreakpoints([breakpoint]);
    const cancellation = new vscode.CancellationTokenSource();
    let session: vscode.DebugSession | undefined;
    let ended = false;
    let resolveStop: () => void = () => {};
    let rejectStop: (error: unknown) => void = () => {};
    const observed = new Promise<void>((resolve, reject) => {resolveStop = resolve; rejectStop = reject;});
    const timeout = setTimeout(() => rejectStop(new Error("The selected collection row breakpoint was not observed")), 20000);
    const termination = vscode.debug.onDidTerminateDebugSession((candidate) => {if (candidate.id === session?.id) {ended = true;}});
    const tracker = vscode.debug.registerDebugAdapterTrackerFactory("debugpy", {
      createDebugAdapterTracker(candidate) {
        if (!candidate.configuration["__behaveExecutionId"]) {return undefined;}
        session = candidate;
        return { onDidSendMessage(message) {
          if (message.type === "event" && message.event === "stopped") {
            void (async () => {
              assert.strictEqual(message.body.reason, "breakpoint");
              const stack = await candidate.customRequest("stackTrace", { threadId: message.body.threadId });
              const frame = stack.stackFrames[0];
              assert.strictEqual(fs.realpathSync(frame.source.path), fs.realpathSync(step));
              assert.strictEqual(frame.line, line + 1);
              const value = await candidate.customRequest("evaluate", { expression: "request.node.callspec.params['_pytest_bdd_example']['value']", frameId: frame.id, context: "watch" });
              assert.strictEqual(value.result.replace(/^["']|["']$/g, ""), "other", "A shared step breakpoint must expose the selected row's distinct value");
              const node = await candidate.customRequest("evaluate", { expression: "request.node.nodeid", frameId: frame.id, context: "watch" });
              assert.ok(node.result.includes("test_binding_is_unrelated[other-"), node.result);
              cancellation.cancel(); resolveStop();
            })().catch(rejectStop);
          }
        } };
      },
    });
    try {
      const pending = run([selected], true, cancellation.token);
      await observed;
      const result = await pending;
      assert.strictEqual(result.statuses.get(selected), "skipped");
      assert.ok(ended, "The matching actual debugger must terminate before admission is released");
      assert.strictEqual(fs.existsSync(path.join(project, "runtime/ledger.txt")), false);
    } finally {
      clearTimeout(timeout); cancellation.cancel(); cancellation.dispose(); tracker.dispose(); termination.dispose(); vscode.debug.removeBreakpoints([breakpoint]);
      if (session && !ended) {await vscode.debug.stopDebugging(session);}
    }
    assert.strictEqual((await run([selected])).statuses.get(selected), "passed");
  });

});
