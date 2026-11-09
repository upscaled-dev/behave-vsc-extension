import * as assert from "assert";
import * as fs from "node:fs/promises";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runOwnedProcess, OUTPUT_TAIL_BYTES } from "../../core/owned-process";
import { TestRunArtifacts, REPORT_LIMIT_BYTES } from "../../core/test-run-artifacts";

suite("Owned process and report boundaries", function () {
  this.timeout(15000);
  const python = process.env["BEHAVE_TEST_PYTHON"] ?? "python3";
  test("streams real output while retaining a bounded diagnostic tail", async () => {
    let published = 0;
    const result = await runOwnedProcess({ executable: python, args: ["-c", "import sys; sys.stdout.write('x' * 600000); sys.stderr.write('y' * 600000)"], cwd: process.cwd() }, new AbortController().signal,
      (text) => {published += Buffer.byteLength(text);});
    assert.strictEqual(result.returnCode, 0);
    assert.strictEqual(published, 1200000);
    for (const retained of [result.output, result.error]) {
      assert.ok(retained.includes("Output truncated"));
      assert.ok(Buffer.byteLength(retained) < OUTPUT_TAIL_BYTES + 100);
    }
  });
  test("cancellation tolerates a transient group query EPERM and requires confirmed absence", async function () {
    if (process.platform === "win32") {this.skip();}
    const controller = new AbortController();
    const kill = process.kill;
    let injected = false;
    let confirmedAbsent = false;
    process.kill = ((pid, signal) => {
      if (pid < 0 && signal === 0 && !injected) {
        injected = true; throw Object.assign(new Error("transient group query denial"), { code: "EPERM" });
      }
      try {return kill(pid, signal);} catch (error) {
        if (pid < 0 && signal === 0 && (error as NodeJS.ErrnoException).code === "ESRCH") {confirmedAbsent = true;}
        throw error;
      }
    }) as typeof process.kill;
    try {
      const result = await runOwnedProcess({ executable: python, args: ["-c", "import time; print('READY', flush=True); time.sleep(600)"], cwd: process.cwd() }, controller.signal,
        (text) => {if (text.includes("READY")) {controller.abort();}});
      assert.ok(injected);
      assert.ok(confirmedAbsent, "EPERM is not absence; settlement requires an ESRCH observation");
      assert.ok(result.cancelled);
      assert.strictEqual(result.terminationFailure, undefined);
    } finally {process.kill = kill;}
  });
  test("a short timeout drains a real process before returning", async () => {
    const result = await runOwnedProcess({ executable: python, args: ["-c", "import time; time.sleep(600)"], cwd: process.cwd() }, new AbortController().signal, () => {}, 30);
    assert.ok(result.timedOut);
    assert.strictEqual(result.terminationFailure, undefined);
  });
  test("an unkillable child settles with an error but retains ownership until late close and group absence", async function () {
    if (process.platform === "win32") {this.skip();}
    const processes = require("node:child_process") as typeof import("node:child_process");
    const spawn = processes.spawn;
    const kill = process.kill;
    const clock = Date.now;
    const child = Object.assign(new EventEmitter(), { pid: 912345, stdout: new PassThrough(), stderr: new PassThrough() });
    const controller = new AbortController();
    let alive = true;
    let now = 0;
    let output = "";
    (processes as any).spawn = () => child;
    Date.now = () => now;
    process.kill = ((pid: number, signal: NodeJS.Signals | number) => {
      assert.strictEqual(pid, -child.pid);
      if (!alive) {throw Object.assign(new Error("gone"), { code: "ESRCH" });}
      if (signal === 0) {now += 2001;}
      return true;
    }) as typeof process.kill;
    try {
      const pending = runOwnedProcess({ executable: python, args: [], cwd: process.cwd() }, controller.signal, (text) => {output += text;});
      child.stdout.write("before stop");
      controller.abort();
      const result = await pending;
      assert.match(result.terminationFailure!.message, /termination could not be confirmed/u);
      assert.strictEqual(child.stdout.destroyed, false, "An unconfirmed stop must retain the child stream observer");
      let terminated = false;
      void result.terminated.then(() => {terminated = true;});
      child.stdout.write("late output");
      assert.strictEqual(output, "before stop", "Late output cannot reach an ended TestRun or disposed channel");
      child.emit("close", 1);
      await Promise.resolve();
      assert.strictEqual(terminated, false, "Parent close cannot prove the process group is absent");
      alive = false;
      child.emit("close", 1);
      await result.terminated;
      assert.strictEqual(terminated, true);
    } finally {
      alive = false;
      child.emit("close", 1);
      (processes as any).spawn = spawn; process.kill = kill; Date.now = clock;
      child.stdout.destroy(); child.stderr.destroy();
    }
  });
  test("a report that grows after its first read is still bounded", async () => {
    const artifacts = await TestRunArtifacts.create();
    await fs.writeFile(artifacts.report, "[]");
    const promises = require("node:fs/promises") as typeof fs;
    const open = promises.open;
    let grown = false;
    (promises as any).open = async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      const read = handle.read.bind(handle);
      (handle as any).read = async (...readArgs: any[]) => {
        const value = await (read as any)(...readArgs);
        if (!grown) {grown = true; await fs.appendFile(artifacts.report, Buffer.alloc(REPORT_LIMIT_BYTES, 32));}
        return value;
      };
      return handle;
    };
    try {await assert.rejects(artifacts.readReport(), /16 MiB/u); assert.ok(grown);}
    finally {(promises as any).open = open; await artifacts.cleanup();}
    await assert.rejects(fs.stat(artifacts.report), /ENOENT/u);
  });
});
