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
npm run package
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

1. Ensure all tests pass
2. Update version in `package.json`
3. Update `CHANGELOG.md`
4. Create a release tag
5. Build and package the extension
6. Publish to VS Code Marketplace

### Automated Versioning

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
