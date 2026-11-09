const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');
const { killTree } = require('@vscode/test-electron/out/util');
const { readArchive } = require('../../release.cjs');
const { prepare } = require('./prepare.cjs');

const repository = path.resolve(__dirname, '../../..');
const dependencies = { 'ms-python.python': '2026.10.0', 'ms-python.debugpy': '2026.6.0' };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));

function parseOptions(args) {
  const { values } = parseArgs({ args, options: Object.fromEntries(
    ['artifact', 'output', 'host', 'python', 'executable', 'extensions-root', 'framework'].map(name => [name, { type: 'string' }])) });
  for (const name of ['artifact', 'output', 'host', 'python']) { assert.ok(values[name], `Missing --${name}`); }
  assert.ok(['1.142.0', '1.99.0'].includes(values.host), 'Choose pinned --host 1.142.0 or 1.99.0');
  assert.ok(path.isAbsolute(values.python), '--python must be an absolute interpreter path');
  if (values.executable) { assert.ok(path.isAbsolute(values.executable), '--executable must be absolute'); }
  assert.ok(!values.framework || ['behave', 'pytest-bdd'].includes(values.framework), 'Choose --framework behave or pytest-bdd');
  return values;
}

function electronCli(executable, platform = process.platform, exists = fs.existsSync, read = fs.readFileSync) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const root = paths.dirname(executable);
  let script;
  if (platform === 'win32') {
    const command = read(paths.join(root, 'bin/code.cmd'), 'utf8');
    const candidates = [...command.matchAll(/"%~dp0\.\.\\((?:[a-f0-9]{10}\\)?resources\\app\\out\\cli\.js)"/giu)]
      .map(match => paths.resolve(root, match[1]));
    for (const candidate of candidates) {
      const relative = paths.relative(root, candidate);
      assert.ok(relative && !relative.startsWith('..') && !paths.isAbsolute(relative), 'Official CLI script must remain inside the VS Code installation');
    }
    const existing = candidates.filter(exists);
    assert.equal(existing.length, 1, 'Official bin/code.cmd must name exactly one existing CLI script');
    [script] = existing;
  } else {
    script = paths.resolve(root, platform === 'darwin' ? '../Resources/app/out/cli.js' : 'resources/app/out/cli.js');
  }
  assert.ok(exists(script), `Official VS Code CLI script is missing: ${script}`);
  return [executable, script];
}

function runCommand(executable, args, { log, env = {}, timeoutMs = 180000, signal, onOutput }) {
  const environment = { ...process.env };
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) { delete environment[name]; } else { environment[name] = value; }
  }
  const description = { executable, args, shell: false,
    env: Object.fromEntries(Object.entries(env).map(([name, value]) => [name, value ?? null])), timeoutMs };
  writeJson(`${log}.command.json`, description);
  return new Promise((resolve, reject) => {
    const output = fs.openSync(log, 'w');
    const child = spawn(executable, args, { cwd: repository, env: environment, shell: false,
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let failure;
    let stdout = '';
    let stderr = '';
    let totalBytes = 0;
    let closed = false;
    let drainTimer;
    let stopping;
    const stop = error => {
      failure ??= error;
      if (stopping || closed || !child.pid) { return; }
      // Force the owned tree together: killing its parent first can orphan a child.
      stopping = killTree(child.pid, true).catch(error => { failure = new Error(`Owned process termination failed: ${error.message}`); });
      drainTimer = setTimeout(() => {
        child.kill('SIGKILL'); child.stdout.destroy(); child.stderr.destroy(); child.unref();
        finish(null, 'unconfirmed termination');
      }, 10000);
    };
    const abort = () => stop(new Error('Owned command cancelled'));
    const interrupt = () => stop(new Error('Owned command interrupted'));
    const terminate = () => stop(new Error('Owned command terminated'));
    const timer = setTimeout(() => stop(new Error(`Owned command exceeded ${timeoutMs}ms`)), timeoutMs);
    const finish = async (code, exitSignal) => {
      if (closed) { return; }
      closed = true;
      clearTimeout(timer); clearTimeout(drainTimer);
      signal?.removeEventListener('abort', abort);
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
      try {
        try {
          if (stopping) {
            let deadline;
            try {
              await Promise.race([stopping, new Promise((_, fail) => {
                deadline = setTimeout(() => fail(new Error('Owned tree termination was not acknowledged')), 10000);
              })]);
            } finally { clearTimeout(deadline); }
          }
        } catch (error) { failure = error; }
        finally { fs.closeSync(output); }
        const result = { ...description, code, signal: exitSignal, stdout, stderr,
          ...(failure ? { error: failure.message } : {}) };
        writeJson(`${log}.command.json`, result);
        if (failure || code !== 0) { reject(new Error(`${failure?.message ?? `Command exited ${code ?? exitSignal}`}. See ${log}`)); }
        else { resolve(result); }
      } catch (error) { reject(error); }
    };
    const consume = (stream, bytes) => {
      totalBytes += bytes.length;
      if (totalBytes > 32 * 1024 * 1024) { stop(new Error('Owned command exceeded the 32 MiB log limit')); return; }
      try {
        fs.writeSync(output, bytes);
        if (stream === 'stdout') { stdout = (stdout + bytes.toString()).slice(-1024 * 1024); }
        else { stderr = (stderr + bytes.toString()).slice(-1024 * 1024); }
        onOutput?.(bytes.toString());
      } catch (error) { stop(error); }
    };
    child.stdout.on('data', bytes => consume('stdout', bytes));
    child.stderr.on('data', bytes => consume('stderr', bytes));
    child.once('error', error => { failure = error; });
    child.once('close', (code, exitSignal) => { void finish(code, exitSignal); });
    signal?.addEventListener('abort', abort, { once: true });
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    if (signal?.aborted) { abort(); }
  });
}

function archiveProfiles(temporary, output, files = fs) {
  for (const entry of files.readdirSync(temporary)) {
    if (!entry.startsWith('user-')) { continue; }
    for (const relative of ['logs', 'User/settings.json', 'User/workspaceStorage']) {
      const source = path.join(temporary, entry, relative);
      if (files.existsSync(source)) { files.cpSync(source, path.join(output, 'profiles', entry, relative), { recursive: true }); }
    }
  }
}

function finalizeEvidence(temporary, output, summary, files = fs) {
  const failures = [];
  try { archiveProfiles(temporary, output, files); }
  catch (error) { failures.push({ phase: 'archive', error }); }
  try { files.rmSync(temporary, { recursive: true, force: true }); }
  catch (error) { failures.push({ phase: 'remove', error }); }
  if (failures.length) {
    summary.status = 'failed';
    summary.cleanupErrors = failures.map(({ phase, error }) => ({ phase, error: error.stack ?? String(error) }));
  }
  summary.finishedAt = new Date().toISOString();
  files.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  if (failures.length && !summary.error) {
    throw new AggregateError(failures.map(failure => failure.error), 'Installed acceptance cleanup failed');
  }
}

async function main(options) {
  assert.equal(require('@vscode/test-electron/package.json').version, '2.5.2', 'Use the lockfile-pinned VS Code test SDK');
  const output = path.resolve(options.output);
  assert.ok(!fs.existsSync(output), '--output must name a fresh destination');
  fs.mkdirSync(output, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), 'btr-i-'));
  const summary = { startedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
    host: options.host, companion: { enabled: false, coexistence: 'OPEN' }, temporary, journeys: {} };
  try {
    const artifact = path.resolve(options.artifact);
    const archive = await readArchive(artifact);
    const manifest = JSON.parse(archive.get('extension/package.json').toString());
    assert.equal(`${manifest.publisher}.${manifest.name}`, 'upscaled-dev.behave-test-runner');
    const bundle = archive.get(`extension/${manifest.main.replace(/^\.\//u, '')}`);
    assert.ok(bundle, 'The packaged extension must contain its entry point');
    summary.package = { path: artifact, sha256: hash(fs.readFileSync(artifact)), version: manifest.version, bundleSha256: hash(bundle) };
    fs.copyFileSync(artifact, path.join(output, path.basename(artifact)));
    const python = await runCommand(options.python, ['-c',
      'import json,sys,importlib.metadata as m; print(json.dumps({"executable":sys.executable,"version":sys.version,"packages":{p:m.version(p) for p in ["behave","pytest","pytest-bdd","pytest-xdist","debugpy"]}}))'],
    { log: path.join(output, 'python.log') });
    summary.python = JSON.parse(python.stdout);
    const requirements = fs.readFileSync(path.join(repository, 'src/test/fixtures/execution/requirements.txt'), 'utf8');
    for (const line of requirements.trim().split(/\r?\n/u)) {
      const [name, version] = line.split('==');
      assert.equal(summary.python.packages[name], version, `Pinned Python package ${name}`);
    }
    const { resolveVSCodeExecutablePath } = require(path.join(repository, 'out/test/vscode-executable-path.js'));
    const executable = resolveVSCodeExecutablePath(options.executable ?? await downloadAndUnzipVSCode({ version: options.host, timeout: 60000 }));
    summary.executable = executable;
    const [cli, cliScript] = electronCli(executable);
    const extensionsRoot = options['extensions-root'] ? path.resolve(options['extensions-root']) : path.join(temporary, 'extensions');
    const cliProfile = [`--extensions-dir=${extensionsRoot}`, `--user-data-dir=${path.join(temporary, 'user-cli')}`];
    const command = (name, args) => runCommand(cli, [cliScript, ...args, ...cliProfile],
      { log: path.join(output, `${name}.log`), env: { ELECTRON_RUN_AS_NODE: '1', VSCODE_TEST: undefined } });
    const version = await command('host-version', ['--version']);
    assert.equal(version.stdout.trim().split(/\r?\n/u)[0], options.host, 'The actual VS Code executable must have the requested version');
    summary.actualHost = version.stdout.trim();
    await command('install-target', ['--install-extension', artifact, '--force', '--do-not-include-pack-dependencies']);
    const existing = await command('registry-before', ['--list-extensions', '--show-versions']);
    for (const [id, version] of Object.entries(dependencies)) {
      if (!existing.stdout.split(/\r?\n/u).includes(`${id}@${version}`)) {
        await command(`install-${id}`, ['--install-extension', `${id}@${version}`, '--force', '--do-not-include-pack-dependencies']);
      }
    }
    const registry = await command('registry-installed', ['--list-extensions', '--show-versions']);
    summary.registry = registry.stdout.trim().split(/\r?\n/u);
    for (const [id, version] of Object.entries({ ...dependencies, 'upscaled-dev.behave-test-runner': manifest.version })) {
      assert.ok(summary.registry.includes(`${id}@${version}`), `Installed registry must contain ${id}@${version}`);
    }
    for (const framework of options.framework ? [options.framework] : ['behave', 'pytest-bdd']) {
      const userData = path.join(temporary, `user-${framework}`);
      fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
      writeJson(path.join(userData, 'User/settings.json'), {
        'security.workspace.trust.enabled': false, 'extensions.autoCheckUpdates': false, 'extensions.autoUpdate': false,
        'update.mode': 'none', 'telemetry.telemetryLevel': 'off', 'python.experiments.enabled': false,
      });
      const configPath = prepare({ root: output, framework, python: options.python, extensionsRoot, userData,
        targetVersion: manifest.version, bundleSha256: summary.package.bundleSha256 });
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const args = [config.workspace, `--extensions-dir=${extensionsRoot}`, `--user-data-dir=${userData}`,
        '--disable-extension=alexkrechik.cucumberautocomplete', '--no-sandbox', '--disable-gpu-sandbox', '--disable-gpu',
        '--disable-updates', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
        `--extensionDevelopmentPath=${path.join(__dirname, 'harness')}`, `--extensionTestsPath=${path.join(__dirname, 'index.cjs')}`];
      await runCommand(executable, args, { log: path.join(output, `${framework}-host.log`), timeoutMs: 240000,
        env: { ELECTRON_RUN_AS_NODE: undefined, VSCODE_TEST: undefined, BEHAVE_INSTALLED_CONFIG: configPath, BEHAVE_INSTALLED_PHASES: 'run,definition,debug' } });
      const evidence = JSON.parse(fs.readFileSync(config.evidence, 'utf8'));
      summary.journeys[framework] = { status: evidence.status, evidence: config.evidence };
      assert.equal(evidence.status, 'passed');
      assert.equal(evidence.vscode, options.host);
      for (const dependency of evidence.dependencies) { assert.equal(dependency.version, dependencies[dependency.id]); }
    }
    summary.status = 'passed';
  } catch (error) {
    summary.status = 'failed'; summary.error = error.stack ?? String(error);
    throw error;
  } finally {
    finalizeEvidence(temporary, output, summary);
  }
}

if (require.main === module) {
  Promise.resolve().then(() => main(parseOptions(process.argv.slice(2)))).catch(error => {
    console.error(error.stack ?? error); process.exitCode = 1;
  });
}

module.exports = { parseOptions, electronCli, runCommand, finalizeEvidence, main };
