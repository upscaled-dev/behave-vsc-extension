// Run after npm run compile-tests. All generated fixtures and host state are temporary.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runTests, downloadAndUnzipVSCode } = require('@vscode/test-electron');
const { resolveVSCodeExecutablePath } = require('../../out/test/vscode-executable-path');

async function main() {
  const [python, version = '1.142.0', output = path.join(os.tmpdir(), 'behave-foundation-evidence.json'), executablePath = process.env.VSCODE_EXECUTABLE_PATH] = process.argv.slice(2);
  if (!python) throw new Error('Usage: node scripts/audit/foundation.cjs <python-executable> [VS-Code-version] [output.json] [VS-Code-executable]');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'behave-foundation-audit-'));
  try {
    const workspace = path.join(scratch, 'workspace');
    fs.mkdirSync(path.join(workspace, 'semantics'), { recursive: true });
    const fixtures = require('./parser-fixtures.json');
    for (const [id, content] of Object.entries(fixtures)) {
      fs.writeFileSync(path.join(workspace, 'semantics', `${id}.feature`), content);
    }
    for (const size of [10, 100, 1000]) {
      const directory = path.join(workspace, 'workload', String(size));
      fs.mkdirSync(directory, { recursive: true });
      for (let i = 0; i < size; i++) {
        let content = `Feature: Workload ${i}\n  Background:\n    Given shared setup\n`;
        for (let j = 0; j < 6; j++) content += `  @smoke @fast\n  Scenario: Regular ${j}\n    Given a value\n    Then a result\n`;
        for (let j = 0; j < 2; j++) content += `  @smoke\n  Scenario Outline: Outline ${j}\n    Given <value>\n    Then a result\n    Examples: Values\n      | value |\n      | a |\n      | b |\n      | c |\n      | d |\n      | e |\n`;
        fs.writeFileSync(path.join(directory, `${i}.feature`), content);
      }
    }
    // A noop development extension keeps the target extension's activation out of this measurement.
    const noop = path.join(scratch, 'noop');
    fs.mkdirSync(noop);
    fs.writeFileSync(path.join(noop, 'package.json'), JSON.stringify({ name: 'foundation-audit-host', publisher: 'local-audit', version: '0.0.0', engines: { vscode: '^1.99.0' } }));
    const frameworks = JSON.parse(execFileSync(python, [path.join(__dirname, 'framework-parser.py'), workspace], { encoding: 'utf8' }));
    const executable = resolveVSCodeExecutablePath(executablePath ?? await downloadAndUnzipVSCode({ version }));
    await runTests({
      vscodeExecutablePath: executable, extensionDevelopmentPath: noop,
      extensionTestsPath: path.join(__dirname, 'foundation-host.cjs'),
      extensionTestsEnv: { FOUNDATION_AUDIT_WORKSPACE: workspace, FOUNDATION_AUDIT_RESULT: path.join(scratch, 'native.json'), VSCODE_TEST: undefined, ELECTRON_RUN_AS_NODE: undefined },
      launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
        `--user-data-dir=${path.join(scratch, 'user-data')}`, `--extensions-dir=${path.join(scratch, 'extensions')}`],
    });
    const native = JSON.parse(fs.readFileSync(path.join(scratch, 'native.json'), 'utf8'));
    if (native.environment.vscode !== version) throw new Error(`Expected VS Code ${version}, observed ${native.environment.vscode}`);
    fs.writeFileSync(output, JSON.stringify({ ...native, frameworks }, null, 2) + '\n');
    console.log(`Evidence saved to ${output}`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
