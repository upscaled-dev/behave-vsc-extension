const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const yauzl = require('yauzl');
const { parseStringPromise } = require('xml2js');

async function readVersion() {
  const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
  const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
  assert.equal(lock.version, manifest.version, 'Lockfile version must match package.json');
  assert.equal(lock.packages[''].version, manifest.version, 'Lockfile root version must match package.json');
  return manifest;
}

function checkTag(manifest) {
  assert.equal(process.env.GITHUB_REF_NAME, `v${manifest.version}`, 'Release tag must be v<package.json version>');
}

function readArchive(filename) {
  return new Promise((resolve, reject) => {
    yauzl.open(filename, { lazyEntries: true }, (error, zip) => {
      if (error) { reject(error); return; }
      const files = new Map();
      let totalBytes = 0;
      const fail = error => { zip.close(); reject(error); };
      zip.on('error', fail);
      zip.on('end', () => resolve(files));
      zip.on('entry', entry => {
        if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
        totalBytes += entry.uncompressedSize;
        if (totalBytes > 32 * 1024 * 1024 || files.size >= 10000) {
          fail(new Error('VSIX exceeds the 32 MiB or 10000 file verification limit'));
          return;
        }
        if (files.has(entry.fileName)) {
          fail(new Error(`Duplicate archive entry: ${entry.fileName}`));
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) { fail(streamError); return; }
          const chunks = [];
          stream.on('error', fail);
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

async function verify(manifest, artifact) {
  assert.equal(path.basename(artifact), `${manifest.name}-${manifest.version}.vsix`, 'VSIX filename must match package.json');
  const files = await readArchive(artifact);
  const packaged = JSON.parse(files.get('extension/package.json')?.toString() ?? 'null');
  assert.ok(packaged, 'VSIX must include extension/package.json');
  const xml = await parseStringPromise(files.get('extension.vsixmanifest')?.toString() ?? '');
  const identity = xml.PackageManifest?.Metadata?.[0]?.Identity?.[0]?.$;
  assert.ok(identity, 'VSIX must include its XML identity');
  for (const [jsonKey, xmlKey] of [['name', 'Id'], ['publisher', 'Publisher'], ['version', 'Version']]) {
    assert.equal(packaged[jsonKey], manifest[jsonKey], `Packaged ${jsonKey} must match package.json`);
    assert.equal(identity[xmlKey], manifest[jsonKey], `VSIX ${xmlKey} must match package.json`);
  }
  assert.equal(packaged.main, manifest.main, 'Packaged entry point must match package.json');
  for (const asset of [manifest.main.replace(/^\.\//, ''), 'python/behave_pytest_plugin.py', 'python/behave_capture.py']) {
    const bytes = files.get(`extension/${asset}`);
    assert.ok(bytes?.length, `VSIX must include ${asset}`);
    assert.deepEqual(bytes, await fs.readFile(asset), `VSIX must contain the current ${asset}`);
  }
  for (const name of files.keys()) {
    assert.ok(!/(^|\/)(src|out|test|tests|scripts|plans|node_modules|__pycache__|\.[^/]+)(\/|$)|\.(ts|tsx|map|pyc|pyo|vsix)$/.test(name), `Development asset in VSIX: ${name}`);
  }
  return artifact;
}

async function main() {
  const command = process.argv[2];
  const manifest = await readVersion();
  const artifact = path.join('dist', `${manifest.name}-${manifest.version}.vsix`);
  if (['check-tag', 'publish'].includes(command) || process.env.GITHUB_REF_TYPE === 'tag') {
    checkTag(manifest);
  }
  if (command === 'check-tag') { return; }
  if (command === 'package') {
    await fs.mkdir('dist', { recursive: true });
    await require('@vscode/vsce').createVSIX({ packagePath: 'dist', useYarn: false });
  }
  assert.ok(['package', 'verify', 'publish'].includes(command), 'Expected check-tag, package, verify or publish');
  await verify(manifest, artifact);
  console.log(`Verified ${artifact}`);
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `version=${manifest.version}\nartifact=${artifact}\n`);
  }
  if (command === 'publish') {
    if (!process.env.VSCE_PAT) {
      console.log('VSCE_PAT is not set. Skipping Marketplace publication.');
      return;
    }
    await require('@vscode/vsce').publishVSIX(artifact, { pat: process.env.VSCE_PAT });
  }
}

module.exports = { readArchive };

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
