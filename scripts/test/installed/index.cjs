const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const extensionId = 'upscaled-dev.behave-test-runner';
const timeoutMs = 45000;

function sameFile(actual, expected) {
  return typeof actual === 'string' && typeof expected === 'string'
    && vscode.Uri.file(actual).fsPath === vscode.Uri.file(expected).fsPath;
}

function observation(name, subscribe, inspect) {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  // An observation can fail while its initiating command is still pending.
  promise.catch(() => {});
  const check = () => {
    try { const value = inspect(); if (value !== undefined) { resolve(value); } }
    catch (error) { reject(error); }
  };
  const listener = subscribe(check, reject);
  const timer = setTimeout(() => reject(new Error(`Timed out observing ${name}`)), timeoutMs);
  check();
  return { promise, check, fail: reject, dispose() { clearTimeout(timer); listener.dispose(); } };
}

async function bounded(pending, name, milliseconds = timeoutMs) {
  let timer;
  try {
    return await Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function installed(extension, root) {
  assert.ok(extension, 'Expected extension is installed');
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(extension.extensionPath));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `${extension.id} must load from the isolated extensions root`);
  return { id: extension.id, version: extension.packageJSON.version, path: extension.extensionPath,
    developmentFlag: 'not exposed by the stable vscode.Extension API' };
}

function allItems(controller) {
  const found = [];
  const visit = item => { found.push(item); item.children.forEach(visit); };
  controller.items.forEach(visit);
  return found;
}

function ledger(config) {
  return fs.readFileSync(path.join(config.workspace, 'ledger.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
}

function savedRuns(userData) {
  const storage = path.join(userData, 'User/workspaceStorage');
  if (!fs.existsSync(storage)) { return []; }
  return fs.readdirSync(storage).flatMap(workspace => {
    const directory = path.join(storage, workspace, 'testResults');
    if (!fs.existsSync(directory)) { return []; }
    return fs.readdirSync(directory).filter(file => file.endsWith('.json')).flatMap(file => {
      // VS Code publishes the file asynchronously; a later filesystem event observes completion.
      try { return [JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))]; }
      catch { return []; }
    });
  });
}

function observeNativePass(config, selected) {
  const before = new Set(savedRuns(config.userData).map(run => run.id));
  return observation(`native passed TestItem ${selected.label}`, (check, fail) => {
    const watcher = fs.watch(config.userData, { recursive: true }, check);
    watcher.on('error', fail);
    return { dispose: () => watcher.close() };
  }, () => {
    for (const run of savedRuns(config.userData)) {
      if (before.has(run.id) || !run.completedAt) { continue; }
      const item = run.items?.find(entry => entry.item.extId.split('\0').at(-1) === selected.id);
      if (item?.ownComputedState === 3) { return { runId: run.id, extId: item.item.extId, state: item.ownComputedState }; }
    }
    return undefined;
  });
}

function outputDocument() {
  return vscode.workspace.textDocuments.find(document => {
    const uri = decodeURIComponent(document.uri.toString());
    return document.uri.scheme === 'output' && uri.includes(extensionId) && uri.includes('Behave Test Runner');
  });
}

function onDocuments(check) {
  const opened = vscode.workspace.onDidOpenTextDocument(check);
  const changed = vscode.workspace.onDidChangeTextDocument(check);
  return { dispose() { opened.dispose(); changed.dispose(); } };
}

function observeOutput(before, config, evidence) {
  return observation('selected operation in the installed output channel', onDocuments, () => {
    const document = outputDocument();
    if (!document) { return undefined; }
    const text = document.getText();
    assert.ok(text.startsWith(before), 'Output history must retain the operation boundary');
    const added = text.slice(before.length);
    evidence.output = { uri: document.uri.toString(), text: added };
    const selectedPassed = config.framework === 'behave'
      ? added.includes(config.selectedName) && added.includes(`I record "${config.selectedEntry}"`)
      : added.split(/\r?\n/).some(line => line.includes(config.outputTestId) && /\sPASSED\b/u.test(line))
        && /\b1 passed, 3 deselected\b/u.test(added);
    return selectedPassed ? evidence.output : undefined;
  });
}

async function runJourney(config, controller, selected, lenses, evidence) {
  const lens = lenses.find(item => item.range.start.line === selected.range.start.line && item.command?.command === 'behaveTestRunner.runScenario');
  assert.ok(lens?.command, 'The selected scenario must expose its real Run CodeLens');
  evidence.selected = { id: selected.id, label: selected.label };
  evidence.command = lens.command;
  fs.writeFileSync(path.join(config.workspace, 'ledger.txt'), '');
  const opened = observation('the installed extension output document', onDocuments, outputDocument);
  let before;
  try {
    await vscode.commands.executeCommand('behaveTestRunner.showOutput');
    before = (await opened.promise).getText();
  } finally { opened.dispose(); }
  const output = observeOutput(before, config, evidence);
  const passed = observeNativePass(config, selected);
  try {
    await bounded(vscode.commands.executeCommand(lens.command.command, ...(lens.command.arguments ?? [])), 'Run CodeLens command');
    evidence.commandCompleted = true;
    output.check(); passed.check();
    evidence.ledger = ledger(config);
    assert.deepEqual(evidence.ledger, [config.selectedEntry], 'Only the selected Python scenario must execute once');
    evidence.originalItemRetained = allItems(controller).find(item => item.id === selected.id) === selected;
    assert.equal(evidence.originalItemRetained, true, 'The original discovered native TestItem must be retained');
    evidence.native = await passed.promise;
    evidence.output = await output.promise;
    return evidence;
  } finally { output.dispose(); passed.dispose(); }
}

async function definitionJourney(config, document, evidence) {
  const line = document.getText().split(/\r?\n/).findIndex(text => text.includes(`I record "${config.selectedEntry}"`));
  assert.ok(line >= 0, 'The populated feature must contain the selected step');
  const position = new vscode.Position(line, 12);
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(position, position);
  const definitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', document.uri, position);
  evidence.candidates = (definitions ?? []).map(definition => {
    const uri = definition.uri ?? definition.targetUri;
    const range = definition.range ?? definition.targetSelectionRange;
    return { uri: uri.toString(), path: uri.fsPath,
      range: { start: { line: range.start.line + 1, character: range.start.character },
        end: { line: range.end.line + 1, character: range.end.character } } };
  });
  assert.equal(definitions?.length, 1, `F12 must have one real Python definition. Candidates: ${JSON.stringify(evidence.candidates)}`);
  const definition = definitions[0];
  const uri = definition.uri ?? definition.targetUri;
  const range = definition.range ?? definition.targetSelectionRange;
  assert.ok(sameFile(uri.fsPath, config.stepSource), 'The definition must target the selected Python step file');
  assert.equal(range.start.line, config.definitionLine);
  const revealed = observation('F12 editor selection at the Python step definition', check => {
    const active = vscode.window.onDidChangeActiveTextEditor(check);
    const selection = vscode.window.onDidChangeTextEditorSelection(check);
    return { dispose() { active.dispose(); selection.dispose(); } };
  }, () => {
    const active = vscode.window.activeTextEditor;
    return sameFile(active?.document.uri.fsPath, config.stepSource) && active.selection.start.line === config.definitionLine
      ? { path: active.document.uri.fsPath, line: active.selection.start.line + 1 } : undefined;
  });
  try {
    await vscode.commands.executeCommand('editor.action.revealDefinition');
    revealed.check();
    evidence.provider = { path: uri.fsPath, line: range.start.line + 1 };
    evidence.editor = await revealed.promise;
    return evidence;
  } finally { revealed.dispose(); }
}

async function debugJourney(config, lenses, selected, evidence) {
  const lens = lenses.find(item => item.range.start.line === selected.range.start.line && item.command?.command === 'behaveTestRunner.debugScenario');
  assert.ok(lens?.command, 'The selected scenario must expose its real Debug CodeLens');
  const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(config.stepSource), new vscode.Position(config.breakpointLine, 0)));
  let owned;
  let stoppedEvent;
  let terminate;
  let fail;
  let didTerminate = false;
  const terminated = new Promise(resolve => { terminate = resolve; });
  const stopped = new Promise((resolve, reject) => {
    fail = reject;
    stoppedEvent = resolve;
  });
  stopped.catch(() => {});
  const dap = [];
  evidence.dap = dap;
  evidence.command = lens.command;
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory('debugpy', {
    createDebugAdapterTracker(session) {
      if (!session.configuration.__behaveExecutionId || !sameFile(session.configuration.cwd, config.workspace)) { return undefined; }
      owned = session;
      evidence.sessionId = owned.id;
      evidence.type = owned.type;
      evidence.python = owned.configuration.python;
      return {
        onDidSendMessage(message) {
          if (message.type === 'event' && ['stopped', 'terminated', 'exited'].includes(message.event)) {
            dap.push({ event: message.event, body: message.body });
          }
          if (message.type === 'event' && message.event === 'stopped') { stoppedEvent(message.body); }
        },
        onError: error => fail(error),
      };
    },
  });
  const ended = vscode.debug.onDidTerminateDebugSession(session => {
    if (session.id === owned?.id) { didTerminate = true; terminate(); }
  });
  fs.writeFileSync(path.join(config.workspace, 'ledger.txt'), '');
  vscode.debug.addBreakpoints([breakpoint]);
  let command;
  try {
    command = Promise.resolve(vscode.commands.executeCommand(lens.command.command, ...(lens.command.arguments ?? [])));
    command.catch(error => fail(error));
    const stop = await bounded(stopped, 'real Python breakpoint stop');
    evidence.stop = stop;
    assert.equal(stop.reason, 'breakpoint', 'Debug acceptance requires a real source breakpoint');
    assert.ok(owned, 'A real Microsoft debugpy session must own the stop');
    assert.equal(owned.type, 'debugpy');
    assert.ok(sameFile(owned.configuration.python, config.python), 'The debugger must run the selected pinned Python interpreter');
    const stack = await bounded(owned.customRequest('stackTrace', { threadId: stop.threadId, startFrame: 0, levels: 20 }), 'Python stack trace');
    const frame = stack.stackFrames[0];
    evidence.frame = { name: frame.name, path: frame.source.path, line: frame.line };
    assert.ok(sameFile(frame.source.path, config.stepSource), 'The stopped frame must target the selected Python step file');
    assert.equal(frame.line, config.breakpointLine + 1);
    await owned.customRequest('continue', { threadId: stop.threadId });
    await bounded(Promise.all([terminated, command]), 'debug termination and extension operation completion');
    evidence.ledger = ledger(config);
    assert.deepEqual(evidence.ledger, [config.selectedEntry], 'The real debug run must execute only the selected scenario once');
    assert.deepEqual(dap.filter(event => event.event === 'exited').map(event => event.body.exitCode), [0],
      'The real Python debug run must report exactly one successful exit');
    return evidence;
  } finally {
    vscode.debug.removeBreakpoints([breakpoint]);
    try {
      if (owned && !didTerminate) {
        await bounded(Promise.all([vscode.debug.stopDebugging(owned), terminated]), 'owned debug cleanup', 15000);
      }
    } finally { tracker.dispose(); ended.dispose(); }
  }
}

async function run() {
  const config = JSON.parse(fs.readFileSync(process.env.BEHAVE_INSTALLED_CONFIG, 'utf8'));
  if (process.platform === 'win32') {
    const uppercaseDrive = config.feature.replace(/^[a-z]:/iu, drive => drive.toUpperCase());
    assert.ok(sameFile(vscode.Uri.file(config.feature).fsPath, uppercaseDrive),
      'Windows path comparison must match a URI path to an uppercase input drive');
  } else {
    assert.equal(sameFile('/case/Step.py', '/case/step.py'), false, 'POSIX path comparison must preserve filename case');
  }
  const evidence = { platform: process.platform, architecture: process.arch, vscode: vscode.version, framework: config.framework,
    workspace: config.workspace, python: config.python, startedAt: new Date().toISOString(), journeys: {} };
  try {
    assert.equal(vscode.workspace.isTrusted, true, 'The installed execution workspace must be trusted');
    const target = vscode.extensions.getExtension(extensionId);
    evidence.target = installed(target, config.extensionsRoot);
    assert.equal(target.packageJSON.version, config.targetVersion, 'The installed target version must match the package under test');
    const actualHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(target.extensionPath, 'dist/extension.js'))).digest('hex');
    assert.equal(actualHash, config.bundleSha256, 'The installed bundle must match the tested package build');
    evidence.target.bundleSha256 = actualHash;
    const api = await target.activate();
    assert.ok(api?.testController, 'The installed extension must expose its native controller');
    await vscode.commands.executeCommand('behaveTestRunner.discoverTests');
    const selected = allItems(api.testController).find(item => item.label === config.selectedName && sameFile(item.uri?.fsPath, config.feature));
    assert.ok(selected, `The real discovered scenario '${config.selectedName}' must exist`);
    evidence.discovered = allItems(api.testController).map(item => ({ id: item.id, label: item.label, path: item.uri?.fsPath }));
    const document = await vscode.workspace.openTextDocument(config.feature);
    await vscode.window.showTextDocument(document);
    const lenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', document.uri, 100);
    assert.ok(lenses?.length, 'The installed CodeLens provider must produce populated scenario actions');
    const phases = (process.env.BEHAVE_INSTALLED_PHASES ?? 'run,definition,debug').split(',');
    assert.ok(phases.length && phases.every(phase => ['run', 'definition', 'debug'].includes(phase)), 'Select named installed acceptance phases');
    if (phases.includes('run')) {
      evidence.journeys.run = {};
      await runJourney(config, api.testController, selected, lenses, evidence.journeys.run);
    }
    if (phases.includes('definition')) {
      evidence.journeys.definition = {};
      await definitionJourney(config, document, evidence.journeys.definition);
    }
    if (phases.includes('debug')) {
      evidence.dependencies = ['ms-python.python', 'ms-python.debugpy'].map(id => installed(vscode.extensions.getExtension(id), config.extensionsRoot));
      evidence.journeys.debug = {};
      await debugJourney(config, lenses, selected, evidence.journeys.debug);
    }
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed'; evidence.error = error.stack ?? String(error);
    throw error;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(config.evidence, JSON.stringify(evidence, null, 2));
    console.log(`Installed acceptance ${evidence.status}: ${config.evidence}`);
  }
}

module.exports = { run };
