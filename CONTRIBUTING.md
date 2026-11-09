# Contributing to Behave Test Runner

Thank you for your interest in contributing to the Behave Test Runner VS Code extension! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Release Process](#release-process)

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Getting Started

### Prerequisites

- Node.js 20.x or later
- npm or yarn
- VS Code 1.99.0 or later
- Python with Behave installed (`pip install behave`)

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/your-username/behave-test-runner.git
   cd behave-test-runner
   ```

## Development Setup

### Install Dependencies

```bash
npm install
```

### Build the Extension

```bash
# Compile TypeScript
npm run compile

# Watch for changes
npm run watch

# Package for distribution
npm run package:vsix
```

### Run Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:parser
npm run test:execution

# Run with verbose output
npm run test:verbose
```

The native execution tests require real Python frameworks. The fixture baseline uses Behave 1.3.3, pytest 7.4.4, pytest-bdd 8.1.0, and debugpy 1.8.20. pytest-xdist 3.6.1 is a test dependency used to verify that distributed execution is rejected before any body runs. The populated native acceptance paths also passed with Behave 1.2.6. Install the pinned fixture versions before running the suite:

```bash
python3 -m pip install -r src/test/fixtures/execution/requirements.txt
TEST_GREP='Execution selection acceptance' npm test

# Exercise a different isolated Python environment
BEHAVE_TEST_PYTHON='/path/to/venv/bin/python' TEST_GREP='Execution selection acceptance' npm test
```

Run the collection adapter's bounded Python checks and native acceptance on both supported metadata layouts. Keep the 8.1.0 baseline unchanged. For 9.0.0, create a separate environment using Python 3.10 or later:

```bash
python3.12 -m venv /tmp/behave-pytest9
/tmp/behave-pytest9/bin/python -m pip install 'pytest==7.4.4' 'pytest-bdd==9.0.0' 'behave==1.3.3' 'debugpy==1.8.20' 'pytest-xdist==3.6.1'
/tmp/behave-pytest9/bin/python -B src/test/python/collection_plugin_test.py
BEHAVE_TEST_PYTHON=/tmp/behave-pytest9/bin/python TEST_GREP='Pytest collection identity acceptance' npm test
```

The baseline interpreter can run the same Python checks. `vsce ls` must include `python/behave_pytest_plugin.py` and exclude its bytecode; listing assets does not package, publish or change the version. The `pytestBddFilePattern` setting remains unused pending its own configuration contract; native pytest collection configuration governs Python modules.

`TEST_GREP='Project context acceptance' npm test` exercises two real workspace folders with identical relative feature paths and scenario titles. Project A uses Behave and project B uses pytest-bdd, distinct configured command prefixes and relative working directories. Acceptance observes the actual project-B process invocation, project-specific step ledgers, delegated native TestRun outcomes and mixed Run All. Folder changes complete through workspace events. A removal-after-capture regression retains B's target outside its cwd and native outcome while rejecting later requests. Framework detection is also exercised with every explicit override absent. Preserve the first workspace folder when adding temporary roots so the native extension host stays alive.

The command palette displays pytest native output in the Behave Test Runner output channel from the single captured execution, including stderr. The shipped Python plugin selects actual collected bindings and reports physical Gherkin row locations without inferring Python names or parsing parameter IDs.

Shutdown regressions use controlled child events, debug events, and acknowledgement timers. An unconfirmed termination must end the user operation with an error, block new admission, and retain observers and reports until termination is confirmed. A parent close after a failed Windows tree stop is insufficient confirmation. Cancellation acceptance preserves a completed result, skips running and unstarted selections, and confirms descendant absence before the native TestRun ends. Parallel acceptance calls the public command with real workers and asserts its failure message. Primary report acceptance covers both frameworks through capture, parsing, and the real output channel at DEBUG level. A real failed Behave report is also replayed through native TestRun methods with two tag aliases: streamed output and every report-derived message share one 1 MiB payload budget. One operation truncation notice and fixed per-item status summaries are bounded control text outside that payload budget.

These tests run Behave and pytest-bdd against temporary populated projects, assert append-only step ledgers and native TestItem outcomes, and fail when Python dependencies are missing. The debug acceptance test calls the production provider, runs the real debugpy adapter from a test extension, asserts a breakpoint at the selected step source and line, cancels the matching native session, and retries. This validates execution ownership and Python debugging; integration with the installed Microsoft Python extension remains a manual check. Collection acceptance covers arbitrary binding names, repeated Examples values, extra parameters and separate Python bindings, real mixed row outcomes, unique and ambiguous name selection, lexical symlink workspace paths, nested pytest configuration, marker filtering, dry runs and non-BDD suite tests. A real xdist command is rejected before any body runs. Its selected-row breakpoint evaluates the actual parameter value in the paused Python frame.

The native runner uses pinned VS Code 1.142.0 and creates a temporary populated workspace, user profile, and extension directory for each run. It activates the built extension and waits for Mocha completion. `npm test` builds the extension before launching the trusted host, then launches a separate restricted host and asserts populated discovery with no execution or generated workspace files. The restricted pass uses the native executable directly because test-electron forces workspace trust off. Focused `TEST_GREP` runs use the trusted host; run `TEST_WORKSPACE_TRUST=untrusted npm run test:fast` for the restricted pass.

```bash
# Focus a suite through the same runner
TEST_GREP='Foundation lifecycle acceptance' npm test

# Exercise the minimum version declared in package.json
VSCODE_VERSION=minimum npm test

# Choose another host version or an existing executable
VSCODE_VERSION=1.124.0 npm test
VSCODE_EXECUTABLE_PATH='/path/to/code' npm test
```

The version pin makes the baseline repeatable; update it deliberately when validating a newer host. On macOS the runner supports both `Electron` and `Code` archive executable names. It clears inherited Electron Node mode and the old activation bypass before starting the host. The temporary workspace and profile are removed after host exit.

### Linting and Code Quality

```bash
# Run ESLint
npm run lint

# Fix ESLint issues
npm run lint:fix

# Type checking
npm run check-types
```

## Project Structure

```
src/
├── core/                    # Core functionality
│   └── test-executor.ts    # Test execution logic
├── parsers/                # File parsing
│   └── feature-parser.ts   # Gherkin feature file parser
├── test-providers/         # VS Code test integration
│   └── behave-test-provider.ts
├── commands/               # VS Code commands
│   └── command-manager.ts  # Command registration and handling
├── utils/                  # Utilities
│   └── logger.ts          # Logging utility
├── types/                  # TypeScript type definitions
│   └── index.ts           # Shared interfaces and types
└── extension.ts           # Main extension entry point

scripts/
├── build/                  # Build scripts
│   └── esbuild.cjs       # Build configuration
└── test/                  # Test scripts
    └── run-tests.js      # Test runner

src/test/                  # Test files
├── suite/                 # Test suite configuration
└── *.test.ts             # Test files
```

## Coding Standards

### TypeScript

- Use strict TypeScript configuration
- Prefer interfaces over types for object shapes
- Use explicit return types for public functions
- Avoid `any` type - use proper typing
- Use ES modules (`import`/`export`)

### Code Style

- Follow ESLint configuration
- Use 2-space indentation
- Use single quotes for strings
- Use semicolons
- Use trailing commas in objects and arrays
- Maximum line length: 100 characters

### Naming Conventions

- Use camelCase for variables and functions
- Use PascalCase for classes and interfaces
- Use UPPER_CASE for constants
- Use descriptive names that explain intent

### Documentation

- Document all public APIs with JSDoc comments
- Include examples in documentation
- Keep README.md up to date
- Document configuration options

### Example

```typescript
/**
 * Parses a Gherkin feature file and extracts scenarios
 * @param filePath - Path to the feature file
 * @returns Parsed feature or null if parsing fails
 */
export function parseFeatureFile(filePath: string): ParsedFeature | null {
  // Implementation
}
```

## Testing

### Test Structure

- Unit tests for individual functions and classes
- Integration tests for VS Code API integration
- Parser tests for Gherkin parsing functionality
- Execution tests for test running functionality

### Writing Tests

```typescript
import * as assert from 'assert';
import { FeatureParser } from '../../parsers/feature-parser.js';

suite('Parser Test Suite', () => {
  test('Should parse valid feature file', () => {
    const content = `
Feature: Calculator
  Scenario: Add two numbers
    Given I have entered 50 into the calculator
    When I press add
    Then the result should be 120 on the screen
`;

    const result = FeatureParser.parseFeatureContent(content, '/test.feature');

    assert.ok(result);
    assert.strictEqual(result?.feature, 'Calculator');
    assert.strictEqual(result?.scenarios.length, 1);
  });
});
```

### Test Guidelines

- Test both success and failure cases
- Test edge cases and error conditions
- Use descriptive test names
- Keep tests focused and isolated
- Mock external dependencies

## Submitting Changes

### Commit Messages

Use conventional commit format:

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

Examples:
```
feat(parser): add support for scenario outlines
fix(test-executor): handle missing behave installation
docs(readme): update installation instructions
```

### Pull Request Process

1. Create a feature branch from `main`
2. Make your changes following coding standards
3. Add tests for new functionality
4. Update documentation as needed
5. Run all tests and ensure they pass
6. Submit a pull request with a clear description

### Pull Request Guidelines

- Provide a clear title and description
- Reference related issues
- Include screenshots for UI changes
- Ensure all CI checks pass
- Request reviews from maintainers

## Release Process

### Versioning

This project follows [Semantic Versioning](https://semver.org/):
- **Patch** (0.0.x): Bug fixes, documentation
- **Minor** (0.x.0): New features (non-breaking)
- **Major** (x.0.0): Breaking changes

### Release Steps

1. Ensure all tests and `npm run test:release` pass.
2. Run one explicit `npm run release:patch`, `release:minor`, or `release:major` command. `commit-and-tag-version` updates `package.json`, both lockfile versions and the changelog, then creates the release commit and `v<version>` tag.
3. Review and push that commit and tag when the release is authorized.
4. The tag workflow checks the version before building, creates and validates one VSIX, and uploads that same artifact to GitHub and the Marketplace. A missing `VSCE_PAT` skips Marketplace publication; invalid or missing artifacts fail.

### Automated Versioning

The explicit release commands are the only version owner. `npm run package` builds the production bundle, and `npm run package:vsix` builds and verifies `dist/behave-test-runner-<version>.vsix` without changing tracked versions or creating a commit or tag. The pinned local `@vscode/vsce` is installed by `npm ci`; no global tool is needed. `npm run verify:vsix` checks an existing archive against the current manifest, bundle and Python plugin. Source maps, source, tests and bytecode are excluded.

`npm run test:release` builds the same version twice, reads the real ZIP metadata and runtime assets, and tests rejection and retry without publishing. Local artifact checks do not establish installed-extension or cross-platform acceptance.

The project uses `commit-and-tag-version` for automated versioning:

```bash
# Patch release
npm run release:patch

# Minor release
npm run release:minor

# Major release
npm run release:major
```

## Getting Help

- 📖 [Documentation](README.md)
- 🐛 [Issue Tracker](https://github.com/your-username/behave-test-runner/issues)
- 💬 [Discussions](https://github.com/your-username/behave-test-runner/discussions)

## License

By contributing to this project, you agree that your contributions will be licensed under the MIT License.
