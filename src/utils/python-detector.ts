import * as fs from "node:fs";
import { commandInvocation, InvocationContext, requireWorkspaceTrust } from "../core/command-invocation";
import { runOwnedProcess } from "../core/owned-process";

/** Python probes share the operation's cancellation and shell-free process ownership. */
export class PythonDetector {
  private static instance: PythonDetector;
  private cachedCommand: string | null;
  constructor(initialCachedCommand?: string | null) {this.cachedCommand = initialCachedCommand ?? null;}
  public static create(initialCachedCommand?: string | null): PythonDetector {return new PythonDetector(initialCachedCommand);}
  public static getInstance(): PythonDetector {return this.instance ??= new PythonDetector();}

  private async probe(command: string, args: string[], context?: InvocationContext): Promise<string> {
    requireWorkspaceTrust();
    const invocation = commandInvocation(command, context?.cwd ?? process.cwd());
    const result = await runOwnedProcess({ ...invocation, args: [...invocation.args, ...args] }, context?.signal ?? new AbortController().signal, () => {}, 5000);
    if (result.terminationFailure) {throw result.terminationFailure;}
    context?.signal?.throwIfAborted();
    return result.returnCode === 0 && !result.timedOut && !result.launchFailure ? result.output + result.error : "";
  }
  public async detectPythonCommand(context?: InvocationContext): Promise<string> {
    requireWorkspaceTrust();
    if (this.cachedCommand) {return this.cachedCommand;}
    for (const command of ["python3", "python", "py"]) {
      if ((await this.probe(command, ["--version"], context)).includes("Python")) {return this.cachedCommand = command;}
    }
    return this.cachedCommand = "python3";
  }
  public async getBehaveCommand(context?: InvocationContext): Promise<string> {return `${await this.detectPythonCommand(context)} -m behave`;}
  public async testBehaveCommand(command: string, context?: InvocationContext): Promise<boolean> {
    return (await this.probe(command, ["--version"], context)).includes("behave");
  }
  public async detectVenvPython(context?: InvocationContext): Promise<string | null> {
    const script = 'import sys; print(sys.executable if getattr(sys, "base_prefix", sys.prefix) != sys.prefix else "")';
    for (const command of ["python3", "python"]) {
      const detected = (await this.probe(command, ["-c", script], context)).trim();
      if (detected && fs.existsSync(detected)) {return detected;}
    }
    return null;
  }
  public async getBestBehaveCommand(context?: InvocationContext): Promise<string> {
    const python = await this.detectVenvPython(context);
    if (python) {return `${JSON.stringify(python)} -m behave`;}
    if (await this.testBehaveCommand("behave", context)) {return "behave";}
    return this.getBehaveCommand(context);
  }
  public clearCache(): void {this.cachedCommand = null;}
  public getCachedCommand(): string | null {return this.cachedCommand;}
}
