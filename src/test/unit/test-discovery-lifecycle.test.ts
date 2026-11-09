import * as assert from "assert";
import * as vscode from "vscode";
import { TestDiscoveryLifecycle } from "../../test-providers/test-discovery-lifecycle";
import { ExtensionConfig } from "../../core/extension-config";
import { BehaveTestProvider } from "../../test-providers/behave-test-provider";
import { createCheckedOutputChannel } from "../output-channel";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {resolve = done;});
  return { promise, resolve };
}

suite("Discovery lifecycle controlled completion", () => {
  let createOutputChannel: typeof vscode.window.createOutputChannel;
  setup(() => {
    createOutputChannel = vscode.window.createOutputChannel;
    vscode.window.createOutputChannel = createCheckedOutputChannel as typeof vscode.window.createOutputChannel;
  });
  teardown(() => {vscode.window.createOutputChannel = createOutputChannel;});

  test("disposal before a queued pass starts does not call discovery", async () => {
    let calls = 0;
    const lifecycle = new TestDiscoveryLifecycle(async () => {calls++;});
    const pending = lifecycle.refresh();
    await lifecycle.dispose();
    await pending;
    assert.strictEqual(calls, 0);
  });

  test("completed and failed discovery passes release their cancellation listeners", async () => {
    let calls = 0;
    let listeners = 0;
    const lifecycle = new TestDiscoveryLifecycle(async () => {
      assert.strictEqual(listeners, 1, "Only the current pass retains a cancellation listener");
      if (++calls === 2) {throw new Error("controlled discovery failure");}
    });
    const token = lifecycle["cancellation"].token;
    const register = token.onCancellationRequested;
    Object.defineProperty(token, "onCancellationRequested", { value: (listener: () => void) => {
      listeners++;
      const subscription = register(listener);
      return new vscode.Disposable(() => {listeners--; subscription.dispose();});
    } });
    try {
      await lifecycle.refresh();
      assert.strictEqual(listeners, 0);
      await assert.rejects(lifecycle.refresh(), /controlled discovery failure/u);
      assert.strictEqual(listeners, 0);
      await lifecycle.refresh();
      assert.strictEqual(listeners, 0);
    } finally {await lifecycle.dispose();}
  });

  test("overlapping discovery requests join the same pass", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    let calls = 0;
    const lifecycle = new TestDiscoveryLifecycle(async () => {
      calls++;
      started.resolve();
      await release.promise;
    });
    const first = lifecycle.refresh();
    await started.promise;
    assert.strictEqual(lifecycle.refresh(), first);
    assert.strictEqual(lifecycle.refresh(), first);
    release.resolve();
    await first;
    assert.strictEqual(calls, 1);
    lifecycle.dispose();
  });

  test("coalesces queued refreshes, discards the stale pass, and settles after the latest commit", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const commits: number[] = [];
    let calls = 0;
    const lifecycle = new TestDiscoveryLifecycle(async (isCurrent) => {
      const call = ++calls;
      if (call === 1) {started.resolve(); await release.promise;}
      if (isCurrent()) {commits.push(call);}
    });
    const first = lifecycle.refresh();
    await started.promise;
    const second = lifecycle.invalidate();
    const third = lifecycle.invalidate();
    assert.strictEqual(second, first);
    assert.strictEqual(third, first);
    release.resolve();
    await first;
    assert.strictEqual(calls, 2);
    assert.deepStrictEqual(commits, [2]);
    lifecycle.dispose();
  });

  test("disposing during pending discovery revokes its commit and ignores late invalidation", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    let commits = 0;
    let calls = 0;
    const lifecycle = new TestDiscoveryLifecycle(async (isCurrent) => {
      calls++;
      started.resolve();
      await release.promise;
      if (isCurrent()) {commits++;}
    });
    const pending = lifecycle.refresh();
    await started.promise;
    lifecycle.dispose();
    release.resolve();
    await pending;
    await lifecycle.invalidate();
    await lifecycle.refresh();
    assert.strictEqual(commits, 0);
    assert.strictEqual(calls, 1);
  });

  test("invalidation is lazy until explicit discovery and failed passes allow retry", async () => {
    let calls = 0;
    const lifecycle = new TestDiscoveryLifecycle(async () => {
      calls++;
      if (calls === 1) {throw new Error("discovery failed");}
    });
    await lifecycle.invalidate();
    assert.strictEqual(calls, 0);
    await assert.rejects(lifecycle.refresh(), /discovery failed/);
    await lifecycle.refresh();
    assert.strictEqual(calls, 2);
    lifecycle.dispose();
  });

  test("config disposal detaches listeners and does not retire a different singleton", () => {
    const singleton = ExtensionConfig.getInstance();
    const config = ExtensionConfig.create();
    let calls = 0;
    const registration = config.addChangeListener(() => {calls++;});
    config.reload();
    assert.strictEqual(calls, 1);
    registration.dispose();
    config.reload();
    assert.strictEqual(calls, 1);
    const subscription = config["configurationSubscription"]!;
    const disposeSubscription = subscription.dispose.bind(subscription);
    let disposed = 0;
    subscription.dispose = () => {disposed++; disposeSubscription();};
    config.dispose();
    config.dispose();
    assert.strictEqual(disposed, 1);
    assert.strictEqual(config["configurationSubscription"] !== undefined, true);
    assert.strictEqual(config["changeListeners"].length, 0);
    assert.strictEqual(ExtensionConfig.getInstance(), singleton);
  });

  test("the real tree builder cannot mutate a caller's controller after pending discovery is disposed", async () => {
    const controller = vscode.tests.createTestController("foundation-pending", "Foundation pending");
    const provider = BehaveTestProvider.create(controller);
    const started = deferred<void>();
    const release = deferred<string[]>();
    provider.discoveryManager.discoverTestFiles = () => {started.resolve(); return release.promise;};
    const pending = provider.discoverTests();
    await started.promise;
    provider.dispose();
    release.resolve([]);
    await pending;
    assert.strictEqual(controller.items.size, 0);
    controller.items.add(controller.createTestItem("retained", "Caller still owns controller"));
    assert.ok(controller.items.get("retained"));
    controller.dispose();
  });

  test("an injected context is borrowed while a default context is released by its owner", () => {
    const ownerController = vscode.tests.createTestController("foundation-owner", "Foundation owner");
    const owner = BehaveTestProvider.create(ownerController);
    const context = owner["context"];
    const borrowedController = vscode.tests.createTestController("foundation-borrowed", "Foundation borrowed");
    const borrower = BehaveTestProvider.create(borrowedController, context);
    let disposals = 0;
    const original = context.config.dispose.bind(context.config);
    context.config.dispose = () => {disposals++; original();};
    borrower.dispose();
    assert.strictEqual(disposals, 0);
    assert.strictEqual(context.config["disposed"], false);
    owner.dispose();
    assert.strictEqual(disposals, 1);
    assert.strictEqual(context.config["disposed"], true);
    borrowedController.dispose();
    ownerController.dispose();
  });

  test("retired watcher callbacks are ignored and a failed event burst reports once", async () => {
    const createWatcher = vscode.workspace.createFileSystemWatcher;
    const showError = vscode.window.showErrorMessage;
    const creates: Array<() => void> = [];
    let reports = 0;
    const reported = deferred<void>();
    (vscode.workspace as any).createFileSystemWatcher = () => ({
      onDidCreate: (callback: () => void) => {creates.push(callback);},
      onDidChange: () => {}, onDidDelete: () => {}, dispose: () => {},
    });
    (vscode.window as any).showErrorMessage = () => {reports++; reported.resolve(); return Promise.resolve(undefined);};
    const controller = vscode.tests.createTestController("foundation-watcher-burst", "Foundation watcher burst");
    const provider = BehaveTestProvider.create(controller);
    const folder = vscode.workspace.workspaceFolders![0]!;
    const resource = vscode.workspace.getConfiguration("behaveTestRunner", folder.uri);
    const previousPattern = resource.inspect("testFilePattern")?.workspaceFolderValue;
    try {
      let calls = 0;
      provider.discoveryManager.discoverTestFiles = async () => {calls++; return [];};
      await provider.discoverTests();
      const oldCreate = creates[0]!;
      const pattern = "**/*.retired";
      const changed = new Promise<void>((resolve) => {
        const registration = vscode.workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration("behaveTestRunner.testFilePattern", folder.uri)) {registration.dispose(); resolve();}
        });
      });
      await Promise.all([changed, resource.update("testFilePattern", pattern, vscode.ConfigurationTarget.WorkspaceFolder)]);
      await provider.discoverTests();
      calls = 0;
      oldCreate();
      await Promise.resolve();
      assert.strictEqual(calls, 0, "A retired watcher cannot trigger another scan");
      const started = deferred<void>();
      const release = deferred<void>();
      provider.discoveryManager.discoverTestFiles = async () => {
        calls++;
        started.resolve();
        await release.promise;
        throw new Error("controlled watcher failure");
      };
      const create = creates[creates.length - 1]!;
      create();
      await started.promise;
      for (let event = 0; event < 5; event++) {create();}
      release.resolve();
      await reported.promise;
      assert.strictEqual(calls, 2, "An active invalidation burst needs at most one trailing pass");
      assert.strictEqual(reports, 1, "One shared failed refresh produces one actionable error");
    } finally {
      provider.dispose();
      controller.dispose();
      (vscode.workspace as any).createFileSystemWatcher = createWatcher;
      (vscode.window as any).showErrorMessage = showError;
      await resource.update("testFilePattern", previousPattern, vscode.ConfigurationTarget.WorkspaceFolder);
    }
  });

  test("provider disposal releases profiles and watcher once while its caller retains the controller", () => {
    const controller = vscode.tests.createTestController("foundation-disposal", "Foundation disposal");
    const provider = BehaveTestProvider.create(controller);
    const watcher = provider["fileWatchers"][0]!;
    const original = watcher.dispose.bind(watcher);
    let disposed = 0;
    watcher.dispose = () => {disposed++; original();};
    provider.dispose();
    provider.dispose();
    assert.strictEqual(disposed, 1);
    assert.strictEqual(controller.resolveHandler, undefined);
    controller.items.add(controller.createTestItem("caller-owned", "Controller remains usable"));
    assert.ok(controller.items.get("caller-owned"));
    controller.dispose();
  });
});
