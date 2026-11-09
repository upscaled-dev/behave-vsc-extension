import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { BehaveTestProvider } from "../../test-providers/behave-test-provider";
import { afterOutput } from "../output-channel";

type Activation = { testController: vscode.TestController; testProvider: BehaveTestProvider };

suite("Foundation lifecycle acceptance", () => {
  let extensionModule: typeof import("../../extension");
  let active: Activation;
  let context: vscode.ExtensionContext;
  let fixture: vscode.Uri;
  const config = vscode.workspace.getConfiguration("behaveTestRunner");
  const content = (name: string) => `Feature: Lifecycle fixture\n  @smoke\n  Scenario: ${name}\n    Given a populated workspace\n\n  Scenario Outline: Example scenario\n    Given <value>\n    Examples:\n      | value |\n      | first |\n`;

  function labels(): string[] {
    const result: string[] = [];
    const visit = (item: vscode.TestItem) => {
      result.push(item.label);
      item.children.forEach(visit);
    };
    active.testController.items.forEach(visit);
    return result;
  }

  async function afterProjection(predicate: () => boolean, action: () => Thenable<unknown>): Promise<void> {
    const builder = active.testProvider["treeBuilder"];
    const original = builder.discoverTests.bind(builder);
    let complete!: () => void;
    const completed = new Promise<void>((resolve) => {complete = resolve;});
    builder.discoverTests = async (...args) => {
      await original(...args);
      if (predicate()) {complete();}
    };
    try {
      await action();
      await completed;
      assert.ok(predicate());
    } finally {
      builder.discoverTests = original;
    }
  }

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension("upscaled-dev.behave-test-runner");
    assert.ok(extension, "The real extension must be installed in the native host");
    await extension.activate();
    extensionModule = require(path.join(extension.extensionPath, "dist/extension.js"));
    await extensionModule.deactivate();
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "An isolated populated workspace is required");
    fixture = vscode.Uri.joinPath(folder.uri, "lifecycle.feature");
    await vscode.workspace.fs.writeFile(fixture, Buffer.from(content("Discovered lifecycle scenario")));
    await config.update("autoDiscoverTests", false, vscode.ConfigurationTarget.Workspace);
    await config.update("autoDetectFramework", false, vscode.ConfigurationTarget.Workspace);
    context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    active = await extensionModule.activate(context) as Activation;
    assert.ok(active.testController);
    assert.ok(active.testProvider);
  });

  suiteTeardown(async () => {
    await extensionModule?.deactivate();
    for (const resource of context?.subscriptions ?? []) {resource.dispose();}
    await vscode.workspace.fs.delete(fixture);
    for (const setting of ["autoDiscoverTests", "autoDetectFramework", "testFilePattern", "framework"]) {
      await config.update(setting, undefined, vscode.ConfigurationTarget.Workspace);
    }
  });

  test("automatic discovery off stays empty until Discover returns the named parsed scenario", async () => {
    assert.strictEqual(active.testController.items.size, 0);
    await vscode.commands.executeCommand("behaveTestRunner.discoverTests");
    assert.ok(labels().includes("Discovered lifecycle scenario"));
    assert.ok(labels().some((label) => label.includes("Example scenario")));
  });

  test("all five grouping commands rebuild populated items and preserve an unsaved editor", async () => {
    const document = await vscode.workspace.openTextDocument(fixture);
    const editor = await vscode.window.showTextDocument(document);
    await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), "# unsaved user edit\n"));
    const dirtyText = document.getText();
    assert.ok(document.isDirty);
    // The previous force-refresh implementation invoked this command.
    await vscode.commands.executeCommand("workbench.action.files.revert");
    assert.strictEqual(document.isDirty, false);
    assert.notStrictEqual(document.getText(), dirtyText, "The former refresh command discards the unsaved edit");
    await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), "# unsaved user edit\n"));
    assert.strictEqual(document.getText(), dirtyText);
    const showError = vscode.window.showErrorMessage;
    const errors: string[] = [];
    try {
      (vscode.window as any).showErrorMessage = (message: string) => {errors.push(message); return Promise.resolve(undefined);};
      for (const [strategy, rootLabel] of [
        ["TagBased", "@smoke"], ["FileBased", "lifecycle.feature"], ["ScenarioType", "Regular Scenarios"],
        ["Flat", "All Scenarios"], ["FeatureBased", "Lifecycle fixture"],
      ]) {
        await vscode.commands.executeCommand(`behaveTestRunner.set${strategy}Organization`);
        assert.deepStrictEqual(errors, [], `${strategy} must not report a grouping error`);
        assert.strictEqual(active.testProvider.getOrganizationStrategy().strategyType, `${strategy}Organization`);
        assert.ok(Array.from(active.testController.items).some(([, item]) => item.label === rootLabel), strategy);
        assert.ok(labels().includes("Discovered lifecycle scenario"), strategy);
        assert.ok(labels().some((label) => label.includes("Example scenario")), strategy);
        assert.strictEqual(document.getText(), dirtyText);
        assert.ok(document.isDirty);
      }
    } finally {(vscode.window as any).showErrorMessage = showError;}
    await document.save();
  });

  test("real watcher create, change, and delete retain all five grouping projections", async () => {
    const roots = [
      ["TagBased", "@smoke"], ["FileBased", "watcher.feature"],
      ["ScenarioType", "Regular Scenarios"], ["Flat", "All Scenarios"],
      ["FeatureBased", "Lifecycle fixture"],
    ];
    for (const [strategy, rootLabel] of roots) {
      await vscode.commands.executeCommand(`behaveTestRunner.set${strategy}Organization`);
      const created = vscode.Uri.joinPath(fixture, "..", "watcher.feature");
      await afterProjection(() => labels().includes("Watcher created scenario"),
        () => vscode.workspace.fs.writeFile(created, Buffer.from(content("Watcher created scenario"))));
      const root = Array.from(active.testController.items).map(([, item]) => item)
        .find((item) => item.label === rootLabel && Array.from(item.children).some(([, child]) => child.label === "Watcher created scenario"));
      assert.ok(root, `${strategy} keeps the new scenario in ${rootLabel}`);
      await afterProjection(() => labels().includes("Watcher changed scenario") && !labels().includes("Watcher created scenario"),
        () => vscode.workspace.fs.writeFile(created, Buffer.from(content("Watcher changed scenario"))));
      await afterProjection(() => !labels().includes("Watcher changed scenario"),
        () => vscode.workspace.fs.delete(created));
    }
  });

  test("pattern changes rebind the watcher and rebuild using the new pattern", async () => {
    await afterProjection(() => !labels().includes("Discovered lifecycle scenario"),
      () => config.update("testFilePattern", "**/*.acceptance", vscode.ConfigurationTarget.Workspace));
    const created = vscode.Uri.joinPath(fixture, "..", "watcher.acceptance");
    await afterProjection(() => labels().includes("New pattern scenario"),
      () => vscode.workspace.fs.writeFile(created, Buffer.from(content("New pattern scenario"))));
    await afterProjection(() => !labels().includes("New pattern scenario"), () => vscode.workspace.fs.delete(created));
    await afterProjection(() => labels().includes("Discovered lifecycle scenario"),
      () => config.update("testFilePattern", undefined, vscode.ConfigurationTarget.Workspace));
  });

  test("unrelated settings do not scan and enabling automatic discovery requests a rebuild", async () => {
    const manager = active.testProvider.discoveryManager;
    const original = manager.discoverTestFiles.bind(manager);
    let scans = 0;
    manager.discoverTestFiles = async (...args) => {scans++; return original(...args);};
    const changed = new Promise<void>((resolve) => {
      const registration = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("behaveTestRunner.tags")) {registration.dispose(); resolve();}
      });
    });
    try {
      await Promise.all([changed, config.update("tags", "@unrelated", vscode.ConfigurationTarget.Workspace)]);
      assert.strictEqual(scans, 0);
      await afterProjection(() => labels().includes("Discovered lifecycle scenario"),
        () => config.update("autoDiscoverTests", true, vscode.ConfigurationTarget.Workspace));
      assert.strictEqual(scans, 1);
      await config.update("autoDiscoverTests", false, vscode.ConfigurationTarget.Workspace);
    } finally {
      manager.discoverTestFiles = original;
      await config.update("tags", undefined, vscode.ConfigurationTarget.Workspace);
    }
  });

  test("failed manual discovery and grouping preserve the last tree, report failure, and allow retry", async () => {
    const manager = active.testProvider.discoveryManager;
    const discover = manager.discoverTestFiles.bind(manager);
    const previousLabels = labels();
    const previousStrategy = active.testProvider.getOrganizationStrategy();
    const showInformation = vscode.window.showInformationMessage;
    const showError = vscode.window.showErrorMessage;
    const information: string[] = [];
    const errors: string[] = [];
    (vscode.window as any).showInformationMessage = (message: string) => {information.push(message); return Promise.resolve(undefined);};
    (vscode.window as any).showErrorMessage = (message: string) => {errors.push(message); return Promise.resolve(undefined);};
    try {
      manager.discoverTestFiles = async () => {throw new Error("controlled discovery failure");};
      await assert.rejects(active.testProvider.discoverTests(), /controlled discovery failure/);
      assert.deepStrictEqual(labels(), previousLabels);
      await vscode.commands.executeCommand("behaveTestRunner.setFileBasedOrganization");
      assert.deepStrictEqual(labels(), previousLabels);
      assert.strictEqual(active.testProvider.getOrganizationStrategy(), previousStrategy, "Failed grouping keeps the strategy matching the rendered tree");
      assert.ok(errors.some((message) => message.includes("Failed to change organization strategy") && message.includes("controlled discovery failure")));
      assert.ok(!information.some((message) => message.includes("Organization strategy changed")));
      manager.discoverTestFiles = discover;
      await vscode.commands.executeCommand("behaveTestRunner.setFileBasedOrganization");
      assert.ok(labels().includes("Discovered lifecycle scenario"));
      assert.ok(Array.from(active.testController.items).some(([, item]) => item.label === "lifecycle.feature"));
      assert.ok(information.some((message) => message.includes("Organization strategy changed")));
    } finally {
      manager.discoverTestFiles = discover;
      (vscode.window as any).showInformationMessage = showInformation;
      (vscode.window as any).showErrorMessage = showError;
    }
  });

  test("overlapping failed grouping changes restore the last rendered strategy and a retry commits", async () => {
    await vscode.commands.executeCommand("behaveTestRunner.setFeatureBasedOrganization");
    const originalStrategy = active.testProvider.getOrganizationStrategy();
    const previousLabels = labels();
    const organization = active.testProvider.organizationManager;
    const manager = active.testProvider.discoveryManager;
    const discover = manager.discoverTestFiles.bind(manager);
    const setStrategy = organization.setStrategy.bind(organization);
    const showError = vscode.window.showErrorMessage;
    const showInformation = vscode.window.showInformationMessage;
    const errors: string[] = [];
    const information: string[] = [];
    let started!: () => void;
    const discoveryStarted = new Promise<void>((resolve) => {started = resolve;});
    let release!: () => void;
    const released = new Promise<void>((resolve) => {release = resolve;});
    let latestStarted!: () => void;
    const latest = new Promise<void>((resolve) => {latestStarted = resolve;});
    try {
      (vscode.window as any).showErrorMessage = (message: string) => {errors.push(message); return Promise.resolve(undefined);};
      (vscode.window as any).showInformationMessage = (message: string) => {information.push(message); return Promise.resolve(undefined);};
      manager.discoverTestFiles = async () => {started(); await released; throw new Error("concurrent grouping failure");};
      organization.setStrategy = (strategy) => {
        setStrategy(strategy);
        if (strategy.strategyType === "FlatOrganization") {latestStarted();}
      };
      const file = vscode.commands.executeCommand("behaveTestRunner.setFileBasedOrganization");
      await discoveryStarted;
      const flat = vscode.commands.executeCommand("behaveTestRunner.setFlatOrganization");
      await latest;
      release();
      await Promise.all([file, flat]);
      assert.strictEqual(active.testProvider.getOrganizationStrategy(), originalStrategy);
      assert.deepStrictEqual(labels(), previousLabels);
      assert.deepStrictEqual(errors, ["Failed to change organization strategy: concurrent grouping failure"]);
      assert.deepStrictEqual(information, [], "Failed grouping must not report success");
      manager.discoverTestFiles = discover;
      await vscode.commands.executeCommand("behaveTestRunner.setFlatOrganization");
      assert.strictEqual(active.testProvider.getOrganizationStrategy().strategyType, "FlatOrganization");
      assert.ok(Array.from(active.testController.items).some(([, item]) => item.label === "All Scenarios"));
      assert.ok(labels().includes("Discovered lifecycle scenario"));
      assert.strictEqual(errors.length, 1, "A successful retry must not report another error");
      assert.deepStrictEqual(information, ["Organization strategy changed to: Flat"]);
    } finally {
      release();
      manager.discoverTestFiles = discover;
      organization.setStrategy = setStrategy;
      (vscode.window as any).showErrorMessage = showError;
      (vscode.window as any).showInformationMessage = showInformation;
    }
  });

  for (const outcome of ["success", "failure"]) {
    test(`deactivation invalidates pending grouping ${outcome} and permits a fresh retry`, async () => {
      const oldProvider = active.testProvider;
      const manager = oldProvider.discoveryManager;
      const discover = manager.discoverTestFiles.bind(manager);
      const files = await discover();
      const showInformation = vscode.window.showInformationMessage;
      const showError = vscode.window.showErrorMessage;
      const notifications: string[] = [];
      let started!: () => void;
      const discoveryStarted = new Promise<void>((resolve) => {started = resolve;});
      let release!: () => void;
      const released = new Promise<void>((resolve) => {release = resolve;});
      let command: Thenable<unknown> | undefined;
      try {
        (vscode.window as any).showInformationMessage = (message: string) => {notifications.push(message); return Promise.resolve(undefined);};
        (vscode.window as any).showErrorMessage = (message: string) => {notifications.push(message); return Promise.resolve(undefined);};
        manager.discoverTestFiles = async () => {
          started();
          await released;
          if (outcome === "failure") {throw new Error("discovery completed after disposal");}
          return files;
        };
        command = vscode.commands.executeCommand("behaveTestRunner.setFileBasedOrganization");
        await discoveryStarted;
        const pendingStrategy = oldProvider.getOrganizationStrategy();
        await extensionModule.deactivate();
        release();
        await command;
        assert.deepStrictEqual(notifications, [], "Disposed grouping must not publish late success or failure");
        assert.strictEqual(oldProvider.getDiscoveredTests().size, 0, "Disposed discovery cannot repopulate the tree");
        assert.strictEqual(oldProvider.getOrganizationStrategy(), pendingStrategy, "Disposed grouping must not roll back state");
      } finally {
        release();
        await command;
        manager.discoverTestFiles = discover;
        (vscode.window as any).showInformationMessage = showInformation;
        (vscode.window as any).showErrorMessage = showError;
        await extensionModule.deactivate();
        context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
        active = await extensionModule.activate(context) as Activation;
      }
      await vscode.commands.executeCommand("behaveTestRunner.setFileBasedOrganization");
      assert.ok(labels().includes("Discovered lifecycle scenario"));
      assert.ok(Array.from(active.testController.items).some(([, item]) => item.label === "lifecycle.feature"));
    });
  }

  for (const phase of ["search", "read"]) {
    for (const outcome of ["success", "failure"]) {
      test(`shutdown cancels a pending ${phase} and ignores late ${outcome} before a populated retry`, async () => {
        const provider = active.testProvider;
        const logger = provider["context"].logger;
        const channel = logger["outputChannel"];
        const append = channel.appendLine.bind(channel);
        const dispose = logger.dispose.bind(logger);
        const builder = provider["treeBuilder"];
        const discover = builder.discoverTests.bind(builder);
        const findFiles = vscode.workspace.findFiles;
        const readFile = vscode.workspace.fs.readFile;
        const filesystem = Object.getOwnPropertyDescriptor(vscode.workspace, "fs")!;
        const contents = await readFile(fixture);
        const showInformation = vscode.window.showInformationMessage;
        const showError = vscode.window.showErrorMessage;
        const notifications: string[] = [];
        const lateLogs: string[] = [];
        let closures = 0;
        let token: vscode.CancellationToken | undefined;
        let started!: () => void;
        const blocked = new Promise<void>((resolve) => {started = resolve;});
        let release!: () => void;
        const released = new Promise<void>((resolve) => {release = resolve;});
        let finished!: () => void;
        const underlyingFinished = new Promise<void>((resolve) => {finished = resolve;});
        let settled = false;
        let refresh: Promise<void> | undefined;
        try {
          channel.appendLine = (line) => {if (closures) {lateLogs.push(line);} else {append(line);}};
          logger.dispose = () => {closures++; dispose();};
          (vscode.window as any).showInformationMessage = (message: string) => {notifications.push(message); return Promise.resolve(undefined);};
          (vscode.window as any).showErrorMessage = (message: string) => {notifications.push(message); return Promise.resolve(undefined);};
          builder.discoverTests = async (...args) => {try {await discover(...args);} finally {finished();}};
          if (phase === "search") {
            vscode.workspace.findFiles = async (_include, _exclude, _maximum, cancellation) => {
              token = cancellation;
              started();
              await released; // Deliberately ignores cancellation, like an unresponsive filesystem.
              if (outcome === "failure") {throw new Error("late native search failure");}
              return [fixture];
            };
          } else {
            Object.defineProperty(vscode.workspace, "fs", { configurable: true, value: { ...vscode.workspace.fs, readFile: async (uri: vscode.Uri) => {
              if (uri.toString() !== fixture.toString()) {return readFile(uri);}
              started();
              await released;
              if (outcome === "failure") {throw new Error("late native read failure");}
              return contents;
            } } });
          }
          refresh = provider.refreshTests().then(() => {settled = true;});
          await blocked;
          await extensionModule.deactivate();
          assert.strictEqual(settled, true, "Shutdown must settle discovery without waiting for the held native request");
          assert.strictEqual(closures, 1);
          if (phase === "search") {assert.ok(token?.isCancellationRequested, "Native search receives cancellation");}
          release();
          await underlyingFinished;
          assert.deepStrictEqual(lateLogs, [], "Late filesystem completion cannot use the closed logger");
          assert.deepStrictEqual(notifications, []);
          assert.strictEqual(provider.getDiscoveredTests().size, 0);
          assert.strictEqual(provider.discoveryManager.getCacheStats().size, 0);
        } finally {
          release();
          if (refresh) {await underlyingFinished; await refresh;}
          vscode.workspace.findFiles = findFiles;
          Object.defineProperty(vscode.workspace, "fs", filesystem);
          builder.discoverTests = discover;
          channel.appendLine = append;
          logger.dispose = dispose;
          (vscode.window as any).showInformationMessage = showInformation;
          (vscode.window as any).showErrorMessage = showError;
          await extensionModule.deactivate();
          context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
          active = await extensionModule.activate(context) as Activation;
        }
        await vscode.commands.executeCommand("behaveTestRunner.discoverTests");
        assert.ok(labels().includes("Discovered lifecycle scenario"));
      });
    }
  }

  test("shutdown invalidates grouping immediately while execution still drains", async () => {
    const provider = active.testProvider;
    const { logger, testExecutor } = provider["context"];
    const disposeLogger = logger.dispose.bind(logger);
    const manager = provider.discoveryManager;
    const discover = manager.discoverTestFiles.bind(manager);
    const showInformation = vscode.window.showInformationMessage;
    const showError = vscode.window.showErrorMessage;
    const notifications: string[] = [];
    let closures = 0;
    let releaseExecution!: () => void;
    const executionGate = new Promise<void>((resolve) => {releaseExecution = resolve;});
    let signal!: AbortSignal;
    const execution = testExecutor.withExecutionSession(async (session) => {signal = session.signal; await executionGate;});
    let started!: () => void;
    const discoveryStarted = new Promise<void>((resolve) => {started = resolve;});
    let releaseDiscovery!: () => void;
    const discoveryGate = new Promise<void>((resolve) => {releaseDiscovery = resolve;});
    let shutdown: Promise<void> | undefined;
    let command: Thenable<unknown> | undefined;
    try {
      logger.dispose = () => {closures++; disposeLogger();};
      (vscode.window as any).showInformationMessage = (message: string) => {notifications.push(message); return Promise.resolve(undefined);};
      (vscode.window as any).showErrorMessage = (message: string) => {notifications.push(message); return Promise.resolve(undefined);};
      manager.discoverTestFiles = async () => {started(); await discoveryGate; return [];};
      command = vscode.commands.executeCommand("behaveTestRunner.setFileBasedOrganization");
      await discoveryStarted;
      shutdown = extensionModule.deactivate();
      assert.ok(signal.aborted);
      assert.ok(provider["disposed"], "Discovery and its commits are invalidated before execution drains");
      await command;
      assert.deepStrictEqual(notifications, []);
      assert.strictEqual(closures, 0, "Execution cleanup still owns a live logger");
      releaseExecution();
      await execution;
      await shutdown;
      assert.strictEqual(closures, 1);
    } finally {
      releaseExecution(); releaseDiscovery();
      await execution;
      await shutdown;
      await command;
      manager.discoverTestFiles = discover;
      logger.dispose = disposeLogger;
      (vscode.window as any).showInformationMessage = showInformation;
      (vscode.window as any).showErrorMessage = showError;
      await extensionModule.deactivate();
      context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
      active = await extensionModule.activate(context) as Activation;
    }
    await active.testProvider.discoverTests();
    assert.ok(labels().includes("Discovered lifecycle scenario"));
  });

  test("shutdown during initial discovery cancels activation and permits a populated restart", async () => {
    await extensionModule.deactivate();
    await config.update("autoDiscoverTests", true, vscode.ConfigurationTarget.Workspace);
    const findFiles = vscode.workspace.findFiles;
    const showError = vscode.window.showErrorMessage;
    const errors: string[] = [];
    let token: vscode.CancellationToken | undefined;
    let started!: () => void;
    const discoveryStarted = new Promise<void>((resolve) => {started = resolve;});
    let release!: () => void;
    const released = new Promise<void>((resolve) => {release = resolve;});
    let rejected: Promise<void> | undefined;
    try {
      vscode.workspace.findFiles = async (_include, _exclude, _maximum, cancellation) => {
        token = cancellation; started(); await released; throw new Error("late initial discovery failure");
      };
      (vscode.window as any).showErrorMessage = (message: string) => {errors.push(message); return Promise.resolve(undefined);};
      context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
      rejected = assert.rejects(extensionModule.activate(context), /Extension activation was disposed/u);
      await discoveryStarted;
      await extensionModule.deactivate();
      await rejected;
      assert.ok(token?.isCancellationRequested);
      release();
      await new Promise<void>((resolve) => {setImmediate(resolve);});
      assert.deepStrictEqual(errors, [], "A cancelled startup must not report a discovery error");
    } finally {
      release();
      await rejected;
      vscode.workspace.findFiles = findFiles;
      (vscode.window as any).showErrorMessage = showError;
      await extensionModule.deactivate();
      context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
      active = await extensionModule.activate(context) as Activation;
      await config.update("autoDiscoverTests", false, vscode.ConfigurationTarget.Workspace);
    }
    assert.ok(labels().includes("Discovered lifecycle scenario"));
  });

  test("an injected provider leaves its logger alive until activation disposes it once", async () => {
    const logger = active.testProvider["context"].logger;
    const dispose = logger.dispose.bind(logger);
    let disposed = 0;
    logger.dispose = () => {disposed++; dispose();};
    try {
      active.testProvider.dispose();
      active.testProvider.dispose();
      assert.strictEqual(disposed, 0);
      logger.info("Activation retains ownership after provider disposal");
      await extensionModule.deactivate();
      await extensionModule.deactivate();
      assert.strictEqual(disposed, 1);
    } finally {
      logger.dispose = dispose;
      await extensionModule.deactivate();
      context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
      active = await extensionModule.activate(context) as Activation;
    }
    await active.testProvider.discoverTests();
    assert.ok(labels().includes("Discovered lifecycle scenario"));
  });

  test("automatic startup and an overlapping native resolve share exactly one discovery", async () => {
    await extensionModule.deactivate();
    await config.update("autoDiscoverTests", true, vscode.ConfigurationTarget.Workspace);
    const createController = vscode.tests.createTestController;
    const findFiles = vscode.workspace.findFiles;
    let controller: vscode.TestController | undefined;
    let scans = 0;
    (vscode.tests as any).createTestController = (...args: any[]) => {
      controller = (createController as any)(...args);
      return controller;
    };
    (vscode.workspace as any).findFiles = (...args: any[]) => {scans++; return (findFiles as any)(...args);};
    try {
      context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
      const activating = extensionModule.activate(context);
      assert.ok(controller?.resolveHandler);
      const resolving = controller.resolveHandler(undefined);
      active = await activating as Activation;
      await resolving;
      assert.strictEqual(scans, 1);
      assert.ok(labels().includes("Discovered lifecycle scenario"));
    } finally {
      (vscode.tests as any).createTestController = createController;
      (vscode.workspace as any).findFiles = findFiles;
      await config.update("autoDiscoverTests", false, vscode.ConfigurationTarget.Workspace);
    }
  });

  test("partial activation failure cleans up and permits a fresh activation", async () => {
    await extensionModule.deactivate();
    await config.update("framework", "unsupported-test-framework", vscode.ConfigurationTarget.Workspace);
    const failedContext = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    const createOutputChannel = vscode.window.createOutputChannel;
    let outputChannels = 0;
    (vscode.window as any).createOutputChannel = (...args: any[]) => {outputChannels++; return (createOutputChannel as any)(...args);};
    try {
      await assert.rejects(extensionModule.activate(failedContext), /Unsupported framework/);
      assert.strictEqual(outputChannels, 0, "Invalid framework is rejected before allocating an output channel");
    } finally {
      (vscode.window as any).createOutputChannel = createOutputChannel;
    }
    await config.update("framework", "behave", vscode.ConfigurationTarget.Workspace);
    context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    active = await extensionModule.activate(context) as Activation;
    for (const stale of failedContext.subscriptions) {stale.dispose();}
    await vscode.commands.executeCommand("behaveTestRunner.discoverTests");
    assert.ok(labels().includes("Discovered lifecycle scenario"));
  });

  test("deactivation releases registrations and supports a fresh populated activation", async () => {
    const oldProvider = active.testProvider;
    await extensionModule.deactivate();
    await extensionModule.deactivate();
    assert.strictEqual(oldProvider["disposed"], true);
    context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    active = await extensionModule.activate(context) as Activation;
    assert.notStrictEqual(active.testProvider, oldProvider);
    assert.strictEqual(active.testController.items.size, 0);
    const logger = active.testProvider["context"].logger;
    const output = await afterOutput(logger["outputChannel"], (text) => text.includes("Test discovery completed") && /"fileCount": [1-9]/u.test(text), async () => {
      logger.showOutput();
      await active.testController.resolveHandler?.(undefined);
    });
    assert.ok(labels().includes("Discovered lifecycle scenario"));
    assert.ok(output.includes("Test discovery completed"), "The fresh activation's populated discovery reaches native output");
  });
});
