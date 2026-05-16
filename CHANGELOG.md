# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [Unreleased]

### Features

* **gherkin-multi-examples**: Support multiple, named, and tagged `Examples:` blocks per scenario outline
  * **What**: Previously the parser required `Examples:` to be an exact string match, which silently dropped any block with a name (e.g. `Examples: Standard Amounts`). Multiple `Examples:` blocks per outline were also unsupported — only the last would survive even if the name issue were fixed. Both gaps are now closed.
  * **Block tags**: A `@tag` on the line immediately before `Examples:` is captured in the new `Scenario.examplesBlockTags` field and merged into each example's effective tags. The tag applies only to examples in that block, not the whole outline. Previously such tags would bleed onto the parent outline.
  * **Test Explorer hierarchy**: When an outline has any named or tagged Examples block, examples are now grouped under per-block test items (`Outline → Examples: <name> → Example`). Outlines with a single unnamed block keep the existing flat hierarchy for backward compatibility.
  * **Run-result mapping**: Test-result mapping loops in `BehaveTestProvider` now walk leaf descendants via the new `collectLeafTestItems` helper, so the deeper 3-level hierarchy correctly maps per-example pass/fail status after a run.
  * **New file**: `features/account-operations.feature` demonstrates named + tagged + multiple Examples blocks alongside `Background` and `Rule`.

* **gherkin-background**: Parse `Background:` steps at both feature and rule level
  * **What**: Background steps are captured on each affected scenario via the new `Scenario.backgroundSteps` field. Feature-level and rule-level backgrounds compose: a scenario inside a Rule receives both the feature `Background` and the rule's `Background`, in that order.
  * **Impact**: Behave already runs Background steps implicitly during execution — this change makes the metadata available to the extension. Background blocks no longer interfere with scenario step collection or line-number tracking.

* **gherkin-rule**: Parse `Rule:` keyword (Gherkin 6+)
  * **What**: Scenarios inside a `Rule:` block now carry the rule name in the new `Scenario.ruleName` field. Multiple `Rule:` blocks per feature are supported.
  * **Impact**: Rule names are not yet rendered as a separate level in the Test Explorer hierarchy — scenarios still appear directly under the feature item. The metadata is available for future grouping work.

### Tests

* **feature-parser-advanced**: Add `src/test/unit/feature-parser-advanced.test.ts` (8 tests) covering named/multiple/tagged Examples blocks, feature- and rule-level Background composition, multi-Rule features, and the full user-provided "Valid + Invalid Withdrawals" example. Existing parser tests remain green (backward compatible for the unnamed single-block case).

### Code Quality

* **codebase-slim**: Reduce verbosity across the core files on `refactor/decouple-large-classes` (~3,000 lines removed across 6 files, ~48% reduction)
  * `src/commands/command-manager.ts`: 1,784 → 609 lines. Consolidated 24 near-duplicate command handlers, extracted shared `errMsg(error)` helper, dropped redundant `try/catch` wrappers that only re-wrapped the message, removed entry/exit `logger.debug` pairs, collapsed the 6-arm strategy `switch` to a `STRATEGY_TYPE_BY_VALUE` lookup. Public API and all test-pinned private methods preserved.
  * `src/core/test-executor.ts`: 1,163 → 592 lines. Factored shared `buildScenarioCommandLegacy` / `buildFeatureCommandLegacy` helpers so the CommandBuilder path and the legacy-fallback path no longer duplicate option assembly. Kept legacy fallbacks because existing tests construct `TestExecutor` without a context.
  * `src/test-providers/behave-test-provider.ts`: 2,300 → 1,461 lines. Stripped trivial JSDoc, removed `logger.debug` / `logger.info` calls that only traced internal state, added `readonly` modifiers, dropped unused `getOrganizationStrategyName()` helper.
  * `src/utils/pytest-result-parser.ts`: 441 → 270 lines. Consolidated regex patterns into named module-level constants (`TEST_LINE_RE`, `SIMPLE_TEST_LINE_RE`, `FAILED_SUMMARY_RE`, `SUMMARY_RE`), unified the two summary-line shapes into one regex, factored `summarizeTests` and `emptySummary` helpers.
  * `src/core/extension-config.ts`: 339 → 190 lines. Stripped boilerplate JSDoc from one-line getters; behavior unchanged.
  * `src/utils/logger.ts`: 154 → 72 lines. Stripped JSDoc; behavior unchanged.
  * **Behavior**: No public API changes. All test-pinned methods preserved. Typecheck and lint pass.
  * **Audit**: Re-checked the four methods marked "USED" in `IMPLEMENTATION_CHECKLIST.md` (`forceRefreshTestExplorer`, `updateTestStatus`, `runFeatureFileLegacy`, `discoverFeatureFiles`). Three were genuinely in use and kept. `runFeatureFileLegacy` was confirmed unreferenced anywhere in `src/` or `scripts/` (the checklist claim was stale) and removed.

## [1.2.12](https://github.com/upscaled-dev/behave-vsc-extension/compare/v1.2.11...v1.2.12) (2025-08-01)

### Bug Fixes

* **framework-setting-override**: Fix manual framework setting being overridden by auto-detection ([#critical](https://github.com/upscaled-dev/behave-vsc-extension/issues/critical))
  * **Root Cause**: Extension was always using auto-detected framework even when user manually set framework in settings
  * **Impact**: Users who set `behaveTestRunner.framework` to "pytest-bdd" were still getting behave commands
  * **Solution**: Modified extension activation logic to respect manual framework settings over auto-detection. Auto-detection now only triggers when framework is still at default "behave" value.

## [1.2.7](https://github.com/upscaled-dev/behave-vsc-extension/compare/v1.2.4...v1.2.7) (2025-08-01)

### Bug Fixes

* **multiple-output-instances**: Fix multiple "Behave Test Runner" entries in VS Code output panel ([#critical](https://github.com/upscaled-dev/behave-vsc-extension/issues/critical))
  * **Root Cause**: Logger.create() was creating new output channels instead of using singleton pattern
  * **Impact**: Multiple extension activations created multiple output channels
  * **Fix**: Modified Logger.create() to use singleton instance when no output channel is provided
  * **Prevention**: Added comprehensive Logger singleton tests to prevent regression
  * **Additional**: Added protection against multiple extension activations

* **extension-cleanup**: Improve extension deactivation and resource cleanup
  * Add proper Logger singleton disposal in deactivate function
  * Clear all global references during cleanup
  * Add protection against multiple activations with early return

### Testing

* **logger-singleton**: Add comprehensive tests for Logger singleton pattern ([#test](https://github.com/upscaled-dev/behave-vsc-extension/issues/test))
  * New test file: `src/test/unit/logger-singleton.test.ts`
  * Verifies Logger.create() returns singleton instance when no parameters provided
  * Tests that Logger.create() with parameters returns new instances (for testing)
  * Ensures multiple activations use the same output channel
  * Validates Logger.getInstance() always returns the same instance

* **organization-strategy-integration**: Add real VS Code environment tests ([#test](https://github.com/upscaled-dev/behave-vsc-extension/issues/test))
  * New test file: `src/test/integration/organization-strategy-switching.test.ts`
  * Tests actual VS Code TestController and TestProvider integration
  * Verifies organization strategy switching works in real environment
  * Ensures test provider properly exposes required properties to command manager

## [1.2.4](https://github.com/upscaled-dev/behave-vsc-extension/compare/v1.2.0...v1.2.4) (2025-08-01)

### Bug Fixes

* **organization-strategy**: Fix organization strategy switching functionality
  * Add proper error handling and logging for strategy switching
  * Expose organization manager and discovery manager in BehaveTestProvider
  * Fix test provider compatibility with CommandManager interface
  * Add comprehensive logging to debug strategy switching issues

* **test-explorer**: Remove unnecessary Test Explorer configuration option
  * **Rationale**: Test Explorer is core functionality of a test runner extension
  * **Change**: Removed `behaveTestRunner.enableTestExplorer` setting
  * **Impact**: Test Explorer is now always enabled (as it should be)
  * **Benefit**: Simplifies configuration and prevents user confusion

* **extension-cleanup**: Improve extension deactivation and prevent multiple output entries
  * Add proper error handling in deactivate function
  * Improve cleanup order to prevent resource leaks
  * Add comprehensive logging for debugging extension lifecycle issues

### Configuration

* **simplification**: Remove redundant Test Explorer configuration
  * Removed `behaveTestRunner.enableTestExplorer` setting
  * Test Explorer is now always enabled (core functionality)
  * Simplified configuration for better user experience

## [1.2.2](https://github.com/upscaled-dev/behave-vsc-extension/compare/v1.2.0...v1.2.2) (2025-08-01)

### Bug Fixes

* **command-consistency**: Fix individual scenarios being reported as skipped ([#critical](https://github.com/upscaled-dev/behave-vsc-extension/issues/critical))
  * **Root Cause**: Incomplete CommandBuilder migration caused command mismatch between execution and result parsing
  * **Impact**: Individual scenarios showed "skipped" status instead of actual pass/fail results
  * **Fix**: Made `runScenarioWithOutput()` and `runFeatureFileWithOutput()` use the same CommandBuilder as their display counterparts
  * **Prevention**: Added comprehensive unit tests to ensure command consistency between execution and output capture methods
  * **Affected Methods**: `runScenario()` vs `runScenarioWithOutput()`, `runFeatureFile()` vs `runFeatureFileWithOutput()`

* **organization-strategy**: Add comprehensive tests for organization strategy switching
  * Add unit tests to verify all organization strategies (tag, file, scenario-type, flat, feature-based) work correctly
  * Ensure strategy switching properly refreshes Test Explorer views
  * Validate that all strategy persistence and state management functions correctly

### Testing

* **regression-prevention**: Add command consistency test suite ([#test](https://github.com/upscaled-dev/behave-vsc-extension/issues/test))
  * New test file: `src/test/unit/command-consistency.test.ts`
  * Verifies identical base commands between execution and output capture methods
  * Tests both CommandBuilder and fallback legacy command generation
  * Includes specific regression test for individual scenario status reporting
  * Added organization strategy switching test suite: `src/test/unit/organization-strategy-switching.test.ts`

## [1.2.0](https://github.com/upscaled-dev/behave-vsc-extension/compare/v1.1.76...v1.2.0) (2025-08-01)

### Features

* **adapter-pattern**: Implement Adapter Pattern for multi-framework support ([#major](https://github.com/upscaled-dev/behave-vsc-extension/issues/major))
  * Add CommandBuilder interface for abstracting framework-specific command generation
  * Extract BehaveCommandBuilder from TestExecutor with full backward compatibility
  * Implement PytestBddCommandBuilder for pytest-bdd framework support
  * Create FrameworkFactory for automatic framework detection and selection
  
* **pytest-bdd-support**: Add comprehensive pytest-bdd framework support ([#feature](https://github.com/upscaled-dev/behave-vsc-extension/issues/feature))
  * Automatic framework detection based on configuration files (pytest.ini, behave.ini, etc.)
  * Command translation from behave syntax to pytest-bdd syntax
  * Tag to marker conversion (@smoke → -m "smoke")
  * Scenario name to test function name conversion
  * Support for pytest-bdd specific output formats and debugging
  
* **configuration**: Extended configuration options ([#enhancement](https://github.com/upscaled-dev/behave-vsc-extension/issues/enhancement))
  * `behaveTestRunner.framework` - Select framework ("behave" or "pytest-bdd")
  * `behaveTestRunner.autoDetectFramework` - Enable automatic framework detection
  * `behaveTestRunner.pytestCommand` - Configure pytest command
  * `behaveTestRunner.pytestBddFilePattern` - Set pytest-bdd test file pattern

### Architecture Improvements

* **dependency-injection**: Enhanced BehaveExtensionContext with CommandBuilder
* **type-safety**: Maintained strict TypeScript typing throughout refactor
* **backward-compatibility**: All existing behave functionality preserved with fallback support
* **test-coverage**: Added 35 new tests for adapter components (12 BehaveCommandBuilder, 15 PytestBddCommandBuilder, 8 FrameworkFactory)

### Documentation

* **readme**: Updated README with pytest-bdd support and configuration documentation
* **examples**: Added configuration examples for both frameworks
* **troubleshooting**: Enhanced troubleshooting section for multi-framework scenarios

### Technical Details

* Tests: 205/205 passing (increased from 170)
* Architecture: Adapter Pattern implemented with Factory Pattern
* Frameworks: behave (existing) + pytest-bdd (new)
* Linting: All ESLint rules compliance maintained

### [1.1.76](https://github.com/upscaled-dev/behave-vsc-extension/compare/v1.1.0...v1.1.76) (2025-07-26)


### Bug Fixes

* linter warnings ([78a52ee](https://github.com/upscaled-dev/behave-vsc-extension/commit/78a52ee1793825aa1f5c612fa82e62270e2daab6))
* resolve debug command issues for scenario outlines and examples ([33fa925](https://github.com/upscaled-dev/behave-vsc-extension/commit/33fa925cf8a9a668e69e8c9951cddc1351ce863b))
* running tests using view ([2f3828d](https://github.com/upscaled-dev/behave-vsc-extension/commit/2f3828d085fb0b1089888b2c21e07fc1cfa344e3))

### [1.1.70](https://github.com/upscaled-dev/behave-vsc-extension/compare/v1.1.0...v1.1.70) (2025-07-24)


### Bug Fixes

* linter warnings ([78a52ee](https://github.com/upscaled-dev/behave-vsc-extension/commit/78a52ee1793825aa1f5c612fa82e62270e2daab6))
* resolve debug command issues for scenario outlines and examples ([33fa925](https://github.com/upscaled-dev/behave-vsc-extension/commit/33fa925cf8a9a668e69e8c9951cddc1351ce863b))
* running tests using view ([2f3828d](https://github.com/upscaled-dev/behave-vsc-extension/commit/2f3828d085fb0b1089888b2c21e07fc1cfa344e3))

### [1.1.8](https://github.com/upscaled-dev/behave-vsc-extension/compare/v1.1.0...v1.1.8) (2025-07-22)


### Bug Fixes

* linter warnings ([78a52ee](https://github.com/upscaled-dev/behave-vsc-extension/commit/78a52ee1793825aa1f5c612fa82e62270e2daab6))
* resolve debug command issues for scenario outlines and examples ([33fa925](https://github.com/upscaled-dev/behave-vsc-extension/commit/33fa925cf8a9a668e69e8c9951cddc1351ce863b))

## 1.1.0 (2025-07-22)


### Features

* initial release - behave test runner ([71d28d7](https://github.com/upscaled-dev/behave-vsc-extension/commit/71d28d70b5077adb1581c99cb6ab653b9391b563))
* prefer venv python for behave if detected ([3a3b817](https://github.com/upscaled-dev/behave-vsc-extension/commit/3a3b817e17cfe252b6453120a1bc27c397ecb379))


### Bug Fixes

* run only selected scenario outline example from codelens ([e37fb59](https://github.com/upscaled-dev/behave-vsc-extension/commit/e37fb59c875b4d05f47aecf8029603416a0b5a34))
* run scenario outline from gutter runs all examples ([6fbe228](https://github.com/upscaled-dev/behave-vsc-extension/commit/6fbe228c9c861045b83d8b7177063b16e1179415))

### [0.3.2](https://github.com/your-username/behave-test-runner/compare/v0.3.0...v0.3.2) (2025-01-27)

### Fixed

- **CodeLens Output Display**: Fixed issue where CodeLens commands were not displaying behave output in terminal
- **Command Manager Integration**: Updated all command manager methods to display behave output before capturing results
- **Dual Execution Flow**: Ensured both Test Explorer and CodeLens use the same dual output handling approach

### [0.3.0](https://github.com/your-username/behave-test-runner/compare/v0.2.103...v0.3.0) (2025-01-27)

### Features

- **Dual Output Handling**: Extension now displays behave output in terminal AND captures it for accurate status determination
- **Enhanced Test Status Reporting**: Tests now correctly show pass/fail based on actual behave return codes instead of always passing
- **Demo Feature Files**: Added comprehensive demo files to test behave output display functionality
- **Comprehensive Test Coverage**: Added extensive tests for scenario outline detection and path handling

### Fixed

- **Restored behave output display**: Fixed critical issue where behave test results were not visible in terminal
- **Scenario outline detection**: Fixed scenario outline detection by reading feature files and checking line content
- **Portable test paths**: Fixed hardcoded absolute paths in tests to use portable path resolution
- **Test suite cleanup**: Removed orphaned test files that didn't have corresponding source files

### Changed

- **Test execution flow**: Modified test provider to run behave in terminal first, then capture output for status
- **Path resolution**: Updated tests to use `process.cwd()` for portable path handling
- **Output capture**: Enhanced output capture while maintaining terminal visibility
- **Enhanced error handling**: Improved error messages and logging for better debugging

### [0.2.60](https://github.com/your-username/behave-test-runner/compare/v0.2.15...v0.2.60) (2025-01-27)

### Features

- **New Default Organization**: Feature-Based (Hierarchical) organization is now the default strategy
- **Hierarchical Structure**: Feature files as root items with scenarios nested as children
- **Multiple Organization Strategies**: Easy switching between 5 different organization strategies via context menu
- **Enhanced Test Organization**: Improved test hierarchy with clear parent-child relationships

### Changed

- **Default Strategy**: Changed from TagBasedOrganization to FeatureBasedOrganization
- **Test Explorer Layout**: Now shows feature files at root level with scenarios as children by default
- **Organization Switching**: Added context menu options to switch between organization strategies

### [0.2.15](https://github.com/your-username/behave-test-runner/compare/v0.2.10...v0.2.15) (2025-07-18)

### Bug Fixes

- gutter button behavior and test status updates ([34fb8da](https://github.com/your-username/behave-test-runner/commit/34fb8da863537d0760d7593f31e4f96d280fa86d))

### [0.2.11](https://github.com/your-username/behave-test-runner/compare/v0.0.11...v0.2.11) (2025-07-18)

### Features

- enhance scenario outline support with improved organization ([6b2ac00](https://github.com/your-username/behave-test-runner/commit/6b2ac00a1b4d433546a2a006b21110d5f1f086a4))
- implement centralized configuration management ([0a776ba](https://github.com/your-username/behave-test-runner/commit/0a776ba95cd3660cbafa69855478a8ea8f06925e))
- implement specific gutter button rules for different test levels ([1448bf2](https://github.com/your-username/behave-test-runner/commit/1448bf23d08ae312be697e5245a2b0b2177d6005))
- implement test organization strategies and discovery manager ([045ad8c](https://github.com/your-username/behave-test-runner/commit/045ad8cd1ec23635949fc028448d4ed2079457a0))
- improved error handling ([3f3c306](https://github.com/your-username/behave-test-runner/commit/3f3c30669aa4e47a2ec9371aa892debfb84258f2))

### Bug Fixes

- improve test explorer gutter button behavior for scenario outlines ([448d56f](https://github.com/your-username/behave-test-runner/commit/448d56ff195b41c88180e9f31b314eb2fb42692f))
- make command naming consistent with behavetestrunner prefix ([f6b83dc](https://github.com/your-username/behave-test-runner/commit/f6b83dc7cd073a2db3c4c88321742942d55d8627))
- restore all codelens functionality and add missing command handlers ([3653b34](https://github.com/your-username/behave-test-runner/commit/3653b346b0e1997dd132debdbdb91dc0c6335c01))
- restore codelens functionality by fixing dynamic import ([bef2afc](https://github.com/your-username/behave-test-runner/commit/bef2afc87deeebb4fddc340cf92916552f481706))

## [0.2.0](https://github.com/your-username/behave-test-runner/compare/v0.0.11...v0.2.0) (2025-07-18)

### Features

- enhance scenario outline support with improved organization ([6b2ac00](https://github.com/your-username/behave-test-runner/commit/6b2ac00a1b4d433546a2a006b21110d5f1f086a4))

## [0.1.0](https://github.com/your-username/behave-test-runner/compare/v0.0.11...v0.1.0) (2025-07-18)

### Features

- enhance scenario outline support with improved organization ([6b2ac00](https://github.com/your-username/behave-test-runner/commit/6b2ac00a1b4d433546a2a006b21110d5f1f086a4))

## [0.0.43] - 2025-01-27

### Fixed

- Fixed all lint errors and parsing issues
- Removed unused error variables and eslint-disable directives
- Fixed non-null assertions with optional chaining
- Resolved TypeScript compilation errors

### Changed

- Cleaned up code by removing unnecessary try/catch wrappers
- Improved code quality and maintainability

## [0.0.42] - 2025-01-27

### Added

- Enhanced scenario outline support with clean, numbered examples
- Smart example naming (1:, 2:, 3: instead of verbose names)
- Long column handling for better readability
- Tag-based organization in Test Explorer
- Multiple scenario outline support
- Sorted examples by number
- Improved test hierarchy organization

### Changed

- Better scenario outline handling in parser
- Enhanced test provider organization
- Improved scenario outline naming for clarity

## [0.0.41] - 2025-01-27

### Added

- Parallel execution support for faster test runs
- Enhanced test discovery and organization
- Better CodeLens integration

### Fixed

- Test execution timeout issues
- Command manager test issues
- Parser test failures

## [0.0.40] - 2025-01-27

### Added

- Comprehensive test suite with 99 total tests
- Integration test support
- Enhanced error handling

### Fixed

- Test execution and discovery issues
- Extension activation in test mode

## [0.0.11] - 2025-07-17

### Features

- Feature level execution

## [0.0.5] - 2025-07-16

### Features

- Add comprehensive autoversioning setup with conventional commits

### Bug Fixes

- Resolve es module compatibility issues in config files
- Scenario level execution on test explorer

## [0.0.2] - 2025-07-11

### Features

- Add comprehensive autoversioning setup with conventional commits
