import * as assert from 'assert';
import { BehaveCommandBuilder } from '../../../core/command-builders/behave-command-builder';
import { ExtensionConfig } from '../../../core/extension-config';
import { TestExecutionOptions, FeatureExecutionOptions } from '../../../types';

suite('BehaveCommandBuilder Unit Tests', () => {
  let commandBuilder: BehaveCommandBuilder;
  let mockConfig: ExtensionConfig;

  setup(() => {
    // Create a mock config for testing
    mockConfig = {
      getIntelligentBehaveCommand: async () => 'python3 -m behave',
      tags: '',
      outputFormat: 'pretty',
      dryRun: false,
    } as any;
    
    commandBuilder = new BehaveCommandBuilder(mockConfig);
  });

  test('Should build basic scenario command', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      lineNumber: 5,
      scenarioName: 'Test Scenario'
    };

    const command = await commandBuilder.buildScenarioCommand(options);
    
    assert.ok(command.includes('python3 -m behave'));
    assert.ok(command.includes('/test/features/test.feature'));
    assert.ok(command.includes('--name="Test Scenario"'));
  });

  test('Should build scenario command with tags', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      scenarioName: 'Test Scenario',
      tags: '@smoke'
    };

    const command = await commandBuilder.buildScenarioCommand(options);
    
    assert.ok(command.includes('--tags="@smoke"'));
    assert.ok(command.includes('--no-skipped'));
  });

  test('Should build scenario command with output format', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      scenarioName: 'Test Scenario',
      outputFormat: 'json'
    };

    const command = await commandBuilder.buildScenarioCommand(options);
    
    assert.ok(command.includes('--format=json'));
  });

  test('Should build scenario command with dry run', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      scenarioName: 'Test Scenario',
      dryRun: true
    };

    const command = await commandBuilder.buildScenarioCommand(options);
    
    assert.ok(command.includes('--dry-run'));
  });

  test('Should build feature command', async () => {
    const options: FeatureExecutionOptions = {
      filePath: '/test/features/test.feature'
    };

    const command = await commandBuilder.buildFeatureCommand(options);
    
    assert.ok(command.includes('python3 -m behave'));
    assert.ok(command.includes('/test/features/test.feature'));
    assert.ok(!command.includes(':'));
  });

  test('Should build feature command with tags', async () => {
    const options: FeatureExecutionOptions = {
      filePath: '/test/features/test.feature',
      tags: '@regression'
    };

    const command = await commandBuilder.buildFeatureCommand(options);
    
    assert.ok(command.includes('--tags="@regression"'));
    assert.ok(command.includes('--no-skipped'));
  });

  test('Should build tag command', async () => {
    const command = await commandBuilder.buildTagCommand('@smoke');
    
    assert.ok(command.includes('python3 -m behave'));
    assert.ok(command.includes('--tags="@smoke"'));
    assert.ok(command.includes('--no-skipped'));
  });

  test('Should build debug command', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      lineNumber: 5,
      scenarioName: 'Test Scenario'
    };

    const command = await commandBuilder.buildDebugCommand(options);
    
    assert.ok(command.includes('python3 -m behave'));
    assert.ok(command.includes('/test/features/test.feature'));
    assert.ok(command.includes('--name="Test Scenario"'));
    assert.ok(command.includes('--no-capture'));
  });

  test('Should validate installation', () => {
    const isValid = commandBuilder.validateInstallation();
    assert.strictEqual(isValid, true);
  });

  test('Should return framework name', () => {
    const frameworkName = commandBuilder.getFrameworkName();
    assert.strictEqual(frameworkName, 'behave');
  });

  test('Should handle scenario outline example names', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      lineNumber: 5,
      scenarioName: '1: Login with different credentials - username: admin, password: admin123'
    };

    const command = await commandBuilder.buildScenarioCommand(options);

    // Example labels ("<index>: <outline name> - <values>") are detected by the
    // strict prefix check (no file read needed) and the original outline name
    // is used so behave runs the matching outline.
    assert.ok(command.includes('--name="Login with different credentials"'));
  });

  test('Should handle complex scenario names', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      scenarioName: 'Complex scenario with special characters & symbols'
    };

    const command = await commandBuilder.buildScenarioCommand(options);
    
    assert.ok(command.includes('--name="Complex scenario with special characters & symbols"'));
  });
}); 