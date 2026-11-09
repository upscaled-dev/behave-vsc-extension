import * as assert from "assert";
import { PytestBddCommandBuilder } from "../../../core/command-builders/pytest-bdd-command-builder";
import { ExtensionConfig } from "../../../core/extension-config";
import * as vscode from "vscode";

suite("PytestBddCommandBuilder Unit Tests", () => {
  const builder = new PytestBddCommandBuilder({ workingDirectory: "/project", getPytestCommand: () => "uv run pytest", tags: "", dryRun: false } as unknown as ExtensionConfig);
  test("builds a target and marker as separate arguments without a shared report", async () => {
    const invocation = await builder.buildScenarioCommand({ filePath: "/project/features/selection.feature", scenarioName: "First scenario", tags: "@smoke or retry" });
    assert.strictEqual(invocation.executable, "uv");
    assert.deepStrictEqual(invocation.args, ["run", "pytest", "-p", "behave_pytest_plugin", "--btr-project-root=/project", "--btr-feature=/project/features/selection.feature", "--btr-name=First scenario", "-m", "smoke or retry", "-v"]);
    assert.strictEqual(invocation.cwd, "/project");
  });
  test("debug rejects executable wrappers", async () => {
    await assert.rejects(async () => builder.buildDebugConfiguration({ filePath: "a.feature" }), /Debugging requires/u);
  });
  test("an invalid explicit line rejects instead of falling back to a supplied name", async () => {
    for (const lineNumber of [0, -1, 1.5, Number.NaN]) {
      await assert.rejects(async () => builder.buildScenarioCommand({ filePath: "/project/example.feature", lineNumber, scenarioName: "A valid name" }), /positive integer/u);
    }
  });

  test("Behave-only invalid formats do not block pytest configuration or per-call execution", async () => {
    const config = ExtensionConfig.create({ get: (name: string, fallback: unknown) =>
      name === "outputFormat" ? "invalid" : name === "framework" ? "pytest-bdd" : fallback } as vscode.WorkspaceConfiguration, undefined, false);
    try {assert.doesNotThrow(() => config.validate());} finally {config.dispose();}
    const invocation = await builder.buildScenarioCommand({ filePath: "/project/features/selection.feature", lineNumber: 7, outputFormat: "invalid" });
    assert.ok(invocation.args.includes("--btr-line=7"));
    assert.strictEqual(invocation.args.includes("invalid"), false);
  });

});
