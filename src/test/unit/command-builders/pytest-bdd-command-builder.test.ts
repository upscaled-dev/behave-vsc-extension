import * as assert from 'assert';
import { PytestBddCommandBuilder } from '../../../core/command-builders/pytest-bdd-command-builder';
import { ExtensionConfig } from '../../../core/extension-config';
import { TestExecutionOptions, FeatureExecutionOptions } from '../../../types';

suite('PytestBddCommandBuilder Unit Tests', () => {
  let commandBuilder: PytestBddCommandBuilder;
  let mockConfig: ExtensionConfig;

  setup(() => {
    // Create a mock config for testing
    mockConfig = {
      getPytestCommand: () => 'pytest',
      tags: '',
      outputFormat: 'pretty',
      dryRun: false,
    } as any;
    
    commandBuilder = new PytestBddCommandBuilder(mockConfig);
  });

  test('Should build basic scenario command', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      scenarioName: 'Test Scenario'
    };

    const command = await commandBuilder.buildScenarioCommand(options);
    
    assert.ok(command.includes('pytest'));
    assert.ok(command.includes('test_test.py'));
    assert.ok(command.includes('::test_test_scenario'));
    assert.ok(command.includes('-v'));
  });

  test('Should build scenario command with tags', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      scenarioName: 'Test Scenario',
      tags: '@smoke'
    };

    const command = await commandBuilder.buildScenarioCommand(options);
    
    assert.ok(command.includes('-m "smoke"'));
    assert.ok(!command.includes('@smoke')); // @ should be removed
  });

  test('Should build scenario command with output format', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      scenarioName: 'Test Scenario',
      outputFormat: 'json'
    };

    const command = await commandBuilder.buildScenarioCommand(options);
    
    assert.ok(command.includes('--json-report'));
  });

  test('Should build scenario command with dry run', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      scenarioName: 'Test Scenario',
      dryRun: true
    };

    const command = await commandBuilder.buildScenarioCommand(options);
    
    assert.ok(command.includes('--collect-only'));
  });

  test('Should build feature command', async () => {
    const options: FeatureExecutionOptions = {
      filePath: '/test/features/example.feature'
    };

    const command = await commandBuilder.buildFeatureCommand(options);
    
    assert.ok(command.includes('pytest'));
    assert.ok(command.includes('test_example.py'));
    assert.ok(command.includes('-v'));
  });

  test('Should build feature command with tags', async () => {
    const options: FeatureExecutionOptions = {
      filePath: '/test/features/test.feature',
      tags: '@regression'
    };

    const command = await commandBuilder.buildFeatureCommand(options);
    
    assert.ok(command.includes('-m "regression"'));
  });

  test('Should build tag command', async () => {
    const command = await commandBuilder.buildTagCommand('@smoke');
    
    assert.ok(command.includes('pytest'));
    assert.ok(command.includes('-m "smoke"'));
    assert.ok(command.includes('-v'));
  });

  test('Should build debug command', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      scenarioName: 'Test Scenario'
    };

    const command = await commandBuilder.buildDebugCommand(options);
    
    assert.ok(command.includes('pytest'));
    assert.ok(command.includes('test_test.py'));
    assert.ok(command.includes('::test_test_scenario'));
    assert.ok(command.includes('-s'));
    assert.ok(command.includes('--capture=no'));
  });

  test('Should validate installation', () => {
    const isValid = commandBuilder.validateInstallation();
    assert.strictEqual(isValid, true);
  });

  test('Should return framework name', () => {
    const frameworkName = commandBuilder.getFrameworkName();
    assert.strictEqual(frameworkName, 'pytest-bdd');
  });

  test('Should convert scenario name to test function name', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      scenarioName: 'Basic smoke test with spaces'
    };

    const command = await commandBuilder.buildScenarioCommand(options);
    
    assert.ok(command.includes('::test_basic_smoke_test_with_spaces'));
  });

  test('Should handle scenario outline example names', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      scenarioName: '1: Login with different credentials - username: admin, password: admin123'
    };

    const command = await commandBuilder.buildScenarioCommand(options);
    
    // Should extract the original outline name and convert it
    assert.ok(command.includes('::test_login_with_different_credentials'));
  });

  test('Should convert tags to markers correctly', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      scenarioName: 'Test Scenario',
      tags: '@integration'
    };

    const command = await commandBuilder.buildScenarioCommand(options);
    
    assert.ok(command.includes('-m "integration"'));
    assert.ok(!command.includes('@integration'));
  });

  test('Should handle output format conversions', async () => {
    const jsonOptions: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      scenarioName: 'Test Scenario',
      outputFormat: 'junit'
    };

    const command = await commandBuilder.buildScenarioCommand(jsonOptions);
    assert.ok(command.includes('--junit-xml=junit.xml'));
  });

  test('Should handle plain output format', async () => {
    const plainOptions: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      scenarioName: 'Test Scenario',
      outputFormat: 'plain'
    };

    const command = await commandBuilder.buildScenarioCommand(plainOptions);
    assert.ok(command.includes('-q'));
  });
}); 