import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { FeatureParser } from "../../parsers/feature-parser";
import { TestTreeBuilder } from "../../test-providers/test-tree-builder";
import { FeatureBasedOrganization, TestOrganizationManager } from "../../core/test-organization";
import { BehaveExtensionContext } from "../../types";
import { Logger } from "../../utils/logger";

suite("Physical container identity Unit Tests", () => {
  let directory: string;
  let file: string;
  let controller: vscode.TestController;
  let builder: TestTreeBuilder;
  let parents: Map<string, string>;
  let files: string[];

  function children(item: vscode.TestItem): vscode.TestItem[] {
    return Array.from(item.children, ([, child]) => child);
  }

  setup(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "behave-container-tree-"));
    file = vscode.Uri.file(path.join(directory, "containers.feature")).fsPath;
    fs.copyFileSync(path.resolve(__dirname, "../../../src/test/fixtures/containers/containers.feature"), file);
    files = [file];
    controller = vscode.tests.createTestController("container-tree", "Container tree");
    const logger = new Logger({ appendLine: () => {} } as unknown as vscode.OutputChannel);
    const context = { logger, featureParser: new FeatureParser(logger),
      organizationManager: new TestOrganizationManager(logger, new FeatureBasedOrganization(logger)),
      discoveryManager: { discoverTestFiles: async () => files },
    } as unknown as BehaveExtensionContext;
    parents = new Map();
    builder = new TestTreeBuilder(controller, context, new Map(), parents);
  });

  teardown(() => {controller.dispose(); fs.rmSync(directory, { recursive: true, force: true });});

  test("Physical container identity separates duplicate outlines and named/unnamed blocks and survives a rename", async () => {
    await builder.discoverTests();
    const feature = controller.items.get(file)!;
    const outlines = children(feature).filter((item) => item.children.size > 0);
    assert.deepStrictEqual(outlines.map((item) => [item.label, item.range!.start.line + 1]), [
      ["Scenario Outline: Repeated", 3], ["Scenario Outline: Repeated", 11],
      ["Scenario Outline: Named blocks", 19], ["Scenario Outline: Unnamed blocks", 31],
      ["Scenario Outline: Legacy block", 41],
    ]);
    assert.deepStrictEqual(outlines.map((item) => item.id), [3, 11, 19, 31, 41].map((line) => `${file}:outline:${line}`));
    for (const [outlineLine, blockLines, labels] of [
      [3, [5], ["Examples: Same"]], [11, [13], ["Examples: Same"]],
      [19, [22, 26], ["Examples: Same", "Examples: Same"]], [31, [33, 36], ["Examples", "Examples"]],
    ] as const) {
      const outline = outlines.find((item) => item.range!.start.line + 1 === outlineLine)!;
      const blocks = children(outline);
      assert.deepStrictEqual(blocks.map((item) => item.range!.start.line + 1), blockLines);
      assert.deepStrictEqual(blocks.map((item) => item.label), labels);
      assert.deepStrictEqual(blocks.map((item) => item.id), blockLines.map((line) => `${file}:examples:${line}`));
      for (const block of blocks) {
        for (const row of children(block)) {assert.strictEqual(parents.get(row.id), outline.id);}
      }
    }
    const legacy = outlines.find((item) => item.range!.start.line === 40)!;
    assert.deepStrictEqual(children(legacy).map((item) => item.range!.start.line + 1), [45, 46]);
    const ids = outlines.map((item) => item.id);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("Scenario Outline: Repeated", "Scenario Outline: Renamed").replace("Examples: Same", "Examples: Renamed"));
    await builder.discoverTests();
    const renamed = children(controller.items.get(file)!).filter((item) => item.children.size > 0);
    assert.deepStrictEqual(renamed.map((item) => item.id), ids);
    assert.strictEqual(renamed[0]?.label, "Scenario Outline: Renamed");
    assert.strictEqual(children(renamed[0]!)[0]?.label, "Examples: Renamed");
    assert.strictEqual(children(renamed[0]!)[0]?.id, `${file}:examples:5`);
  });

  test("Physical container identity assigns file metadata on explicit-file addition and isolates identical files", async () => {
    const other = vscode.Uri.file(path.join(directory, "other.feature")).fsPath;
    fs.copyFileSync(file, other);
    await builder.addFeatureFileToTestController(vscode.Uri.file(file));
    await builder.addFeatureFileToTestController(vscode.Uri.file(other));
    assert.strictEqual(controller.items.size, 2);
    const snapshot = builder.scenarioSnapshot();
    assert.strictEqual(snapshot.size, 22);
    for (const selectedFile of [file, other]) {
      const feature = controller.items.get(selectedFile)!;
      const repeated = children(feature).filter((item) => item.label === "Scenario Outline: Repeated");
      assert.deepStrictEqual(repeated.map((item) => item.id), [3, 11].map((line) => `${selectedFile}:outline:${line}`));
      const scenarios = [...snapshot].filter(([, scenario]) => scenario.filePath === selectedFile);
      assert.strictEqual(scenarios.length, 11);
      for (const [id, scenario] of scenarios) {assert.strictEqual(id, `${selectedFile}:${scenario.lineNumber}`);}
    }
  });

  test("Physical container identity retains flat single-row and unfinished-outline compatibility", async () => {
    fs.writeFileSync(file, 'Feature: Compatibility\n  Scenario Outline: Same\n    Given <value>\n    Examples:\n      | value |\n      | one |\n  Scenario Outline: Same\n    Given <value>\n    Examples:\n      | value |\n      | two |\n  Scenario Outline: Unfinished\n    Given <value>\n');
    await builder.discoverTests();
    const items = children(controller.items.get(file)!);
    assert.deepStrictEqual(items.map((item) => [item.label, item.range!.start.line + 1, item.children.size]), [
      ["1: Same - value: one", 6, 0], ["1: Same - value: two", 11, 0], ["Unfinished", 12, 0],
    ]);
  });
});
