import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export const REPORT_LIMIT_BYTES = 16 * 1024 * 1024;

/** One private report directory per physical invocation. */
export class TestRunArtifacts {
  public readonly report: string;
  private constructor(private readonly directory: string) {this.report = path.join(directory, "results.json");}

  public static async create(): Promise<TestRunArtifacts> {
    return new TestRunArtifacts(await fs.mkdtemp(path.join(os.tmpdir(), "behave-test-run-")));
  }

  public async readReport(): Promise<string> {
    const handle = await fs.open(this.report, "r");
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      while (bytes <= REPORT_LIMIT_BYTES) {
        const buffer = Buffer.alloc(Math.min(64 * 1024, REPORT_LIMIT_BYTES + 1 - bytes));
        const read = await handle.read(buffer, 0, buffer.length, null);
        if (!read.bytesRead) {break;}
        chunks.push(buffer.subarray(0, read.bytesRead)); bytes += read.bytesRead;
      }
      if (bytes > REPORT_LIMIT_BYTES) {throw new Error("Test report exceeds the 16 MiB limit.");}
      const text = Buffer.concat(chunks).toString("utf8");
      let parsed: unknown;
      try {parsed = JSON.parse(text);} catch {throw new Error("Test report contains invalid JSON.");}
      if (!Array.isArray(parsed)) {throw new Error("Test report must contain a JSON array.");}
      return text;
    } finally {await handle.close();}
  }

  public cleanup(): Promise<void> {return fs.rm(this.directory, { recursive: true, force: true });}
}
