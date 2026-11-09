import * as assert from "assert";
import * as vscode from "vscode";
import { afterOutput } from "../output-channel";

suite("Output channel observation Unit Tests", () => {
  const opened = new Set<(document: vscode.TextDocument) => void>();
  const changed = new Set<(event: vscode.TextDocumentChangeEvent) => void>();
  const timers = new Map<number, () => void>();
  let open: typeof vscode.workspace.onDidOpenTextDocument;
  let change: typeof vscode.workspace.onDidChangeTextDocument;
  let schedule: typeof setTimeout;
  let cancel: typeof clearTimeout;
  let markers: string[];
  let channel: vscode.OutputChannel;

  function document(uri: string, text: string): vscode.TextDocument {
    return { uri: vscode.Uri.parse(uri), version: 1, getText: () => text } as unknown as vscode.TextDocument;
  }

  function emitOpen(uri: string, text: string): void {
    for (const listener of opened) {listener(document(uri, text));}
  }

  function emitChange(uri: string, text: string): void {
    for (const listener of changed) {listener({ document: document(uri, text) } as vscode.TextDocumentChangeEvent);}
  }

  function released(): void {
    assert.strictEqual(opened.size, 0);
    assert.strictEqual(changed.size, 0);
    assert.strictEqual(timers.size, 0);
  }

  setup(() => {
    markers = [];
    channel = { name: "Expected fixture output", appendLine: (text: string) => {markers.push(text);} } as vscode.OutputChannel;
    open = vscode.workspace.onDidOpenTextDocument;
    change = vscode.workspace.onDidChangeTextDocument;
    schedule = globalThis.setTimeout;
    cancel = globalThis.clearTimeout;
    (vscode.workspace as any).onDidOpenTextDocument = (listener: (value: vscode.TextDocument) => void) => {
      opened.add(listener);
      return { dispose: () => opened.delete(listener) };
    };
    (vscode.workspace as any).onDidChangeTextDocument = (listener: (value: vscode.TextDocumentChangeEvent) => void) => {
      changed.add(listener);
      return { dispose: () => changed.delete(listener) };
    };
    let next = 0;
    globalThis.setTimeout = ((callback: () => void) => {
      const id = ++next;
      timers.set(id, callback);
      return id;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((id: number) => {timers.delete(id);}) as unknown as typeof clearTimeout;
  });

  teardown(() => {
    (vscode.workspace as any).onDidOpenTextDocument = open;
    (vscode.workspace as any).onDidChangeTextDocument = change;
    globalThis.setTimeout = schedule;
    globalThis.clearTimeout = cancel;
    opened.clear(); changed.clear(); timers.clear();
  });

  test("newly opened target cannot satisfy observation with matching text before its operation boundary", async () => {
    let matches = 0;
    const text = await afterOutput(channel, (value) => {
      if (!value.includes("named scenario passed")) {return false;}
      matches++;
      return true;
    }, () => {
      assert.strictEqual(markers.length, 1, "Boundary is written to the expected channel before the action");
      emitOpen("output:expected", "named scenario passed\n");
      emitChange("output:expected", `named scenario passed\n${markers[0]}\n`);
      assert.strictEqual(matches, 0, "Old matching text remains before the new boundary");
      emitChange("output:expected", `named scenario passed\n${markers[0]}\nnew named scenario passed\n`);
    });
    assert.strictEqual(matches, 1);
    assert.strictEqual(text, "\nnew named scenario passed\n", "Returned text excludes the boundary and old result");
    released();
  });

  test("fresh matching text in another channel cannot satisfy or replace the expected channel", async () => {
    let matches = 0;
    const text = await afterOutput(channel, (value) => {
      if (!value.includes("selected test passed")) {return false;}
      matches++;
      return true;
    }, () => {
      emitOpen("output:other", "selected test passed\n");
      emitOpen("output:expected", `${markers[0]}\n`);
      emitChange("output:other", `${markers[0]}\nselected test passed\n`);
      assert.strictEqual(matches, 0, "After locating the expected marker, the observer stays pinned to that document");
      emitChange("output:expected", `${markers[0]}\nselected test passed\n`);
    });
    assert.strictEqual(text, "\nselected test passed\n");
    assert.strictEqual(matches, 1);
    released();
  });

  test("an identical prior result cannot satisfy the next operation", async () => {
    const result = "test_pytest_first passed\n";
    await afterOutput(channel, (value) => value.includes(result), () => {
      emitOpen("output:expected", `${markers[0]}\n${result}`);
    });
    released();
    let matches = 0;
    const text = await afterOutput(channel, (value) => {
      if (!value.includes(result)) {return false;}
      matches++;
      return true;
    }, () => {
      assert.notStrictEqual(markers[0], markers[1]);
      emitOpen("output:expected", `${markers[0]}\n${result}`);
      emitChange("output:expected", `${markers[0]}\n${result}${markers[1]}\n`);
      assert.strictEqual(matches, 0, "The previous operation's identical bytes cannot complete this operation");
      emitChange("output:expected", `${markers[0]}\n${result}${markers[1]}\n${result}`);
    });
    assert.strictEqual(text, `\n${result}`);
    assert.strictEqual(matches, 1);
    released();
  });

  test("action rejection releases output listeners and the failure timer", async () => {
    await assert.rejects(afterOutput(channel, () => false, async () => {
      throw new Error("controlled action failure");
    }), /controlled action failure/u);
    released();
  });

  test("the controlled failure timer reports bounded channel context and releases listeners", async () => {
    let begin!: () => void;
    const started = new Promise<void>((resolve) => {begin = resolve;});
    const pending = afterOutput(channel, () => false, () => {
      emitOpen("output:expected", `${markers[0]}\n${"x".repeat(5000)}`);
      begin();
    }, "selected command output");
    const failure = assert.rejects(pending, (error: Error) => {
      assert.match(error.message, /selected command output in Expected fixture output/u);
      assert.ok(error.message.includes("output:expected"));
      assert.ok(error.message.length < 1500, "Failure context retains a bounded suffix");
      return true;
    });
    await started;
    assert.strictEqual(timers.size, 1);
    [...timers.values()][0]!();
    await failure;
    released();
  });
});
