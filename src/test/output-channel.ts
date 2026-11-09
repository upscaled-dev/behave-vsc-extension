import * as assert from "assert";
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";

export function createCheckedOutputChannel(name: string): vscode.OutputChannel {
  let disposed = false;
  const use = () => {assert.ok(!disposed, "Output channel used after disposal");};
  return { name, append: use, appendLine: use, replace: use, clear: use, show: use, hide: use,
    dispose: () => {assert.ok(!disposed, "Output channel disposed twice"); disposed = true;} };
}

export async function afterOutput(
  channel: vscode.OutputChannel,
  contains: (text: string) => boolean,
  action: () => unknown | PromiseLike<unknown>,
  phase = "populated output",
): Promise<string> {
  let complete!: (text: string) => void;
  let fail!: (error: Error) => void;
  const observed = new Promise<string>((resolve, reject) => {complete = resolve; fail = reject;});
  const boundary = `[output observation ${randomUUID()}]`;
  let matchingUri: string | undefined;
  let latest: Array<{ uri: string; version: number; added: string }> = [];
  const inspect = (document: vscode.TextDocument) => {
    if (document.uri.scheme !== "output") {return;}
    const uri = document.uri.toString();
    if (matchingUri && matchingUri !== uri) {return;}
    const text = document.getText();
    const index = text.lastIndexOf(boundary);
    const added = index < 0 ? "" : text.slice(index + boundary.length);
    latest = [...latest.filter((entry) => entry.uri !== uri), { uri, version: document.version, added: added.slice(-1000) }].slice(-3);
    if (index < 0) {return;}
    matchingUri = uri;
    if (contains(added)) {complete(added);}
  };
  const opened = vscode.workspace.onDidOpenTextDocument(inspect);
  const changed = vscode.workspace.onDidChangeTextDocument((event) => inspect(event.document));
  const timeout = setTimeout(() => fail(new Error(`Expected ${phase} in ${channel.name} was not observed. Output documents: ${
    JSON.stringify(latest)
  }`)), 10000);
  try {
    channel.appendLine(boundary);
    const [text] = await Promise.all([observed, Promise.resolve().then(action)]);
    return text;
  } finally {
    clearTimeout(timeout);
    opened.dispose();
    changed.dispose();
  }
}
