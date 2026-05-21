# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

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
