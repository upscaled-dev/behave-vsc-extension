import * as path from "node:path";
import * as fs from "node:fs";
import * as vscode from "vscode";

export interface CommandInvocation {
  readonly executable: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface InvocationContext {
  readonly cwd: string;
  readonly projectRoot?: string;
  readonly signal?: AbortSignal;
  readonly captureOutput?: boolean;
}

export function pythonPluginEnvironment(plugin: string): NodeJS.ProcessEnv {
  const extension = vscode.extensions.getExtension("upscaled-dev.behave-test-runner");
  const directory = extension && path.join(extension.extensionPath, "python");
  if (!directory || !fs.existsSync(path.join(directory, plugin))) {
    throw new Error(`The Python plugin ${plugin} is missing. Reinstall Behave Test Runner.`);
  }
  return { PYTHONPATH: [directory, process.env["PYTHONPATH"]].filter(Boolean).join(path.delimiter) };
}

export function requireWorkspaceTrust(): void {
  if (!vscode.workspace.isTrusted) {throw new Error("Trust this workspace before running or debugging tests.");}
}

/** Parse the executable prefix only. Test data is appended directly as argv. */
export function commandInvocation(command: string, cwd: string): CommandInvocation {
  const migration = "Use an executable prefix such as behave, python -m behave, poetry run behave, or uv run behave. Shell syntax and Windows cmd/bat shims are not supported.";
  const invalid = (): never => {throw new Error(`Invalid test command. ${migration}`);};
  if (!command.trim() || /[\r\n`$;&|<>]/u.test(command)) {invalid();}
  const tokens: string[] = [];
  let token = "";
  let quote: string | undefined;
  let started = false;
  for (let index = 0; index < command.length; index++) {
    const char = command.charAt(index);
    if (char === "\\" && quote !== "'" && ["'", '"', "\\", " "].includes(command.charAt(index + 1))) {
      token += command.charAt(++index); started = true;
    } else if (quote) {
      if (char === quote) {quote = undefined;} else {token += char;}
    } else if (char === "'" || char === '"') {
      quote = char; started = true;
    } else if (/\s/u.test(char)) {
      if (started) {tokens.push(token); token = ""; started = false;}
    } else {token += char; started = true;}
  }
  if (quote) {invalid();}
  if (started) {tokens.push(token);}
  const [executable, ...args] = tokens;
  const shellHosts = new Set(["cmd", "powershell", "pwsh", "sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh"]);
  // Configured prefixes are executable tokens, including a wrapper's selected command.
  const unsupported = (part: string) => {
    const name = path.posix.basename(part.replace(/\\/gu, "/")).toLowerCase();
    return /\.(cmd|bat)$/u.test(name) || shellHosts.has(name.replace(/\.exe$/u, ""));
  };
  if (!executable || tokens.some((part) => !part || /^[A-Za-z_][\w]*=/u.test(part) || unsupported(part))) {invalid();}
  return { executable: executable as string, args, cwd };
}

export function invocationContext(cwd: string | undefined, configured: string): InvocationContext {
  return { cwd: cwd ?? (configured || (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd())) };
}

/** A bare framework uses the Python extension's selected interpreter. */
export function debugPython(invocation: CommandInvocation, tool: string): string | undefined {
  const name = path.basename(invocation.executable).replace(/\.exe$/iu, "").toLowerCase();
  if (name === tool && invocation.args.length === 0) {return undefined;}
  if (/^(python(?:\d+(?:\.\d+)*)?|py)$/u.test(name) && invocation.args.length === 2 && invocation.args[0] === "-m" && invocation.args[1] === tool) {
    return invocation.executable;
  }
  throw new Error("Debugging requires a bare framework executable or an explicit Python -m command. Configure wrappers such as poetry run or uv run for Run only.");
}
