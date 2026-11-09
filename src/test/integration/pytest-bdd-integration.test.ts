import * as assert from "assert";
import { PytestBddCommandBuilder } from "../../core/command-builders/pytest-bdd-command-builder";
import { ExtensionConfig } from "../../core/extension-config";

suite("Pytest-bdd invocation integration", () => {
  test("all builder entry points retain a structured prefix and explicit cwd", async () => {
    const builder = new PytestBddCommandBuilder({ getPytestCommand: () => '"/virtual env/python" -m pytest', workingDirectory: "/project", tags: "@smoke", dryRun: false } as unknown as ExtensionConfig);
    const invocations = await Promise.all([builder.buildScenarioCommand({ filePath: "features/example.feature", scenarioName: "Example" }),
      builder.buildFeatureCommand({ filePath: "features/example.feature" }), builder.buildTagCommand("@smoke"), builder.buildRunAllCommand()]);
    for (const invocation of invocations) {
      assert.strictEqual(invocation.executable, "/virtual env/python");
      assert.deepStrictEqual(invocation.args.slice(0, 2), ["-m", "pytest"]);
      assert.strictEqual(invocation.cwd, "/project");
      assert.ok(!invocation.args.some((arg) => arg.includes("cucumber-output.json")));
    }
  });
});
