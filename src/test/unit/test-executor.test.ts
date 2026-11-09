import * as assert from "assert";
import * as vscode from "vscode";
import { ProjectContext } from "../../core/project-context";
import { BehaveCommandBuilder } from "../../core/command-builders/behave-command-builder";
import { TestExecutor } from "../../core/test-executor";
import { ExtensionConfig } from "../../core/extension-config";
import { PythonDetector } from "../../utils/python-detector";
import { CommandManager } from "../../commands/command-manager";
import { BehaveJsonParser } from "../../utils/behave-json-parser";
import { CucumberJsonParser } from "../../utils/cucumber-json-parser";
import { Logger, LogLevel } from "../../utils/logger";
import { OUTPUT_PUBLISH_BYTES, ProcessTerminationError } from "../../core/owned-process";

suite("TestExecutor Unit Tests", () => {
  const config = { workingDirectory: "/explicit/project", behaveCommand: "behave" } as ExtensionConfig;
  function createExecutor(debug?: typeof vscode.debug, configured: ExtensionConfig = config) {
    const executor = new TestExecutor(undefined, undefined, debug, configured);
    const folder = { uri: vscode.Uri.file(require("node:path").parse(process.cwd()).root), name: "unit project", index: 0 };
    const project: ProjectContext = { folder, cwd: configured.workingDirectory, config: { ...configured, maxParallelProcesses: 16 } as ExtensionConfig, builder: new BehaveCommandBuilder(configured) };
    executor.resolveProjects = async () => new Map([[folder.uri.toString(), project]]);
    return executor;
  }
  test("admission spans a complete operation and is shared across executor instances", async () => {
    const executor = createExecutor();
    const second = createExecutor();
    let entered: () => void = () => {};
    const ready = new Promise<void>((resolve) => {entered = resolve;});
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {release = resolve;});
    const active = executor.withExecutionSession(async (session) => {
      assert.ok(session.signal); entered(); await gate;
    });
    await ready;
    await assert.rejects(second.withExecutionSession(async () => {}), /already in progress/u);
    release(); await active;
    await second.withExecutionSession(async () => {});
    await executor.dispose(); await second.dispose();
  });
  test("disposal cancels immediately and waits for operation drainage", async () => {
    const executor = createExecutor();
    let finish: () => void = () => {};
    const gate = new Promise<void>((resolve) => {finish = resolve;});
    let signal: AbortSignal | undefined;
    const active = executor.withExecutionSession(async (session) => {signal = session.signal; await gate;});
    let drained = false;
    const disposal = executor.dispose().then(() => {drained = true;});
    assert.strictEqual(signal?.aborted, true);
    assert.strictEqual(drained, false);
    await assert.rejects(executor.withExecutionSession(async () => {}), /disposed/u);
    finish(); await active; await disposal;
    assert.ok(drained);
  });
  test("the operation display limit preserves complete UTF-8 characters and publishes one notice", async () => {
    const executor = createExecutor();
    let output = "";
    await executor.withExecutionSession(async (session) => {
      session.publish("x".repeat(OUTPUT_PUBLISH_BYTES - 1));
      session.publish("😀");
      session.publish("discarded");
    }, undefined, (text) => {output += text;});
    assert.strictEqual(output, "x".repeat(OUTPUT_PUBLISH_BYTES - 1) + "\n[Output truncated: the operation reached the 1 MiB display limit]\n");
    await executor.dispose();
  });
  test("stream text and alias messages share one UTF-8 budget and a detached session cannot reuse it", async () => {
    const executor = createExecutor();
    let stream = "";
    let message = "";
    let detached: ((text: string) => string) | undefined;
    const format = (text: string) => text.replace(/\r?\n/g, "\r\n");
    await executor.withExecutionSession(async (session) => {
      detached = session.limitDisplay;
      session.publish("stream\n");
      message = session.limitDisplay("😀".repeat(OUTPUT_PUBLISH_BYTES));
      assert.strictEqual(session.limitDisplay("later alias"), "", "Aliases cannot acquire a fresh message budget");
    }, undefined, (text) => {stream += text;}, format);
    const notice = format("\n[Output truncated: the operation reached the 1 MiB display limit]\n");
    assert.ok(message.includes(notice));
    assert.ok(!message.includes("�"));
    assert.ok(Buffer.byteLength(stream + message) <= OUTPUT_PUBLISH_BYTES + Buffer.byteLength(notice));
    assert.strictEqual(detached?.("after completion"), "");
    await executor.withExecutionSession(async (session) => {
      assert.strictEqual(detached?.("during another operation"), "");
      assert.strictEqual(session.limitDisplay("fresh operation"), "fresh operation");
    });
    await executor.dispose();
  });
  test("cancellation is observable before any selected unit is launched", async () => {
    const executor = createExecutor();
    const token = new vscode.CancellationTokenSource(); token.cancel();
    await executor.withExecutionSession(async (session) => {assert.ok(session.signal.aborted);}, token.token);
    token.dispose(); await executor.dispose();
  });
  test("unconfirmed probe termination remains an execution error when cancellation is already requested", async () => {
    let begin: () => void = () => {};
    const probing = new Promise<void>((resolve) => {begin = resolve;});
    let fail: () => void = () => {};
    const failed = new Promise<void>((resolve) => {fail = resolve;});
    const probeConfig = { ...config, getIntelligentBehaveCommand: async () => {
      begin(); await failed;
      const failure = new ProcessTerminationError("probe is still present");
      failure.message = "Reload the window: probe stop was unconfirmed.";
      throw failure;
    } } as unknown as ExtensionConfig;
    const executor = createExecutor(undefined, probeConfig);
    const token = new vscode.CancellationTokenSource();
    const previousPoison = (TestExecutor as any).poison;
    try {
      const pending = executor.withExecutionSession((session) => executor.runScenarioWithOutput({ filePath: "a.feature" }, session), token.token);
      await probing;
      token.cancel(); fail();
      const result = await pending;
      assert.strictEqual(result.errored, true, "A failed stop takes precedence over the cancelled signal");
      assert.strictEqual(result.cancelled, undefined);
      const second = createExecutor();
      await assert.rejects(second.withExecutionSession(async () => {}), /Reload the window/u);
      await second.dispose();
    } finally {
      fail(); await executor.dispose(); token.dispose(); (TestExecutor as any).poison = previousPoison;
    }
  });
  test("report parsers preserve localized and empty display names, skipped fields and inferred legacy statuses", () => {
    let logged = "";
    const logger = new Logger({ appendLine: (text: string) => {logged += text;} } as vscode.OutputChannel, LogLevel.DEBUG);
    const behave = new BehaveJsonParser(logger);
    const cucumber = new CucumberJsonParser(logger);
    for (const name of ["", "確認する"] ) {
      const steps = [{ name, result: { status: "passed" } }];
      const report = JSON.stringify([{ filename: "example.feature", elements: [
        { type: "scenario", name, line: 3, steps },
        { type: "scenario", name, location: "example.feature:8", status: "skipped", steps: [{ name }] },
      ] }]);
      assert.deepStrictEqual(behave.parseBehaveJsonOutput(report).map((result) => result.status), ["passed", "skipped"]);
      const suite = cucumber.parseCucumberJson(JSON.stringify([{ uri: "example.feature", elements: [{ name, line: 3, steps }] }]));
      assert.strictEqual(suite.tests[0]?.name, name);
      assert.strictEqual(suite.tests[0]?.status, "passed");
    }
    for (const status of ["unknown", "untested", "executing", "xfailed", "xpassed", "pending_warn", "untested_pending", "untested_undefined"]) {
      const report = JSON.stringify([{ filename: "example.feature", elements: [{ type: "scenario", name: "", line: 3, status, steps: [] }] }]);
      assert.strictEqual(behave.parseBehaveJsonOutput(report)[0]?.status, status, "Existing Behave status semantics remain available to the consumer");
    }
    assert.ok(logged.length < 4096, "Summary diagnostics must not include report bodies");
  });
  test("valid JSON with invalid primary feature or scenario shapes throws for both parsers", () => {
    const behave = new BehaveJsonParser();
    const cucumber = new CucumberJsonParser();
    for (const report of ["[{}]", '[{"filename":"example.feature","elements":[null]}]',
      '[{"filename":"example.feature","elements":[{"type":"scenario","name":"broken","line":3,"steps":[]}]}]']) {
      assert.throws(() => behave.parseBehaveJsonOutput(report), /Invalid Behave report/u);
    }
    for (const report of ["[{}]", '[{"uri":"example.feature","elements":[null]}]',
      '[{"uri":"example.feature","elements":[{"name":"broken","line":3,"steps":[{}]}]}]']) {
      assert.throws(() => cucumber.parseCucumberJson(report), /Invalid cucumber report/u);
    }
  });
  test("unsupported shell and secondary batch prefixes never reach process launch", async () => {
    const processes = require("node:child_process") as typeof import("node:child_process");
    const spawn = processes.spawn;
    let launches = 0;
    (processes as any).spawn = () => {launches++; throw new Error("unexpected launch");};
    try {
      for (const command of ["cmd.exe /c behave.cmd", '"C:\\Windows\\System32\\cmd.exe" /c behave', "/bin/bash -c behave",
        "pwsh -Command behave", "poetry run /bin/zsh -c behave", "uv run C:/tools/behave.bat"]) {
        const executor = createExecutor(undefined,
          { ...config, getIntelligentBehaveCommand: async () => command } as unknown as ExtensionConfig);
        const result = await executor.runFeatureFileWithOutput({ filePath: "a.feature" });
        assert.strictEqual(result.errored, true, command);
        assert.match(result.error!, /Invalid test command/u);
        await executor.dispose();
      }
      assert.strictEqual(launches, 0);
    } finally {(processes as any).spawn = spawn;}
  });
  test("parallel workers obey configured concurrency and the hard limit of sixteen", async () => {
    for (const configured of [1, 3, 99]) {
      const executor = createExecutor();
      const limit = Math.min(configured, 16);
      const projects = await executor.resolveProjects();
      const project = projects.values().next().value!;
      executor.resolveProjects = async () => new Map([[project.folder.uri.toString(), { ...project, config: { ...config, maxParallelProcesses: limit } as ExtensionConfig }]]);
      let active = 0;
      let peak = 0;
      let started: () => void = () => {};
      const full = new Promise<void>((resolve) => {started = resolve;});
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {release = resolve;});
      const files: string[] = [];
      executor.runFeatureFileWithOutput = async (options) => {
        assert.strictEqual(options.outputFormat, "json", "Per-call format must survive the parallel worker boundary");
        files.push(options.filePath); active++; peak = Math.max(peak, active);
        if (active === limit) {started();}
        await gate; active--;
        return { success: true, output: "", duration: 1 };
      };
      const pending = executor.runTestsInParallel({ featureFiles: Array.from({ length: 20 }, (_, index) => `${index}.feature`), maxProcesses: configured, outputFormat: "json" });
      await full;
      assert.strictEqual(files.length, limit);
      release(); await pending;
      assert.strictEqual(files.length, 20);
      assert.strictEqual(peak, limit);
      await executor.dispose();
    }
  });
  test("parallel report, launch and test failures reject after all owned workers drain", async () => {
    for (const errored of [false, true]) {
      const executor = createExecutor();
      let finished = 0;
      executor.runFeatureFileWithOutput = async () => {finished++; return { success: false, errored, output: "", duration: 1 };};
      await assert.rejects(executor.runTestsInParallel({ featureFiles: ["a.feature", "b.feature"], maxProcesses: 2 }), /2 parallel feature execution/u);
      assert.strictEqual(finished, 2);
      await executor.dispose();
    }
  });
  test("debug retains admission until the matching real session terminates", async () => {
    const starts = new vscode.EventEmitter<vscode.DebugSession>();
    const ends = new vscode.EventEmitter<vscode.DebugSession>();
    let launched: () => void = () => {};
    const launch = new Promise<void>((resolve) => {launched = resolve;});
    let candidate: vscode.DebugSession;
    const debug = { onDidStartDebugSession: starts.event, onDidTerminateDebugSession: ends.event,
      startDebugging: async (_folder: unknown, configuration: vscode.DebugConfiguration) => {
        candidate = { id: "owned", configuration } as vscode.DebugSession; starts.fire(candidate); launched(); return true;
      }, stopDebugging: async (target: vscode.DebugSession) => {assert.strictEqual(target, candidate); ends.fire(candidate);} } as unknown as typeof vscode.debug;
    const executor = createExecutor(debug);
    const token = new vscode.CancellationTokenSource();
    const pending = executor.withExecutionSession(async (session) => executor.debugScenario({ filePath: "a.feature", lineNumber: 17 }, session), token.token);
    await launch;
    await assert.rejects(executor.withExecutionSession(async () => {}), /already in progress/u);
    ends.fire({ configuration: {} } as vscode.DebugSession);
    token.cancel(); await pending;
    await executor.withExecutionSession(async () => {});
    token.dispose(); starts.dispose(); ends.dispose(); await executor.dispose();
  });
  test("cancellation before debug launch releases observers without poisoning admission", async () => {
    const starts = new vscode.EventEmitter<vscode.DebugSession>();
    const ends = new vscode.EventEmitter<vscode.DebugSession>();
    let released = 0;
    const observe = (event: vscode.Event<vscode.DebugSession>) => (listener: (candidate: vscode.DebugSession) => unknown) => {
      const registration = event(listener);
      return new vscode.Disposable(() => {released++; registration.dispose();});
    };
    let launches = 0;
    const debug = { onDidStartDebugSession: observe(starts.event), onDidTerminateDebugSession: observe(ends.event),
      startDebugging: async () => {launches++; return false;} } as unknown as typeof vscode.debug;
    const executor = createExecutor(debug);
    const builder = (await executor.resolveProjects()).values().next().value!.builder;
    const build = builder.buildDebugConfiguration.bind(builder);
    let begin: () => void = () => {};
    const building = new Promise<void>((resolve) => {begin = resolve;});
    let finish: () => void = () => {};
    const gate = new Promise<void>((resolve) => {finish = resolve;});
    builder.buildDebugConfiguration = async (...args) => {begin(); await gate; return build(...args);};
    const token = new vscode.CancellationTokenSource();
    const pending = executor.withExecutionSession((session) => executor.debugScenario({ filePath: "a.feature" }, session), token.token);
    await building;
    token.cancel(); finish();
    await assert.rejects(pending, /aborted/u);
    assert.strictEqual(launches, 0);
    assert.strictEqual(released, 2);
    await executor.withExecutionSession(async () => {});
    token.dispose(); starts.dispose(); ends.dispose(); await executor.dispose();
  });
  test("a declined debugger launch releases admission", async () => {
    const starts = new vscode.EventEmitter<vscode.DebugSession>(); const ends = new vscode.EventEmitter<vscode.DebugSession>();
    const debug = { onDidStartDebugSession: starts.event, onDidTerminateDebugSession: ends.event, startDebugging: async () => false } as unknown as typeof vscode.debug;
    const executor = createExecutor(debug);
    await assert.rejects(executor.debugScenario({ filePath: "a.feature" }), /declined/u);
    await executor.withExecutionSession(async () => {});
    starts.dispose(); ends.dispose(); await executor.dispose();
  });
  for (const delayedLaunch of [false, true]) {
    test(`late debug start remains owned after ${delayedLaunch ? "cancellation during a pending launch" : "start acknowledgement timeout"}`, async () => {
      const starts = new vscode.EventEmitter<vscode.DebugSession>();
      const ends = new vscode.EventEmitter<vscode.DebugSession>();
      const schedule = global.setTimeout;
      const deadlines = new Map<ReturnType<typeof setTimeout>, () => void>();
      let acknowledge: () => void = () => {};
      const acknowledgementPending = new Promise<void>((resolve) => {acknowledge = resolve;});
      let acknowledgementCount = 0;
      let expire: (() => void) | undefined;
      global.setTimeout = ((callback: () => void, delay: number) => {
        const handle = schedule(callback, delay);
        if (delay === 10000) {
          deadlines.set(handle, callback);
          if (++acknowledgementCount === 2) {expire = callback; acknowledge();}
        }
        return handle;
      }) as typeof setTimeout;
      let configuration!: vscode.DebugConfiguration;
      let launchReady: () => void = () => {};
      const launched = new Promise<void>((resolve) => {launchReady = resolve;});
      let accept: (value: boolean) => void = () => {};
      const launch = new Promise<boolean>((resolve) => {accept = resolve;});
      let stopped: (target: vscode.DebugSession) => void = () => {};
      const stopObserved = new Promise<vscode.DebugSession>((resolve) => {stopped = resolve;});
      let observers = 0;
      const observe = (source: vscode.EventEmitter<vscode.DebugSession>) => (listener: (candidate: vscode.DebugSession) => unknown) => {
        observers++;
        const registration = source.event(listener);
        let disposed = false;
        return { dispose: () => {if (!disposed) {disposed = true; observers--; registration.dispose();}} };
      };
      const debug = { onDidStartDebugSession: observe(starts), onDidTerminateDebugSession: observe(ends),
        startDebugging: (_folder: unknown, config: vscode.DebugConfiguration) => {
          configuration = config; launchReady(); return delayedLaunch ? launch : Promise.resolve(true);
        }, stopDebugging: async (target: vscode.DebugSession) => {stopped(target);} } as unknown as typeof vscode.debug;
      const executor = createExecutor(debug);
      const token = new vscode.CancellationTokenSource();
      const previousPoison = (TestExecutor as any).poison;
      const pending = executor.withExecutionSession((session) => executor.debugScenario({ filePath: "a.feature" }, session), token.token);
      const rejected = assert.rejects(pending, /not confirmed/u);
      try {
        await launched;
        if (delayedLaunch) {token.cancel();}
        await acknowledgementPending;
        assert.ok(expire, "The start acknowledgement must have installed its bounded deadline");
        expire();
        await rejected;
        await executor.dispose();
        assert.strictEqual(observers, 2, "Unknown start retains both matching lifecycle observers after disposal");
        const second = createExecutor();
        await assert.rejects(second.withExecutionSession(async () => {}), /not confirmed/u);
        await second.dispose();
        if (delayedLaunch) {accept(true); await launch;}
        const candidate = { id: "late-owned", configuration } as vscode.DebugSession;
        starts.fire({ configuration: {} } as vscode.DebugSession);
        starts.fire(candidate);
        assert.strictEqual(await stopObserved, candidate, "A late start must stop the specifically owned session");
        ends.fire(candidate);
        assert.strictEqual(observers, 0, "Known termination releases retained observers");
      } finally {
        for (const handle of deadlines.keys()) {clearTimeout(handle);}
        global.setTimeout = schedule;
        (TestExecutor as any).poison = previousPoison;
        token.dispose(); starts.dispose(); ends.dispose();
      }
    });
  }

});

suite('PythonDetector', () => {
  test('should prefer venv python if detected', async () => {
    const detector = PythonDetector.create();
    // Mock detectVenvPython to return a fake venv path
    detector.detectVenvPython = async () => '/fake/venv/bin/python';
    // Mock testBehaveCommand to always return false for direct behave, true for venv
    detector.testBehaveCommand = async (cmd: string) => cmd.startsWith('/fake/venv/bin/python');
    const command = await detector.getBestBehaveCommand();
    assert.strictEqual(command, '"/fake/venv/bin/python" -m behave');
    detector.clearCache();
  });
});

suite('CommandManager TestItemMap', () => {
  test('should add and retrieve test items from the map', () => {
    const manager = CommandManager.getInstance();
    manager.clearTestItemMap();
    const fakeTestItem = { id: 'test1' } as any;
    manager.addTestItemToMap('/path/to/file.feature', 10, 'Scenario Name', fakeTestItem);
    const found = manager.getTestItemFromMap('/path/to/file.feature', 10, 'Scenario Name');
    assert.strictEqual(found, fakeTestItem);
    manager.clearTestItemMap();
  });

  test('should clear the map', () => {
    const manager = CommandManager.getInstance();
    const fakeTestItem = { id: 'test2' } as any;
    manager.addTestItemToMap('/path/to/file.feature', 20, 'Another Scenario', fakeTestItem);
    manager.clearTestItemMap();
    const found = manager.getTestItemFromMap('/path/to/file.feature', 20, 'Another Scenario');
    assert.strictEqual(found, undefined);
  });

  test('should block test execution when discovery is in progress', () => {
    const manager = CommandManager.getInstance();
    manager.setTestDiscoveryInProgress(true);
    assert.strictEqual(manager.getIsTestRunning(), true);
    manager.setTestDiscoveryInProgress(false);
    assert.strictEqual(manager.getIsTestRunning(), false);
  });
});

test('Should run only the specific scenario outline example from CodeLens', async () => {
  const manager = CommandManager.create();
  // Spy on testExecutor.runScenario
  let calledWith: any = null;
  manager['context']['testExecutor'].runScenario = async (opts: any) => {
    calledWith = opts;
    return Promise.resolve();
  };
  manager['context']['testExecutor'].runScenarioWithOutput = async (opts: any) => {
    calledWith = opts;
    return { success: true, duration: 1, output: '', error: "" };
  };
  // Simulate running a scenario outline example from CodeLens
  const filePath = '/path/to/file.feature';
  const lineNumber = 10;
  const scenarioName = '1: Login with different credentials - username: admin, password: secret, result: success';
  await manager['runScenario'](filePath, lineNumber, scenarioName);
  // Should run only the specific example
  assert.deepStrictEqual({ filePath: calledWith.filePath, lineNumber: calledWith.lineNumber, scenarioName: calledWith.scenarioName }, { filePath, lineNumber, scenarioName });
});

test('Should debug only the specific scenario outline example from CodeLens with quoted name', async () => {
  const manager = CommandManager.create();
  // Spy on testExecutor.debugScenario
  let calledWith: any = null;
  manager['context']['testExecutor'].debugScenario = async (opts: any) => {
    calledWith = opts;
    return Promise.resolve();
  };
  // Simulate debugging a scenario outline example from CodeLens
  const filePath = '/path/to/file.feature';
  const lineNumber = 10;
  const scenarioName = '1: Login with different credentials - username: admin, password: secret, result: success';
  await manager['debugScenario'](filePath, lineNumber, scenarioName);
  // Should pass the scenarioName without quotes (TestExecutor handles quoting internally)
  assert.deepStrictEqual({ filePath: calledWith.filePath, lineNumber: calledWith.lineNumber }, { filePath, lineNumber });
  assert.strictEqual(calledWith.scenarioName, scenarioName);
});
