import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { BehaveCommandBuilder } from "../../../core/command-builders/behave-command-builder";
import { ExtensionConfig } from "../../../core/extension-config";
import * as vscode from "vscode";

suite("BehaveCommandBuilder Unit Tests", () => {
  const builder = new BehaveCommandBuilder({ workingDirectory: "/project", behaveCommand: '"/python path/python3" -m behave',
    getIntelligentBehaveCommand: async () => '"/python path/python3" -m behave', tags: "", dryRun: false } as unknown as ExtensionConfig);
  test("preserves exact line selection and passes dynamic values as argv", async () => {
    const invocation = await builder.buildScenarioCommand({ filePath: '/project/a "$(touch bad)".feature', lineNumber: 17, scenarioName: "Duplicate title", tags: "@tag;literal" });
    assert.strictEqual(invocation.executable, "/python path/python3");
    assert.deepStrictEqual(invocation.args, ["-m", "behave", '/project/a "$(touch bad)".feature:17', "--tags", "@tag;literal", "--no-skipped", "-f", "pretty"]);
    assert.strictEqual(invocation.cwd, "/project");
  });
  test("name selection escapes the regex without shell quoting", async () => {
    const invocation = await builder.buildScenarioCommand({ filePath: "a.feature", scenarioName: "Price (USD)" });
    assert.deepStrictEqual(invocation.args.slice(3, 5), ["--name", "Price \\(USD\\)"]);
  });
  test("debug uses explicit interpreter and the same exact row", async () => {
    const config = await builder.buildDebugConfiguration({ filePath: "a.feature", lineNumber: 23, scenarioName: "row" });
    assert.strictEqual(config["python"], "/python path/python3");
    assert.deepStrictEqual(config["args"], ["a.feature:23", "-f", "pretty", "--no-capture"]);
  });

  suite("English keyword physical targets", () => {
    let directory: string;
    const relativeFile = "aliases.feature";
    setup(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), "behave-heading-selection-"));
      const source = fs.readFileSync(path.resolve(__dirname, "../../../../src/test/fixtures/keywords/english-aliases.feature"), "utf8");
      fs.writeFileSync(path.join(directory, relativeFile), source + '\n  Scenario Template: Alias template\n    Given I begin English "<entry>"\n    Scenarios:\n      | entry |\n      | unrelated |\n');
    });
    teardown(() => fs.rmSync(directory, { recursive: true, force: true }));

    test("Run and Debug resolve only the heading's physical rows relative to the invocation cwd", async () => {
      const context = { cwd: directory };
      for (const [lineNumber, rows] of [[24, [31, 32]], [38, [43]]] as const) {
        const options = { filePath: relativeFile, lineNumber, scenarioName: "Alias template" };
        const targets = rows.map((line) => `${relativeFile}:${line}`);
        const run = await builder.buildScenarioCommand(options, context);
        const debug = await builder.buildDebugCommand(options, context);
        const configuration = await builder.buildDebugConfiguration(options, context);
        assert.deepStrictEqual(run.args, ["-m", "behave", ...targets, "-f", "pretty"]);
        assert.deepStrictEqual(debug.args, ["-m", "behave", ...targets, "-f", "pretty", "--no-capture"]);
        assert.deepStrictEqual(configuration["args"], [...targets, "-f", "pretty", "--no-capture"]);
        assert.strictEqual(run.cwd, directory);
        assert.strictEqual(configuration["cwd"], directory);
      }
    });

    test("concrete scenario, row and docstring lines retain exact selectors", async () => {
      for (const lineNumber of [13, 17, 31, 32, 34, 43]) {
        const invocation = await builder.buildScenarioCommand({ filePath: relativeFile, lineNumber }, { cwd: directory });
        assert.deepStrictEqual(invocation.args, ["-m", "behave", `${relativeFile}:${lineNumber}`, "-f", "pretty"]);
      }
    });

    test("a real empty outline fails before executable resolution and supports a corrected retry", async () => {
      const empty = 'Feature: Empty\n  Scenario Template: Empty\n    Given I begin English "<entry>"\n';
      fs.writeFileSync(path.join(directory, relativeFile), empty);
      let resolutions = 0;
      const configured = new BehaveCommandBuilder({ workingDirectory: directory, behaveCommand: "python3 -m behave",
        getIntelligentBehaveCommand: async () => {resolutions++; return "python3 -m behave";} } as unknown as ExtensionConfig);
      const options = { filePath: relativeFile, lineNumber: 2, scenarioName: "Empty" };
      await assert.rejects(configured.buildScenarioCommand(options), /has no executable Examples rows/u);
      await assert.rejects(configured.buildDebugCommand(options), /has no executable Examples rows/u);
      assert.throws(() => configured.buildDebugConfiguration(options), /has no executable Examples rows/u);
      assert.strictEqual(resolutions, 0);
      fs.appendFileSync(path.join(directory, relativeFile), "    Scenarios:\n      | entry |\n      | repaired |\n");
      assert.deepStrictEqual((await configured.buildScenarioCommand(options)).args, ["-m", "behave", `${relativeFile}:6`, "-f", "pretty"]);
      assert.strictEqual(resolutions, 1);
    });
  });

  test("output format precedence and validation use one supported-format resolver", () => {
    assert.strictEqual(ExtensionConfig.resolveBehaveOutputFormat(), "pretty");
    assert.strictEqual(ExtensionConfig.resolveBehaveOutputFormat(undefined, "plain"), "plain");
    assert.strictEqual(ExtensionConfig.resolveBehaveOutputFormat("json", "plain"), "json");
    assert.throws(() => ExtensionConfig.resolveBehaveOutputFormat("invalid", "plain"), /Unsupported Behave outputFormat 'invalid'/u);
    const formats: string[] = require("../../../../package.json").contributes.configuration.properties["behaveTestRunner.outputFormat"].enum;
    for (const format of formats) {
      const config = ExtensionConfig.create({ get: (name: string, fallback: unknown) => name === "outputFormat" ? format : fallback } as vscode.WorkspaceConfiguration, undefined, false);
      try {assert.doesNotThrow(() => config.validate(), format);} finally {config.dispose();}
    }
  });

  test("all Behave run and debug routes share the selected formatter without enabling dry-run", async () => {
    for (const format of ["pretty", "plain", "json", "progress", "steps", "junit"]) {
      const configured = new BehaveCommandBuilder({ workingDirectory: "/project", behaveCommand: "python3 -m behave", outputFormat: format,
        getIntelligentBehaveCommand: async () => "python3 -m behave", tags: "", dryRun: false } as unknown as ExtensionConfig);
      const outputs = [
        (await configured.buildScenarioCommand({ filePath: "a.feature", lineNumber: 17 })).args,
        (await configured.buildFeatureCommand({ filePath: "a.feature" })).args,
        (await configured.buildRunAllCommand()).args,
        (await configured.buildTagCommand("@smoke")).args,
        (await configured.buildDebugCommand({ filePath: "a.feature", lineNumber: 17 })).args,
        (await configured.buildDebugConfiguration({ filePath: "a.feature", lineNumber: 17 }))["args"] as string[],
      ];
      for (const args of outputs) {
        const formatter = args.indexOf("-f");
        assert.deepStrictEqual(args.slice(formatter, formatter + 2), ["-f", format === "junit" ? "pretty" : format], format);
        assert.strictEqual(args.includes("--junit"), format === "junit");
        assert.strictEqual(args.includes("--dry-run"), false, "Selecting steps must not change execution policy");
      }
      const override = await configured.buildScenarioCommand({ filePath: "a.feature", outputFormat: "json" });
      assert.deepStrictEqual(override.args.slice(-2), ["-f", "json"]);
    }
  });

  test("invalid consumed formats fail before resolving an executable and corrected overrides can retry", async () => {
    let resolutions = 0;
    const configured = new BehaveCommandBuilder({ workingDirectory: "/project", outputFormat: "invalid",
      getIntelligentBehaveCommand: async () => {resolutions++; return "behave --no-color";} } as unknown as ExtensionConfig);
    await assert.rejects(configured.buildScenarioCommand({ filePath: "a.feature" }), /Unsupported Behave outputFormat/u);
    assert.strictEqual(resolutions, 0);
    const corrected = await configured.buildScenarioCommand({ filePath: "a.feature", outputFormat: "plain" });
    assert.strictEqual(resolutions, 1);
    assert.ok(corrected.args.includes("--no-color"), "Configured executable-prefix flags remain supported");
    assert.deepStrictEqual(corrected.args.slice(-2), ["-f", "plain"]);
  });
});
