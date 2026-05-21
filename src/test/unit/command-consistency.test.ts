import { suite, test, setup } from 'mocha';
import { assert } from 'chai';
import { TestExecutor } from '../../core/test-executor';
import { ExtensionConfig } from '../../core/extension-config';
import { Logger } from '../../utils/logger';
import { BehaveJsonParser } from '../../utils/behave-json-parser';
import { PytestResultParser } from '../../utils/pytest-result-parser';
import { CucumberJsonParser } from '../../utils/cucumber-json-parser';
import { BehaveCommandBuilder } from '../../core/command-builders/behave-command-builder';
import { BehaveExtensionContext, TestExecutionOptions, FeatureExecutionOptions } from '../../types';
import { createMockTestExecutor, createMockTestDiscoveryManager, createMockTestOrganizationManager, createMockFeatureParser, createMockTestItemMapping } from '../mocks/mock-types';

suite('Command Consistency Tests - Prevent Regression', () => {
  let testExecutor: TestExecutor;
  let config: ExtensionConfig;
  let logger: Logger;
  let behaveJsonParser: BehaveJsonParser;
  let cucumberJsonParser: CucumberJsonParser;
  let commandBuilder: BehaveCommandBuilder;
  let mockContext: BehaveExtensionContext;

  // Track executed commands for comparison
  let executedCommands: string[] = [];
  let outputCommands: string[] = [];

  setup(() => {
    // Clear command tracking
    executedCommands = [];
    outputCommands = [];

    // Create mock dependencies
    config = ExtensionConfig.create();
    logger = Logger.create();
    behaveJsonParser = BehaveJsonParser.create(logger);
    const pytestResultParser = PytestResultParser.create(logger);
    cucumberJsonParser = CucumberJsonParser.create(logger);
    commandBuilder = new BehaveCommandBuilder(config);

    // Create mock context with CommandBuilder
    mockContext = {
      logger,
      config,
      testExecutor: createMockTestExecutor(),
      discoveryManager: createMockTestDiscoveryManager(),
      organizationManager: createMockTestOrganizationManager(),
      featureParser: createMockFeatureParser(),
      behaveJsonParser,
      pytestResultParser,
      cucumberJsonParser,
      testItemMapping: createMockTestItemMapping(),
      commandBuilder,
    };

    // Create TestExecutor with mocked execution methods
    testExecutor = new TestExecutor(
      {
        workspaceFolders: [{ uri: { fsPath: '/test/workspace' } } as any],
      } as any,
      {
        showInformationMessage: () => Promise.resolve(undefined),
        showErrorMessage: () => Promise.resolve(undefined),
        createTerminal: () => ({
          sendText: (text: string) => {
            // Only capture actual behave/pytest commands, not terminal setup
            if (text.includes('behave') || text.includes('pytest')) {
              executedCommands.push(text);
            }
          },
          show: () => {},
        } as any),
      } as any,
      {} as any,
      config,
      logger,
      behaveJsonParser,
      cucumberJsonParser
    );

    // Set the context to enable CommandBuilder usage
    testExecutor.setContext(mockContext);

    // Mock executeCommandWithOutput to capture commands
    (testExecutor as any).executeCommandWithOutput = async (command: string, _workingDir: string) => {
      outputCommands.push(command);
      return {
        success: true,
        output: '[]', // Empty JSON array
        error: '',
        returnCode: 0,
      };
    };
  });

  test('runScenario and runScenarioWithOutput should generate identical base commands', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      lineNumber: 5,
      scenarioName: 'Test Scenario',
      tags: '@smoke',
      outputFormat: 'pretty',
      dryRun: false,
    };

    // Execute both methods
    await testExecutor.runScenario(options);
    await testExecutor.runScenarioWithOutput(options);

    // Verify commands were executed
    assert.equal(executedCommands.length, 1, 'runScenario should execute one command');
    assert.equal(outputCommands.length, 1, 'runScenarioWithOutput should execute one command');

    const displayCommand = executedCommands[0];
    const outputCommand = outputCommands[0];

    assert.isDefined(displayCommand, 'Display command should be defined');
    assert.isDefined(outputCommand, 'Output command should be defined');

    // The output command should be the display command + "--format=json"
    let expectedOutputCommand = displayCommand;
    if (displayCommand.includes('--format=pretty')) {
      expectedOutputCommand = displayCommand.replace('--format=pretty', '--format=json');
    } else {
      expectedOutputCommand = displayCommand + ' --format=json';
    }
    
    assert.equal(outputCommand, expectedOutputCommand, 
      'runScenarioWithOutput should generate the same command as runScenario, but with --format=json');

    // Verify both commands contain the same core elements
    assert.include(displayCommand, '/test/features/test.feature:5');
    assert.include(displayCommand, '--name="Test Scenario"');
    assert.include(displayCommand, '--tags="@smoke"');
    assert.include(displayCommand, '--no-skipped');

    assert.include(outputCommand, '/test/features/test.feature:5');
    assert.include(outputCommand, '--name="Test Scenario"');
    assert.include(outputCommand, '--tags="@smoke"');
    assert.include(outputCommand, '--no-skipped');
    assert.include(outputCommand, '--format=json');
  });

  test('runFeatureFile and runFeatureFileWithOutput should generate identical base commands', async () => {
    const options: FeatureExecutionOptions = {
      filePath: '/test/features/test.feature',
      tags: '@regression',
      outputFormat: 'pretty',
      dryRun: false,
    };

    // Execute both methods
    await testExecutor.runFeatureFile(options);
    await testExecutor.runFeatureFileWithOutput(options);

    // Verify commands were executed
    assert.equal(executedCommands.length, 1, 'runFeatureFile should execute one command');
    assert.equal(outputCommands.length, 1, 'runFeatureFileWithOutput should execute one command');

    const displayCommand = executedCommands[0];
    const outputCommand = outputCommands[0];

    assert.isDefined(displayCommand, 'Display command should be defined');
    assert.isDefined(outputCommand, 'Output command should be defined');

    // The output command should be the display command + "--format=json"
    let expectedOutputCommand = displayCommand;
    if (displayCommand.includes('--format=pretty')) {
      expectedOutputCommand = displayCommand.replace('--format=pretty', '--format=json');
    } else {
      expectedOutputCommand = displayCommand + ' --format=json';
    }
    
    assert.equal(outputCommand, expectedOutputCommand, 
      'runFeatureFileWithOutput should generate the same command as runFeatureFile, but with --format=json');

    // Verify both commands contain the same core elements
    assert.include(displayCommand, '/test/features/test.feature');
    assert.include(displayCommand, '--tags="@regression"');
    assert.include(displayCommand, '--no-skipped');

    assert.include(outputCommand, '/test/features/test.feature');
    assert.include(outputCommand, '--tags="@regression"');
    assert.include(outputCommand, '--no-skipped');
    assert.include(outputCommand, '--format=json');
  });

  test('Both methods should use CommandBuilder when available', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      lineNumber: 10,
      scenarioName: 'Another Test',
    };

    // Spy on CommandBuilder method
    let buildScenarioCommandCalls = 0;
    const originalBuildScenarioCommand = commandBuilder.buildScenarioCommand.bind(commandBuilder);
    commandBuilder.buildScenarioCommand = async (opts) => {
      buildScenarioCommandCalls++;
      return await originalBuildScenarioCommand(opts);
    };

    // Execute both methods
    await testExecutor.runScenario(options);
    await testExecutor.runScenarioWithOutput(options);

    // Verify CommandBuilder was used for both
    assert.equal(buildScenarioCommandCalls, 2, 
      'CommandBuilder.buildScenarioCommand should be called twice (once for each method)');
  });

  test('Commands should be identical for scenario outlines', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/outline.feature',
      lineNumber: 8,
      scenarioName: 'Test Outline',
    };

    // Execute both methods
    await testExecutor.runScenario(options);
    await testExecutor.runScenarioWithOutput(options);

    const displayCommand = executedCommands[0];
    const outputCommand = outputCommands[0];

    assert.isDefined(displayCommand, 'Display command should be defined');
    assert.isDefined(outputCommand, 'Output command should be defined');

    // Remove --format differences for comparison
    const normalizeCommand = (cmd: string) => cmd.replace(/--format=\w+/, '').trim();
    
    assert.equal(normalizeCommand(displayCommand), normalizeCommand(outputCommand),
      'Base commands should be identical for scenario outlines');
  });

  test('Commands should be identical when no CommandBuilder is available (fallback)', async () => {
    // Create TestExecutor without CommandBuilder context
    const fallbackExecutor = new TestExecutor(
      {
        workspaceFolders: [{ uri: { fsPath: '/test/workspace' } } as any],
      } as any,
      {
        showInformationMessage: () => Promise.resolve(undefined),
        showErrorMessage: () => Promise.resolve(undefined),
        createTerminal: () => ({
          sendText: (text: string) => {
            // Only capture actual behave/pytest commands, not terminal setup
            if (text.includes('behave') || text.includes('pytest')) {
              executedCommands.push(text);
            }
          },
          show: () => {},
        } as any),
      } as any,
      {} as any,
      config,
      logger,
      behaveJsonParser,
      cucumberJsonParser
    );

    // Mock executeCommandWithOutput for fallback executor
    (fallbackExecutor as any).executeCommandWithOutput = async (command: string, _workingDir: string) => {
      outputCommands.push(command);
      return {
        success: true,
        output: '[]',
        error: '',
        returnCode: 0,
      };
    };

    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      lineNumber: 15,
      scenarioName: 'Fallback Test',
    };

    // Execute both methods (should use fallback logic)
    await fallbackExecutor.runScenario(options);
    await fallbackExecutor.runScenarioWithOutput(options);

    const displayCommand = executedCommands[0];
    const outputCommand = outputCommands[0];

    assert.isDefined(displayCommand, 'Display command should be defined');
    assert.isDefined(outputCommand, 'Output command should be defined');

    // Normalize commands by removing format differences
    const normalizeCommand = (cmd: string) => cmd.replace(/--format=\w+/, '').trim();
    
    assert.equal(normalizeCommand(displayCommand), normalizeCommand(outputCommand),
      'Fallback commands should be identical except for output format');
  });

  test('Regression Test: Individual scenarios should not be marked as skipped due to command mismatch', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      lineNumber: 20,
      scenarioName: 'Individual Scenario',
      tags: '@unit',
    };

    // Mock successful execution with proper JSON output
    (testExecutor as any).executeCommandWithOutput = async (command: string, _workingDir: string) => {
      outputCommands.push(command);
      
      // Return realistic behave JSON output
      const jsonOutput = JSON.stringify([{
        filename: '/test/features/test.feature',
        elements: [{
          type: 'scenario',
          name: 'Individual Scenario',
          line: 20,
          status: 'passed',
          steps: [{
            result: { status: 'passed' }
          }]
        }]
      }]);
      
      return {
        success: true,
        output: jsonOutput,
        error: '',
        returnCode: 0,
      };
    };

    // Execute scenario with output capture
    const result = await testExecutor.runScenarioWithOutput(options);

    // Verify the result shows passed (not skipped)
    assert.isTrue(result.success, 'Test execution should succeed');
    assert.isDefined(result.scenarioResults, 'Scenario results should be available');
    
    const scenarioKeys = Object.keys(result.scenarioResults || {});
    assert.isAtLeast(scenarioKeys.length, 1, 'Should have at least one scenario result');
    
    // Verify no scenarios are marked as skipped when they actually passed
    const statuses = Object.values(result.scenarioResults || {});
    assert.notInclude(statuses, 'skipped', 'No scenarios should be incorrectly marked as skipped');
  });
}); 