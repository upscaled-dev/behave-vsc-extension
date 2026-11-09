import * as assert from "assert";
import { commandInvocation, debugPython } from "../../core/command-invocation";
import { BehaveCommandBuilder } from "../../core/command-builders/behave-command-builder";
import { ExtensionConfig } from "../../core/extension-config";

suite("Command Consistency Tests - Prevent Regression", () => {
  test("run and debug retain identical exact scenario and outline row selectors", async () => {
    const builder = new BehaveCommandBuilder({ workingDirectory: "/project", behaveCommand: "python3 -m behave", getIntelligentBehaveCommand: async () => "python3 -m behave", dryRun: false, tags: "" } as unknown as ExtensionConfig);
    for (const options of [{ filePath: "a.feature", lineNumber: 17, scenarioName: "Duplicate title" },
      { filePath: "a.feature", lineNumber: 39, scenarioName: "1: Outline - value: first" }]) {
      const run = await builder.buildScenarioCommand(options);
      const debug = await builder.buildDebugConfiguration(options);
      assert.strictEqual(run.args[2], debug["args"][0]);
      assert.ok(!run.args.includes("--name"));
      assert.ok(!debug["args"].includes("--name"));
    }
  });
  test("prefix parser supports quoted interpreters and executable wrappers", () => {
    for (const [command, executable, args] of [
      ['"/python path/python3" -m behave', "/python path/python3", ["-m", "behave"]],
      ["py -m behave", "py", ["-m", "behave"]], ["poetry run behave", "poetry", ["run", "behave"]],
      ["uv run pytest", "uv", ["run", "pytest"]], ["behave", "behave", []],
    ] as Array<[string, string, string[]]>) {
      assert.deepStrictEqual(commandInvocation(command, "/project"), { executable, args, cwd: "/project" });
    }
  });
  test("prefix parser rejects shell syntax before launch", () => {
    for (const command of ["", "'unclosed", 'python\n-m behave', "ENV=value behave", "behave; touch bad", "behave && other", "behave | cat", "behave >out", "$(python) -m behave", "`python` -m behave", "behave.cmd", "behave.bat", "cmd.exe /c behave.cmd", '"C:\\Windows\\System32\\CMD.EXE" /c behave',
      "powershell -Command behave", "pwsh.exe -c behave", "sh -c behave", "/bin/bash -c behave", "/bin/zsh -c behave",
      "poetry run cmd /c behave", "uv run /bin/sh -c behave", "uv run C:/tools/behave.BAT", "poetry run tools/behave.cmd"]) {
      assert.throws(() => commandInvocation(command, "/project"), /Invalid test command/u, command);
    }
  });
  test("debug preserves explicit Python and leaves bare tools to the selected interpreter", () => {
    assert.strictEqual(debugPython(commandInvocation("behave", "/project"), "behave"), undefined);
    assert.strictEqual(debugPython(commandInvocation('"/venv path/python3" -m behave', "/project"), "behave"), "/venv path/python3");
    assert.throws(() => debugPython(commandInvocation("poetry run behave", "/project"), "behave"), /Debugging requires/u);
  });
});
