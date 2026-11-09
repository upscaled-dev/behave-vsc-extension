# Installed extension journeys

This driver loads Behave Test Runner from an isolated installed extension registry.
Only `harness/` is a development extension. The target and Microsoft Python
extensions must be installed under the supplied extensions directory.

The portable runner installs the packaged VSIX and pinned Microsoft Python
2026.10.0 and debugpy 2026.6.0 through the official CLI, then runs both frameworks:

```sh
npm ci
python -m pip install -r src/test/fixtures/execution/requirements.txt
npm run compile-tests
npm run package:vsix
node scripts/test/installed/run.cjs --artifact dist/behave-test-runner-1.2.42.vsix --output installed-evidence --host 1.142.0 --python /absolute/path/to/python
```

Use the versioned VSIX produced by packaging. `--host` accepts `1.142.0` or
`1.99.0`. `--python` must be absolute and provide the exact requirements,
including debugpy 1.8.20. The output directory must be fresh. On headless Linux,
prefix the runner command with `xvfb-run -a`. Optional `--executable` selects an
existing absolute VS Code executable; its real version is checked. Optional
`--extensions-root` reuses an isolated extension directory and preserves it.
Optional `--framework behave` or `--framework pytest-bdd` selects one framework.

The runner invokes Electron with argument arrays and `shell: false`. Only the
test driver is a development extension. It uses the lockfile-pinned test SDK
2.5.2 for downloads and owned process termination. Failed or cancelled commands
terminate only their own process tree. Short temporary profiles are copied into
the output's `profiles/` directory before owned temporary files are removed;
user-supplied extension directories are never removed. Evidence includes the
tested VSIX, archive and bundle hashes, actual host and Python versions, CLI
registry, exact command arguments, named environment overrides, journey JSON,
and host logs. Inherited environment variables and credentials are not recorded.

`.github/workflows/installed-journeys.yml` runs the same command on Windows,
Ubuntu and macOS for both pinned hosts. It supports manual dispatch, pushes to
`validation/installed-*` branches, and pull requests changing the workflow or
harness. It grants only `contents: read`, limits each job to 30 minutes, and
uploads evidence on every outcome. It packages without changing the version and
does not publish. Workflow presence does not establish platform acceptance:
Windows and other remote platforms require successful retained journey artifacts.

This slice explicitly disables `alexkrechik.cucumberautocomplete`. Default
companion coexistence remains OPEN: Cucumber 3.1 can contribute the original
feature position alongside the Python definition. The driver retains every
candidate and requires one exact Python target; it never removes competing
candidates to make F12 pass.

Use the existing real execution fixtures to prepare one fresh workspace per host:

```sh
node scripts/test/installed/prepare.cjs ROOT FRAMEWORK PYTHON EXTENSIONS_ROOT USER_DATA dist/extension.js
```

`FRAMEWORK` is `behave` or `pytest-bdd`. `PYTHON` is an absolute interpreter path
with the packages in `src/test/fixtures/execution/requirements.txt` installed.
`ROOT/FRAMEWORK` must not already exist. The command prints the generated config
path. The fixtures are copied unchanged; settings select that interpreter and
framework before activation.

Launch the real host through `@vscode/test-electron.runTests` with:

- `extensionDevelopmentPath`: the absolute `harness/` directory.
- `extensionTestsPath`: the absolute `index.cjs` path.
- `launchArgs`: the generated workspace, the same `--extensions-dir` and
  `--user-data-dir` passed to preparation, and the caller's isolated host flags.
- `extensionTestsEnv.BEHAVE_INSTALLED_CONFIG`: the generated config path.
- `extensionTestsEnv.BEHAVE_INSTALLED_PHASES`: `run,definition` for the first happy
  path, `debug` for the real debugger check, or `run,definition,debug` for all.

The caller owns VSIX installation, Microsoft extension installation, host version
selection, process drainage, platform availability, and retained launch logs.
The driver verifies the target installation path, version and bundle hash
before activating it through `vscode.extensions`. Stable `vscode.Extension`
does not expose a development flag; evidence records that API limitation. The
caller must retain the CLI installation registry and exact launch options showing
that only `harness/` is a development extension. The driver reads the activation
API's native controller to retain TestItem identities. It never imports the
target bundle, calls provider methods, or replaces production APIs.

The Run journey invokes the real selected scenario CodeLens command, checks its
exact Python ledger, retains the discovered TestItem object, observes its passed
state in VS Code's saved native test results, and captures the operation's text
from the target extension's actual Output document. Behave output must include
the selected scenario and step. Native pytest output must include the selected
collected node ID with `PASSED` and the populated fixture's `1 passed, 3 deselected`
summary. Partial output, ledger and native state remain in evidence if a later
observation fails. The native result file shape
is an internal host detail, so an incompatible host fails this check explicitly.

The definition journey checks the registered definition provider and executes
the editor's F12 command, then observes the Python editor selection. The Debug
journey uses the installed Microsoft debugger, stops at a real Python source
breakpoint, checks the top stack frame's file and line through DAP, continues,
and requires session termination, exactly one DAP exit with code zero, and the
exact selected ledger. It stops
only its own debug session on failure. Observations use events and bounded
failure deadlines.

Evidence is written to `ROOT/FRAMEWORK-evidence.json`, including partial results
and the error if a journey fails. These are native command/provider acceptance
checks. They do not claim mouse clicks, keyboard dispatch, or visual UI
inspection. Each platform must execute its own real host journey to earn
platform evidence.
