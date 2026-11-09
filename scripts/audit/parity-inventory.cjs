// Read the pinned reference through git, independent of its worktree changes.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const reference = process.argv[2];
if (!reference) throw new Error('Usage: node scripts/audit/parity-inventory.cjs <reference-repository>');
const revision = '8c4ad1f462631eb0fd88471bcd3ee87742f2b934';
const manifest = JSON.parse(execFileSync('git', ['-C', reference, 'show', `${revision}:package.json`], { encoding: 'utf8' }));
const document = fs.readFileSync(path.join(__dirname, '../../plans/2026-10-20-parity-inventory.md'), 'utf8');
const commands = manifest.contributes.commands.map(command => command.command);
const configs = manifest.contributes.configuration;
const settings = (Array.isArray(configs) ? configs : [configs]).flatMap(config => Object.keys(config.properties));
const expected = new Set([...commands, ...settings]);
const recorded = new Set([...document.matchAll(/`(playwrightBddRunner\.[\w.]+)`/g)].map(match => match[1]));
const missing = [...expected].filter(id => !recorded.has(id));
const stale = [...recorded].filter(id => !expected.has(id));
if (missing.length || stale.length) {
  console.error(JSON.stringify({ missing, stale }, null, 2)); process.exitCode = 1;
} else {
  console.log(`Pinned Specwright ${manifest.version}: ${commands.length} commands and ${settings.length} settings covered; no stale identifiers.`);
}
