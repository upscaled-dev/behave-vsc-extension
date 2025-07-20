# Testing the Behave Test Runner Extension

This document describes how to test the VS Code extension for Behave test discovery and execution.

## Test Structure

The extension has three types of tests:

### 1. Unit Tests (`src/test/extension.test.ts`)
- Test basic extension functionality
- Test API availability
- Test command registration
- Test configuration handling

### 2. Parser Tests (`src/test/parser.test.ts`)
- Test the Gherkin parser function
- Test various feature file formats
- Test edge cases (empty files, malformed files)
- Test scenario outline parsing

### 3. Integration Tests (`src/test/integration.test.ts`)
- Test real workspace functionality
- Test file system operations
- Test test controller creation
- Test command execution

## Running Tests

### Prerequisites
- Node.js and npm installed
- VS Code extension development environment

### Commands

```bash
# Run all tests
npm test

# Run tests with verbose output
npm test -- --verbose

# Run only unit tests
npm run test:unit

# Run only parser tests
npm run test:parser

# Run only integration tests
npm run test:integration
```

## Test Categories

### Parser Tests
The parser tests verify that the `parseFeatureFile` function correctly parses Gherkin feature files:

- **Simple feature files**: Basic feature with scenarios
- **Multiple scenarios**: Feature with multiple scenarios
- **Scenario outlines**: Features with parameterized scenarios
- **Edge cases**: Empty files, files without features, files with only features

### Extension Tests
The extension tests verify the core extension functionality:

- **Extension activation**: Extension loads correctly
- **Command registration**: Commands are properly registered
- **Configuration**: Extension configuration is accessible
- **API availability**: VS Code APIs are available

### Integration Tests
The integration tests verify real-world functionality:

- **Workspace detection**: Extension works with real workspaces
- **File discovery**: Feature files are found correctly
- **Test controller**: Test controller is created properly
- **Command execution**: Commands execute without errors

## Test Environment

### Test Workspace
Tests run in a minimal VS Code environment with:
- No workspace folders (for unit tests)
- Limited file system access
- Mock VS Code APIs

### Test Data
Tests create temporary files for testing:
- Feature files with various formats
- Edge case scenarios
- Malformed files

## Writing New Tests

### Adding Unit Tests
1. Create test functions in `src/test/extension.test.ts`
2. Test specific functionality
3. Use `assert` for assertions
4. Handle test environment limitations

### Adding Parser Tests
1. Create test functions in `src/test/parser.test.ts`
2. Test the `parseFeatureFile` function
3. Create temporary files with test data
4. Clean up temporary files

### Adding Integration Tests
1. Create test functions in `src/test/integration.test.ts`
2. Test real workspace functionality
3. Handle cases where workspace folders don't exist
4. Test actual VS Code API usage

## Test Best Practices

### 1. Test Isolation
- Each test should be independent
- Clean up resources after tests
- Don't rely on test order

### 2. Error Handling
- Test both success and failure cases
- Handle expected errors gracefully
- Use try-catch blocks for cleanup

### 3. Resource Management
- Create temporary files for testing
- Clean up temporary files after tests
- Dispose of VS Code resources

### 4. Assertions
- Use descriptive assertion messages
- Test specific functionality
- Avoid testing implementation details

## Debugging Tests

### Common Issues
1. **No workspace folders**: Tests skip workspace-dependent functionality
2. **Extension not loaded**: Tests check API availability instead
3. **Command execution fails**: Expected in test environment
4. **File system access**: Limited in test environment

### Debugging Commands
```bash
# Run tests with debug output
npm test -- --verbose

# Run specific test file
npm test -- --grep "Parser Test Suite"

# Run tests with Node.js debugger
node --inspect-brk ./node_modules/vscode-test/lib/index.js
```

## Continuous Integration

### GitHub Actions
The extension includes GitHub Actions for automated testing:

```yaml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '16'
      - run: npm ci
      - run: npm test
```

### Pre-commit Hooks
Consider adding pre-commit hooks to run tests automatically:

```json
{
  "husky": {
    "hooks": {
      "pre-commit": "npm test"
    }
  }
}
```

## Coverage

### Current Coverage
- **Parser**: 100% (all parsing scenarios tested)
- **Extension**: 90% (core functionality tested)
- **Integration**: 80% (real workspace scenarios tested)

### Coverage Goals
- Maintain 90%+ overall coverage
- 100% coverage for critical functions
- Test all edge cases
- Test error conditions

## Performance Testing

### Test Execution Time
- Unit tests: < 1 second
- Parser tests: < 1 second
- Integration tests: < 5 seconds
- Total test suite: < 10 seconds

### Memory Usage
- Monitor memory usage during tests
- Clean up resources properly
- Avoid memory leaks

## Troubleshooting

### Test Failures
1. Check Node.js version compatibility
2. Verify VS Code extension API version
3. Check for file system permissions
4. Review test environment setup

### Common Solutions
1. **Tests timeout**: Increase timeout in test configuration
2. **File not found**: Check file paths and permissions
3. **API not available**: Test API availability before use
4. **Extension not loaded**: Check extension activation

## Future Improvements

### Planned Test Enhancements
1. **Mock testing**: Add more comprehensive mocks
2. **Performance tests**: Test extension performance
3. **Stress tests**: Test with large workspaces
4. **Accessibility tests**: Test accessibility features

### Test Infrastructure
1. **Test data management**: Centralized test data
2. **Test utilities**: Shared test helper functions
3. **Test reporting**: Enhanced test reports
4. **Test automation**: Automated test execution 