const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { parseStringPromise } = require('xml2js');
const { readArchive } = require('../release.cjs');

const root = path.resolve(__dirname, '../..');
const manifest = require('../../package.json');
const artifactName = `${manifest.name}-${manifest.version}.vsix`;
const artifact = path.join(root, 'dist', artifactName);
// Never inherit publication credentials or GitHub outputs in a regression test.
const environment = { ...process.env, VSCE_PAT: '', GITHUB_OUTPUT: '', GITHUB_REF_TYPE: '', GITHUB_REF_NAME: '' };

function run(command, args, cwd = root, env = {}) {
  const result = spawnSync(command, args, {
    cwd, env: { ...environment, ...env }, encoding: 'utf8', timeout: 120000,
  });
  if (result.error) { throw result.error; }
  return { status: result.status, output: result.stdout + result.stderr };
}

function succeeds(result) { assert.equal(result.status, 0, result.output); }
function fails(result, message) {
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, message);
}

test('real npm packaging preserves versions and produces matching runtime ZIPs twice', async () => {
  const versions = await Promise.all(['package.json', 'package-lock.json'].map(file => fs.readFile(path.join(root, file))));
  const head = run('git', ['rev-parse', 'HEAD']).output;
  const tags = run('git', ['tag', '--list']).output;
  // A development build can leave this file behind. Production packaging must exclude it.
  await fs.mkdir(path.join(root, 'dist'), { recursive: true });
  const sourceMap = path.join(root, 'dist/extension.js.map');
  const previousMap = await fs.readFile(sourceMap).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await fs.writeFile(sourceMap, 'stale development source map');
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      // Use npm's actual JS entry point, including on Windows where npm is a .cmd file.
      succeeds(run(process.execPath, [process.env.npm_execpath, 'run', 'package:vsix']));
      const files = await readArchive(artifact);
      assert.deepEqual([...files.keys()].sort(), [
        '[Content_Types].xml', 'extension.vsixmanifest', 'extension/LICENSE.txt',
        'extension/readme.md', 'extension/THIRD-PARTY-NOTICES.md', 'extension/dist/extension.js', 'extension/icon.png',
        'extension/package.json', 'extension/python/behave_pytest_plugin.py', 'extension/python/behave_capture.py',
      ].sort());
      const packaged = JSON.parse(files.get('extension/package.json'));
      const xml = await parseStringPromise(files.get('extension.vsixmanifest').toString());
      const identity = xml.PackageManifest.Metadata[0].Identity[0].$;
      assert.equal(path.basename(artifact), artifactName);
      assert.equal(packaged.version, manifest.version);
      assert.deepEqual([identity.Id, identity.Publisher, identity.Version], [manifest.name, manifest.publisher, manifest.version]);
      for (const file of ['dist/extension.js', 'python/behave_pytest_plugin.py', 'python/behave_capture.py']) {
        assert.deepEqual(files.get(`extension/${file}`), await fs.readFile(path.join(root, file)));
      }
      for (const [index, file] of ['package.json', 'package-lock.json'].entries()) {
        assert.deepEqual(await fs.readFile(path.join(root, file)), versions[index]);
      }
      assert.equal(run('git', ['rev-parse', 'HEAD']).output, head);
      assert.equal(run('git', ['tag', '--list']).output, tags);
    }
  } finally {
    if (previousMap) await fs.writeFile(sourceMap, previousMap);
    else await fs.rm(sourceMap, { force: true });
  }
});

test('release rejects the wrong tag before creating an archive and accepts a corrected tag', async () => {
  const before = await fs.readFile(artifact);
  fails(run(process.execPath, ['scripts/release.cjs', 'package'], root, {
    GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: manifest.version,
  }), /Release tag must be/);
  assert.deepEqual(await fs.readFile(artifact), before);
  succeeds(run(process.execPath, ['scripts/release.cjs', 'check-tag'], root, {
    GITHUB_REF_NAME: `v${manifest.version}`,
  }));
});

test('missing, mismatched and stale artifacts block publication; corrected artifacts can retry', async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'behave-release-'));
  try {
    for (const file of ['package.json', 'package-lock.json', 'dist/extension.js', 'python/behave_pytest_plugin.py', 'python/behave_capture.py']) {
      await fs.mkdir(path.dirname(path.join(fixture, file)), { recursive: true });
      await fs.copyFile(path.join(root, file), path.join(fixture, file));
    }
    const script = path.join(root, 'scripts/release.cjs');
    const publish = () => run(process.execPath, [script, 'publish'], fixture, { GITHUB_REF_NAME: `v${manifest.version}` });
    fails(publish(), /ENOENT/);
    await fs.copyFile(artifact, path.join(fixture, 'dist', artifactName));
    const skipped = publish();
    succeeds(skipped);
    assert.match(skipped.output, /Skipping Marketplace publication/);
    await fs.appendFile(path.join(fixture, 'python/behave_pytest_plugin.py'), '\n# changed after packaging\n');
    fails(publish(), /current python\/behave_pytest_plugin.py/);
    await fs.copyFile(path.join(root, 'python/behave_pytest_plugin.py'), path.join(fixture, 'python/behave_pytest_plugin.py'));
    succeeds(publish());
    const changed = { ...manifest, publisher: 'different-publisher' };
    await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify(changed));
    fails(publish(), /Packaged publisher/);
    await fs.copyFile(path.join(root, 'package.json'), path.join(fixture, 'package.json'));
    succeeds(publish());
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
});

test('explicit version commands use the existing synchronized manifest and lock updater', async () => {
  const config = require('../../.versionrc.js');
  assert.match(config.commitUrlFormat, /upscaled-dev\/behave-vsc-extension/);
  assert.equal(manifest.scripts.version, undefined);
  assert.equal(manifest.scripts['bump:patch'], undefined);
  const defaults = require('commit-and-tag-version/defaults');
  assert.equal(defaults.tagPrefix, 'v');
  assert.ok(defaults.bumpFiles.includes('package.json'));
  assert.ok(defaults.bumpFiles.includes('package-lock.json'));
  const updater = require('commit-and-tag-version/lib/updaters/types/json');
  const updated = JSON.parse(updater.writeVersion(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'), '1.2.43'));
  assert.equal(updated.version, '1.2.43');
  assert.equal(updated.packages[''].version, '1.2.43');
});

test('publication forwards the exact validated artifact and PAT to the pinned API', async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'behave-release-publisher-'));
  try {
    const preload = path.join(fixture, 'publisher.cjs');
    await fs.writeFile(preload, `
const assert = require('node:assert/strict');
const vsce = require(${JSON.stringify(require.resolve('@vscode/vsce'))});
let calls = 0;
vsce.publishVSIX = async (artifact, options) => {
  calls++;
  assert.equal(artifact, ${JSON.stringify(path.join('dist', artifactName))});
  assert.deepEqual(options, { pat: 'release-regression-sentinel' });
};
process.on('exit', () => assert.equal(calls, 1));
`);
    succeeds(run(process.execPath, ['--require', preload, 'scripts/release.cjs', 'publish'], root, {
      GITHUB_REF_NAME: `v${manifest.version}`, VSCE_PAT: 'release-regression-sentinel',
    }));
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
});
