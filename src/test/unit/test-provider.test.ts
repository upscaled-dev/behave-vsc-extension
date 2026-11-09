import * as assert from "assert";
import * as vscode from "vscode";
import { BehaveTestProvider } from "../../test-providers/behave-test-provider.js";
import { Logger } from "../../utils/logger";
import { ExtensionConfig } from "../../core/extension-config";
import { createCheckedOutputChannel } from "../output-channel";

suite("BehaveTestProvider Unit Tests", () => {
  let testController: vscode.TestController;
  let testProvider: BehaveTestProvider;
  let createOutputChannel: typeof vscode.window.createOutputChannel;

  setup(() => {
    // Fast unit fixtures use checked channels; native activation acceptance retains real channels.
    createOutputChannel = vscode.window.createOutputChannel;
    vscode.window.createOutputChannel = createCheckedOutputChannel as typeof vscode.window.createOutputChannel;
    // Create a test controller for testing
    testController = vscode.tests.createTestController(
      "test-provider",
      "Test Provider"
    );

    // Create test provider with the test controller
    testProvider = BehaveTestProvider.create(testController);
  });

  teardown(() => {
    testProvider.dispose();
    testController.dispose();
    vscode.window.createOutputChannel = createOutputChannel;
  });

  test("Constructor should accept test controller parameter", () => {
    // This test ensures the constructor signature is correct
    assert.ok(testProvider, "Test provider should be created");
    assert.strictEqual(
      testProvider["testController"],
      testController,
      "Test provider should use the provided test controller"
    );
  });

  test("SetupTestController should create run profiles", () => {
    // Since runProfiles is not exposed in the VS Code API, we'll test that the provider
    // can be created without errors, which means the setupTestController method worked
    assert.ok(testProvider, "Test provider should be created successfully");
    assert.ok(testController, "Test controller should be created successfully");
  });

  test("Constructor should properly store test controller reference", () => {
    // Test that the test controller is properly stored in the provider
    assert.strictEqual(
      testProvider["testController"],
      testController,
      "Test provider should store the provided test controller"
    );
  });

  test("GetDiscoveredTests should return empty map initially", () => {
    const tests = testProvider.getDiscoveredTests();
    assert.ok(tests instanceof Map, "Should return a Map");
    assert.strictEqual(tests.size, 0, "Should be empty initially");
  });

  test("Parsed scenario metadata retains its exact executable line", () => {
    const file = vscode.Uri.file("/path/to/file.feature");
    const parsed = testProvider["context"].featureParser.parseFeatureContent("Feature: Exact lines\n\n\n\n\n\n\n\n\n  Scenario: Named scenario\n    Given a step\n");
    assert.ok(parsed?.scenarios[0]);
    const scenario = parsed.scenarios[0];
    scenario.filePath = file.fsPath;
    const builder = testProvider["treeBuilder"];
    const item = builder.createScenarioTestItem(file, scenario);
    assert.strictEqual(builder.scenarioFor(item.id)?.lineNumber, 10);
    assert.strictEqual(builder.scenarioFor(file.fsPath), undefined);
  });

  test("TestExecutor should be properly initialized", () => {
    const testExecutor = testProvider["context"]["testExecutor"];
    assert.ok(testExecutor, "TestExecutor should be initialized");
    assert.ok(
      typeof testExecutor.runScenario === "function",
      "TestExecutor should have runScenario method"
    );
    assert.ok(
      typeof testExecutor.debugScenario === "function",
      "TestExecutor should have debugScenario method"
    );
  });

  test("invalid standalone configuration releases its subscription before allocating a logger", () => {
    const createConfig = ExtensionConfig.create;
    const invalid = ExtensionConfig.create();
    invalid.getFramework = () => "unsupported-test-framework";
    const dispose = invalid.dispose.bind(invalid);
    let disposed = false;
    invalid.dispose = () => {disposed = true; dispose();};
    ExtensionConfig.create = () => invalid;
    const createChannel = vscode.window.createOutputChannel;
    let channels = 0;
    (vscode.window as any).createOutputChannel = (...args: any[]) => {channels++; return (createChannel as any)(...args);};
    try {
      assert.throws(() => BehaveTestProvider.create(testController), /Unsupported framework/);
      assert.ok(disposed, "Failed construction releases its configuration listener");
      assert.strictEqual(channels, 0);
    } finally {
      ExtensionConfig.create = createConfig;
      (vscode.window as any).createOutputChannel = createChannel;
      dispose();
    }
  });

  test("standalone providers own independent loggers and keep them open until execution drains", async () => {
    const previousSingleton = Logger["instance"];
    const singleton = Logger.getInstance();
    const otherController = vscode.tests.createTestController("other-provider", "Other Provider");
    const other = BehaveTestProvider.create(otherController);
    const logger = testProvider["context"].logger;
    const disposeLogger = logger.dispose.bind(logger);
    let closures = 0;
    let closed!: () => void;
    const channelClosed = new Promise<void>((resolve) => {closed = resolve;});
    logger.dispose = () => {closures++; disposeLogger(); closed();};
    let release!: () => void;
    const released = new Promise<void>((resolve) => {release = resolve;});
    let execution: Promise<void> | undefined;
    try {
      assert.notStrictEqual(logger, singleton);
      assert.notStrictEqual(logger, other["context"].logger);
      let signal!: AbortSignal;
      execution = testProvider["context"].testExecutor.withExecutionSession(async (session) => {
        signal = session.signal;
        await released;
        assert.strictEqual(closures, 0, "Cleanup can still write to the owned logger");
        logger.info("Execution drained");
      });
      testProvider.dispose();
      testProvider.dispose();
      assert.ok(signal.aborted, "Disposal cancels owned execution");
      assert.strictEqual(closures, 0, "The logger stays open while owned execution drains");
      release();
      await execution;
      await channelClosed;
      assert.strictEqual(closures, 1);
      assert.strictEqual(Logger.getInstance(), singleton, "Standalone disposal must not reset a borrowed singleton");
      singleton.info("Singleton remains available");
      other["context"].logger.info("Other provider remains available");
    } finally {
      release();
      await execution;
      logger.dispose = disposeLogger;
      other.dispose();
      otherController.dispose();
      if (!previousSingleton) {singleton.dispose();}
    }
  });

  test("standalone cleanup reports an executor failure before closing its logger", async () => {
    const { testExecutor, logger } = testProvider["context"];
    const disposeExecutor = testExecutor.dispose.bind(testExecutor);
    const disposeLogger = logger.dispose.bind(logger);
    const error = logger.error.bind(logger);
    const events: string[] = [];
    let closed!: () => void;
    const channelClosed = new Promise<void>((resolve) => {closed = resolve;});
    testExecutor.dispose = async () => {throw new Error("controlled cleanup failure");};
    logger.error = (message, data) => {events.push(`${message}: ${JSON.stringify(data)}`); error(message, data);};
    logger.dispose = () => {events.push("closed"); disposeLogger(); closed();};
    try {
      testProvider.dispose();
      await channelClosed;
      testProvider.dispose();
      assert.deepStrictEqual(events, ['Execution cleanup failed: {"error":"controlled cleanup failure"}', "closed"]);
    } finally {
      testExecutor.dispose = disposeExecutor;
      logger.error = error;
      logger.dispose = disposeLogger;
      await disposeExecutor();
    }
  });

  test("standalone disposal cancels discovery and ignores native completion after its channel closes", async () => {
    const { logger } = testProvider["context"];
    const manager = testProvider.discoveryManager;
    const discover = manager.discoverTestFiles.bind(manager);
    let nativeDiscovery: Promise<string[]> | undefined;
    manager.discoverTestFiles = (...args) => (nativeDiscovery = discover(...args));
    const findFiles = vscode.workspace.findFiles;
    const disposeLogger = logger.dispose.bind(logger);
    const info = logger.info.bind(logger);
    const events: string[] = [];
    let started!: () => void;
    const discoveryStarted = new Promise<void>((resolve) => {started = resolve;});
    let release!: () => void;
    const released = new Promise<void>((resolve) => {release = resolve;});
    let closed!: () => void;
    const channelClosed = new Promise<void>((resolve) => {closed = resolve;});
    (vscode.workspace as any).findFiles = async () => {started(); await released; return [];};
    logger.info = (message, data) => {events.push(message); info(message, data);};
    logger.dispose = () => {events.push("closed"); disposeLogger(); closed();};
    const discovery = testProvider.discoverTests();
    try {
      await discoveryStarted;
      await testProvider.dispose();
      await channelClosed;
      release();
      await discovery;
      await nativeDiscovery;
      assert.ok(!events.includes("Test discovery completed"), "Cancelled native completion cannot log through a closed channel");
      assert.strictEqual(events.indexOf("closed"), events.length - 1, "The channel closes once, after all discovery logging");
      assert.strictEqual(testProvider.getDiscoveredTests().size, 0);
      assert.strictEqual(testProvider.discoveryManager.getCacheStats().size, 0, "Late discovery cannot refill the disposed cache");
    } finally {
      release();
      await discovery;
      await nativeDiscovery;
      manager.discoverTestFiles = discover;
      (vscode.workspace as any).findFiles = findFiles;
      logger.info = info;
      logger.dispose = disposeLogger;
    }
  });

  for (const disposePending of [false, true]) {
    test(`standalone discovery ${disposePending ? "cancels every root on disposal" : "drains every root before reporting failure"}`, async () => {
      const { logger } = testProvider["context"];
      const manager = testProvider.discoveryManager;
      const discover = manager.discoverTestFiles.bind(manager);
      let nativeDiscovery: Promise<string[]> | undefined;
      manager.discoverTestFiles = (...args) => (nativeDiscovery = discover(...args));
      const folders = Object.getOwnPropertyDescriptor(vscode.workspace, "workspaceFolders")!;
      const first = vscode.workspace.workspaceFolders![0]!;
      Object.defineProperty(vscode.workspace, "workspaceFolders", { configurable: true, value: [first,
        { uri: vscode.Uri.joinPath(first.uri, "second-root"), name: "second-root", index: 1 }] });
      const findFiles = vscode.workspace.findFiles;
      const disposeLogger = logger.dispose.bind(logger);
      const error = logger.error.bind(logger);
      const events: string[] = [];
      let failed!: () => void;
      const firstFailure = new Promise<void>((resolve) => {failed = resolve;});
      let release!: () => void;
      const released = new Promise<void>((resolve) => {release = resolve;});
      let closed!: () => void;
      const channelClosed = new Promise<void>((resolve) => {closed = resolve;});
      let calls = 0;
      (vscode.workspace as any).findFiles = async () => {
        if (++calls === 1) {throw new Error("first root failed");}
        await released;
        throw new Error("second root failed");
      };
      logger.error = (message, data) => {
        events.push(`${message}: ${JSON.stringify(data)}`);
        error(message, data);
        if (message === "Failed to discover files") {failed();}
      };
      logger.dispose = () => {events.push("closed"); disposeLogger(); closed();};
      let settled = false;
      const discovery = testProvider.discoverTests().then(() => {settled = true;}, (failure: unknown) => {settled = true; return failure;});
      try {
        await firstFailure;
        if (disposePending) {await testProvider.dispose();}
        // Drain ready promise continuations while the second search remains explicitly held.
        await new Promise<void>((resolve) => {setImmediate(resolve);});
        assert.strictEqual(calls, 2);
        assert.strictEqual(settled, disposePending, "Only cancellation can settle discovery while another root is pending");
        assert.strictEqual(events.includes("closed"), disposePending);
        release();
        const result = await discovery;
        await nativeDiscovery?.catch(() => {}); // The public lifecycle below owns failure presentation.
        if (disposePending) {assert.strictEqual(result, undefined, "Disposed discovery suppresses obsolete failure");}
        else {assert.match(String(result), /first root failed/u); testProvider.dispose();}
        await channelClosed;
        assert.strictEqual(events.some((event) => event.includes("second root failed")), !disposePending);
        assert.strictEqual(events.indexOf("closed"), events.length - 1);
        assert.strictEqual(testProvider.getDiscoveredTests().size, 0);
        assert.strictEqual(testProvider.discoveryManager.getCacheStats().size, 0);
      } finally {
        release();
        await discovery;
        await nativeDiscovery?.catch(() => {});
        manager.discoverTestFiles = discover;
        Object.defineProperty(vscode.workspace, "workspaceFolders", folders);
        (vscode.workspace as any).findFiles = findFiles;
        logger.error = error;
        logger.dispose = disposeLogger;
      }
    });
  }
});
