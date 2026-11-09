import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { CommandInvocation, requireWorkspaceTrust } from "./command-invocation";

export const RUN_TIMEOUT_MS = 15 * 60 * 1000;
export const OUTPUT_TAIL_BYTES = 256 * 1024;
export const OUTPUT_PUBLISH_BYTES = 1024 * 1024;
const TERMINATION_GRACE_MS = 2000;

/** Failure kind is independent of the message shown to the user. */
export class ProcessTerminationError extends Error {
  constructor(detail: string) {
    super(`Process termination could not be confirmed: ${detail}. Reload the window before running more tests.`);
    this.name = "ProcessTerminationError";
  }
}

export interface OwnedProcessResult {
  readonly output: string;
  readonly error: string;
  readonly returnCode: number;
  readonly cancelled: boolean;
  readonly timedOut: boolean;
  readonly terminationFailure?: ProcessTerminationError;
  readonly launchFailure?: string;
  /** Resolves only after output handles close and the owned tree is confirmed stopped. */
  readonly terminated: Promise<void>;
}

class OutputTail {
  private bytes = Buffer.alloc(0);
  private discarded = 0;
  public append(chunk: Buffer): void {
    const combined = Buffer.concat([this.bytes, chunk]);
    const excess = Math.max(0, combined.length - OUTPUT_TAIL_BYTES);
    this.discarded += excess;
    this.bytes = combined.subarray(excess);
  }
  public text(): string {
    const retained = this.bytes.toString("utf8").replace(/^�+/u, "");
    return this.discarded ? `[Output truncated: ${this.discarded} bytes omitted]\n${retained}` : retained;
  }
}

function groupAlive(pid: number): boolean {
  try {process.kill(-pid, 0); return true;} catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForGroup(pid: number): Promise<boolean> {
  const deadline = Date.now() + TERMINATION_GRACE_MS;
  while (groupAlive(pid)) {
    if (Date.now() >= deadline) {return false;}
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

async function terminateTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await new Promise<void>((resolve, reject) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" });
      const timer = setTimeout(() => {killer.kill(); reject(new Error("taskkill did not acknowledge termination"));}, 10000);
      killer.once("error", (error) => {clearTimeout(timer); reject(error);});
      killer.once("close", (code) => {clearTimeout(timer); if (code === 0) {resolve();} else {reject(new Error(`taskkill exited ${code}`));}});
    });
    return;
  }
  if (!groupAlive(pid)) {return;}
  try {process.kill(-pid, "SIGTERM");} catch { /* Recheck the group through the grace window, including an exit racing the signal. */ }
  if (await waitForGroup(pid)) {return;}
  try {process.kill(-pid, "SIGKILL");} catch { /* Recheck the group through the grace window, including an exit racing the signal. */ }
  if (!await waitForGroup(pid)) {throw new Error("Process group is still present after SIGKILL");}
}

/** User settlement is bounded; ownership continues after an unconfirmed termination. */
export function runOwnedProcess(invocation: CommandInvocation, signal: AbortSignal, onOutput: (text: string) => void, timeoutMs = RUN_TIMEOUT_MS): Promise<OwnedProcessResult> {
  requireWorkspaceTrust();
  signal.throwIfAborted();
  return new Promise((resolve) => {
    const stdout = new OutputTail();
    const stderr = new OutputTail();
    const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
    let cancelled = false;
    let timedOut = false;
    let closed = false;
    let treeStopped = false;
    let code: number | null = null;
    let launchFailure: string | undefined;
    let terminationFailure: ProcessTerminationError | undefined;
    let termination: Promise<void> | undefined;
    let settled = false;
    let confirmTermination: () => void = () => {};
    const terminated = new Promise<void>((done) => {confirmTermination = done;});
    const child = spawn(invocation.executable, [...invocation.args], {
      cwd: invocation.cwd, ...(invocation.env ? { env: { ...process.env, ...invocation.env } } : {}), shell: false, detached: process.platform !== "win32", windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const publish = (text: string) => {if (!settled) {try {onOutput(text);} catch { /* observers do not own execution */ }}};
    const settle = () => {
      if (settled) {return;}
      publish(decoders.stdout.end()); publish(decoders.stderr.end());
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve({ output: stdout.text(), error: stderr.text(), returnCode: code ?? 1, cancelled, timedOut, terminated,
        ...(launchFailure ? { launchFailure } : {}), ...(terminationFailure ? { terminationFailure } : {}) });
    };
    const finish = () => {
      if (closed && treeStopped && !termination) {confirmTermination(); settle();}
    };
    const observeLateTermination = () => {
      // Parent close alone cannot confirm a failed Windows tree termination.
      const pid = child.pid;
      if (process.platform === "win32" || !pid) {return;}
      const observe = () => {
        if (!groupAlive(pid)) {treeStopped = true; finish(); return;}
        setTimeout(observe, 1000).unref();
      };
      observe();
    };
    const stop = () => {
      if (termination || treeStopped || !child.pid) {return;}
      termination = terminateTree(child.pid).then(() => {treeStopped = true;}).catch((error: unknown) => {
        terminationFailure = new ProcessTerminationError(String(error));
        settle();
        observeLateTermination();
      }).finally(() => {termination = undefined; finish();});
    };
    const abort = () => {cancelled = true; stop();};
    const timer = setTimeout(() => {timedOut = true; stop();}, timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {if (!settled) {stdout.append(chunk); publish(decoders.stdout.write(chunk));}});
    child.stderr.on("data", (chunk: Buffer) => {if (!settled) {stderr.append(chunk); publish(decoders.stderr.write(chunk));}});
    child.once("error", (error) => {launchFailure = error.message; if (!child.pid) {treeStopped = true;}});
    child.once("exit", (exitCode) => {code = exitCode; if (process.platform !== "win32") {stop();}});
    child.once("close", (exitCode) => {
      closed = true; code = exitCode;
      if (process.platform === "win32" && !terminationFailure && !termination) {treeStopped = true;}
      if (terminationFailure && process.platform !== "win32" && child.pid && !groupAlive(child.pid)) {treeStopped = true;}
      finish();
    });
    if (signal.aborted) {abort();}
  });
}
