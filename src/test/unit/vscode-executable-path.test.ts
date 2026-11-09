import * as assert from "assert";
import { resolveVSCodeExecutablePath, resolveVSCodeVersion } from "../vscode-executable-path";

suite("Native host selection", () => {
  test("uses the archive Code executable only when macOS Electron is absent", () => {
    const downloaded = "/app/Contents/MacOS/Electron";
    const code = "/app/Contents/MacOS/Code";
    assert.strictEqual(resolveVSCodeExecutablePath(downloaded, "darwin", (file) => file === code), code);
    assert.strictEqual(resolveVSCodeExecutablePath(downloaded, "darwin", () => true), downloaded);
    assert.strictEqual(resolveVSCodeExecutablePath(downloaded, "darwin", () => false), downloaded);
    assert.strictEqual(resolveVSCodeExecutablePath(downloaded, "linux", () => false), downloaded);
  });

  test("resolves minimum from the declared engine and preserves explicit host selection", () => {
    assert.strictEqual(resolveVSCodeVersion("minimum", "^1.99.0"), "1.99.0");
    assert.strictEqual(resolveVSCodeVersion("minimum", "~1.99.1"), "1.99.1");
    assert.strictEqual(resolveVSCodeVersion("1.142.0", "^1.99.0"), "1.142.0");
    assert.throws(() => resolveVSCodeVersion("minimum", "*"), /Cannot resolve/);
  });
});
