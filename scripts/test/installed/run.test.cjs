const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { runCommand, parseOptions, electronCli, finalizeEvidence } = require('./run.cjs');

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'installed-runner-boundary-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('official CLI layouts resolve on macOS, Linux and Windows', () => {
  const cases = [
    ['darwin', '/Applications/Visual Studio Code.app/Contents/MacOS/Code', '/Applications/Visual Studio Code.app/Contents/Resources/app/out/cli.js'],
    ['linux', '/opt/VSCode-linux-arm64/code', '/opt/VSCode-linux-arm64/resources/app/out/cli.js'],
    ['win32', 'C:\\Program Files\\VS Code\\Code.exe', 'C:\\Program Files\\VS Code\\resources\\app\\out\\cli.js'],
  ];
  for (const [platform, executable, script] of cases) {
    assert.deepEqual(electronCli(executable, platform, file => file === script), [executable, script]);
  }
  assert.throws(() => electronCli('/missing/code', 'linux', () => false), /CLI script is missing/u);
});

test('command arguments reach the child literally and inherited secrets stay out of evidence', async t => {
  const directory = temporary(t);
  const log = path.join(directory, 'literal arguments & symbols.log');
  const args = ['path with spaces', 'quotes" and apostrophe\'', '&|;%PATH%$(printf unwanted)', 'unicode-é'];
  process.env.INSTALLED_RUNNER_PRIVATE_SENTINEL = 'private-value-must-not-be-recorded';
  t.after(() => { delete process.env.INSTALLED_RUNNER_PRIVATE_SENTINEL; });
  const result = await runCommand(process.execPath,
    ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...args],
    { log, env: { BEHAVE_INSTALLED_PHASES: 'run' } });
  assert.deepEqual(JSON.parse(result.stdout), args);
  const description = fs.readFileSync(`${log}.command.json`, 'utf8');
  assert.ok(!description.includes('private-value-must-not-be-recorded'));
  assert.deepEqual(JSON.parse(description).env, { BEHAVE_INSTALLED_PHASES: 'run' });
  assert.equal(JSON.parse(description).shell, false);
});

test('a missing executable fails and retains the command failure', async t => {
  const directory = temporary(t);
  const log = path.join(directory, 'launch-failure.log');
  await assert.rejects(runCommand(path.join(directory, 'missing-executable'), [], { log }), /ENOENT/u);
  assert.match(JSON.parse(fs.readFileSync(`${log}.command.json`, 'utf8')).error, /ENOENT/u);
});

test('cancellation waits for the owned child tree to close', { timeout: 20000 }, async t => {
  const directory = temporary(t);
  const controller = new AbortController();
  let descendant;
  t.after(() => { if (descendant) { try { process.kill(descendant, 'SIGKILL'); } catch {} } });
  const childCode = 'process.on("SIGTERM",()=>{}); console.log("OWNED_READY:"+process.pid); setInterval(()=>{},1000)';
  const parentCode = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], {stdio:'inherit'}); setInterval(()=>{},1000)`;
  await assert.rejects(runCommand(process.execPath, ['-e', parentCode], {
    log: path.join(directory, 'cancel.log'), signal: controller.signal,
    onOutput(text) {
      const match = /OWNED_READY:(\d+)/u.exec(text);
      if (match) { descendant = Number(match[1]); controller.abort(); }
    },
  }), /cancelled/u);
  assert.ok(descendant, 'Cancel only after the real descendant reports readiness');
  if (process.platform === 'win32') {
    assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' });
  } else {
    const result = spawnSync('ps', ['-p', String(descendant), '-o', 'stat='], { encoding: 'utf8' });
    assert.ifError(result.error);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    const status = result.stdout.trim();
    assert.ok(!status || status.startsWith('Z'), `Owned descendant must have stopped, observed ${status}`);
  }
});

test('the runner rejects floating hosts and relative interpreter paths before launching', () => {
  const base = ['--artifact', 'test.vsix', '--output', 'evidence', '--host'];
  assert.throws(() => parseOptions([...base, 'stable', '--python', process.execPath]), /pinned/u);
  assert.throws(() => parseOptions([...base, '1.99.0', '--python', 'python3']), /absolute/u);
});

test('archive and removal failures retain the original journey error and always save a failed summary', t => {
  const directory = temporary(t);
  const owned = path.join(directory, 'temporary');
  fs.mkdirSync(path.join(owned, 'user-behave/logs'), { recursive: true });
  const summary = { status: 'failed', error: 'original journey failure' };
  finalizeEvidence(owned, directory, summary, { ...fs,
    cpSync() { throw new Error('archive denied'); },
    rmSync() { throw new Error('remove denied'); },
  });
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'summary.json'), 'utf8'));
  assert.equal(saved.error, 'original journey failure');
  assert.equal(saved.status, 'failed');
  assert.ok(saved.finishedAt);
  assert.deepEqual(saved.cleanupErrors.map(error => error.phase), ['archive', 'remove']);
  assert.match(saved.cleanupErrors[0].error, /archive denied/u);
  assert.match(saved.cleanupErrors[1].error, /remove denied/u);
});

test('cleanup failure after passing journeys fails overall after saving the summary', t => {
  const directory = temporary(t);
  const owned = path.join(directory, 'temporary');
  fs.mkdirSync(owned);
  const summary = { status: 'passed' };
  assert.throws(() => finalizeEvidence(owned, directory, summary, { ...fs,
    rmSync() { throw new Error('remove denied'); },
  }), /cleanup failed/u);
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'summary.json'), 'utf8'));
  assert.equal(saved.status, 'failed');
  assert.ok(saved.finishedAt);
  assert.equal(saved.cleanupErrors[0].phase, 'remove');
});
