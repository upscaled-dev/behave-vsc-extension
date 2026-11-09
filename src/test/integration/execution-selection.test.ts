import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { execFileSync, spawnSync } from "child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import * as vscode from "vscode";
import { BehaveTestProvider } from "../../test-providers/behave-test-provider";
import { ScenarioResultLookup } from "../../utils/test-item-mapping";
import { pythonPluginEnvironment } from "../../core/command-invocation";
import { afterOutput } from "../output-channel";

type Activation = { testController: vscode.TestController; testProvider: BehaveTestProvider };

suite("Execution selection acceptance", function () {
  this.timeout(30000);
  let extensionModule: typeof import("../../extension");
  let active: Activation;
  let project: string;
  let workspace: string;
  const fixtures = path.resolve(__dirname, "../../../src/test/fixtures/execution");
  const python = process.env["BEHAVE_TEST_PYTHON"] ?? "python3";
  const pythonCommand = process.platform === "win32"
    ? `"${python.replace(/"/g, '""')}"`
    : `'${python.replace(/'/g, "'\\''")}'`;
  const settings = vscode.workspace.getConfiguration("behaveTestRunner");
  const expected = ["first", "second", "duplicate-first", "duplicate-second", "outline-one", "outline-two", "retry", "other"];
  const pytestExpected = ["pytest-first", "pytest-second", "pytest-outline-one", "pytest-outline-two"];

  function ledger(): string[] {
    return fs.readFileSync(path.join(project, "ledger.txt"), "utf8").trim().split(/\r?\n/).filter(Boolean);
  }

  function items(): vscode.TestItem[] {
    const result: vscode.TestItem[] = [];
    const visit = (item: vscode.TestItem) => {result.push(item); item.children.forEach(visit);};
    active.testController.items.forEach(visit);
    return result;
  }

  function named(name: string): vscode.TestItem {
    const found = items().find((item) => item.label === name);
    assert.ok(found, `Discovered TestItem '${name}' must exist`);
    return found;
  }

  async function run(request = new vscode.TestRunRequest(), token?: vscode.CancellationToken, onOutput?: (text: string) => void, debug = false) {
    const statuses = new Map<vscode.TestItem, string>();
    const auxiliaryRuns: vscode.TestRunRequest[] = [];
    const messages = new Map<vscode.TestItem, string>();
    const recordMessage = (item: vscode.TestItem, value: vscode.TestMessage | readonly vscode.TestMessage[]) => {
      messages.set(item, (Array.isArray(value) ? value : [value]).map((entry: vscode.TestMessage) =>
        typeof entry.message === "string" ? entry.message : entry.message.value).join("\n"));
    };
    let output = "";
    let ended = false;
    const errors: string[] = [];
    const showError = vscode.window.showErrorMessage;
    (vscode.window as any).showErrorMessage = (message: string) => {errors.push(message); return Promise.resolve(undefined);};
    const create = active.testController.createTestRun.bind(active.testController);
    active.testController.createTestRun = (requested) => {
      const native = create(requested);
      if (requested !== request) {auxiliaryRuns.push(requested); return native;}
      return { ...native,
        passed: (item, duration) => {statuses.set(item, "passed"); native.passed(item, duration);},
        failed: (item, message, duration) => {statuses.set(item, "failed"); recordMessage(item, message); native.failed(item, message, duration);},
        errored: (item, message, duration) => {statuses.set(item, "errored"); recordMessage(item, message); native.errored(item, message, duration);},
        skipped: (item) => {statuses.set(item, "skipped"); native.skipped(item);},
        appendOutput: (text, location, item) => {output += text; onOutput?.(text); native.appendOutput(text, location, item);},
        end: () => {ended = true; native.end();},
      };
    };
    try {await active.testProvider[debug ? "debugTests" : "runTests"](request, token);}
    finally {active.testController.createTestRun = create; (vscode.window as any).showErrorMessage = showError;}
    assert.ok(ended, "The actual native TestRun must reach completion");
    return { statuses, messages, output, errors, auxiliaryRuns };
  }

  async function configure(framework: "behave" | "pytest-bdd") {
    await extensionModule.deactivate();
    project = framework === "behave" ? path.join(workspace, "execution-fixtures", "behave") : workspace;
    if (framework === "pytest-bdd") {fs.cpSync(path.join(fixtures, "pytest"), workspace, { recursive: true });}
    for (const [name, value] of Object.entries({ framework, autoDetectFramework: false,
      behaveCommand: `${pythonCommand} -m behave`, pytestCommand: `${pythonCommand} -m pytest`, workingDirectory: project,
      testFilePattern: framework === "behave" ? "execution-fixtures/behave/**/*.feature" : "features/pyselection.feature",
      autoDiscoverTests: true })) {
      await settings.update(name, value, vscode.ConfigurationTarget.Workspace);
    }
    active = await extensionModule.activate({ subscriptions: [] } as unknown as vscode.ExtensionContext) as Activation;
  }

  suiteSetup(async () => {
    execFileSync(python, ["-c", "import behave, pytest, pytest_bdd"], { stdio: "pipe" });
    const extension = vscode.extensions.getExtension("upscaled-dev.behave-test-runner");
    assert.ok(extension);
    await extension.activate();
    extensionModule = require(path.join(extension.extensionPath, "dist/extension.js"));
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    workspace = folder.uri.fsPath;
    fs.cpSync(path.join(fixtures, "behave"), path.join(workspace, "execution-fixtures", "behave"), { recursive: true });
    await configure("behave");
  });

  setup(() => {fs.writeFileSync(path.join(project, "ledger.txt"), "");});

  suiteTeardown(async () => {
    await extensionModule?.deactivate();
    for (const name of ["framework", "autoDetectFramework", "behaveCommand", "pytestCommand", "workingDirectory", "testFilePattern", "autoDiscoverTests"]) {
      await settings.update(name, undefined, vscode.ConfigurationTarget.Workspace);
    }
    if (workspace) {
      for (const entry of ["features", "tests", "pytest.ini", "ledger.txt", "cucumber-output.json", "execution-fixtures"]) {
        fs.rmSync(path.join(workspace, entry), { recursive: true, force: true });
      }
    }
  });

  test("configured JSON output reaches Test Explorer while the original selected scenario passes once", async () => {
    const previous = settings.inspect("outputFormat")?.workspaceValue;
    try {
      await settings.update("outputFormat", "json", vscode.ConfigurationTarget.Workspace);
      await active.testProvider.discoverTests();
      const selected = named("First selected scenario");
      const result = await run(new vscode.TestRunRequest([selected]));
      assert.deepStrictEqual(ledger(), ["first"]);
      assert.strictEqual(result.statuses.get(selected), "passed", result.output);
      assert.match(result.output, /"name":\s*"First selected scenario"/u, "Selected JSON must reach real TestRun output");
      assert.match(result.output, /"type":\s*"scenario"/u);
      assert.deepStrictEqual(result.errors, []);
    } finally {
      await settings.update("outputFormat", previous, vscode.ConfigurationTarget.Workspace);
    }
  });

  test("a standalone native Behave outfile retains selected output and the original TestItem passes once", async () => {
    const previous = settings.inspect("outputFormat")?.workspaceValue;
    const ini = path.join(project, "behave.ini");
    const outfile = path.join(project, "native output.txt");
    try {
      fs.writeFileSync(ini, "[behave]\noutfiles = native output.txt\n");
      await settings.update("outputFormat", "plain", vscode.ConfigurationTarget.Workspace);
      await active.testProvider.discoverTests();
      const selected = named("First selected scenario");
      const result = await run(new vscode.TestRunRequest([selected]));
      assert.strictEqual(result.statuses.get(selected), "passed", result.output);
      assert.deepStrictEqual(ledger(), ["first"]);
      assert.match(result.output, /Given I record "first" \.\.\. passed/u);
      assert.match(fs.readFileSync(outfile, "utf8"), /Given I record "first" \.\.\. passed/u);
      assert.deepStrictEqual(result.errors, []);
    } finally {
      await settings.update("outputFormat", previous, vscode.ConfigurationTarget.Workspace);
      for (const file of [ini, outfile]) {fs.rmSync(file, { force: true });}
    }
  });

  test("unmatched Behave prefix formats and outfiles retain native destinations without shifting the private report", async () => {
    const previous = settings.inspect("outputFormat")?.workspaceValue;
    const command = vscode.workspace.getConfiguration("behaveTestRunner", vscode.Uri.file(project)).get<string>("behaveCommand")!;
    const ini = path.join(project, "behave.ini");
    const native = path.join(project, "native.txt");
    const prefix = path.join(project, "prefix output.txt");
    try {
      for (const entry of [
        { flags: "-f plain", config: "", file: undefined },
        { flags: "--format=plain", config: "", file: undefined },
        { flags: "-fplain", config: "", file: undefined },
        { flags: '-o "prefix output.txt"', config: "", file: prefix },
        { flags: '--outfile="prefix output.txt"', config: "", file: prefix },
        { flags: '-o"prefix output.txt"', config: "", file: prefix },
        { flags: "-f plain", config: "[behave]\noutfiles = native.txt\n", file: native },
        { flags: "-f plain", config: "[behave]\nformat = plain\n", file: path.join(project, "plain.output") },
      ]) {
        fs.writeFileSync(ini, entry.config);
        for (const format of ["pretty", "json"]) {
          await settings.update("outputFormat", format, vscode.ConfigurationTarget.Workspace);
          await settings.update("behaveCommand", `${command} ${entry.flags}`, vscode.ConfigurationTarget.Workspace);
          await active.testProvider.discoverTests();
          fs.writeFileSync(path.join(project, "ledger.txt"), "");
          const selected = named("First selected scenario");
          const result = await run(new vscode.TestRunRequest([selected]));
          assert.strictEqual(result.statuses.get(selected), "passed", `${entry.flags}: ${result.output}`);
          assert.deepStrictEqual(ledger(), ["first"]);
          const visible = format === "json" ? /"type":\s*"scenario"/u : /Given I record "first"\s+#/u;
          assert.match(result.output, visible, "The selected format reaches native TestRun output");
          assert.deepStrictEqual(result.errors, []);
          if (entry.file) {
            const contents = fs.readFileSync(entry.file, "utf8");
            assert.match(contents, entry.file === prefix ? visible : /Given I record "first" \.\.\. passed/u);
            assert.ok(fs.existsSync(entry.file), "Native output survives private report cleanup");
          }
        }
      }
    } finally {
      await settings.update("behaveCommand", command, vscode.ConfigurationTarget.Workspace);
      await settings.update("outputFormat", previous, vscode.ConfigurationTarget.Workspace);
      for (const file of [ini, native, prefix, path.join(project, "plain.output")]) {fs.rmSync(file, { force: true });}
    }
  });

  test("a configured executable wrapper keeps its argv and runs Behave once with a standalone outfile", async () => {
    const previous = settings.inspect("outputFormat")?.workspaceValue;
    const command = vscode.workspace.getConfiguration("behaveTestRunner", vscode.Uri.file(project)).get<string>("behaveCommand")!;
    const wrapper = path.join(project, "behave wrapper.py");
    const ini = path.join(project, "behave.ini");
    const recorded = path.join(project, "wrapper.json");
    fs.writeFileSync(wrapper, 'import json,pathlib,runpy,sys\npathlib.Path("wrapper.json").write_text(json.dumps(sys.argv[1:]))\nrunpy.run_module("behave", run_name="__main__")\n');
    try {
      fs.writeFileSync(ini, "[behave]\noutfiles = native.txt\n");
      await settings.update("outputFormat", "pretty", vscode.ConfigurationTarget.Workspace);
      await settings.update("behaveCommand", `${pythonCommand} "${wrapper}" --format=plain`, vscode.ConfigurationTarget.Workspace);
      await active.testProvider.discoverTests();
      const selected = named("First selected scenario");
      const result = await run(new vscode.TestRunRequest([selected]));
      assert.strictEqual(result.statuses.get(selected), "passed", result.output);
      assert.deepStrictEqual(ledger(), ["first"]);
      const argv: string[] = JSON.parse(fs.readFileSync(recorded, "utf8"));
      assert.strictEqual(argv[0], "--format=plain");
      assert.ok(argv.includes(`${selected.uri!.fsPath}:${selected.range!.start.line + 1}`));
      assert.match(result.output, /Given I record "first"\s+#/u);
      assert.match(fs.readFileSync(path.join(project, "native.txt"), "utf8"), /\.\.\. passed/u);
      const report = argv.find((arg) => arg.startsWith("btr_report="))!.slice("btr_report=".length);
      assert.strictEqual(fs.existsSync(path.dirname(report)), false);
      assert.deepStrictEqual(result.errors, []);
    } finally {
      await settings.update("behaveCommand", command, vscode.ConfigurationTarget.Workspace);
      await settings.update("outputFormat", previous, vscode.ConfigurationTarget.Workspace);
      for (const file of [wrapper, ini, recorded, path.join(project, "native.txt")]) {fs.rmSync(file, { force: true });}
    }
  });

  test("Behave output formats produce distinct native output and keep exact selected outcomes", async () => {
    const previous = settings.inspect("outputFormat")?.workspaceValue;
    try {
      for (const [format, observable] of [
        ["pretty", /Given I record "first"\s+#/u], ["plain", /Given I record "first" \.\.\. passed/u],
        ["progress", /selection\.feature\s+\.[S]*\r?\n/u], ["steps", /GIVEN STEP DEFINITIONS/u],
      ] as const) {
        await settings.update("outputFormat", format, vscode.ConfigurationTarget.Workspace);
        await active.testProvider.discoverTests();
        fs.writeFileSync(path.join(project, "ledger.txt"), "");
        const selected = named("First selected scenario");
        const result = await run(new vscode.TestRunRequest([selected]));
        assert.match(result.output, observable, format);
        assert.strictEqual(result.statuses.get(selected), "passed", result.output);
        assert.deepStrictEqual(ledger(), ["first"], "Formatter choice must not enable dry-run or execute twice");
        assert.deepStrictEqual(result.errors, []);
        assert.strictEqual(fs.existsSync(path.join(project, "reports")), false, "Ordinary format choices must not enable JUnit");
      }
    } finally {await settings.update("outputFormat", previous, vscode.ConfigurationTarget.Workspace);}
  });

  test("Behave JSON attachments remain in selected output and the independent private report", async function () {
    if (execFileSync(python, ["-c", "from behave.runner import Context; print(hasattr(Context, 'attach'))"], { encoding: "utf8" }).trim() !== "True") {this.skip();}
    const feature = path.join(project, "features/attachment.feature");
    const steps = path.join(project, "features/steps/attachment.py");
    fs.writeFileSync(feature, "Feature: Capture attachments\n  Scenario: Attach a sample\n    Given I attach a capture sample\n");
    fs.writeFileSync(steps, 'from pathlib import Path\nfrom behave import given\n@given("I attach a capture sample")\ndef attach_sample(context):\n    with Path("ledger.txt").open("a") as ledger:\n        ledger.write("attachment\\n")\n    context.attach("text/plain", b"BTR_ATTACHMENT")\n');
    try {
      const result = await active.testProvider["context"].testExecutor.runScenarioWithOutput({ filePath: feature, lineNumber: 2, outputFormat: "json" });
      assert.strictEqual(result.success, true, result.error);
      assert.deepStrictEqual(ledger(), ["attachment"]);
      for (const contents of [result.output, result.display!]) {
        assert.match(contents, /"mime_type":\s*"text\/plain"/u);
        assert.match(contents, new RegExp(Buffer.from("BTR_ATTACHMENT").toString("base64"), "u"));
      }
      assert.ok(Object.values(result.scenarioResults ?? {}).includes("passed"));
    } finally {
      for (const file of [feature, steps]) {fs.rmSync(file, { force: true });}
    }
  });

  test("Behave output format per-call overrides and invalid settings fail safely and permit retry", async () => {
    const previous = settings.inspect("outputFormat")?.workspaceValue;
    const executor = active.testProvider["context"].testExecutor;
    try {
      await settings.update("outputFormat", "unsupported-format", vscode.ConfigurationTarget.Workspace);
      await active.testProvider.discoverTests();
      const rejected = named("First selected scenario");
      const invalid = await run(new vscode.TestRunRequest([rejected]));
      assert.strictEqual(invalid.statuses.get(rejected), "errored");
      assert.deepStrictEqual(ledger(), []);
      assert.match(invalid.output, /Unsupported Behave outputFormat 'unsupported-format'/u);
      const selected = named("First selected scenario");
      const options = { filePath: selected.uri!.fsPath, lineNumber: selected.range!.start.line + 1, outputFormat: "json" };
      const override = await executor.runScenarioWithOutput(options);
      assert.ok(override.success, override.error);
      assert.match(override.display!, /"name":\s*"First selected scenario"/u);
      const outcomes = new ScenarioResultLookup(override.scenarioResults ?? {}, project);
      assert.strictEqual(outcomes.get(selected, selected.parent ?? selected), "passed");
      assert.deepStrictEqual(ledger(), ["first"]);
      fs.writeFileSync(path.join(project, "ledger.txt"), "");
      await settings.update("outputFormat", "plain", vscode.ConfigurationTarget.Workspace);
      await active.testProvider.discoverTests();
      const invalidCall = await executor.runScenarioWithOutput({ ...options, outputFormat: "unsupported-call-format" });
      assert.strictEqual(invalidCall.errored, true);
      assert.deepStrictEqual(ledger(), []);
      const retryItem = named("First selected scenario");
      const retry = await run(new vscode.TestRunRequest([retryItem]));
      assert.strictEqual(retry.statuses.get(retryItem), "passed", retry.output);
      assert.match(retry.output, /\.\.\. passed/u);
      assert.deepStrictEqual(ledger(), ["first"]);
    } finally {await settings.update("outputFormat", previous, vscode.ConfigurationTarget.Workspace);}
  });

  test("Behave output formats preserve real failure details and a successful selected retry", async () => {
    const previous = settings.inspect("outputFormat")?.workspaceValue;
    const failure = path.join(project, "fail-retry");
    try {
      await settings.update("outputFormat", "progress", vscode.ConfigurationTarget.Workspace);
      await active.testProvider.discoverTests();
      fs.writeFileSync(failure, "");
      const selected = named("Retry scenario");
      const failed = await run(new vscode.TestRunRequest([selected]));
      assert.strictEqual(failed.statuses.get(selected), "failed", failed.output);
      assert.match(failed.messages.get(selected)!, /requested retry failure/u);
      assert.match(failed.output, /selection\.feature\s+S*F/u);
      assert.deepStrictEqual(ledger(), ["retry"]);
      fs.rmSync(failure);
      fs.writeFileSync(path.join(project, "ledger.txt"), "");
      const retryItem = named("Retry scenario");
      const retry = await run(new vscode.TestRunRequest([retryItem]));
      assert.strictEqual(retry.statuses.get(retryItem), "passed", retry.output);
      assert.deepStrictEqual(ledger(), ["retry"]);
    } finally {
      fs.rmSync(failure, { force: true });
      await settings.update("outputFormat", previous, vscode.ConfigurationTarget.Workspace);
    }
  });

  test("Behave JUnit retains native XML and balanced config and prefix output pairs keep private JSON isolated", async () => {
    const previous = settings.inspect("outputFormat")?.workspaceValue;
    const command = vscode.workspace.getConfiguration("behaveTestRunner", vscode.Uri.file(project)).get<string>("behaveCommand")!;
    const ini = path.join(project, "behave.ini");
    const processes = require("node:child_process") as typeof import("node:child_process");
    const spawn = processes.spawn;
    const reports: string[] = [];
    (processes as any).spawn = (...args: Parameters<typeof spawn>) => {
      const argv = Array.isArray(args[1]) ? args[1] : [];
      const output = argv.find((arg) => arg.startsWith("btr_report="))?.slice("btr_report=".length);
      if (output && path.basename(output) === "results.json") {reports.push(output);}
      return spawn(...args);
    };
    try {
      await settings.update("outputFormat", "junit", vscode.ConfigurationTarget.Workspace);
      for (const directory of ["reports", "format-only-junit", "retained-junit"]) {
        if (directory !== "reports") {
          fs.writeFileSync(ini, `[behave]\nformat = plain\n${directory === "format-only-junit" ? "" : "outfiles = configured.txt\n"}junit_directory = ${directory}\n`);
          await settings.update("behaveCommand", `${command} -f steps -o prefix.txt`, vscode.ConfigurationTarget.Workspace);
        }
        await active.testProvider.discoverTests();
        fs.writeFileSync(path.join(project, "ledger.txt"), "");
        const selected = named("First selected scenario");
        const result = await run(new vscode.TestRunRequest([selected]));
        assert.strictEqual(result.statuses.get(selected), "passed", result.output);
        assert.deepStrictEqual(ledger(), ["first"]);
        assert.match(result.output, /Given I record "first"\s+#/u, "JUnit uses readable pretty stdout");
        assert.deepStrictEqual(result.errors, []);
        const xml = path.join(project, directory, "TESTS-selection.xml");
        assert.match(fs.readFileSync(xml, "utf8"), /First selected scenario/u);
        assert.ok(reports.length > 0);
        for (const report of reports) {assert.strictEqual(fs.existsSync(path.dirname(report)), false, "Only the private JSON directory is removed");}
        assert.strictEqual(fs.existsSync(xml), true, "Native XML survives private report cleanup");
        if (directory !== "reports") {
          assert.match(fs.readFileSync(path.join(project, directory === "format-only-junit" ? "plain.output" : "configured.txt"), "utf8"), /\.\.\. passed/u);
          assert.match(fs.readFileSync(path.join(project, "prefix.txt"), "utf8"), /GIVEN STEP DEFINITIONS/u);
        }
      }
      fs.writeFileSync(path.join(project, "fail-retry"), "");
      fs.writeFileSync(path.join(project, "ledger.txt"), "");
      const failedItem = named("Retry scenario");
      const failed = await run(new vscode.TestRunRequest([failedItem]));
      assert.strictEqual(failed.statuses.get(failedItem), "failed");
      const xml = path.join(project, "retained-junit", "TESTS-selection.xml");
      assert.match(fs.readFileSync(xml, "utf8"), /<failure/u);
      assert.deepStrictEqual(ledger(), ["retry"]);
      fs.rmSync(path.join(project, "fail-retry"));
      fs.writeFileSync(path.join(project, "ledger.txt"), "");
      const retriedItem = named("Retry scenario");
      const retried = await run(new vscode.TestRunRequest([retriedItem]));
      assert.strictEqual(retried.statuses.get(retriedItem), "passed", retried.output);
      assert.strictEqual(fs.readFileSync(xml, "utf8").includes("<failure"), false, "Native retry overwrites its XML with the real new outcome");
      assert.deepStrictEqual(ledger(), ["retry"]);
      await settings.update("outputFormat", "progress", vscode.ConfigurationTarget.Workspace);
      await active.testProvider.discoverTests();
      fs.writeFileSync(ini, "[behave]\nformat = plain\njunit = true\njunit_directory = native-junit\n");
      fs.writeFileSync(path.join(project, "ledger.txt"), "");
      const nativeItem = named("First selected scenario");
      const native = await run(new vscode.TestRunRequest([nativeItem]));
      assert.strictEqual(native.statuses.get(nativeItem), "passed", native.output);
      assert.match(native.output, /selection\.feature\s+\.[S]*\r?\n/u);
      assert.match(fs.readFileSync(path.join(project, "native-junit", "TESTS-selection.xml"), "utf8"), /First selected scenario/u);
      assert.deepStrictEqual(ledger(), ["first"], "Existing native JUnit settings remain effective under an ordinary visible formatter");
    } finally {
      (processes as any).spawn = spawn;
      await settings.update("behaveCommand", command, vscode.ConfigurationTarget.Workspace);
      await settings.update("outputFormat", previous, vscode.ConfigurationTarget.Workspace);
      for (const file of [ini, "reports", "format-only-junit", "retained-junit", "native-junit", "plain.output", "configured.txt", "prefix.txt", "fail-retry"]) {
        fs.rmSync(path.isAbsolute(file) ? file : path.join(project, file), { recursive: true, force: true });
      }
    }
  });

  test("default Run All executes each discovered logical scenario once in all five organizations", async () => {
    for (const grouping of ["FeatureBased", "TagBased", "FileBased", "ScenarioType", "Flat"]) {
      fs.writeFileSync(path.join(project, "ledger.txt"), "");
      await vscode.commands.executeCommand(`behaveTestRunner.set${grouping}Organization`);
      const first = items().filter((item) => item.label === "First selected scenario");
      assert.ok(first.length > 0);
      const result = await run();
      assert.deepStrictEqual(ledger().sort(), [...expected].sort(), grouping);
      for (const alias of first) {assert.strictEqual(result.statuses.get(alias), "passed", grouping);}
      assert.ok(result.output.includes("First selected scenario"));
    }
  });

  test("quoted Python paths and special feature filenames run the named scenario without shell interpretation", async function () {
    if (process.platform === "win32") {this.skip();}
    const [prefix, executable] = execFileSync(python, ["-c", "import sys; print(sys.prefix); print(sys.executable)"], { encoding: "utf8" }).trim().split(/\r?\n/);
    assert.ok(prefix && executable);
    const relative = path.relative(prefix, executable);
    assert.ok(!relative.startsWith(".."), "This acceptance fixture requires its interpreter inside the configured Python environment");
    const environment = path.join(project, "python environment");
    const file = path.join(project, "features", "selection $(touch injected).feature");
    const injected = path.join(project, "injected");
    fs.symlinkSync(prefix, environment, "dir");
    fs.writeFileSync(file, 'Feature: Quoted argv fixture\n  Scenario: Special filename scenario\n    Given I record "special-file"\n');
    try {
      await settings.update("behaveCommand", `'${path.join(environment, relative).replace(/'/g, "'\\''")}' -m behave`, vscode.ConfigurationTarget.Workspace);
      await active.testProvider.discoverTests();
      const selected = named("Special filename scenario");
      const result = await run(new vscode.TestRunRequest([selected]));
      assert.strictEqual(result.statuses.get(selected), "passed", result.output);
      assert.deepStrictEqual(ledger(), ["special-file"]);
      assert.strictEqual(fs.existsSync(injected), false, "Shell metacharacters in the feature path must remain literal argv");
    } finally {
      await settings.update("behaveCommand", `${pythonCommand} -m behave`, vscode.ConfigurationTarget.Workspace);
      fs.rmSync(file, { force: true }); fs.unlinkSync(environment); fs.rmSync(injected, { force: true });
      await active.testProvider.discoverTests();
    }
  });

  test("an explicit empty include executes no scenarios and changes no item outcomes", async () => {
    const result = await run(new vscode.TestRunRequest([]));
    assert.deepStrictEqual(ledger(), []);
    assert.strictEqual(result.statuses.size, 0);
  });

  test("overlapping tag projections deduplicate scenarios and exclusions apply to every alias", async () => {
    await vscode.commands.executeCommand("behaveTestRunner.setTagBasedOrganization");
    const seedFirst = named("First selected scenario");
    const seedExcluded = named("Second selected scenario");
    const seeded = await run(new vscode.TestRunRequest([seedFirst, seedExcluded]));
    assert.strictEqual(seeded.statuses.get(seedExcluded), "passed");
    fs.writeFileSync(path.join(project, "ledger.txt"), "");
    const smoke = named("@smoke");
    const shared = named("@shared");
    const first = items().filter((item) => item.label === "First selected scenario");
    const excluded = items().filter((item) => item.label === "Second selected scenario");
    assert.ok(first.length > 1 && excluded.length > 1, "The selected and excluded scenarios must each have tag aliases");
    const executor = active.testProvider["context"].testExecutor;
    const original = executor.runScenarioWithOutput.bind(executor);
    let refreshed = false;
    executor.runScenarioWithOutput = async (...args) => {
      const result = await original(...args);
      if (!refreshed) {refreshed = true; await active.testProvider.refreshTests();}
      return result;
    };
    try {
      const result = await run(new vscode.TestRunRequest([smoke, shared, first[0]!], [excluded[0]!]));
      assert.ok(refreshed && result.auxiliaryRuns.length > 0, "A real mid-run rebuild must publish separate native history-restoration runs");
      assert.deepStrictEqual(ledger().sort(), ["first", "outline-one", "outline-two"].sort());
      for (const alias of first) {assert.strictEqual(result.statuses.get(alias), "passed");}
      for (const alias of excluded) {assert.strictEqual(result.statuses.has(alias), false);}
    } finally {executor.runScenarioWithOutput = original;}
  });

  test("a feature plus its child executes exact remaining duplicate-title scenarios and outline rows", async () => {
    await vscode.commands.executeCommand("behaveTestRunner.setFeatureBasedOrganization");
    const feature = named("Execution selection");
    const duplicates = items().filter((item) => item.label === "Duplicate title");
    const rows = items().filter((item) => item.children.size === 0 && item.label.includes("Selected outline"));
    assert.strictEqual(duplicates.length, 2);
    assert.strictEqual(rows.length, 2);
    const result = await run(new vscode.TestRunRequest([feature, named("First selected scenario")], [duplicates[1]!, rows[1]!]));
    assert.deepStrictEqual(ledger().sort(), ["first", "second", "duplicate-first", "outline-one", "retry"].sort());
    assert.strictEqual(result.statuses.get(duplicates[0]!), "passed");
    assert.strictEqual(result.statuses.has(duplicates[1]!), false);
    assert.strictEqual(result.statuses.get(rows[0]!), "passed");
    assert.strictEqual(result.statuses.has(rows[1]!), false);
  });

  test("one duplicate title and one example row use exact Behave lines", async () => {
    const duplicates = items().filter((item) => item.label === "Duplicate title");
    const row = items().find((item) => item.children.size === 0 && item.label.includes("outline-two"));
    assert.ok(row);
    const result = await run(new vscode.TestRunRequest([duplicates[1]!, row]));
    assert.deepStrictEqual(ledger().sort(), ["duplicate-second", "outline-two"].sort());
    assert.strictEqual(result.statuses.get(row), "passed");

  });

  test("a named Behave failure settles failed and a subsequent retry settles passed", async () => {
    const retry = named("Retry scenario");
    fs.writeFileSync(path.join(project, "fail-retry"), "");
    try {
      const failed = await run(new vscode.TestRunRequest([retry]));
      assert.strictEqual(failed.statuses.get(retry), "failed");
      assert.ok(failed.output.includes("requested retry failure"));
    } finally {fs.rmSync(path.join(project, "fail-retry"), { force: true });}
    fs.writeFileSync(path.join(project, "ledger.txt"), "");
    const passed = await run(new vscode.TestRunRequest([retry]));
    assert.strictEqual(passed.statuses.get(retry), "passed");
    assert.deepStrictEqual(ledger(), ["retry"]);
  });

  test("cancelling a real descendant drains the process group, ends the TestRun and permits retry", async function () {
    if (process.platform === "win32") {this.skip();}
    const waiting = path.join(project, "wait-descendant");
    fs.writeFileSync(waiting, "");
    const source = new vscode.CancellationTokenSource();
    let ready = false;
    const create = active.testController.createTestRun.bind(active.testController);
    try {
      active.testController.createTestRun = (request) => {
        const native = create(request);
        return { ...native, end: () => {
          const pid = Number(fs.readFileSync(path.join(project, "descendant.pid"), "utf8"));
          assert.throws(() => process.kill(pid, 0), /ESRCH/u, "The real descendant must be gone before native TestRun.end");
          native.end();
        } };
      };
      const result = await run(new vscode.TestRunRequest([named("First selected scenario"), named("Retry scenario"), named("Other selected scenario")]), source.token, (text) => {
        if (text.includes("DESCENDANT_READY")) {ready = true; source.cancel();}
      });
      assert.ok(ready, "Cancellation follows the real descendant's readiness output");
      active.testController.createTestRun = create;
      assert.strictEqual(result.statuses.get(named("First selected scenario")), "passed");
      assert.strictEqual(result.statuses.get(named("Retry scenario")), "skipped");
      assert.strictEqual(result.statuses.get(named("Other selected scenario")), "skipped");
      assert.deepStrictEqual(ledger(), ["first", "retry"]);
      const pid = Number(fs.readFileSync(path.join(project, "descendant.pid"), "utf8"));
      assert.throws(() => process.kill(pid, 0), /ESRCH/u, "The descendant must be gone before the run ends");
    } finally {active.testController.createTestRun = create; source.dispose(); fs.rmSync(waiting, { force: true });}
    fs.writeFileSync(path.join(project, "ledger.txt"), "");
    const retry = await run(new vscode.TestRunRequest([named("Retry scenario")]));
    assert.strictEqual(retry.statuses.get(named("Retry scenario")), "passed", JSON.stringify(retry.errors));
    assert.deepStrictEqual(ledger(), ["retry"]);
  });

  test("the public parallel command runs real files concurrently and reports a real worker failure", async () => {
    const processes = require("node:child_process") as typeof import("node:child_process");
    const spawn = processes.spawn;
    const showError = vscode.window.showErrorMessage;
    const errors: string[] = [];
    const previousFormat = settings.inspect("outputFormat")?.workspaceValue;
    const logger = active.testProvider["context"].logger;
    const append = logger.appendOutput.bind(logger);
    let displayed = "";
    logger.appendOutput = (text) => {displayed += text; append(text);};
    const featureFiles = ["selection.feature", "other.feature"].map((file) => path.join(project, "features", file));
    const launched: string[] = [];
    const ignored = new Map<string, number>();
    let activeWorkers = 0;
    let peak = 0;
    (processes as any).spawn = (...args: Parameters<typeof spawn>) => {
      const child = spawn(...args);
      const [executable, requestedArgs, options] = args;
      const argv = Array.isArray(requestedArgs) ? requestedArgs : [];
      const feature = argv.find((arg) => featureFiles.includes(arg));
      const report = argv.find((arg) => arg.startsWith("btr_report="));
      if (executable === python && options?.cwd === project && argv[0] === "-m" && argv[1] === "behave" &&
        feature && report) {
        launched.push(feature); activeWorkers++; peak = Math.max(peak, activeWorkers);
        child.once("close", () => {activeWorkers--;});
      } else {
        const name = path.posix.basename(executable.replace(/\\/g, "/"));
        ignored.set(name, (ignored.get(name) ?? 0) + 1);
      }
      return child;
    };
    const assertWorkers = () => {
      assert.deepStrictEqual([...launched].sort(), [...featureFiles].sort(), "Each real fixture feature must launch exactly once");
      assert.strictEqual(peak, 2, "Two real feature workers must overlap");
      assert.strictEqual(activeWorkers, 0, "All real feature workers must close before the public command completes");
    };
    (vscode.window as any).showErrorMessage = (message: string) => {errors.push(message); return Promise.resolve(undefined);};
    try {
      await settings.update("maxParallelProcesses", 2, vscode.ConfigurationTarget.Workspace);
      await settings.update("outputFormat", "json", vscode.ConfigurationTarget.Workspace);
      await vscode.commands.executeCommand("behaveTestRunner.runAllTestsParallel");
      assert.deepStrictEqual(ledger().sort(), [...expected].sort());
      assertWorkers();
      assert.strictEqual(errors.length, 0);
      assert.match(displayed, /"name":\s*"First selected scenario"/u, "Parallel workers retain the configured JSON formatter");
      fs.writeFileSync(path.join(project, "fail-retry"), "");
      fs.writeFileSync(path.join(project, "ledger.txt"), "");
      launched.length = 0; peak = 0;
      await vscode.commands.executeCommand("behaveTestRunner.runAllTestsParallel");
      assert.ok(errors.some((message) => message.includes("parallel feature execution(s) failed")), "The registered public command must display its failed worker outcome");
      assertWorkers();
    } finally {
      (processes as any).spawn = spawn; (vscode.window as any).showErrorMessage = showError;
      logger.appendOutput = append;
      if (ignored.size) {process.stdout.write(`Parallel acceptance ignored non-worker processes: ${JSON.stringify(Object.fromEntries(ignored))}\n`);}
      fs.rmSync(path.join(project, "fail-retry"), { force: true });
      await settings.update("maxParallelProcesses", undefined, vscode.ConfigurationTarget.Workspace);
      await settings.update("outputFormat", previousFormat, vscode.ConfigurationTarget.Workspace);
    }
  });

  test("provider debug cancellation and failures settle current and unstarted native items", async () => {
    const executor = active.testProvider["context"].testExecutor;
    const resolve = executor.resolveProjects.bind(executor);
    const builder = (await resolve([path.join(project, "features/selection.feature")])).values().next().value!.builder;
    const build = builder.buildDebugConfiguration.bind(builder);
    executor.resolveProjects = async (...args) => new Map(Array.from(await resolve(...args), ([key, context]) => [key, { ...context, builder }]));
    const source = new vscode.CancellationTokenSource();
    let begin: () => void = () => {};
    const building = new Promise<void>((resolve) => {begin = resolve;});
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {release = resolve;});
    builder.buildDebugConfiguration = async (...args) => {begin(); await gate; return build(...args);};
    try {
      const pending = run(new vscode.TestRunRequest([named("First selected scenario"), named("Retry scenario")]), source.token, undefined, true);
      await building; source.cancel(); release();
      const cancelled = await pending;
      assert.strictEqual(cancelled.statuses.get(named("First selected scenario")), "skipped");
      assert.strictEqual(cancelled.statuses.get(named("Retry scenario")), "skipped");
      assert.deepStrictEqual(ledger(), [], "Cancellation during configuration cannot launch Python");
      builder.buildDebugConfiguration = async () => {throw new Error("controlled invalid debug configuration");};
      const executor = active.testProvider["context"].testExecutor;
      const debug = executor.debugScenario.bind(executor);
      let units = 0;
      executor.debugScenario = async (...args) => {if (++units > 1) {await debug(...args);}};
      try {
        const failed = await run(new vscode.TestRunRequest([named("First selected scenario"), named("Retry scenario"), named("Other selected scenario")]), undefined, undefined, true);
        assert.strictEqual(failed.statuses.get(named("First selected scenario")), "skipped", "Earlier settled debug items must remain settled");
        assert.strictEqual(failed.statuses.get(named("Retry scenario")), "errored");
        assert.strictEqual(failed.statuses.get(named("Other selected scenario")), "skipped");
        assert.strictEqual(units, 2, "A failed debug unit must not launch later units");
      } finally {executor.debugScenario = debug;}
      let finish: () => void = () => {};
      const occupied = new Promise<void>((resolve) => {finish = resolve;});
      const activeOperation = executor.withExecutionSession(async () => occupied);
      try {
        const rejected = await run(new vscode.TestRunRequest([named("First selected scenario")]), undefined, undefined, true);
        assert.strictEqual(rejected.statuses.size, 0, "Admission rejection must not replace earlier native results");
        assert.ok(rejected.errors.some((message) => message.includes("already in progress")));
      } finally {finish(); await activeOperation;}
    } finally {release(); source.dispose(); builder.buildDebugConfiguration = build; executor.resolveProjects = resolve;}
  });

  test("an unconfirmed process stop errors and ends the native run while retaining its report until confirmed termination", async function () {
    if (process.platform === "win32") {this.skip();}
    const processes = require("node:child_process") as typeof import("node:child_process");
    const spawn = processes.spawn;
    const kill = process.kill;
    const clock = Date.now;
    const executor = active.testProvider["context"].testExecutor;
    const executorClass = executor.constructor as any;
    const previousPoison = executorClass.poison;
    const child = Object.assign(new EventEmitter(), { pid: 1073741823, stdout: new PassThrough(), stderr: new PassThrough() });
    const source = new vscode.CancellationTokenSource();
    let alive = true;
    let now = clock();
    let report = "";
    let launched: () => void = () => {};
    const launch = new Promise<void>((resolve) => {launched = resolve;});
    let cleaned: () => void = () => {};
    const cleanup = new Promise<void>((resolve) => {cleaned = resolve;});
    const promises = require("node:fs/promises") as typeof import("node:fs/promises");
    const remove = promises.rm;
    (promises as any).rm = async (...args: Parameters<typeof promises.rm>) => {
      const result = await remove(...args);
      if (report && String(args[0]) === path.dirname(report)) {cleaned();}
      return result;
    };
    (processes as any).spawn = (_file: string, args: string[]) => {
      report = args.find((arg) => arg.startsWith("btr_report="))!.slice("btr_report=".length);
      launched(); return child;
    };
    Date.now = () => now;
    process.kill = ((pid: number, signal: NodeJS.Signals | number) => {
      if (pid !== -child.pid) {return kill(pid, signal);}
      if (!alive) {throw Object.assign(new Error("gone"), { code: "ESRCH" });}
      if (signal === 0) {now += 2001;}
      return true;
    }) as typeof process.kill;
    try {
      let observedOutput = "";
      const pending = run(new vscode.TestRunRequest([named("Retry scenario")]), source.token, (text) => {observedOutput += text;});
      await launch;
      child.stdout.write("before bounded failure\n");
      source.cancel();
      const result = await pending;
      Date.now = clock;
      assert.strictEqual(result.statuses.get(named("Retry scenario")), "errored", "Unknown termination must not be painted as a cancelled skip");
      assert.ok(result.output.includes("termination could not be confirmed"));
      assert.ok(fs.existsSync(path.dirname(report)), "The possibly active report directory must be retained");
      const second = new executorClass();
      await assert.rejects(second.withExecutionSession(async () => {}), /Reload the window/u);
      await second.dispose();
      await executor.dispose();
      const output = observedOutput;
      child.stdout.write("late data must be discarded\n");
      assert.strictEqual(observedOutput, output, "An ended native TestRun cannot receive late output");
      alive = false;
      child.stdout.end(); child.stderr.end(); child.emit("close", 1);
      await cleanup;
      assert.strictEqual(fs.existsSync(path.dirname(report)), false, "Confirmed termination permits deferred report cleanup after disposal");
    } finally {
      alive = false; child.emit("close", 1); source.dispose();
      (processes as any).spawn = spawn; process.kill = kill; Date.now = clock;
      (promises as any).rm = remove; executorClass.poison = previousPoison;
      child.stdout.destroy(); child.stderr.destroy();
      await configure("behave");
    }
  });

  test("the provider retains admission between selected units", async () => {
    const executor = active.testProvider["context"].testExecutor;
    const original = executor.runScenarioWithOutput.bind(executor);
    let firstComplete: () => void = () => {};
    const completed = new Promise<void>((resolve) => {firstComplete = resolve;});
    let continueRun: () => void = () => {};
    const release = new Promise<void>((resolve) => {continueRun = resolve;});
    let units = 0;
    executor.runScenarioWithOutput = async (options, session) => {
      const result = await original(options, session);
      if (++units === 1) {firstComplete(); await release;}
      return result;
    };
    try {
      const pending = run(new vscode.TestRunRequest([named("First selected scenario"), named("Second selected scenario")]));
      await completed;
      await assert.rejects(executor.runScenarioWithOutput({ filePath: named("Retry scenario").uri!.fsPath }), /already in progress/u);
      assert.deepStrictEqual(ledger(), ["first"]);
      continueRun();
      const result = await pending;
      assert.strictEqual(result.statuses.get(named("Second selected scenario")), "passed");
      assert.deepStrictEqual(ledger(), ["first", "second"]);
    } finally {continueRun(); executor.runScenarioWithOutput = original;}
  });

  test("missing, malformed and oversized primary reports error the selected scenario", async () => {
    const script = path.join(project, "report-fixture.py");
    fs.writeFileSync(script, `import sys,pathlib
report = pathlib.Path(next(arg.split("=", 1)[1] for arg in sys.argv if arg.startswith("btr_report=")))
mode = pathlib.Path("report-mode").read_text()
print("report fixture " + mode, flush=True)
if mode == "malformed": report.write_text("{broken")
if mode == "oversized": report.write_bytes(b" " * (16 * 1024 * 1024 + 1))
`);
    await settings.update("behaveCommand", `${pythonCommand} "${script}"`, vscode.ConfigurationTarget.Workspace);
    try {
      fs.writeFileSync(path.join(project, "cucumber-output.json"), '[{"elements":[{"type":"scenario","name":"Retry scenario","line":24,"steps":[{"result":{"status":"passed"}}]}]}]');
      for (const mode of ["missing", "malformed", "oversized"]) {
        fs.writeFileSync(path.join(project, "report-mode"), mode);
        const result = await run(new vscode.TestRunRequest([named("Retry scenario")]));
        assert.strictEqual(result.statuses.get(named("Retry scenario")), "errored", mode);
        assert.ok(result.output.includes("Test execution error"), mode);
        assert.deepStrictEqual(ledger(), [], mode);
      }
    } finally {
      await settings.update("behaveCommand", `${pythonCommand} -m behave`, vscode.ConfigurationTarget.Workspace);
      for (const file of [script, path.join(project, "report-mode"), path.join(project, "cucumber-output.json")]) {fs.rmSync(file, { force: true });}
    }
  });

  test("large Behave failure messages and streamed output share one display budget across tag aliases", async () => {
    const file = path.join(project, "features", "large-aliased-failure.feature");
    const steps = path.join(project, "features", "steps", "large_failure.py");
    const report = path.join(project, "large-failure-report.json");
    const replay = path.join(project, "large-failure-replay.py");
    const command = settings.get<string>("behaveCommand")!;
    fs.writeFileSync(file, 'Feature: Large failure fixture\n  @smoke @shared\n  Scenario: Large aliased failure\n    Given a large reported failure\n');
    fs.writeFileSync(steps, 'from behave import given\n@given("a large reported failure")\ndef large_failure(context):\n    assert False, "LARGE_FAILURE_DETAIL " + "x" * (2 * 1024 * 1024)\n');
    try {
      const baseline = await active.testProvider["context"].testExecutor.runFeatureFileWithOutput({ filePath: file });
      assert.strictEqual(baseline.success, false);
      assert.ok(baseline.output.includes("LARGE_FAILURE_DETAIL"), "The large failed report must come from real Behave");
      fs.writeFileSync(report, baseline.output);
      fs.writeFileSync(replay, `import sys,pathlib
report = pathlib.Path(next(arg.split("=", 1)[1] for arg in sys.argv if arg.startswith("btr_report=")))
report.write_bytes(pathlib.Path("large-failure-report.json").read_bytes())
print("replayed native failure output", flush=True)
sys.exit(1)
`);
      await settings.update("behaveCommand", `${pythonCommand} "${replay}"`, vscode.ConfigurationTarget.Workspace);
      await active.testProvider.discoverTests();
      await vscode.commands.executeCommand("behaveTestRunner.setTagBasedOrganization");
      const aliases = items().filter((item) => item.label === "Large aliased failure");
      assert.strictEqual(aliases.length, 2, "The real parsed scenario must have two visible tag aliases");
      const result = await run(new vscode.TestRunRequest(aliases));
      for (const alias of aliases) {assert.strictEqual(result.statuses.get(alias), "failed");}
      const details = Array.from(result.messages).filter(([item]) => aliases.includes(item)).map(([, text]) => text);
      assert.ok(details[0]?.includes("LARGE_FAILURE_DETAIL"), "The first alias keeps useful bounded report detail");
      assert.strictEqual(details[1], "Test failed", "The later alias keeps its status summary without receiving another payload allowance");
      const notice = "\r\n[Output truncated: the operation reached the 1 MiB display limit]\r\n";
      const allMessages = Array.from(result.messages.values());
      const fixedSummaries = allMessages.filter((text) => text === "Test failed").reduce((bytes, text) => bytes + Buffer.byteLength(text), 0);
      const displayedBytes = Buffer.byteLength(result.output) + allMessages.reduce((bytes, text) => bytes + Buffer.byteLength(text), 0);
      assert.ok(details[0]?.includes(notice), "One bounded truncation notice explains the missing tail");
      assert.ok(displayedBytes <= 1024 * 1024 + Buffer.byteLength(notice) + fixedSummaries,
        "Actual native output and every report-derived TestMessage must share the operation's 1 MiB payload budget");
    } finally {
      await settings.update("behaveCommand", command, vscode.ConfigurationTarget.Workspace);
      for (const entry of [file, steps, report, replay]) {fs.rmSync(entry, { force: true });}
      await active.testProvider.discoverTests();
    }
  });

  test("both primary report parsers reject invalid JSON shapes and never republish large report bodies", async () => {
    try {
      for (const framework of ["behave", "pytest-bdd"] as const) {
        await configure(framework);
        const context = active.testProvider["context"];
        const selected = named(framework === "behave" ? "Retry scenario" : "Pytest first");
        const options = { filePath: selected.uri!.fsPath, lineNumber: selected.range!.start.line + 1, scenarioName: selected.label };
        const baseline = await context.testExecutor.runScenarioWithOutput(options);
        assert.ok(baseline.success, baseline.error);
        const template = JSON.parse(baseline.output);
        const marker = "report-body-must-not-be-logged";
        if (framework === "behave") {template[0].elements[0].steps[0].name = marker + "z".repeat(2 * 1024 * 1024);}
        else {template[0].detail = marker + "z".repeat(128 * 1024);}
        const source = path.join(project, "primary-report-template.json");
        const script = path.join(project, "primary-report-producer.py");
        const mode = path.join(project, "primary-report-mode");
        fs.writeFileSync(source, JSON.stringify(template));
        fs.writeFileSync(script, `import sys,json,pathlib
report = pathlib.Path(next(arg.split("=", 1)[1] for arg in sys.argv if arg.startswith("btr_report=")) if any(arg.startswith("btr_report=") for arg in sys.argv) else next(arg.split("=", 1)[1] for arg in sys.argv if arg.startswith("--btr-report=")))
mode = pathlib.Path("primary-report-mode").read_text()
data = json.loads(pathlib.Path("primary-report-template.json").read_text())
if mode == "feature": data = [{}]
if mode == "scenario":
    if "elements" in data[0]: data[0]["elements"][0]["steps"] = "invalid steps"
    else: data[0]["status"] = "invalid status"
if mode == "large": print("native stream " + "x" * (1024 * 1024 + 10000), flush=True)
report.write_text(json.dumps(data))
`);
        const command = framework === "behave" ? "behaveCommand" : "pytestCommand";
        const original = settings.get<string>(command)!;
        const logger = context.logger;
        const level = logger.getLogLevel();
        const channel = logger["outputChannel"];
        const append = channel.append.bind(channel);
        const appendLine = channel.appendLine.bind(channel);
        let displayed = "";
        channel.append = (text) => {displayed += text; append(text);};
        channel.appendLine = (text) => {displayed += text + "\n"; appendLine(text);};
        logger.setLogLevel(0);
        try {
          await settings.update(command, `${pythonCommand} "${script}"`, vscode.ConfigurationTarget.Workspace);
          for (const reportMode of ["large", "feature", "scenario"]) {
            fs.writeFileSync(mode, reportMode); displayed = "";
            const result = await context.testExecutor.runScenarioWithOutput(options);
            if (reportMode === "large") {
              assert.strictEqual(result.success, true, result.error);
              assert.ok(Object.values(result.scenarioResults ?? {}).includes("passed"), "The populated large report must still produce real parsed outcomes");
              assert.ok(displayed.includes("native stream"));
              assert.ok(displayed.includes("1 MiB display limit"));
              assert.ok(Buffer.byteLength(displayed) < 1024 * 1024 + 2048, "Real Logger output must stay bounded even at DEBUG level");
            } else {
              assert.strictEqual(result.success, false);
              assert.strictEqual(result.errored, true, `${framework} ${reportMode} must fail instead of implying an empty successful suite`);
            }
            assert.strictEqual(displayed.includes(marker), false, "Raw reports and parsed scenario bodies must never be republished through parser logging");
          }
        } finally {
          channel.append = append; channel.appendLine = appendLine; logger.setLogLevel(level);
          await settings.update(command, original, vscode.ConfigurationTarget.Workspace);
          for (const file of [source, script, mode]) {fs.rmSync(file, { force: true });}
        }
      }
    } finally {await configure("behave");}
  });

  test("the actual Python debugger stops in a selected step, cancellation terminates it and retry runs", async () => {
    const step = path.join(project, "features/steps/ledger.py");
    const line = fs.readFileSync(step, "utf8").split("\n").findIndex((text) => text.includes('with Path("ledger.txt")'));
    assert.ok(line > 0);
    const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(step), new vscode.Position(line, 0)));
    vscode.debug.addBreakpoints([breakpoint]);
    const source = new vscode.CancellationTokenSource();
    let stopped = false;
    let nativeEnded = false;
    let ownedSession: vscode.DebugSession | undefined;
    let rejectStop: (error: unknown) => void = () => {};
    let resolveStop: () => void = () => {};
    const observed = new Promise<void>((resolve, reject) => {resolveStop = resolve; rejectStop = reject;});
    const timeout = setTimeout(() => rejectStop(new Error("The real Python breakpoint was not observed")), 20000);
    const termination = vscode.debug.onDidTerminateDebugSession((candidate) => {if (candidate.id === ownedSession?.id) {nativeEnded = true;}});
    const tracker = vscode.debug.registerDebugAdapterTrackerFactory("debugpy", {
      createDebugAdapterTracker(candidate) {
        if (!candidate.configuration["__behaveExecutionId"]) {return undefined;}
        ownedSession = candidate;
        return { onDidSendMessage(message) {
          if (message.type === "event" && message.event === "stopped") {
            void (async () => {
              assert.strictEqual(message.body.reason, "breakpoint");
              const stack = await candidate.customRequest("stackTrace", { threadId: message.body.threadId });
              assert.strictEqual(stack.stackFrames[0].source.path, step);
              assert.strictEqual(stack.stackFrames[0].line, line + 1);
              stopped = true; source.cancel(); resolveStop();
            })().catch(rejectStop);
          }
        } };
      },
    });
    try {
      const pending = active.testProvider["debugTests"](new vscode.TestRunRequest([named("First selected scenario")]), source.token);
      await observed; await pending;
      assert.ok(stopped, "The real debug adapter must report the selected Python breakpoint");
      assert.ok(nativeEnded, "The matching native debug session must terminate before admission is released");
      assert.deepStrictEqual(ledger(), [], "Cancellation at the breakpoint prevents the selected step from recording");
    } finally {
      clearTimeout(timeout); source.cancel(); source.dispose(); tracker.dispose(); termination.dispose(); vscode.debug.removeBreakpoints([breakpoint]);
      if (ownedSession && !nativeEnded) {await vscode.debug.stopDebugging(ownedSession);}
    }
    const retry = await run(new vscode.TestRunRequest([named("First selected scenario")]));
    assert.strictEqual(retry.statuses.get(named("First selected scenario")), "passed");
    assert.deepStrictEqual(ledger(), ["first"]);
  });

  test("Behave JUnit debug continues a real selected breakpoint and retains native XML", async () => {
    const previous = settings.inspect("outputFormat")?.workspaceValue;
    const step = path.join(project, "features/steps/ledger.py");
    const line = fs.readFileSync(step, "utf8").split("\n").findIndex((text) => text.includes('with Path("ledger.txt")'));
    const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(step), new vscode.Position(line, 0)));
    const source = new vscode.CancellationTokenSource();
    const ini = path.join(project, "behave.ini");
    const humanOutput = path.join(project, "debug-output.txt");
    let stopped = false;
    let rejectFailure: (error: unknown) => void = () => {};
    const failure = new Promise<never>((_resolve, reject) => {rejectFailure = reject;});
    const timer = setTimeout(() => rejectFailure(new Error("The real JUnit debug request did not complete")), 20000);
    const tracker = vscode.debug.registerDebugAdapterTrackerFactory("debugpy", {
      createDebugAdapterTracker(candidate) {
        if (!candidate.configuration["__behaveExecutionId"]) {return undefined;}
        return { onDidSendMessage(message) {
          if (message.type === "event" && message.event === "stopped") {
            void (async () => {
              const stack = await candidate.customRequest("stackTrace", { threadId: message.body.threadId });
              assert.strictEqual(stack.stackFrames[0].source.path, step);
              assert.strictEqual(stack.stackFrames[0].line, line + 1);
              const args = candidate.configuration["args"] as string[];
              assert.ok(args.includes("--junit"));
              assert.deepStrictEqual(args.slice(args.indexOf("-f"), args.indexOf("-f") + 2), ["-f", "pretty"]);
              assert.strictEqual(args.includes("-o"), false, "Debug preserves native configured human-output destinations");
              stopped = true;
              await candidate.customRequest("continue", { threadId: message.body.threadId });
            })().catch(rejectFailure);
          }
        } };
      },
    });
    let pending: ReturnType<typeof run> | undefined;
    vscode.debug.addBreakpoints([breakpoint]);
    try {
      fs.writeFileSync(ini, "[behave]\noutfiles = debug-output.txt\n");
      await settings.update("outputFormat", "junit", vscode.ConfigurationTarget.Workspace);
      await active.testProvider.discoverTests();
      const selected = named("First selected scenario");
      pending = run(new vscode.TestRunRequest([selected]), source.token, undefined, true);
      const result = await Promise.race([pending, failure]);
      assert.ok(stopped, "The native debug request must reach the real selected step");
      assert.strictEqual(result.statuses.get(selected), "skipped", "Debug results are not inferred from successful termination");
      assert.deepStrictEqual(ledger(), ["first"]);
      assert.match(fs.readFileSync(path.join(project, "reports", "TESTS-selection.xml"), "utf8"), /First selected scenario/u);
      assert.match(fs.readFileSync(humanOutput, "utf8"), /Scenario: First selected scenario/u);
    } finally {
      clearTimeout(timer); source.cancel();
      if (pending) {await pending.catch(() => {});}
      tracker.dispose(); source.dispose(); vscode.debug.removeBreakpoints([breakpoint]);
      await settings.update("outputFormat", previous, vscode.ConfigurationTarget.Workspace);
      fs.rmSync(path.join(project, "reports"), { recursive: true, force: true });
      fs.rmSync(ini, { force: true }); fs.rmSync(humanOutput, { force: true });
    }
  });

  test("pytest Run All executes once in each grouping and reports real row identities", async () => {
    await configure("pytest-bdd");
    for (const grouping of ["FeatureBased", "TagBased", "FileBased", "ScenarioType", "Flat"]) {
      fs.writeFileSync(path.join(project, "ledger.txt"), "");
      await vscode.commands.executeCommand(`behaveTestRunner.set${grouping}Organization`);
      const first = named("Pytest first");
      const rows = items().filter((item) => item.children.size === 0 && item.label.includes("Pytest outline"));
      assert.strictEqual(rows.length, 2, "Both original Examples rows must be present before execution");
      const result = await run();
      assert.deepStrictEqual(ledger().sort(), [...pytestExpected].sort(), grouping);
      assert.strictEqual(result.statuses.get(first), "passed");
      for (const row of rows) {
        assert.strictEqual(result.statuses.get(row), "passed");
      }
      assert.ok(result.output.includes("test_pytest_first"));
    }
  });

  test("a stale workspace cucumber report cannot supply a missing invocation report", async () => {
    const stale = path.join(project, "cucumber-output.json");
    const bytes = JSON.stringify([{ uri: "features/pyselection.feature", elements: [{ type: "scenario", name: "Pytest first", line: 3, steps: [{ result: { status: "passed" } }] }] }]);
    fs.writeFileSync(stale, bytes);
    await settings.update("pytestCommand", `${pythonCommand} -m extension_missing_fixture_module`, vscode.ConfigurationTarget.Workspace);
    try {
      const result = await run(new vscode.TestRunRequest([named("Pytest first")]));
      assert.strictEqual(result.statuses.get(named("Pytest first")), "errored");
      assert.deepStrictEqual(ledger(), []);
      assert.strictEqual(fs.readFileSync(stale, "utf8"), bytes, "The shared workspace report is neither read nor replaced");
    } finally {await settings.update("pytestCommand", `${pythonCommand} -m pytest`, vscode.ConfigurationTarget.Workspace); fs.rmSync(stale, { force: true });}
  });

  test("the public pytest parallel command rejects before starting any process", async () => {
    const processes = require("node:child_process") as typeof import("node:child_process");
    const spawn = processes.spawn;
    const showError = vscode.window.showErrorMessage;
    const errors: string[] = [];
    let launches = 0;
    (processes as any).spawn = () => {launches++; throw new Error("unexpected pytest parallel launch");};
    (vscode.window as any).showErrorMessage = (message: string) => {errors.push(message); return Promise.resolve(undefined);};
    try {
      await vscode.commands.executeCommand("behaveTestRunner.runAllTestsParallel");
      assert.strictEqual(launches, 0);
      assert.ok(errors.some((message) => message.includes("supports Behave only")));
      assert.deepStrictEqual(ledger(), []);
    } finally {(processes as any).spawn = spawn; (vscode.window as any).showErrorMessage = showError;}
  });

  test("pytest partial outlines execute only requested rows and whole-outline retry runs every row", async () => {
    await vscode.commands.executeCommand("behaveTestRunner.setFeatureBasedOrganization");
    const row = items().find((item) => item.children.size === 0 && item.label.includes("pytest-outline-one"));
    assert.ok(row);
    const first = named("Pytest first");
    const result = await run(new vscode.TestRunRequest([first, row]));
    assert.deepStrictEqual(ledger().sort(), ["pytest-first", "pytest-outline-one"].sort());
    assert.strictEqual(result.statuses.get(row), "passed");
    fs.writeFileSync(path.join(project, "ledger.txt"), "");
    const outline = items().find((item) => item.label === "Scenario Outline: Pytest outline");
    assert.ok(outline);
    await run(new vscode.TestRunRequest([outline]));
    assert.deepStrictEqual(ledger().sort(), ["pytest-outline-one", "pytest-outline-two"].sort());
  });

  test("mixed pytest outline outcomes cannot paint every example passed", async () => {
    fs.writeFileSync(path.join(project, "fail-outline"), "");
    try {
      const result = await run();
      assert.deepStrictEqual(ledger().sort(), [...pytestExpected].sort());
      assert.strictEqual(result.statuses.get(named("Pytest first")), "passed");
      for (const row of items().filter((item) => item.children.size === 0 && item.label.includes("Pytest outline"))) {
        assert.strictEqual(result.statuses.get(row), row.label.includes("pytest-outline-two") ? "failed" : "passed");
      }
      assert.ok(result.output.includes("requested outline failure"));
    } finally {fs.rmSync(path.join(project, "fail-outline"), { force: true });}
  });

  test("pytest scenario, feature, tag, context, and suite commands launch once and display captured output", async () => {
    await configure("pytest-bdd");
    const file = path.join(project, "features/pyselection.feature");
    const executor = active.testProvider["context"].testExecutor;
    const showError = vscode.window.showErrorMessage;
    const errors: string[] = [];
    const terminalScenario = executor.runScenario.bind(executor);
    const terminalFeature = executor.runFeatureFile.bind(executor);
    const terminalSuite = executor.runAllTests.bind(executor);
    let extraTerminalLaunches = 0;
    executor.runScenario = async (options) => {extraTerminalLaunches++; await terminalScenario(options);};
    executor.runFeatureFile = async (options) => {extraTerminalLaunches++; await terminalFeature(options);};
    executor.runAllTests = async () => {extraTerminalLaunches++; await terminalSuite();};
    const logger = active.testProvider["context"].logger;
    const append = logger.appendOutput.bind(logger);
    const show = logger.showOutput.bind(logger);
    const output: string[] = [];
    let shown = 0;
    logger.appendOutput = (text) => {output.push(text); append(text);};
    logger.showOutput = () => {shown++; show();};
    try {
      (vscode.window as any).showErrorMessage = (message: string) => {errors.push(message); return Promise.resolve(undefined);};
      const cases: Array<[string, unknown[], string[]]> = [
        ["runScenario", [file, 3, "Pytest first"], ["pytest-first"]],
        ["runFeatureFile", [file], pytestExpected],
        ["runScenarioWithTags", [file, 3, "Pytest first", "@smoke"], ["pytest-first"]],
        ["runFeatureFileWithTags", [file, "@smoke"], ["pytest-first"]],
        ["runScenarioWithContext", [file, 3, "Pytest first"], ["pytest-first"]],
        ["runFeatureFileWithContext", [file], pytestExpected],
        ["runAllTests", [], pytestExpected],
      ];
      for (const [command, args, entries] of cases) {
        fs.writeFileSync(path.join(project, "ledger.txt"), "");
        output.length = 0;
        const previousShows = shown;
        const visible = await afterOutput(logger["outputChannel"], (text) => text.includes("test_pytest_first") && text.includes("passed"), () =>
          vscode.commands.executeCommand(`behaveTestRunner.${command}`, ...args), `pytest ${command} output`);
        assert.strictEqual(extraTerminalLaunches, 0, `${command} must not launch a second terminal execution`);
        assert.deepStrictEqual(ledger().sort(), [...entries].sort(), command);
        assert.ok(output.join("").includes("test_pytest_first") && output.join("").includes("passed"), command);
        assert.ok(visible.includes("test_pytest_first") && visible.includes("passed"), `${command} must reach the native output document`);
        assert.strictEqual(shown, previousShows + 1, command);
        assert.deepStrictEqual(errors, [], `${command} must complete without an error notification`);
      }
      await settings.update("pytestCommand", `${pythonCommand} -m extension_missing_fixture_module`, vscode.ConfigurationTarget.Workspace);
      fs.writeFileSync(path.join(project, "ledger.txt"), "");
      output.length = 0;
      const failureOutput = await afterOutput(logger["outputChannel"], (text) => text.includes("No module named extension_missing_fixture_module"), () =>
        vscode.commands.executeCommand("behaveTestRunner.runScenario", file, 3, "Pytest first"), "pytest startup stderr");
      assert.deepStrictEqual(ledger(), []);
      assert.ok(output.join("").includes("No module named extension_missing_fixture_module"), "Captured startup stderr remains visible");
      assert.ok(failureOutput.includes("No module named extension_missing_fixture_module"), "Startup stderr reaches the native output document");
      assert.strictEqual(extraTerminalLaunches, 0);
      assert.strictEqual(errors.length, 1, "Only the deliberately missing module must trigger a notification");
      assert.match(errors[0]!, /^Failed to execute Run Pytest-BDD Scenario: Test failed: ENOENT: .*results\.json/u);
      console.log(`Captured expected pytest startup notification: ${errors[0]}`);
      await settings.update("pytestCommand", `${pythonCommand} -m pytest`, vscode.ConfigurationTarget.Workspace);
      fs.writeFileSync(path.join(project, "ledger.txt"), "");
      output.length = 0;
      const retryOutput = await afterOutput(logger["outputChannel"], (text) => text.includes("test_pytest_first") && text.includes("passed"), () =>
        vscode.commands.executeCommand("behaveTestRunner.runScenario", file, 3, "Pytest first"), "corrected pytest retry output");
      assert.deepStrictEqual(ledger(), ["pytest-first"], "Correcting the command permits a real selected retry");
      assert.ok(output.join("").includes("test_pytest_first") && output.join("").includes("passed"));
      assert.ok(retryOutput.includes("test_pytest_first") && retryOutput.includes("passed"), "The corrected retry reaches the native output document");
      assert.strictEqual(errors.length, 1, "The corrected retry must not add a notification");
    } finally {
      (vscode.window as any).showErrorMessage = showError;
      executor.runScenario = terminalScenario;
      executor.runFeatureFile = terminalFeature;
      executor.runAllTests = terminalSuite;
      logger.appendOutput = append; logger.showOutput = show;
      await settings.update("pytestCommand", `${pythonCommand} -m pytest`, vscode.ConfigurationTarget.Workspace);
    }
  });

  for (const framework of ["behave", "pytest-bdd"] as const) {
    for (const variant of ["inherited", "rules"] as const) {
      test(`${framework} Inherited tag scope selects exact ${variant} groups and recovers after failure`, async function () {
        this.timeout(90000);
        if (framework === "behave" && variant === "rules" && execFileSync(python,
          ["-c", "import behave.model; print(hasattr(behave.model, 'Rule'))"], { encoding: "utf8" }).trim() !== "True") {this.skip();}
        await configure(framework);
        const directory = path.resolve(__dirname, "../../../src/test/fixtures/tags");
        const feature = path.join(project, `features/tags-${variant}.feature`);
        const binding = framework === "behave" ? path.join(project, "features/steps/tags.py") : path.join(project, "tests/test_tags.py");
        const failure = path.join(project, "fail-tag");
        const ledgerFile = path.join(project, "tag-ledger.jsonl");
        const report = path.join(project, "tag-rule-report.json");
        const pattern = settings.inspect("testFilePattern")?.workspaceValue;
        const common = variant === "inherited" ? ["@tag_feature", "@tag_shared"] : ["@tag_rule_feature", "@tag_shared"];
        const cases: Array<[number, string, string[], string[]]> = variant === "inherited" ? [
          [8, "first", ["@tag_direct"], []], [11, "second", [], []], [21, "left-one", ["@tag_outline", "@tag_left"], []],
          [22, "left-two", ["@tag_outline", "@tag_left"], []], [27, "right-one", ["@tag_outline", "@tag_right"], []], [29, "following", [], []],
        ] : [
          [6, "root", [], []], [15, "red-first", ["@tag_red", "@tag_direct"], ["red"]],
          [25, "red-left", ["@tag_red", "@tag_outline", "@tag_left"], ["red"]],
          [30, "red-right", ["@tag_red", "@tag_outline", "@tag_right"], ["red"]],
          [37, "blue-first", ["@tag_blue"], ["blue"]], [44, "plain-first", [], ["plain"]],
        ];
        const records = cases.map(([, entry, tags, setup]) => ({ entry, tags: [...common, ...tags].sort(), setup: ["feature", ...setup] }));
        const leaves = () => items().filter((item) => item.uri?.fsPath === feature && !item.children.size);
        const execute = async (request: vscode.TestRunRequest, selected: string[], failed?: string) => {
          const originals = leaves();
          fs.writeFileSync(ledgerFile, "");
          const result = await run(request);
          const observed = fs.readFileSync(ledgerFile, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
          const byEntry = (a: { entry: string }, b: { entry: string }) => a.entry.localeCompare(b.entry);
          assert.deepStrictEqual(observed.sort(byEntry), records.filter((record) => selected.includes(record.entry)).sort(byEntry), result.output);
          for (const item of originals) {
            const entry = cases.find(([line]) => line === item.range!.start.line + 1)![1];
            if (selected.includes(entry)) {assert.strictEqual(result.statuses.get(item), entry === failed ? "failed" : "passed", `${entry}: ${result.output}`);}
            else {assert.strictEqual(result.statuses.has(item), false, `Unselected original alias ${entry} must not receive an outcome`);}
          }
          assert.deepStrictEqual(result.errors, []);
        };
        const errors: string[] = [];
        const showError = vscode.window.showErrorMessage;
        try {
          (vscode.window as any).showErrorMessage = (message: string) => {errors.push(message); return Promise.resolve(undefined);};
          const source = fs.readFileSync(path.join(directory, `${variant}.feature`), "utf8");
          fs.writeFileSync(feature, source);
          fs.writeFileSync(binding, fs.readFileSync(path.join(directory, framework === "behave" ? "behave_tags.py" : "pytest_tags.py"), "utf8")
            .replace("tags.feature", `tags-${variant}.feature`));
          const document = await vscode.workspace.openTextDocument(feature);
          await settings.update("testFilePattern", path.relative(workspace, feature).split(path.sep).join("/"), vscode.ConfigurationTarget.Workspace);
          for (const grouping of ["FeatureBased", "FileBased", "ScenarioType", "Flat", "TagBased"]) {
            await vscode.commands.executeCommand(`behaveTestRunner.set${grouping}Organization`);
            await active.testProvider.discoverTests();
            assert.deepStrictEqual([...new Set(leaves().map((item) => item.range!.start.line + 1))].sort((a, b) => a - b), cases.map(([line]) => line));
            assert.strictEqual(document.getText(), source, "Grouping must preserve the feature document");
            await execute(new vscode.TestRunRequest(), records.map((record) => record.entry));
          }
          const groups = Array.from(active.testController.items, ([, item]) => item);
          const tags = [...new Set(records.flatMap((record) => record.tags))].sort();
          assert.deepStrictEqual(groups.map((group) => group.label).sort(), tags, "Every populated native group must match an effective tag");
          for (const tag of tags) {
            const group = named(tag);
            const selected = records.filter((record) => record.tags.includes(tag)).map((record) => record.entry);
            const groupLeaves = Array.from(group.children, ([, item]) => item);
            assert.strictEqual(groupLeaves.length, selected.length, "Repeated inherited tags must not duplicate a projection");
            assert.deepStrictEqual(groupLeaves.map((item) => cases.find(([line]) => line === item.range!.start.line + 1)![1]).sort(), [...selected].sort());
            await execute(new vscode.TestRunRequest([group]), selected);
          }
          const excluded = leaves().find((item) => item.range!.start.line + 1 === cases[0]![0])!;
          await execute(new vscode.TestRunRequest([named(common[0]!), named("@tag_shared"), named("@tag_left")], [excluded]),
            records.filter((record) => record.entry !== cases[0]![1]).map((record) => record.entry));
          const failed = variant === "inherited" ? "left-one" : "red-right";
          fs.writeFileSync(failure, "fail one inherited-tag selection");
          const failureTag = variant === "inherited" ? "@tag_left" : common[0]!;
          const selected = records.filter((record) => record.tags.includes(failureTag)).map((record) => record.entry);
          await execute(new vscode.TestRunRequest([named(failureTag)]), selected, failed);
          if (framework === "behave" && variant === "rules") {
            const captured = spawnSync(python, ["-m", "behave", feature, "-f", "behave_capture:CaptureFormatter",
              "-D", "btr_format=plain", "-D", `btr_report=${report}`], {
              cwd: project, env: { ...process.env, ...pythonPluginEnvironment("behave_capture.py") }, encoding: "utf8",
            });
            assert.strictEqual(captured.status, 1, captured.stdout + captured.stderr);
            const elements: Array<{ type: string; location: string; status?: string }> = JSON.parse(fs.readFileSync(report, "utf8"))[0].elements;
            const line = (element: { location: string }) => Number(element.location.split(":").pop());
            assert.deepStrictEqual(elements.filter((element) => element.type === "scenario").map((element) => [line(element), element.status]), [
              [6, "passed"], [15, "passed"], [25, "passed"], [30, "failed"], [37, "passed"], [44, "passed"],
            ]);
            const backgrounds = elements.filter((element) => element.type === "background");
            assert.deepStrictEqual(backgrounds.map(line), [3, 11, 34, 41]);
            for (const background of backgrounds) {
              assert.ok(!("status" in background), `Background at ${background.location} must not receive scenario status ${background.status}`);
            }
          }
          fs.rmSync(failure);
          await active.testProvider.discoverTests();
          await execute(new vscode.TestRunRequest([named(failureTag)]), selected);
          assert.deepStrictEqual(errors, [], "Inherited tag grouping and corrected retry must not emit error popups");
        } finally {
          (vscode.window as any).showErrorMessage = showError;
          for (const entry of [feature, binding, failure, ledgerFile, report]) {fs.rmSync(entry, { force: true });}
          await settings.update("testFilePattern", pattern, vscode.ConfigurationTarget.Workspace);
          await active.testProvider.discoverTests();
        }
      });
    }

    test(`${framework} Physical container identity selects only its own rows and survives grouping and retry`, async function () {
      this.timeout(60000);
      await configure(framework);
      const directory = path.resolve(__dirname, "../../../src/test/fixtures/containers");
      const feature = path.join(project, "features/containers.feature");
      const binding = framework === "behave" ? path.join(project, "features/steps/containers.py") : path.join(project, "tests/test_containers.py");
      const failure = path.join(project, "fail-container");
      const pattern = settings.inspect("testFilePattern")?.workspaceValue;
      const entries = new Map([[7, "a-one"], [8, "a-two"], [15, "b-one"], [16, "b-two"], [24, "named-left"], [28, "named-right"],
        [35, "bare-left"], [38, "bare-right"], [45, "legacy-one"], [46, "legacy-two"], [53, "single"]]);
      const nativeItems = () => items().filter((item) => item.uri?.fsPath === feature);
      const at = (line: number) => {
        const item = nativeItems().find((item) => item.range!.start.line + 1 === line);
        assert.ok(item, `A native source container or row at line ${line} must exist`);
        return item;
      };
      let firstBindingAvailable = framework === "behave";
      const execute = async (request: vscode.TestRunRequest, lines: number[], failedLine?: number) => {
        const originalLeaves = nativeItems().filter((item) => item.children.size === 0);
        fs.writeFileSync(path.join(project, "ledger.txt"), "");
        const result = await run(request);
        const executable = lines.filter((line) => firstBindingAvailable || (line !== 7 && line !== 8));
        assert.deepStrictEqual(ledger().sort(), executable.map((line) => entries.get(line)!).sort(), result.output);
        for (const leaf of originalLeaves) {
          const line = leaf.range!.start.line + 1;
          if (lines.includes(line)) {
            const expected = !executable.includes(line) ? "errored" : line === failedLine ? "failed" : "passed";
            assert.strictEqual(result.statuses.get(leaf), expected, `${leaf.label}: ${result.output}`);
          } else {assert.strictEqual(result.statuses.has(leaf), false, `Unselected original row ${line} must not receive an outcome`);}
        }
        if (lines.length && executable.length === 0) {assert.match(result.output, /No collected pytest-bdd binding matches/);}
        assert.deepStrictEqual(result.errors, []);
      };
      const errors: string[] = [];
      const showError = vscode.window.showErrorMessage;
      try {
        (vscode.window as any).showErrorMessage = (message: string) => {errors.push(message); return Promise.resolve(undefined);};
        fs.copyFileSync(path.join(directory, "containers.feature"), feature);
        fs.copyFileSync(path.join(directory, framework === "behave" ? "behave_containers.py" : "pytest_containers.py"), binding);
        await settings.update("testFilePattern", path.relative(workspace, feature).split(path.sep).join("/"), vscode.ConfigurationTarget.Workspace);
        await vscode.commands.executeCommand("behaveTestRunner.setFeatureBasedOrganization");
        await active.testProvider.discoverTests();
        const root = active.testController.items.get(feature)!;
        assert.deepStrictEqual(Array.from(root.children, ([, child]) => [child.label, child.range!.start.line + 1]), [
          ["Scenario Outline: Repeated", 3], ["Scenario Outline: Repeated", 11], ["Scenario Outline: Named blocks", 19],
          ["Scenario Outline: Unnamed blocks", 31], ["Scenario Outline: Legacy block", 41], ["1: Single row - entry: single", 53],
        ]);
        const firstId = at(3).id;
        const blockId = at(5).id;
        for (const [line, rows] of [[3, [7, 8]], [11, [15, 16]], [5, [7, 8]], [13, [15, 16]], [19, [24, 28]],
          [22, [24]], [26, [28]], [31, [35, 38]], [33, [35]], [36, [38]], [41, [45, 46]], [53, [53]]] as const) {
          await execute(new vscode.TestRunRequest([at(line)]), [...rows]);
        }
        await execute(new vscode.TestRunRequest([at(3), at(11)], [at(3)]), [15, 16]);
        for (const grouping of ["TagBased", "FileBased", "ScenarioType", "Flat", "FeatureBased"]) {
          await vscode.commands.executeCommand(`behaveTestRunner.set${grouping}Organization`);
          await active.testProvider.discoverTests();
          assert.deepStrictEqual([...new Set(nativeItems().filter((item) => !item.children.size).map((item) => item.range!.start.line + 1))].sort((a, b) => a - b), [...entries.keys()]);
          await execute(new vscode.TestRunRequest(), [...entries.keys()]);
        }
        fs.writeFileSync(failure, "fail one selected row");
        await execute(new vscode.TestRunRequest([at(11)]), [15, 16], 15);
        fs.rmSync(failure);
        await active.testProvider.discoverTests();
        await execute(new vscode.TestRunRequest([at(11)]), [15, 16]);
        fs.writeFileSync(feature, fs.readFileSync(feature, "utf8").replace("Scenario Outline: Repeated", "Scenario Outline: Renamed").replace("Examples: Same", "Examples: Renamed"));
        await active.testProvider.discoverTests();
        firstBindingAvailable = true;
        assert.strictEqual(at(3).id, firstId);
        assert.strictEqual(at(3).label, "Scenario Outline: Renamed");
        assert.strictEqual(at(5).id, blockId);
        assert.strictEqual(at(5).label, "Examples: Renamed");
        await execute(new vscode.TestRunRequest([at(3)]), [7, 8]);
        assert.deepStrictEqual(errors, [], "Grouping, expected missing bindings and retry must not emit an error popup");
      } finally {
        (vscode.window as any).showErrorMessage = showError;
        for (const entry of [feature, binding, failure]) {fs.rmSync(entry, { force: true });}
        await settings.update("testFilePattern", pattern, vscode.ConfigurationTarget.Workspace);
        await active.testProvider.discoverTests();
      }
    });

    for (const fixture of ["boundaries", "descriptions"]) {
      test(`${framework} Docstring boundaries ${fixture} preserve native targets, exact payloads and selected retry`, async function () {
        if (fixture === "descriptions" && framework === "behave" && execFileSync(python,
          ["-c", "import behave.model; print(hasattr(behave.model, 'Rule'))"], { encoding: "utf8" }).trim() !== "True") {this.skip();}
        await configure(framework);
        const directory = path.resolve(__dirname, "../../../src/test/fixtures/docstrings");
        const valid = fs.readFileSync(path.join(directory, `${fixture}.feature`));
        const feature = path.join(project, `features/docstrings-${fixture}.feature`);
        const binding = framework === "behave" ? path.join(project, "features/steps/boundaries.py") : path.join(project, "tests/test_boundaries.py");
        const pattern = settings.inspect("testFilePattern")?.workspaceValue;
        const codeLens = settings.inspect("enableCodeLens")?.workspaceValue;
        const errors: string[] = [];
        const showError = vscode.window.showErrorMessage;
        const setup = ["Scenario: Phantom setup\n@phantom_setup", "continued"];
        const payload = ["Scenario: Phantom scenario", "Scenario Outline: Phantom outline", "Examples: Phantom examples", "@phantom",
          "Rule: Phantom rule", "Background: Phantom background", "Given phantom step", "```", "'''"].join("\n");
        const rowText = "Examples: Phantom row table\n| unrelated | columns |\n@phantom_row\nThen phantom row step";
        const expected = fixture === "descriptions" ? [
          { line: 15, entry: { kind: "payload", text: payload, setup } },
          { line: 37, entry: { kind: "following", setup } },
        ] : [
          { line: 11, entry: { kind: "payload", text: payload, setup } },
          { line: 37, entry: { kind: "row", value: "one", text: rowText, setup } },
          { line: 38, entry: { kind: "row", value: "two", text: rowText, setup } },
          { line: 41, entry: { kind: "following", setup } },
        ];
        const leaves = () => items().filter((item) => item.children.size === 0 && item.uri?.fsPath === feature);
        try {
          (vscode.window as any).showErrorMessage = (message: string) => {errors.push(message); return Promise.resolve(undefined);};
          fs.writeFileSync(feature, valid);
          fs.writeFileSync(binding, fs.readFileSync(path.join(directory, framework === "behave" ? "behave_boundaries.py" : "pytest_boundaries.py"), "utf8")
            .replace("boundaries.feature", `docstrings-${fixture}.feature`));
          await settings.update("testFilePattern", path.relative(workspace, feature).split(path.sep).join("/"), vscode.ConfigurationTarget.Workspace);
          await settings.update("enableCodeLens", true, vscode.ConfigurationTarget.Workspace);
          await vscode.commands.executeCommand("behaveTestRunner.setFeatureBasedOrganization");
          await active.testProvider.discoverTests();
          assert.deepStrictEqual(leaves().map((item) => [item.label, item.range!.start.line + 1]), fixture === "descriptions" ? [
            ["Read boundary payload", 15], ["Following boundary scenario", 37],
          ] : [
            ["Read boundary payload", 11], ["Following boundary scenario", 41],
            ["1: Boundary row - value: one", 37], ["2: Boundary row - value: two", 38],
          ]);
          assert.deepStrictEqual(fs.readFileSync(feature), valid, "Discovery must preserve the original feature bytes");
          assert.ok(items().every((item) => !item.label.includes("Phantom") && !item.description?.includes("@phantom")));
          const document = await vscode.workspace.openTextDocument(feature);
          const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", document.uri);
          assert.ok(lenses);
          for (const command of ["behaveTestRunner.runScenario", "behaveTestRunner.debugScenario"]) {
            assert.deepStrictEqual(lenses.filter((lens) => lens.command?.command === command).map((lens) => lens.command?.arguments?.slice(1)).sort((a, b) => a![0] - b![0]), fixture === "descriptions" ? [
              [15, "Read boundary payload"], [37, "Following boundary scenario"],
            ] : [[11, "Read boundary payload"], [26, "Boundary row"], [37, "1: Boundary row - value: one"],
              [38, "2: Boundary row - value: two"], [41, "Following boundary scenario"]]);
          }
          assert.deepStrictEqual(lenses.filter((lens) => lens.command?.command === "behaveTestRunner.runFeatureFileWithTags")
            .map((lens) => lens.command?.arguments?.[1]).sort(), ["@after", "@real"]);
          for (const { line, entry } of expected) {
            const current = leaves();
            const selected = current.find((item) => item.range!.start.line + 1 === line);
            assert.ok(selected);
            fs.writeFileSync(path.join(project, "ledger.txt"), "");
            const result = await run(new vscode.TestRunRequest([selected]));
            assert.deepStrictEqual(ledger().map((text) => JSON.parse(text)), [entry], result.output);
            assert.strictEqual(result.statuses.get(selected), "passed", result.output);
            for (const other of current.filter((item) => item !== selected)) {assert.strictEqual(result.statuses.has(other), false);}
            assert.deepStrictEqual(result.errors, []);
            assert.deepStrictEqual(fs.readFileSync(feature), valid, "Provider execution must preserve the original feature bytes");
          }
          fs.writeFileSync(feature, valid.toString("utf8").replace("Given phantom step", "CORRUPTED"));
          await active.testProvider.discoverTests();
          fs.writeFileSync(path.join(project, "ledger.txt"), "");
          const failed = named("Read boundary payload");
          const result = await run(new vscode.TestRunRequest([failed]));
          assert.strictEqual(result.statuses.get(failed), "failed", result.output);
          assert.deepStrictEqual([...result.statuses.keys()].filter((item) => item.children.size === 0), [failed]);
          assert.deepStrictEqual(ledger(), []);
          assert.deepStrictEqual(result.errors, []);
          fs.writeFileSync(feature, valid);
          await active.testProvider.discoverTests();
          const recovered = named("Read boundary payload");
          const retry = await run(new vscode.TestRunRequest([recovered]));
          assert.strictEqual(retry.statuses.get(recovered), "passed", retry.output);
          assert.deepStrictEqual([...retry.statuses.keys()].filter((item) => item.children.size === 0), [recovered]);
          assert.deepStrictEqual(retry.errors, []);
          assert.deepStrictEqual(ledger().map((text) => JSON.parse(text)), [expected[0]!.entry], retry.output);
          assert.deepStrictEqual(fs.readFileSync(feature), valid, "Retry must preserve the restored original feature bytes");
          fs.writeFileSync(path.join(project, "ledger.txt"), "");
          const runLens = lenses.find((lens) => lens.command?.command === "behaveTestRunner.runScenario" && lens.command.arguments?.[1] === expected[0]!.line)!;
          await vscode.commands.executeCommand(runLens.command!.command, ...runLens.command!.arguments!);
          assert.deepStrictEqual(ledger().map((text) => JSON.parse(text)), [expected[0]!.entry]);
          assert.deepStrictEqual(fs.readFileSync(feature), valid, "The actual CodeLens command must preserve the original feature bytes");
          assert.deepStrictEqual(errors, [], "Successful commands and expected provider assertion failures do not emit error notifications");
        } finally {
          (vscode.window as any).showErrorMessage = showError;
          fs.rmSync(feature, { force: true });
          fs.rmSync(binding, { force: true });
          await settings.update("enableCodeLens", codeLens, vscode.ConfigurationTarget.Workspace);
          await settings.update("testFilePattern", pattern, vscode.ConfigurationTarget.Workspace);
          await active.testProvider.discoverTests();
        }
      });
    }

    test(`${framework} English keyword aliases retain native selections, CodeLens and wildcard navigation`, async function () {
      this.timeout(90000);
      const legacyBehave = framework === "behave" && execFileSync(python,
        ["-c", "import behave; print(behave.__version__)"], { encoding: "utf8" }).trim().startsWith("1.2.");
      const stepDefinitionPaths = settings.inspect<string[]>("stepDefinitionPaths")?.workspaceValue;
      await settings.update("stepDefinitionPaths", [framework === "behave" ? "execution-fixtures/behave/features/steps/**/*.py" : "tests/**/*.py"], vscode.ConfigurationTarget.Workspace);
      await configure(framework);
      const directory = path.resolve(__dirname, "../../../src/test/fixtures/keywords");
      const feature = path.join(project, "features/english-aliases.feature");
      const binding = framework === "behave" ? path.join(project, "features/steps/english_aliases.py") : path.join(project, "tests/test_english_aliases.py");
      const failure = path.join(project, "fail-english-alias");
      const ledgerFile = path.join(project, "english-alias-ledger.jsonl");
      const pattern = settings.inspect("testFilePattern")?.workspaceValue;
      const codeLens = settings.inspect("enableCodeLens")?.workspaceValue;
      const source = fs.readFileSync(path.join(directory, "english-aliases.feature"));
      const nativeSource = legacyBehave
        ? Buffer.from(source.toString("utf8").replace("Example: Alias example", "Scenario: Alias example"))
        : source;
      const expectedPayload = ["Scenario: Phantom scenario", "Scenario Template: Phantom template", "Scenarios: Phantom rows", "@phantom_step"].join("\n");
      const expectedSetup = ["Scenario: Phantom background\n@phantom_background", "continued"];
      const leaves = () => items().filter((item) => item.children.size === 0 && item.uri?.fsPath === feature);
      const errors: string[] = [];
      const showError = vscode.window.showErrorMessage;
      try {
        (vscode.window as any).showErrorMessage = (message: string) => {errors.push(message); return Promise.resolve(undefined);};
        fs.writeFileSync(binding, fs.readFileSync(path.join(directory, framework === "behave" ? "behave_english_aliases.py" : "pytest_english_aliases.py"), "utf8")
          .replace("english-aliases.feature", path.basename(feature)));
        if (legacyBehave) {
          fs.writeFileSync(feature, source);
          const rejected = spawnSync(python, ["-m", "behave", feature], { cwd: project, encoding: "utf8" });
          assert.notStrictEqual(rejected.status, 0);
          assert.match(rejected.stderr + rejected.stdout, /Parser failure.*Example: Alias example/su);
        }
        fs.writeFileSync(feature, nativeSource);
        await settings.update("testFilePattern", path.relative(workspace, feature).split(path.sep).join("/"), vscode.ConfigurationTarget.Workspace);
        await settings.update("enableCodeLens", true, vscode.ConfigurationTarget.Workspace);
        await vscode.commands.executeCommand("behaveTestRunner.setFeatureBasedOrganization");
        await active.testProvider.discoverTests();
        assert.deepStrictEqual(leaves().map((item) => [item.label, item.range!.start.line + 1] as [string, number]).sort((a, b) => a[1] - b[1]), [
          ["Alias example", 13], ["1: Alias template - entry: one", 31], ["2: Alias template - entry: two", 32],
          ["Original scenario control", 34], ["1: Original outline control - entry: three", 43],
        ]);
        assert.ok(items().every((item) => !item.label.includes("Phantom") && !item.description?.includes("@phantom")));
        assert.deepStrictEqual(fs.readFileSync(feature), nativeSource, "Discovery must preserve English keyword source bytes");
        const metadata = (active.testProvider as any).treeBuilder.scenarioSnapshot() as ReadonlyMap<string, {
          outlineLineNumber?: number; examplesBlockLineNumber?: number; tags?: string[]; backgroundSteps?: string[];
        }>;
        for (const [line, expected] of new Map<number, [number | undefined, number | undefined, string[]]>([
          [13, [undefined, undefined, ["@feature_alias", "@example_alias"]]],
          [31, [24, 29, ["@feature_alias", "@template_alias", "@rows_alias"]]],
          [32, [24, 29, ["@feature_alias", "@template_alias", "@rows_alias"]]],
          [34, [undefined, undefined, ["@feature_alias"]]],
          [43, [38, 41, ["@feature_alias"]]],
        ])) {
          const item = leaves().find((candidate) => candidate.range!.start.line + 1 === line)!;
          const scenario = metadata.get(item.id)!;
          assert.strictEqual(item.id, `${feature}:${line}`);
          if (line === 31 || line === 32) {
            assert.strictEqual(item.parent?.id, `${feature}:examples:${scenario.examplesBlockLineNumber}`);
            assert.strictEqual(item.parent?.parent?.id, `${feature}:outline:${scenario.outlineLineNumber}`);
            assert.strictEqual(item.parent?.parent?.parent?.id, feature);
            assert.strictEqual(item.parent?.range?.start.line, 28);
            assert.strictEqual(item.parent?.parent?.range?.start.line, 23);
          } else {assert.strictEqual(item.parent?.id, feature);}
          assert.deepStrictEqual([scenario.outlineLineNumber, scenario.examplesBlockLineNumber, scenario.tags], expected);
          assert.deepStrictEqual(scenario.backgroundSteps, ["Given I prepare English setup", "* I continue English setup"]);
        }
        const document = await vscode.workspace.openTextDocument(feature);
        const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", document.uri);
        assert.ok(lenses);
        for (const command of ["behaveTestRunner.runScenario", "behaveTestRunner.debugScenario"]) {
          assert.deepStrictEqual(lenses.filter((lens) => lens.command?.command === command).map((lens) => lens.command?.arguments?.slice(1)).sort((a, b) => a![0] - b![0]), [
            [13, "Alias example"], [24, "Alias template"], [31, "1: Alias template - entry: one"],
            [32, "2: Alias template - entry: two"], [34, "Original scenario control"], [38, "Original outline control"],
            [43, "1: Original outline control - entry: three"],
          ]);
        }
        const definitions = await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeDefinitionProvider", document.uri, new vscode.Position(20, 6));
        assert.deepStrictEqual(definitions?.map((location) => [location.uri.fsPath, location.range.start.line + 1]), [[binding, framework === "behave" ? 26 : 28]]);
        const original = leaves();
        const example = original.find((item) => item.range!.start.line + 1 === 13)!;
        const row = original.find((item) => item.range!.start.line + 1 === 31)!;
        fs.writeFileSync(ledgerFile, "");
        const selected = await run(new vscode.TestRunRequest([example, row]));
        assert.deepStrictEqual(fs.readFileSync(ledgerFile, "utf8").trim().split(/\r?\n/).filter(Boolean).map((entry) => JSON.parse(entry)), [
          { entry: "example-wildcard", setup: expectedSetup, payload: expectedPayload },
          { entry: "one-wildcard", setup: expectedSetup, payload: null },
        ], selected.output);
        for (const item of original) {
          assert.strictEqual(selected.statuses.get(item), item === example || item === row ? "passed" : undefined, selected.output);
        }
        assert.deepStrictEqual(selected.errors, []);
        fs.writeFileSync(failure, "retry selected alias example");
        fs.writeFileSync(ledgerFile, "");
        const failedItem = named("Alias example");
        const failed = await run(new vscode.TestRunRequest([failedItem]));
        assert.strictEqual(failed.statuses.get(failedItem), "failed", failed.output);
        assert.deepStrictEqual(fs.readFileSync(ledgerFile, "utf8"), "");
        assert.deepStrictEqual(failed.errors, []);
        fs.rmSync(failure);
        fs.writeFileSync(ledgerFile, "");
        const recoveredItem = named("Alias example");
        const recovered = await run(new vscode.TestRunRequest([recoveredItem]));
        assert.strictEqual(recovered.statuses.get(recoveredItem), "passed", recovered.output);
        assert.deepStrictEqual(recovered.errors, []);
        assert.deepStrictEqual(fs.readFileSync(ledgerFile, "utf8").trim().split(/\r?\n/).filter(Boolean).map((entry) => JSON.parse(entry)), [
          { entry: "example-wildcard", setup: expectedSetup, payload: expectedPayload },
        ]);
        fs.writeFileSync(ledgerFile, "");
        const runLens = lenses.find((lens) => lens.command?.command === "behaveTestRunner.runScenario" && lens.command.arguments?.[1] === 13)!;
        await vscode.commands.executeCommand(runLens.command!.command, ...runLens.command!.arguments!);
        assert.deepStrictEqual(fs.readFileSync(ledgerFile, "utf8").trim().split(/\r?\n/).filter(Boolean).map((entry) => JSON.parse(entry)), [
          { entry: "example-wildcard", setup: expectedSetup, payload: expectedPayload },
        ]);
        fs.writeFileSync(ledgerFile, "");
        const templateLens = lenses.find((lens) => lens.command?.command === "behaveTestRunner.runScenario" && lens.command.arguments?.[1] === 24)!;
        await vscode.commands.executeCommand(templateLens.command!.command, ...templateLens.command!.arguments!);
        const expectedTemplateEntries = ["one-wildcard", "two-wildcard"];
        assert.deepStrictEqual(fs.readFileSync(ledgerFile, "utf8").trim().split(/\r?\n/).filter(Boolean).map((entry) => JSON.parse(entry)), expectedTemplateEntries.map((entry) => ({ entry, setup: expectedSetup, payload: null })));
        assert.deepStrictEqual(fs.readFileSync(feature), nativeSource, "Selection and CodeLens execution must preserve English keyword source bytes");
        assert.deepStrictEqual(errors, [], "English keyword commands must not emit error notifications");
      } finally {
        (vscode.window as any).showErrorMessage = showError;
        for (const entry of [feature, binding, failure, ledgerFile]) {fs.rmSync(entry, { force: true });}
        await settings.update("enableCodeLens", codeLens, vscode.ConfigurationTarget.Workspace);
        await settings.update("testFilePattern", pattern, vscode.ConfigurationTarget.Workspace);
        await settings.update("stepDefinitionPaths", stepDefinitionPaths, vscode.ConfigurationTarget.Workspace);
        await active.testProvider.discoverTests();
      }
    });

    test(`${framework} French dialect retains native selections, CodeLens and step navigation`, async function () {
      this.timeout(90000);
      const stepDefinitionPaths = settings.inspect<string[]>("stepDefinitionPaths")?.workspaceValue;
      await settings.update("stepDefinitionPaths", [framework === "behave" ? "execution-fixtures/behave/features/steps/**/*.py" : "tests/**/*.py"], vscode.ConfigurationTarget.Workspace);
      await configure(framework);
      const directory = path.resolve(__dirname, "../../../src/test/fixtures/keywords");
      const feature = path.join(project, "features/french.feature");
      const binding = path.join(project, framework === "behave" ? "features/steps/french.py" : "tests/test_french.py");
      const ledgerFile = path.join(project, "french-ledger.txt");
      const pattern = settings.inspect("testFilePattern")?.workspaceValue;
      const codeLens = settings.inspect("enableCodeLens")?.workspaceValue;
      const source = fs.readFileSync(path.join(directory, "french.feature"));
      const leaves = () => items().filter((item) => item.children.size === 0 && item.uri?.fsPath === feature);
      const errors: string[] = [];
      const showError = vscode.window.showErrorMessage;
      try {
        (vscode.window as any).showErrorMessage = (message: string) => {errors.push(message); return Promise.resolve(undefined);};
        fs.writeFileSync(feature, source);
        fs.copyFileSync(path.join(directory, framework === "behave" ? "behave_french.py" : "pytest_french.py"), binding);
        await settings.update("testFilePattern", path.relative(workspace, feature).split(path.sep).join("/"), vscode.ConfigurationTarget.Workspace);
        await settings.update("enableCodeLens", true, vscode.ConfigurationTarget.Workspace);
        await vscode.commands.executeCommand("behaveTestRunner.setFeatureBasedOrganization");
        await active.testProvider.discoverTests();
        const original = leaves();
        assert.deepStrictEqual(original.map((item): [string, number] => [item.label, item.range!.start.line + 1]).sort((a, b) => a[1] - b[1]), [
          ["scénario choisi", 9], ["1: lignes choisies - entrée: un", 21], ["2: lignes choisies - entrée: deux", 22],
        ]);
        assert.deepStrictEqual(original.map((item) => item.id), [`${feature}:9`, `${feature}:21`, `${feature}:22`]);
        const selected = original.filter((item) => [9, 21].includes(item.range!.start.line + 1));
        assert.deepStrictEqual(selected.map((item) => item.id), [`${feature}:9`, `${feature}:21`]);
        assert.strictEqual(selected[0]?.parent?.id, feature);
        assert.strictEqual(selected[1]?.parent?.id, `${feature}:examples:19`);
        assert.strictEqual(selected[1]?.parent?.parent?.id, `${feature}:outline:14`);
        assert.strictEqual(selected[1]?.parent?.parent?.parent?.id, feature);
        const metadata = (active.testProvider as any).treeBuilder.scenarioSnapshot() as ReadonlyMap<string, {
          outlineLineNumber?: number; examplesBlockLineNumber?: number; tags?: string[]; backgroundSteps?: string[];
        }>;
        assert.deepStrictEqual([metadata.get(`${feature}:9`), metadata.get(`${feature}:21`), metadata.get(`${feature}:22`)].map((scenario) => [
          scenario?.outlineLineNumber, scenario?.examplesBlockLineNumber, scenario?.tags, scenario?.backgroundSteps,
        ]), [
          [undefined, undefined, ["@feature_fr", "@scenario_fr"], ["Soit une préparation française"]],
          [14, 19, ["@feature_fr", "@outline_fr", "@rows_fr"], ["Soit une préparation française"]],
          [14, 19, ["@feature_fr", "@outline_fr", "@rows_fr"], ["Soit une préparation française"]],
        ]);
        assert.deepStrictEqual(fs.readFileSync(feature), source, "Discovery must preserve French source bytes");
        fs.writeFileSync(ledgerFile, "");
        const result = await run(new vscode.TestRunRequest(selected));
        assert.deepStrictEqual(fs.readFileSync(ledgerFile, "utf8").trim().split(/\r?\n/).filter(Boolean), ["scénario:préparé", "un:préparé"]);
        for (const item of original) {assert.strictEqual(result.statuses.get(item), selected.includes(item) ? "passed" : undefined, result.output);}
        assert.deepStrictEqual(result.errors, []);
        const document = await vscode.workspace.openTextDocument(feature);
        const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", document.uri);
        assert.ok(lenses);
        const commands = lenses.filter((lens) => lens.command?.command === "behaveTestRunner.runScenario");
        assert.deepStrictEqual(commands.map((lens) => lens.command?.arguments?.slice(1)).sort((a, b) => a![0] - b![0]), [
          [9, "scénario choisi"], [14, "lignes choisies"], [21, "1: lignes choisies - entrée: un"], [22, "2: lignes choisies - entrée: deux"],
        ]);
        const definitions = await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeDefinitionProvider", document.uri, new vscode.Position(5, 6));
        assert.deepStrictEqual(definitions?.map((location) => [location.uri.fsPath, location.range.start.line + 1]), [[binding, framework === "behave" ? 10 : 12]]);
        for (const [line, expected] of [[9, ["scénario:préparé"]], [14, ["un:préparé", "deux:préparé"]]] as const) {
          fs.writeFileSync(ledgerFile, "");
          const lens = commands.find((candidate) => candidate.command?.arguments?.[1] === line)!;
          await vscode.commands.executeCommand(lens.command!.command, ...lens.command!.arguments!);
          assert.deepStrictEqual(fs.readFileSync(ledgerFile, "utf8").trim().split(/\r?\n/).filter(Boolean), expected);
        }
        assert.deepStrictEqual(fs.readFileSync(feature), source, "Selection and CodeLens commands must preserve French source bytes");
        assert.deepStrictEqual(errors, []);
      } finally {
        (vscode.window as any).showErrorMessage = showError;
        for (const entry of [feature, binding, ledgerFile]) {fs.rmSync(entry, { force: true });}
        await settings.update("enableCodeLens", codeLens, vscode.ConfigurationTarget.Workspace);
        await settings.update("testFilePattern", pattern, vscode.ConfigurationTarget.Workspace);
        await settings.update("stepDefinitionPaths", stepDefinitionPaths, vscode.ConfigurationTarget.Workspace);
        await active.testProvider.discoverTests();
      }
    });

    test(`${framework} matcher definitions preserve real selections and conservative navigation`, async function () {
      this.timeout(90000);
      const stepDefinitionPaths = settings.inspect<string[]>("stepDefinitionPaths")?.workspaceValue;
      await settings.update("stepDefinitionPaths", [framework === "behave" ? "execution-fixtures/behave/features/steps/**/*.py" : "tests/**/*.py"], vscode.ConfigurationTarget.Workspace);
      await configure(framework);
      const directory = path.resolve(__dirname, "../../../src/test/fixtures/matchers");
      const feature = path.join(project, "features/matchers.feature");
      const binding = path.join(project, framework === "behave" ? "features/steps/matchers.py" : "tests/test_matchers.py");
      const ledgerFile = path.join(project, "matcher-ledger.txt");
      const pattern = settings.inspect("testFilePattern")?.workspaceValue;
      const source = fs.readFileSync(path.join(directory, "matchers.feature"));
      const leaves = () => items().filter((item) => item.children.size === 0 && item.uri?.fsPath === feature);
      const errors: string[] = [];
      const showError = vscode.window.showErrorMessage;
      try {
        (vscode.window as any).showErrorMessage = (message: string) => {errors.push(message); return Promise.resolve(undefined);};
        fs.writeFileSync(feature, source);
        fs.copyFileSync(path.join(directory, framework === "behave" ? "behave_matchers.py" : "pytest_matchers.py"), binding);
        await settings.update("testFilePattern", path.relative(workspace, feature).split(path.sep).join("/"), vscode.ConfigurationTarget.Workspace);
        await vscode.commands.executeCommand("behaveTestRunner.setFeatureBasedOrganization");
        await active.testProvider.discoverTests();
        const original = leaves();
        const selected = original.filter((item) => [3, 15].includes(item.range!.start.line + 1));
        assert.deepStrictEqual(selected.map((item) => item.id), [`${feature}:3`, `${feature}:15`]);
        fs.writeFileSync(ledgerFile, "");
        const runResult = await run(new vscode.TestRunRequest(selected));
        assert.deepStrictEqual(fs.readFileSync(ledgerFile, "utf8").trim().split(/\r?\n/).filter(Boolean), [
          "parse:12", "cfparse:alpha", "re:42", "done", "parse:7", "done",
        ]);
        for (const item of original) {assert.strictEqual(runResult.statuses.get(item), selected.includes(item) ? "passed" : undefined, runResult.output);}
        assert.deepStrictEqual(runResult.errors, []);
        const document = await vscode.workspace.openTextDocument(feature);
        const definitions = async (line: number) => vscode.commands.executeCommand<vscode.Location[]>(
          "vscode.executeDefinitionProvider", document.uri, new vscode.Position(line - 1, 6));
        const lines = framework === "behave" ? [25, 35, 45, 55, 25] : [24, 31, 38, 45, 24];
        for (const [line, bindingLine] of [[4, lines[0]], [5, lines[1]], [6, lines[2]], [7, lines[3]], [10, lines[4]]] as const) {
          assert.deepStrictEqual((await definitions(line))?.map((location) => [location.uri.fsPath, location.range.start.line + 1]), [[binding, bindingLine]]);
        }
        assert.deepStrictEqual((await definitions(18)) ?? [], [], "A When step must not navigate to a Given definition");
        assert.deepStrictEqual(((await definitions(19)) ?? []).map((location) => location.range.start.line + 1), framework === "behave" ? [60] : []);
        assert.deepStrictEqual(fs.readFileSync(feature), source, "Navigation must preserve matcher feature source bytes");
        assert.deepStrictEqual(fs.readFileSync(binding, "utf8"), fs.readFileSync(path.join(directory, framework === "behave" ? "behave_matchers.py" : "pytest_matchers.py"), "utf8"));
        assert.deepStrictEqual(errors, []);
      } finally {
        (vscode.window as any).showErrorMessage = showError;
        for (const entry of [feature, binding, ledgerFile]) {fs.rmSync(entry, { force: true });}
        await settings.update("testFilePattern", pattern, vscode.ConfigurationTarget.Workspace);
        await settings.update("stepDefinitionPaths", stepDefinitionPaths, vscode.ConfigurationTarget.Workspace);
        await active.testProvider.discoverTests();
      }
    });

    test(`${framework} navigation keeps framework and workspace ownership`, async () => {
      await configure(framework);
      const stepDefinitionPaths = settings.inspect<string[]>("stepDefinitionPaths")?.workspaceValue;
      const pattern = settings.inspect("testFilePattern")?.workspaceValue;
      const feature = path.join(project, "features/ownership.feature");
      const behaveBinding = path.join(project, "features/steps/ownership.py");
      const pytestBinding = path.join(project, "tests/test_ownership.py");
      const nested = path.join(project, "features/nested/environment.feature");
      const environment = path.join(project, "features/environment.py");
      const nestedBinding = path.join(project, "features/steps/nested.py");
      const outside = path.join(path.dirname(workspace), "outside-ownership.feature");
      try {
        fs.mkdirSync(path.dirname(behaveBinding), { recursive: true });
        fs.mkdirSync(path.dirname(pytestBinding), { recursive: true });
        await settings.update("stepDefinitionPaths", [path.relative(workspace, path.dirname(behaveBinding)).split(path.sep).join("/") + "/**/*.py",
          path.relative(workspace, path.dirname(pytestBinding)).split(path.sep).join("/") + "/**/*.py"], vscode.ConfigurationTarget.Workspace);
        fs.writeFileSync(feature, "Feature: ownership\n  Scenario: one\n    Given shared ownership\n");
        fs.writeFileSync(behaveBinding, "from behave import given\n@given('shared ownership')\ndef behave_step(context): pass\n");
        fs.writeFileSync(pytestBinding, "from pytest_bdd import given\n@given('shared ownership')\ndef pytest_step(): pass\n");
        const document = await vscode.workspace.openTextDocument(feature);
        const locations = await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeDefinitionProvider", document.uri, new vscode.Position(2, 6)) ?? [];
        assert.deepStrictEqual(locations.map((location) => location.uri.fsPath), [framework === "behave" ? behaveBinding : pytestBinding]);
        fs.writeFileSync(outside, fs.readFileSync(feature, "utf8"));
        const outsideDocument = await vscode.workspace.openTextDocument(outside);
        assert.deepStrictEqual((await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeDefinitionProvider", outsideDocument.uri, new vscode.Position(2, 6))) ?? [], []);
        if (framework === "behave") {
          fs.mkdirSync(path.dirname(nested), { recursive: true });
          fs.writeFileSync(nested, "Feature: nested\n  Scenario: one\n    Given nested 12\n");
          fs.writeFileSync(environment, "from behave import use_step_matcher\nuse_step_matcher('re')\n");
          const nestedLedger = path.join(project, "nested-ledger.txt");
          fs.writeFileSync(nestedBinding, "from pathlib import Path\nfrom behave import given\n@given(r'nested \\d+')\ndef nested_step(context):\n    Path('nested-ledger.txt').write_text('nested')\n");
          await settings.update("testFilePattern", path.relative(workspace, nested).split(path.sep).join("/"), vscode.ConfigurationTarget.Workspace);
          await active.testProvider.discoverTests();
          const selected = items().find((item) => item.uri?.fsPath === nested && item.children.size === 0)!;
          const result = await run(new vscode.TestRunRequest([selected]));
          assert.strictEqual(result.statuses.get(selected), "passed", result.output);
          assert.strictEqual(fs.readFileSync(nestedLedger, "utf8"), "nested");
          const nestedDocument = await vscode.workspace.openTextDocument(nested);
          assert.deepStrictEqual((await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeDefinitionProvider", nestedDocument.uri, new vscode.Position(2, 6)))?.map((location) => [location.uri.fsPath, location.range.start.line + 1]), [[nestedBinding, 3]]);
          fs.writeFileSync(environment, "from behave import register_type\nregister_type(value=str)\n");
          fs.writeFileSync(nestedBinding, "from behave import given\n@given('nested {value:w}')\ndef nested_step(context): pass\n");
          assert.deepStrictEqual((await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeDefinitionProvider", nestedDocument.uri, new vscode.Position(2, 6))) ?? [], []);
        }
      } finally {
        for (const entry of [feature, behaveBinding, pytestBinding, nested, environment, nestedBinding, outside, path.join(project, "nested-ledger.txt")]) {fs.rmSync(entry, { force: true });}
        await settings.update("stepDefinitionPaths", stepDefinitionPaths, vscode.ConfigurationTarget.Workspace);
        await settings.update("testFilePattern", pattern, vscode.ConfigurationTarget.Workspace);
        await active.testProvider.discoverTests();
      }
    });

    test(`${framework} Background tables retain metadata and execute only selected native leaves`, async function () {
      this.timeout(90000);
      await configure(framework);
      const directory = path.resolve(__dirname, "../../../src/test/fixtures/tables");
      const supportsRules = framework !== "behave" || execFileSync(python,
        ["-c", "import behave.model; print(hasattr(behave.model, 'Rule'))"], { encoding: "utf8" }).trim() === "True";
      const fixture = supportsRules ? "background-tables.feature" : "background-table-feature-only.feature";
      const feature = path.join(project, "features/tables.feature");
      const binding = path.join(project, framework === "behave" ? "features/steps/tables.py" : "tests/test_tables.py");
      const pattern = settings.inspect("testFilePattern")?.workspaceValue;
      const source = fs.readFileSync(path.join(directory, fixture), "utf8");
      const expected = supportsRules ? new Map([
        [22, { entry: "left-one", setup: [
          { scope: "feature", table: [["value"], ["feature|pipe"]] }, { continued: "feature" },
          { scope: "left", table: [["value"], ["left|pipe"]] }, { continued: "left" },
        ] }],
        [23, { entry: "left-two", setup: [
          { scope: "feature", table: [["value"], ["feature|pipe"]] }, { continued: "feature" },
          { scope: "left", table: [["value"], ["left|pipe"]] }, { continued: "left" },
        ] }],
        [34, { entry: "right-one", setup: [
          { scope: "feature", table: [["value"], ["feature|pipe"]] }, { continued: "feature" },
          { scope: "right", table: [["value"], ["right|pipe"]] }, { continued: "right" },
        ] }],
      ]) : new Map([
        [14, { entry: "left-one", setup: [
          { scope: "feature", table: [["value"], ["feature|pipe"]] }, { continued: "feature" },
        ] }],
        [15, { entry: "left-two", setup: [
          { scope: "feature", table: [["value"], ["feature|pipe"]] }, { continued: "feature" },
        ] }],
      ]);
      const expectedMetadata = supportsRules ? new Map([
        [22, [18, 20, "Left table scope", ["@table_feature", "@left_rule", "@left_outline"],
          ["Given I receive table setup \"feature\":", "And I retain table setup \"feature\"", "Given I receive table setup \"left\":", "But I retain table setup \"left\""]]],
        [23, [18, 20, "Left table scope", ["@table_feature", "@left_rule", "@left_outline"],
          ["Given I receive table setup \"feature\":", "And I retain table setup \"feature\"", "Given I receive table setup \"left\":", "But I retain table setup \"left\""]]],
        [34, [undefined, undefined, "Right table scope", ["@table_feature", "@right_rule", "@right_leaf"],
          ["Given I receive table setup \"feature\":", "And I retain table setup \"feature\"", "Given I receive table setup \"right\":", "And I retain table setup \"right\""]]],
      ]) : new Map([
        [14, [10, 12, undefined, ["@table_feature", "@feature_outline"],
          ["Given I receive table setup \"feature\":", "And I retain table setup \"feature\""]]],
        [15, [10, 12, undefined, ["@table_feature", "@feature_outline"],
          ["Given I receive table setup \"feature\":", "And I retain table setup \"feature\""]]],
      ]);
      const leaves = () => items().filter((item) => item.children.size === 0 && item.uri?.fsPath === feature);
      try {
        fs.writeFileSync(feature, source);
        fs.copyFileSync(path.join(directory, framework === "behave" ? "behave_tables.py" : "pytest_tables.py"), binding);
        await settings.update("testFilePattern", path.relative(workspace, feature).split(path.sep).join("/"), vscode.ConfigurationTarget.Workspace);
        await vscode.commands.executeCommand("behaveTestRunner.setFeatureBasedOrganization");
        await active.testProvider.discoverTests();
        assert.strictEqual((await vscode.workspace.openTextDocument(feature)).getText(), source, "Discovery must preserve source bytes");
        const current = leaves();
        assert.deepStrictEqual(current.map((item) => item.range!.start.line + 1).sort((a, b) => a - b), [...expected.keys()]);
        const metadata = (active.testProvider as any).treeBuilder.scenarioSnapshot() as ReadonlyMap<string, {
          outlineLineNumber?: number; examplesBlockLineNumber?: number; ruleName?: string; tags?: string[]; backgroundSteps?: string[];
        }>;
        for (const item of current) {
          const line = item.range!.start.line + 1;
          const scenario = metadata.get(item.id);
          assert.ok(scenario, `Native TestItem at line ${line} retains parser metadata`);
          assert.strictEqual(item.id, `${feature}:${line}`);
          if (scenario.outlineLineNumber) {
            assert.strictEqual(item.parent?.id, `${feature}:examples:${scenario.examplesBlockLineNumber}`);
            assert.strictEqual(item.parent?.parent?.id, `${feature}:outline:${scenario.outlineLineNumber}`);
            assert.strictEqual(item.parent?.parent?.parent?.id, feature);
          } else {assert.strictEqual(item.parent?.id, feature);}
          assert.deepStrictEqual([scenario.outlineLineNumber, scenario.examplesBlockLineNumber, scenario.ruleName,
            scenario.tags, scenario.backgroundSteps], expectedMetadata.get(line));
        }
        const selectedLines = supportsRules ? [22, 34] : [14];
        const selected = selectedLines.map((line) => current.find((item) => item.range!.start.line + 1 === line)!);
        fs.writeFileSync(path.join(project, "table-ledger.jsonl"), "");
        const result = await run(new vscode.TestRunRequest(selected));
        assert.deepStrictEqual(fs.readFileSync(path.join(project, "table-ledger.jsonl"), "utf8").trim().split(/\r?\n/).filter(Boolean)
          .map((record) => JSON.parse(record)).sort((a, b) => a.entry.localeCompare(b.entry)), selectedLines.map((line) => expected.get(line)!).sort((a, b) => a.entry.localeCompare(b.entry)), result.output);
        for (const item of current) {
          if (selected.includes(item)) {assert.strictEqual(result.statuses.get(item), "passed", result.output);}
          else {assert.strictEqual(result.statuses.has(item), false, `Unselected original leaf at line ${item.range!.start.line + 1} must not receive an outcome`);}
        }
        assert.strictEqual(fs.readFileSync(feature, "utf8"), source, "Selection must preserve source bytes");
        assert.deepStrictEqual(result.errors, []);
      } finally {
        for (const entry of [feature, binding, path.join(project, "table-ledger.jsonl")]) {fs.rmSync(entry, { force: true });}
        await settings.update("testFilePattern", pattern, vscode.ConfigurationTarget.Workspace);
        await active.testProvider.discoverTests();
      }
    });

    test(`${framework} Examples column values retain labels and execute each original selected row once`, async () => {
      await configure(framework);
      const columns = path.resolve(__dirname, "../../../src/test/fixtures/examples");
      const feature = path.join(project, "features/columns.feature");
      const binding = framework === "behave" ? path.join(project, "features/steps/columns.py") : path.join(project, "tests/test_columns.py");
      const pattern = settings.inspect("testFilePattern")?.workspaceValue;
      try {
        fs.copyFileSync(path.join(columns, "columns.feature"), feature);
        fs.copyFileSync(path.join(columns, framework === "behave" ? "behave_columns.py" : "pytest_columns.py"), binding);
        await settings.update("testFilePattern", path.relative(workspace, feature).split(path.sep).join("/"), vscode.ConfigurationTarget.Workspace);
        await vscode.commands.executeCommand("behaveTestRunner.setFeatureBasedOrganization");
        await active.testProvider.discoverTests();
        const discovered = items().filter((item) => item.children.size === 0 && item.uri?.fsPath === feature);
        const values = [["", "center", "end"], ["start", "", "end"], ["start", "center", ""], ["", "", ""], ["left|right", "center", "end"]];
        assert.deepStrictEqual(discovered.map((item) => item.label), values.map((row, index) =>
          `${index + 1}: Column values - first: ${row[0]}, middle: ${row[1]}, last: ${row[2]}`));
        assert.deepStrictEqual(discovered.map((item) => item.range!.start.line + 1), [8, 9, 10, 11, 16]);
        assert.deepStrictEqual(discovered.map((item) => [item.parent?.label, item.parent?.range?.start.line]), [
          ["Examples: Empty positions", 5], ["Examples: Empty positions", 5], ["Examples: Empty positions", 5],
          ["Examples: Empty positions", 5], ["Examples: Escaped separator", 13],
        ]);
        for (const [index, expected] of values.entries()) {
          const current = items().filter((item) => item.children.size === 0 && item.uri?.fsPath === feature);
          const selected = current.find((item) => item.range?.start.line === discovered[index]!.range!.start.line);
          assert.ok(selected, "Resolve the current native row before each distinct request");
          fs.writeFileSync(path.join(project, "ledger.txt"), "");
          const result = await run(new vscode.TestRunRequest([selected]));
          assert.deepStrictEqual(ledger().map((entry) => JSON.parse(entry)), [expected], result.output);
          assert.strictEqual(result.statuses.get(selected), "passed", result.output);
          for (const other of current.filter((item) => item !== selected)) {
            assert.strictEqual(result.statuses.has(other), false);
          }
          assert.deepStrictEqual(result.errors, []);
        }
        const validSource = fs.readFileSync(feature, "utf8");
        for (const invalidRow of ["      | | center |", "      | | center | end | extra |"] ) {
          fs.writeFileSync(path.join(project, "ledger.txt"), "");
          fs.writeFileSync(feature, validSource.replace("      |       | center | end  |", invalidRow));
          await active.testProvider.discoverTests();
          assert.strictEqual(items().length, 0, "Invalid width must not leave partial or shifted TestItems");
          assert.deepStrictEqual(ledger(), [], "Rediscovery must not execute Python tests");
          fs.writeFileSync(feature, validSource);
          await active.testProvider.discoverTests();
          const recovered = items().filter((item) => item.children.size === 0 && item.uri?.fsPath === feature);
          assert.deepStrictEqual(recovered.map((item) => item.label), discovered.map((item) => item.label));
          assert.deepStrictEqual(recovered.map((item) => item.range!.start.line + 1), [8, 9, 10, 11, 16]);
          const selected = recovered[0]!;
          const result = await run(new vscode.TestRunRequest([selected]));
          assert.deepStrictEqual(ledger().map((entry) => JSON.parse(entry)), [values[0]], result.output);
          assert.strictEqual(result.statuses.get(selected), "passed", result.output);
          for (const other of recovered.slice(1)) {assert.strictEqual(result.statuses.has(other), false);}
          assert.deepStrictEqual(result.errors, []);
        }
      } finally {
        fs.rmSync(feature, { force: true });
        fs.rmSync(binding, { force: true });
        await settings.update("testFilePattern", pattern, vscode.ConfigurationTarget.Workspace);
        await active.testProvider.discoverTests();
      }
    });
  }
});
