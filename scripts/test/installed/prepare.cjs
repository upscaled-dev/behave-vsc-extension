const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function prepare({ root, framework, python, extensionsRoot, userData, bundle, targetVersion, bundleSha256 }) {
  assert.ok(['behave', 'pytest-bdd'].includes(framework), 'Choose behave or pytest-bdd');
  const workspace = path.resolve(root, framework);
  assert.ok(!fs.existsSync(workspace), `Fixture destination already exists: ${workspace}`);
  const source = path.resolve(__dirname, '../../../src/test/fixtures/execution', framework === 'behave' ? 'behave' : 'pytest');
  fs.cpSync(source, workspace, { recursive: true });
  const quote = process.platform === 'win32' ? `"${python.replace(/"/g, '""')}"` : `'${python.replace(/'/g, "'\\''")}'`;
  const settings = {
    'behaveTestRunner.framework': framework,
    'behaveTestRunner.autoDetectFramework': false,
    'behaveTestRunner.autoDiscoverTests': true,
    'behaveTestRunner.behaveCommand': `${quote} -m behave`,
    'behaveTestRunner.pytestCommand': `${quote} -m pytest`,
    'behaveTestRunner.outputFormat': 'plain',
    'behaveTestRunner.workingDirectory': workspace,
    'behaveTestRunner.enableCodeLens': true,
    'behaveTestRunner.enableStepDefinitionNavigation': true,
    'python.defaultInterpreterPath': python,
    'python.testing.pytestEnabled': false,
    'python.testing.unittestEnabled': false,
    'editor.gotoLocation.multipleDefinitions': 'goto',
    'security.workspace.trust.enabled': false,
  };
  fs.mkdirSync(path.join(workspace, '.vscode'));
  fs.writeFileSync(path.join(workspace, '.vscode/settings.json'), JSON.stringify(settings, null, 2));
  const stepSource = path.join(workspace, framework === 'behave' ? 'features/steps/ledger.py' : 'tests/test_pyselection.py');
  const stepLines = fs.readFileSync(stepSource, 'utf8').split(/\r?\n/);
  const config = {
    framework, workspace, python: path.resolve(python), extensionsRoot: path.resolve(extensionsRoot), userData: path.resolve(userData),
    targetVersion: targetVersion ?? JSON.parse(fs.readFileSync(path.resolve(path.dirname(bundle), '../package.json'), 'utf8')).version,
    bundleSha256: bundleSha256 ?? crypto.createHash('sha256').update(fs.readFileSync(bundle)).digest('hex'),
    feature: path.join(workspace, 'features', framework === 'behave' ? 'selection.feature' : 'pyselection.feature'),
    selectedName: framework === 'behave' ? 'First selected scenario' : 'Pytest first',
    ...(framework === 'pytest-bdd' ? { outputTestId: 'tests/test_pyselection.py::test_pytest_first' } : {}),
    selectedEntry: framework === 'behave' ? 'first' : 'pytest-first', stepSource,
    definitionLine: stepLines.findIndex(line => line.startsWith('@given(')),
    breakpointLine: stepLines.findIndex(line => line.includes('ledger.write(')),
    evidence: path.resolve(root, `${framework}-evidence.json`),
  };
  const configPath = path.resolve(root, `${framework}-config.json`);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

if (require.main === module) {
  const [root, framework, python, extensionsRoot, userData, bundle] = process.argv.slice(2);
  assert.ok(bundle, 'Usage: node prepare.cjs ROOT FRAMEWORK PYTHON EXTENSIONS_ROOT USER_DATA BUNDLE');
  process.stdout.write(`${prepare({ root, framework, python, extensionsRoot, userData, bundle })}\n`);
}

module.exports = { prepare };
