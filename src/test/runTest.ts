import * as fs from "fs";
import { spawn } from "node:child_process";
import * as os from "os";
import * as path from "path";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";
import { resolveVSCodeExecutablePath, resolveVSCodeVersion } from "./vscode-executable-path";

async function runHost(trust: "trusted" | "untrusted"): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../../");
  const extensionTestsPath = path.resolve(__dirname, "./suite/index.js");
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDevelopmentPath, "package.json"), "utf8"));
  // Pin the baseline so a new stable host cannot silently change test behavior.
  const version = resolveVSCodeVersion(process.env["VSCODE_VERSION"] ?? "1.142.0", manifest.engines.vscode);
  const executable = process.env["VSCODE_EXECUTABLE_PATH"] ?? await downloadAndUnzipVSCode({ version });
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "behave-extension-test-"));
  const workspace = path.join(testRoot, "workspace");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "baseline.feature"),
    "Feature: Native baseline\n  @smoke\n  Scenario: A discovered scenario\n    Given a populated workspace\n");
  fs.mkdirSync(path.join(workspace, "features", "steps"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "features", "steps", "baseline.py"),
    "from behave import given\n\n@given('a populated workspace')\ndef populated(context):\n    pass\n");

  const untrusted = trust === "untrusted";
  // Start in workspace-file mode so adding project roots does not transition window modes.
  const workspaceFile = path.join(testRoot, "acceptance.code-workspace");
  fs.writeFileSync(workspaceFile, JSON.stringify({ folders: [{ path: workspace }] }));
  const processLedger = path.join(workspace, "process-ledger.txt");
  const launchProbe = path.join(testRoot, "launch-probe.py");
  fs.writeFileSync(launchProbe, `from pathlib import Path\nPath(${JSON.stringify(processLedger)}).write_text("launched")\n`);
  const userSettings = path.join(testRoot, "user-data", "User");
  fs.mkdirSync(userSettings, { recursive: true });
  fs.writeFileSync(path.join(userSettings, "settings.json"), JSON.stringify({
    "security.workspace.trust.startupPrompt": "never", "security.workspace.trust.banner": "never",
    "security.workspace.trust.enabled": true,
    ...(untrusted ? { "behaveTestRunner.behaveCommand": `${JSON.stringify(process.env["BEHAVE_TEST_PYTHON"] ?? "python3")} ${JSON.stringify(launchProbe)}`, "behaveTestRunner.autoDetectFramework": false } : {}),
  }));
  try {
    const launchArgs = [untrusted ? workspace : workspaceFile, "--disable-extensions",
      `--user-data-dir=${path.join(testRoot, "user-data")}`,
      `--extensions-dir=${path.join(testRoot, "extensions")}`];
    const testEnv = { TEST_GREP: untrusted ? "Workspace trust acceptance" : process.env["TEST_GREP"],
      TEST_WORKSPACE_TRUST: trust, BEHAVE_TEST_PYTHON: process.env["BEHAVE_TEST_PYTHON"] };
    const nativeExecutable = resolveVSCodeExecutablePath(executable);
    if (untrusted) {
      // test-electron always adds --disable-workspace-trust. Launch the real host directly here.
      const env: NodeJS.ProcessEnv = { ...process.env, ...testEnv };
      delete env["VSCODE_TEST"]; delete env["ELECTRON_RUN_AS_NODE"];
      await new Promise<void>((resolve, reject) => {
        const child = spawn(nativeExecutable, [...launchArgs, "--no-sandbox", "--disable-gpu-sandbox", "--disable-updates", "--skip-welcome", "--skip-release-notes",
          `--extensionDevelopmentPath=${extensionDevelopmentPath}`, `--extensionTestsPath=${extensionTestsPath}`], { env, stdio: "inherit" });
        child.once("error", reject);
        child.once("close", (code) => {if (code === 0) {resolve();} else {reject(new Error(`Restricted VS Code host exited ${code}`));}});
      });
    } else {
      await runTests({ version, vscodeExecutablePath: nativeExecutable,
        extensionDevelopmentPath: [extensionDevelopmentPath, path.join(extensionDevelopmentPath, "src/test/fixtures/debug-adapter")],
        extensionTestsPath, extensionTestsEnv: { ...testEnv, VSCODE_TEST: undefined, ELECTRON_RUN_AS_NODE: undefined },
        launchArgs: [...launchArgs, "--disable-workspace-trust"],
      });
    }
  } finally {
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const requested = process.env["TEST_WORKSPACE_TRUST"];
  if (requested === "untrusted") {await runHost("untrusted"); return;}
  await runHost("trusted");
  if (!process.env["TEST_GREP"] && requested !== "trusted") {await runHost("untrusted");}
}

main().catch((error) => {
  console.error("Failed to run tests:", error);
  process.exitCode = 1;
});
