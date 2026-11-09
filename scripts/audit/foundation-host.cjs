const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const vscode = require('vscode');
const { FeatureParser } = require('../../out/parsers/feature-parser');
const { TestDiscoveryManager } = require('../../out/core/test-discovery-manager');
const organization = require('../../out/core/test-organization');
const { TestTreeBuilder } = require('../../out/test-providers/test-tree-builder');
const { TestDiscoveryLifecycle } = require('../../out/test-providers/test-discovery-lifecycle');
const { testExplorerRunPlan } = require('../../out/test-providers/test-explorer-run-plan');
const { Logger } = require('../../out/utils/logger');

const project = path.resolve(__dirname, '../..');
const workspace = process.env.FOUNDATION_AUDIT_WORKSPACE;
function projection(items) {
  return [...items].map(([, item]) => ({ id: item.id.replace(workspace, '<workspace>'), label: item.label,
    line: item.range ? item.range.start.line + 1 : null, description: item.description,
    children: projection(item.children) }));
}
function summary(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { samplesMs: samples, medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted.at(-1) };
}
async function measure(action, count = 5) {
  await action(); // Untimed warmup; no claim of a cold filesystem cache.
  const samples = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now(); await action(); samples.push(performance.now() - start);
  }
  return summary(samples);
}

exports.run = async function () {
  const logger = new Logger();
  const manager = new TestDiscoveryManager(logger);
  const parser = new FeatureParser(logger);
  const controller = vscode.tests.createTestController('foundation-audit', 'Foundation audit');
  const organizationManager = new organization.TestOrganizationManager(logger, new organization.FeatureBasedOrganization(logger));
  let pattern;
  let parseCalls = 0;
  let parseMs = 0;
  const context = { logger, organizationManager,
    discoveryManager: { discoverTestFiles: (_options, token) => manager.discoverTestFiles({ pattern, forceRefresh: true }, token) },
    featureParser: { parseFeatureContent(content) {
      const start = performance.now(); parseCalls++;
      const result = parser.parseFeatureContent(content); parseMs += performance.now() - start; return result;
    } },
  };
  const builder = new TestTreeBuilder(controller, context, new Map(), new Map());
  const result = { environment: { vscode: vscode.version, node: process.version, electron: process.versions.electron,
    platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model, memoryBytes: os.totalmem() },
    sourceHashes: {}, fixtures: {}, workloads: [] };
  for (const name of ['src/parsers/feature-parser.ts', 'src/core/test-discovery-manager.ts', 'src/core/test-organization.ts', 'src/test-providers/test-tree-builder.ts', 'src/test-providers/test-discovery-lifecycle.ts']) {
    result.sourceHashes[name] = crypto.createHash('sha256').update(fs.readFileSync(path.join(project, name))).digest('hex');
  }
  try {
    for (const [id, content] of Object.entries(require('./parser-fixtures.json'))) {
      const parsed = parser.parseFeatureContent(content);
      const parsedProjection = parsed?.scenarios.map(({ name, lineNumber, tags, steps, backgroundSteps, outlineLineNumber, examplesBlockLineNumber, ruleName }) =>
        ({ name, line: lineNumber, tags, steps, backgroundSteps, outlineLineNumber, examplesBlockLineNumber, ruleName })) ?? null;
      pattern = `semantics/${id}.feature`;
      const trees = {};
      const selections = {};
      for (const name of ['FeatureBasedOrganization', 'TagBasedOrganization']) {
        organizationManager.setStrategy(new organization[name](logger));
        await builder.discoverTests(); trees[name] = projection(controller.items);
        const roots = [...controller.items].map(([, item]) => item);
        const containers = roots.flatMap(root => [root, ...[...root.children].map(([, item]) => item)]).filter(item => item.children.size);
        selections[name] = containers.map(item => ({ label: item.label, line: item.range ? item.range.start.line + 1 : null,
          units: testExplorerRunPlan(new vscode.TestRunRequest([item]), roots, id => builder.scenarioFor(id))
            .map(unit => ({ kind: unit.kind, lines: unit.scenarios.map(({ scenario }) => scenario.lineNumber) })) }));
      }
      result.fixtures[id] = { scenarios: parsedProjection, trees, selections,
        codeLenses: parser.provideScenarioCodeLenses(content, `${id}.feature`).map(lens => ({ line: lens.range.start.line + 1, title: lens.command.title, arguments: lens.command.arguments })) };
    }
    for (const size of [10, 100, 1000]) {
      pattern = `workload/${size}/**/*.feature`;
      const contents = fs.readdirSync(path.join(workspace, 'workload', String(size))).map(file =>
        fs.readFileSync(path.join(workspace, 'workload', String(size), file), 'utf8'));
      const workload = { files: size, scenarios: size * 16, bytes: contents.reduce((n, text) => n + Buffer.byteLength(text), 0),
        parse: await measure(() => { let count = 0; for (const text of contents) count += parser.parseFeatureContent(text).scenarios.length; assert.equal(count, size * 16); }),
        codeLens: await measure(() => { for (const text of contents) assert.equal(parser.provideScenarioCodeLenses(text, 'workload.feature').length, 39); }),
        discovery: {}, trees: {} };
      workload.discovery.forced = await measure(async () => assert.equal((await manager.discoverTestFiles({ pattern, forceRefresh: true })).length, size));
      workload.discovery.cached = await measure(async () => assert.equal((await manager.discoverTestFiles({ pattern })).length, size));
      for (const name of ['FeatureBasedOrganization', 'TagBasedOrganization', 'FileBasedOrganization', 'ScenarioTypeOrganization', 'FlatOrganization']) {
        organizationManager.setStrategy(new organization[name](logger));
        parseCalls = 0; parseMs = 0;
        const timing = await measure(async () => { await builder.discoverTests(); assert.equal(builder.scenarioSnapshot().size, size * 16); });
        workload.trees[name] = { ...timing, parseCallsIncludingWarmup: parseCalls, parseMsIncludingWarmup: parseMs };
      }
      let admitted;
      const admission = new Promise(resolve => { admitted = resolve; });
      let passes = 0;
      const lifecycle = new TestDiscoveryLifecycle(async (...args) => { passes++; admitted(); await builder.discoverTests(...args); });
      try {
        const start = performance.now();
        const pending = lifecycle.refresh(); await admission;
        await Promise.all([pending, ...Array.from({ length: 30 }, () => lifecycle.refresh({ invalidate: true }))]);
        assert.equal(passes, 2); assert.equal(builder.scenarioSnapshot().size, size * 16);
        workload.refreshBurst = { invalidations: 30, passes, elapsedMs: performance.now() - start };
      } finally { await lifecycle.dispose(); }
      workload.memory = process.memoryUsage();
      result.workloads.push(workload);
      console.log(`Foundation audit: ${size} files / ${size * 16} scenarios measured`);
    }
    fs.writeFileSync(process.env.FOUNDATION_AUDIT_RESULT, JSON.stringify(result, null, 2));
  } finally {
    controller.dispose(); manager.dispose(); logger.dispose();
  }
};
