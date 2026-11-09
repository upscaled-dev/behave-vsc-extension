import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { BehaveTestProvider } from "../../test-providers/behave-test-provider";

suite("Project context acceptance", function () {
  this.timeout(40000);
  let extension: typeof import("../../extension");
  let active: { testController: vscode.TestController; testProvider: BehaveTestProvider };
  let first: vscode.WorkspaceFolder;
  let second: vscode.WorkspaceFolder;
  let temporary: string;
  const python = process.env["BEHAVE_TEST_PYTHON"] ?? "python3";
  const prefix = JSON.stringify(python);
  const settingNames = ["framework", "autoDetectFramework", "behaveCommand", "pytestCommand", "workingDirectory", "testFilePattern", "autoDiscoverTests", "outputFormat", "stepDefinitionPaths"];
  const previous = new Map<string, unknown>();
  const selectionErrors: string[] = [];

  async function changeFolder(index: number, deleteCount: number, folder?: { uri: vscode.Uri; name: string }) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {subscription.dispose(); reject(new Error("Workspace folder change did not complete"));}, 10000);
      const subscription = vscode.workspace.onDidChangeWorkspaceFolders(() => {clearTimeout(timer); subscription.dispose(); resolve();});
      if (!vscode.workspace.updateWorkspaceFolders(index, deleteCount, ...(folder ? [folder] : []))) {
        clearTimeout(timer); subscription.dispose(); reject(new Error("Workspace folder change was refused"));
      }
    });
  }
  function settings(folder: vscode.WorkspaceFolder) {return vscode.workspace.getConfiguration("behaveTestRunner", folder.uri);}
  async function update(folder: vscode.WorkspaceFolder, name: string, value: unknown) {
    let subscription: vscode.Disposable | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Project setting '${name}' did not change`)), 10000);
      subscription = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`behaveTestRunner.${name}`, folder.uri)) {resolve();}
      });
    });
    try {await Promise.all([settings(folder).update(name, value, vscode.ConfigurationTarget.WorkspaceFolder), changed]);}
    finally {clearTimeout(timer); subscription?.dispose();}
  }
  function ledger(folder: vscode.WorkspaceFolder) {
    const file = path.join(folder.uri.fsPath, "runtime", "ledger.txt");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split(/\r?\n/u).filter(Boolean) : [];
  }
  function selected(folder: vscode.WorkspaceFolder) {
    const found: vscode.TestItem[] = [];
    const visit = (item: vscode.TestItem) => {if (item.label === "Shared named scenario" && item.uri?.fsPath === path.join(folder.uri.fsPath, "runtime/features/shared.feature")) {found.push(item);} item.children.forEach(visit);};
    active.testController.items.forEach(visit);
    assert.strictEqual(found.length, 1, `Project '${folder.name}' must have exactly one named native item`);
    return found[0]!;
  }
  async function run(include?: vscode.TestItem[]) {
    const request = new vscode.TestRunRequest(include);
    const statuses = new Map<vscode.TestItem, string>();
    const create = active.testController.createTestRun.bind(active.testController);
    let ended = false;
    const showError = vscode.window.showErrorMessage;
    selectionErrors.length = 0;
    (vscode.window as any).showErrorMessage = (message: string) => {selectionErrors.push(message); return Promise.resolve(undefined);};
    active.testController.createTestRun = (requested) => {
      const native = create(requested);
      if (requested !== request) {return native;}
      return { ...native, passed: (item, duration) => {statuses.set(item, "passed"); native.passed(item, duration);},
        errored: (item, message, duration) => {statuses.set(item, "errored"); native.errored(item, message, duration);},
        end: () => {ended = true; native.end();} };
    };
    try {await active.testProvider["runTests"](request);}
    finally {active.testController.createTestRun = create; (vscode.window as any).showErrorMessage = showError;}
    assert.ok(ended, "The native TestRun must end");
    return statuses;
  }

  suiteSetup(async () => {
    first = vscode.workspace.workspaceFolders![0]!;
    const installed = vscode.extensions.getExtension("upscaled-dev.behave-test-runner")!;
    await installed.activate();
    extension = require(path.join(installed.extensionPath, "dist/extension.js"));
    await extension.deactivate();
    for (const name of settingNames) {previous.set(name, settings(first).inspect(name)?.workspaceFolderValue);}
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "behave-project-b-"));
    const fixtures = path.resolve(__dirname, "../../../src/test/fixtures/project-context");
    fs.cpSync(path.join(fixtures, "behave"), first.uri.fsPath, { recursive: true });
    fs.cpSync(path.join(fixtures, "pytest"), temporary, { recursive: true });
    await changeFolder(1, 0, { uri: vscode.Uri.file(temporary), name: "Project B" });
    second = vscode.workspace.workspaceFolders![1]!;
    for (const folder of [first, second]) {
      const values = { framework: folder === first ? "behave" : "pytest-bdd", autoDetectFramework: true,
        behaveCommand: `${prefix} -u -m behave`, pytestCommand: `${prefix}${folder === first ? " -u" : ""} -m pytest`, workingDirectory: "runtime",
        testFilePattern: "runtime/features/shared.feature", autoDiscoverTests: true,
        stepDefinitionPaths: folder === first ? ["runtime/features/steps/**/*.py"] : ["runtime/tests/**/*.py"] };
      for (const [name, value] of Object.entries(values)) {await settings(folder).update(name, value, vscode.ConfigurationTarget.WorkspaceFolder);}
    }
    // Detection would choose pytest without the explicit Behave setting in A.
    fs.writeFileSync(path.join(first.uri.fsPath, "runtime/pytest.ini"), "[pytest]\n# pytest-bdd\n");
    active = await extension.activate({ subscriptions: [] } as unknown as vscode.ExtensionContext) as typeof active;
  });
  setup(() => {for (const folder of [first, second]) {fs.writeFileSync(path.join(folder.uri.fsPath, "runtime/ledger.txt"), "");}});
  suiteTeardown(async () => {
    await extension?.deactivate();
    for (const name of settingNames) {await settings(first).update(name, previous.get(name), vscode.ConfigurationTarget.WorkspaceFolder);}
    if (second) {await changeFolder(1, 1);}
    fs.rmSync(path.join(first.uri.fsPath, "runtime"), { recursive: true, force: true });
    if (temporary) {fs.rmSync(temporary, { recursive: true, force: true });}
  });

  test("selecting root B runs only its configured pytest project and settles its same-name native item", async () => {
    const a = selected(first);
    const b = selected(second);
    const processes = require("node:child_process") as typeof import("node:child_process");
    const spawn = processes.spawn;
    const launches: Array<{ executable: string; args: string[]; cwd: string }> = [];
    (processes as any).spawn = (executable: string, args: string[], options: { cwd: string }) => {
      if (Array.isArray(args) && args.some((arg) => arg.startsWith("--btr-report="))) {launches.push({ executable, args, cwd: options.cwd });}
      return spawn(executable, args, options);
    };
    let statuses: Map<vscode.TestItem, string>;
    try {statuses = await run([b]);} finally {(processes as any).spawn = spawn;}
    assert.strictEqual(launches.length, 1);
    assert.strictEqual(launches[0]!.executable, python);
    assert.deepStrictEqual(launches[0]!.args.slice(0, 2), ["-m", "pytest"]);
    assert.strictEqual(launches[0]!.cwd, path.join(second.uri.fsPath, "runtime"));
    assert.deepStrictEqual(ledger(first), []);
    assert.deepStrictEqual(ledger(second), [fs.realpathSync(path.join(second.uri.fsPath, "runtime"))]);
    assert.strictEqual(statuses.get(b), "passed");
    assert.strictEqual(statuses.has(a), false);
  });

  test("mixed Run All executes each root once and projects results to both same-name native items", async () => {
    const a = selected(first);
    const b = selected(second);
    const statuses = await run();
    assert.deepStrictEqual(ledger(first), [fs.realpathSync(path.join(first.uri.fsPath, "runtime"))]);
    assert.deepStrictEqual(ledger(second), [fs.realpathSync(path.join(second.uri.fsPath, "runtime"))]);
    assert.strictEqual(statuses.get(a), "passed");
    assert.strictEqual(statuses.get(b), "passed");
  });

  test("navigation uses the selected root's matching decorator", async () => {
    const firstFeature = path.join(first.uri.fsPath, "runtime/features/shared.feature");
    const firstLocations = await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeDefinitionProvider", vscode.Uri.file(firstFeature), new vscode.Position(3, 4)) ?? [];
    assert.deepStrictEqual(firstLocations.map((location) => location.uri.fsPath), [path.join(first.uri.fsPath, "runtime/features/steps/record.py")]);
    const secondFeature = path.join(second.uri.fsPath, "runtime/features/shared.feature");
    const secondLocations = await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeDefinitionProvider", vscode.Uri.file(secondFeature), new vscode.Position(3, 4)) ?? [];
    assert.deepStrictEqual(secondLocations.map((location) => location.uri.fsPath), [path.join(second.uri.fsPath, "runtime/tests/test_shared.py")]);
  });

  test("public file and suite commands and workspace tag execution use their own projects", async () => {
    await vscode.commands.executeCommand("behaveTestRunner.runFeatureFile", selected(second).uri!.fsPath);
    assert.deepStrictEqual(ledger(first), []);
    assert.strictEqual(ledger(second).length, 1);
    fs.writeFileSync(path.join(second.uri.fsPath, "runtime/ledger.txt"), "");
    await vscode.commands.executeCommand("behaveTestRunner.runAllTests");
    assert.strictEqual(ledger(first).length, 1);
    assert.strictEqual(ledger(second).length, 1);
    for (const folder of [first, second]) {fs.writeFileSync(path.join(folder.uri.fsPath, "runtime/ledger.txt"), "");}
    const tagged = await active.testProvider["context"].testExecutor.runAllTestsWithTagsOutput("project");
    assert.ok(tagged.success);
    assert.strictEqual(ledger(first).length, 1);
    assert.strictEqual(ledger(second).length, 1);
  });

  test("a mixed parallel request rejects every target before any framework launch", async () => {
    await assert.rejects(active.testProvider["context"].testExecutor.runAllTestsInParallel(), /Behave only/u);
    assert.deepStrictEqual(ledger(first), []);
    assert.deepStrictEqual(ledger(second), []);
  });

  test("a partial pytest outline executes only its selected row alongside A", async () => {
    const feature = path.join(second.uri.fsPath, "runtime/features/shared.feature");
    const original = fs.readFileSync(feature, "utf8");
    fs.appendFileSync(feature, '\n  Scenario Outline: B outline <value>\n    Given I record my project\n    Examples:\n      | value |\n      | one |\n      | two |\n');
    try {
      await active.testProvider.discoverTests();
      const rows: vscode.TestItem[] = [];
      const visit = (item: vscode.TestItem) => {if (item.children.size === 0 && item.uri?.fsPath === feature && item.label.includes("B outline")) {rows.push(item);} item.children.forEach(visit);};
      active.testController.items.forEach(visit);
      assert.strictEqual(rows.length, 2);
      const a = selected(first);
      const result = await run([a, rows[0]!]);
      assert.strictEqual(result.get(a), "passed");
      assert.strictEqual(result.get(rows[0]!), "passed");
      assert.strictEqual(result.has(rows[1]!), false);
      assert.strictEqual(ledger(first).length, 1);
      assert.strictEqual(ledger(second).length, 1);
    } finally {fs.writeFileSync(feature, original); await active.testProvider.discoverTests();}
  });

  test("pytest collection cannot execute a matching binding from A", async () => {
    const target = path.join(second.uri.fsPath, "runtime/tests/test_shared.py");
    const neighboring = path.join(first.uri.fsPath, "tests/test_shared.py");
    const marker = path.join(first.uri.fsPath, "runtime/wrong-project.txt");
    fs.mkdirSync(path.dirname(neighboring), { recursive: true });
    fs.writeFileSync(neighboring, `from pathlib import Path\nPath(${JSON.stringify(marker)}).write_text("wrong project")\ndef test_shared_named_scenario():\n    pass\n`);
    fs.renameSync(target, target + ".saved");
    try {
      const b = selected(second);
      assert.strictEqual((await run([b])).get(b), "errored");
      assert.strictEqual(fs.existsSync(marker), false);
      assert.deepStrictEqual(ledger(first), []);
      assert.deepStrictEqual(ledger(second), []);
    } finally {
      fs.renameSync(target + ".saved", target);
      fs.rmSync(neighboring, { force: true }); fs.rmSync(marker, { force: true });
    }
  });

  test("project configuration and output format remain stable during an operation and update the next request", async () => {
    const executor = active.testProvider["context"].testExecutor;
    const original = executor.runFeatureFileWithOutput.bind(executor);
    let enter: () => void = () => {};
    let release: () => void = () => {};
    const entered = new Promise<void>((resolve) => {enter = resolve;});
    const gate = new Promise<void>((resolve) => {release = resolve;});
    const b = selected(second);
    const previousFormat = settings(first).inspect("outputFormat")?.workspaceFolderValue;
    const displays: string[] = [];
    await update(first, "outputFormat", "plain");
    executor.runFeatureFileWithOutput = async (...args) => {
      if (args[0].filePath === selected(first).uri!.fsPath) {enter(); await gate;}
      const result = await original(...args);
      if (args[0].filePath === selected(first).uri!.fsPath) {displays.push(result.display ?? "");}
      return result;
    };
    let pending: ReturnType<typeof run> | undefined;
    try {
      pending = run();
      await entered;
      await update(second, "pytestCommand", "missing-project-b-python");
      await update(first, "outputFormat", "json");
      release();
      const outcomes = await pending;
      assert.strictEqual(outcomes.get(b), "passed", "B retains its admitted interpreter prefix after settings change");
      assert.strictEqual(ledger(second).length, 1);
      assert.match(displays[0]!, /\.\.\. passed/u, "A retains its admitted plain formatter after the setting changes");
      fs.writeFileSync(path.join(second.uri.fsPath, "runtime/ledger.txt"), "");
      const next = selected(second);
      const changed = await run([next]);
      assert.strictEqual(changed.get(next), "errored", "The next request uses B's changed command");
      assert.deepStrictEqual(ledger(second), []);
      fs.writeFileSync(path.join(first.uri.fsPath, "runtime/ledger.txt"), "");
      const nextA = selected(first);
      assert.strictEqual((await run([nextA])).get(nextA), "passed");
      assert.match(displays[1]!, /"name":\s*"Shared named scenario"/u, "The next request uses A's changed JSON formatter");
      assert.strictEqual(ledger(first).length, 1);
    } finally {
      release(); if (pending) {await pending;}
      executor.runFeatureFileWithOutput = original;
      await update(second, "pytestCommand", `${prefix} -m pytest`);
      await update(first, "outputFormat", previousFormat);
      await active.testProvider.discoverTests();
    }
  });

  test("outside-workspace files and a missing selected cwd fail without falling back to A", async () => {
    const executor = active.testProvider["context"].testExecutor;
    await assert.rejects(executor.runFeatureFileWithOutput({ filePath: path.join(os.tmpdir(), "outside-project.feature") }), /Open the folder containing/u);
    const b = selected(second);
    try {
      await update(second, "workingDirectory", "missing-directory");
      await run([b]);
      assert.ok(selectionErrors.some((message) => message.includes("Working directory") && message.includes("Project B")));
      assert.deepStrictEqual(ledger(first), []);
      assert.deepStrictEqual(ledger(second), []);
      const a = selected(first);
      assert.strictEqual((await run([a])).get(a), "passed", "An invalid unselected B project cannot block A");
      assert.strictEqual(ledger(first).length, 1);
    } finally {
      await update(second, "workingDirectory", "runtime");
      await active.testProvider.discoverTests();
    }
  });

  test("folder-specific patterns and folder removal retire discovery and reject a stale selection", async () => {
    const b = selected(second);
    try {
      await update(second, "testFilePattern", "runtime/features/absent.feature");
      await active.testProvider["observedDiscovery"];
      assert.strictEqual(active.testProvider["discoveredTests"].has(b.uri!.fsPath), false);
      assert.ok(selected(first));
      await update(second, "testFilePattern", "runtime/features/shared.feature");
      await active.testProvider.discoverTests();
      const stale = selected(second);
      await changeFolder(1, 1);
      await active.testProvider["observedDiscovery"];
      assert.strictEqual(active.testProvider["discoveredTests"].has(stale.uri!.fsPath), false);
      await assert.rejects(active.testProvider["context"].testExecutor.runFeatureFileWithOutput({ filePath: stale.uri!.fsPath }), /Open the folder containing/u);
      assert.deepStrictEqual(ledger(first), []);
      assert.deepStrictEqual(ledger(second), []);
    } finally {
      if (vscode.workspace.workspaceFolders?.length === 1) {await changeFolder(1, 0, { uri: second.uri, name: second.name });}
      await settings(second).update("testFilePattern", "runtime/features/shared.feature", vscode.ConfigurationTarget.WorkspaceFolder);
      await active.testProvider.discoverTests();
    }
  });

  test("removing B after capture retains its target outside cwd and outcome while later requests reject", async () => {
    const b = selected(second);
    const originalTarget = path.join(second.uri.fsPath, "runtime/tests/test_shared.py");
    const retainedTarget = path.join(second.uri.fsPath, "tests/test_shared.py");
    fs.mkdirSync(path.dirname(retainedTarget), { recursive: true });
    fs.writeFileSync(retainedTarget, fs.readFileSync(originalTarget, "utf8").replace('../features/shared.feature', '../runtime/features/shared.feature'));
    fs.renameSync(originalTarget, originalTarget + ".saved");
    const executor = active.testProvider["context"].testExecutor;
    const resolve = executor.resolveProjects.bind(executor);
    let enter: () => void = () => {};
    let release: () => void = () => {};
    const captured = new Promise<void>((done) => {enter = done;});
    const gate = new Promise<void>((done) => {release = done;});
    executor.resolveProjects = async (...args) => {const projects = await resolve(...args); enter(); await gate; return projects;};
    const processes = require("node:child_process") as typeof import("node:child_process");
    const spawn = processes.spawn;
    const launches: Array<{ target: string; cwd: string }> = [];
    (processes as any).spawn = (...args: Parameters<typeof spawn>) => {
      const child = spawn(...args);
      if (Array.isArray(args[1]) && args[1].some((arg) => arg.startsWith("--btr-report="))) {
        launches.push({ target: args[1].find((arg) => arg.startsWith("--btr-feature="))!.slice("--btr-feature=".length), cwd: String(args[2]?.cwd) });
      }
      return child;
    };
    let pending: ReturnType<typeof run> | undefined;
    try {
      pending = run([b]);
      await captured;
      await changeFolder(1, 1);
      await active.testProvider["observedDiscovery"];
      assert.strictEqual(active.testProvider.getDiscoveredTests().has(b.uri!.fsPath), false, "Discovery must really retire B before the admitted request resumes");
      release();
      assert.strictEqual((await pending).get(b), "passed");
      assert.deepStrictEqual(launches, [{ target: b.uri!.fsPath, cwd: path.join(second.uri.fsPath, "runtime") }]);
      assert.deepStrictEqual(ledger(first), []);
      assert.strictEqual(ledger(second).length, 1);
      await assert.rejects(executor.runFeatureFileWithOutput({ filePath: b.uri!.fsPath }), /Open the folder containing/u);
      assert.strictEqual(launches.length, 1, "A new request cannot reuse the removed project's snapshot");
    } finally {
      release(); if (pending) {await pending;}
      executor.resolveProjects = resolve; (processes as any).spawn = spawn;
      fs.renameSync(originalTarget + ".saved", originalTarget); fs.rmSync(retainedTarget, { force: true });
      if (vscode.workspace.workspaceFolders?.length === 1) {await changeFolder(1, 0, { uri: second.uri, name: second.name });}
      await active.testProvider.discoverTests();
    }
  });

  test("absent framework settings detect pytest only while automatic detection is enabled", async () => {
    const configFile = path.join(second.uri.fsPath, "runtime/pytest.ini");
    const original = fs.readFileSync(configFile, "utf8");
    fs.appendFileSync(configFile, "\n# pytest-bdd project\n");
    const processes = require("node:child_process") as typeof import("node:child_process");
    const spawn = processes.spawn;
    const frameworks: string[] = [];
    const feature = vscode.Uri.file(path.join(second.uri.fsPath, "runtime/features/shared.feature"));
    const binding = path.join(second.uri.fsPath, "runtime/tests/test_shared.py");
    const errors: string[] = [];
    const warnings: string[] = [];
    const information: string[] = [];
    const showError = vscode.window.showErrorMessage;
    const showWarning = vscode.window.showWarningMessage;
    const showInformation = vscode.window.showInformationMessage;
    (processes as any).spawn = (...args: Parameters<typeof spawn>) => {
      const child = spawn(...args);
      const argv = Array.isArray(args[1]) ? args[1] : [];
      const module = argv.indexOf("-m");
      if (args[0] === python && args[2]?.cwd === path.join(second.uri.fsPath, "runtime") && module >= 0) {frameworks.push(argv[module + 1]!);}
      return child;
    };
    try {
      (vscode.window as any).showErrorMessage = (message: string) => {errors.push(message); return Promise.resolve(undefined);};
      (vscode.window as any).showWarningMessage = (message: string) => {warnings.push(message); return Promise.resolve(undefined);};
      (vscode.window as any).showInformationMessage = (message: string) => {information.push(message); return Promise.resolve(undefined);};
      await update(second, "framework", undefined);
      const setting = settings(second).inspect("framework")!;
      assert.deepStrictEqual([setting.globalValue, setting.workspaceValue, setting.workspaceFolderValue], [undefined, undefined, undefined], "No explicit setting may mask automatic framework selection");
      let b = selected(second);
      assert.strictEqual((await run([b])).get(b), "passed");
      assert.deepStrictEqual(frameworks, ["pytest"]);
      assert.strictEqual(ledger(second).length, 1);
      assert.deepStrictEqual((await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeDefinitionProvider", feature, new vscode.Position(3, 6)))?.map((location) => [location.uri.fsPath, location.range.start.line]), [[binding, 6]]);
      fs.writeFileSync(path.join(second.uri.fsPath, "runtime/ledger.txt"), "");
      await update(second, "autoDetectFramework", false);
      b = selected(second);
      assert.strictEqual((await run([b])).get(b), "errored", "Default Behave cannot execute B's pytest-only step definitions");
      assert.deepStrictEqual(frameworks, ["pytest", "behave"]);
      assert.deepStrictEqual(ledger(first), []);
      assert.deepStrictEqual(ledger(second), []);
      assert.deepStrictEqual((await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeDefinitionProvider", feature, new vscode.Position(3, 6))) ?? [], []);
      assert.deepStrictEqual(errors, []);
      assert.deepStrictEqual(warnings, []);
      assert.deepStrictEqual(information, []);
    } finally {
      (processes as any).spawn = spawn; (vscode.window as any).showErrorMessage = showError;
      (vscode.window as any).showWarningMessage = showWarning; (vscode.window as any).showInformationMessage = showInformation;
      fs.writeFileSync(configFile, original);
      await update(second, "framework", "pytest-bdd");
      await update(second, "autoDetectFramework", true);
    }
  });

  test("root B debugging uses its native folder and stops at its actual pytest step", async () => {
    const b = selected(second);
    const step = path.join(second.uri.fsPath, "runtime/tests/test_shared.py");
    const line = fs.readFileSync(step, "utf8").split("\n").findIndex((text) => text.includes('with Path("ledger.txt")'));
    assert.ok(line > 0);
    const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(step), new vscode.Position(line, 0)));
    vscode.debug.addBreakpoints([breakpoint]);
    const cancellation = new vscode.CancellationTokenSource();
    let session: vscode.DebugSession | undefined;
    let ended = false;
    let resolveStop: () => void = () => {};
    let rejectStop: (error: unknown) => void = () => {};
    const observed = new Promise<void>((resolve, reject) => {resolveStop = resolve; rejectStop = reject;});
    const timeout = setTimeout(() => rejectStop(new Error("Project B's Python breakpoint was not observed")), 20000);
    const termination = vscode.debug.onDidTerminateDebugSession((candidate) => {if (candidate.id === session?.id) {ended = true;}});
    const tracker = vscode.debug.registerDebugAdapterTrackerFactory("debugpy", {
      createDebugAdapterTracker(candidate) {
        if (!candidate.configuration["__behaveExecutionId"]) {return undefined;}
        session = candidate;
        return { onDidSendMessage(message) {
          if (message.type === "event" && message.event === "stopped") {
            void (async () => {
              assert.strictEqual(candidate.workspaceFolder?.uri.toString(), second.uri.toString());
              assert.strictEqual(message.body.reason, "breakpoint");
              const stack = await candidate.customRequest("stackTrace", { threadId: message.body.threadId });
              assert.strictEqual(fs.realpathSync(stack.stackFrames[0].source.path), fs.realpathSync(step));
              assert.strictEqual(stack.stackFrames[0].line, line + 1);
              cancellation.cancel(); resolveStop();
            })().catch(rejectStop);
          }
        } };
      },
    });
    try {
      const pending = active.testProvider["debugTests"](new vscode.TestRunRequest([b]), cancellation.token);
      await observed; await pending;
      assert.ok(ended, "B's native debugger must terminate before operation admission is released");
      assert.deepStrictEqual(ledger(first), []);
      assert.deepStrictEqual(ledger(second), []);
    } finally {
      clearTimeout(timeout); cancellation.cancel(); cancellation.dispose(); tracker.dispose(); termination.dispose(); vscode.debug.removeBreakpoints([breakpoint]);
      if (session && !ended) {await vscode.debug.stopDebugging(session);}
    }
    assert.strictEqual((await run([b])).get(b), "passed");
    assert.strictEqual(ledger(second).length, 1);
  });
});
