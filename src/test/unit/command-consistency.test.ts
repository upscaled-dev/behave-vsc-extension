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

    // Behave's WithOutput methods now run once in the terminal and read results
    // from a JSON file written by behave. Stub that file read so tests don't poll
    // the real filesystem; individual tests override it when they need results.
    (testExecutor as any).readBehaveResults = async () => ({ output: '[]', returnCode: 0 });

    // executeCommandWithOutput is only used by non-behave (e.g. pytest-bdd) now.
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

  /** The single behave invocation that captures JSON (the one with the json formatter). */
  const captureCommand = (): string | undefined =>
    executedCommands.find((c) => c.includes('-f json'));
  /** The display-only behave invocation (no json formatter). */
  const displayCommand = (): string | undefined =>
    executedCommands.find((c) => !c.includes('-f json'));
  /** Strip the formatter section + exit-code marker so only the base command remains. */
  const normalizeCommand = (cmd: string): string =>
    cmd
      .replace(/\s-f json -o "[^"]*" -f pretty -o "[^"]*" -f pretty/, '')
      .replace(/\s;\s*echo .*$/, '')
      .replace(/\s--format=\w+/, '')
      .trim();

  test('runScenario displays natively; runScenarioWithOutput runs once with json file + pretty', async () => {
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

    // Both run in the terminal now (single behave run each); spawn is not used.
    assert.equal(outputCommands.length, 0, 'behave should not use executeCommandWithOutput');

    const display = displayCommand() ?? '';
    const capture = captureCommand() ?? '';
    assert.isNotEmpty(display, 'Display command should be defined');
    assert.isNotEmpty(capture, 'Capture command should be defined');

    // The capture run adds three formatters: json -> file, pretty -> file
    // (for the Test Results panel), pretty -> stdout (native terminal display).
    assert.include(capture, '-f json -o ');
    assert.include(capture, '-f pretty');
    assert.notInclude(display, '-f json');

    // Both commands share the same core target/name/tags.
    for (const cmd of [display, capture]) {
      assert.include(cmd, '/test/features/test.feature:5');
      assert.include(cmd, '--name="Test Scenario"');
      assert.include(cmd, '--tags="@smoke"');
      assert.include(cmd, '--no-skipped');
    }
  });

  test('runFeatureFile displays natively; runFeatureFileWithOutput runs once with json file + pretty', async () => {
    const options: FeatureExecutionOptions = {
      filePath: '/test/features/test.feature',
      tags: '@regression',
      outputFormat: 'pretty',
      dryRun: false,
    };

    // Execute both methods
    await testExecutor.runFeatureFile(options);
    await testExecutor.runFeatureFileWithOutput(options);

    assert.equal(outputCommands.length, 0, 'behave should not use executeCommandWithOutput');

    const display = displayCommand() ?? '';
    const capture = captureCommand() ?? '';
    assert.isNotEmpty(display, 'Display command should be defined');
    assert.isNotEmpty(capture, 'Capture command should be defined');

    assert.include(capture, '-f json -o ');
    assert.include(capture, '-f pretty');
    assert.notInclude(display, '-f json');

    for (const cmd of [display, capture]) {
      assert.include(cmd, '/test/features/test.feature');
      assert.include(cmd, '--tags="@regression"');
      assert.include(cmd, '--no-skipped');
    }
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

    const display = displayCommand() ?? '';
    const capture = captureCommand() ?? '';

    assert.isNotEmpty(display, 'Display command should be defined');
    assert.isNotEmpty(capture, 'Capture command should be defined');

    // Strip the formatter section so only the shared base command remains.
    assert.equal(normalizeCommand(display), normalizeCommand(capture),
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

    // Stub the JSON-file read so the fallback behave run doesn't poll the FS.
    (fallbackExecutor as any).readBehaveResults = async () => ({ output: '[]', returnCode: 0 });

    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      lineNumber: 15,
      scenarioName: 'Fallback Test',
    };

    // Execute both methods (should use fallback logic)
    await fallbackExecutor.runScenario(options);
    await fallbackExecutor.runScenarioWithOutput(options);

    const display = displayCommand() ?? '';
    const capture = captureCommand() ?? '';

    assert.isNotEmpty(display, 'Display command should be defined');
    assert.isNotEmpty(capture, 'Capture command should be defined');

    assert.equal(normalizeCommand(display), normalizeCommand(capture),
      'Fallback commands should be identical except for the formatter section');
  });

  test('Regression Test: Individual scenarios should not be marked as skipped due to command mismatch', async () => {
    const options: TestExecutionOptions = {
      filePath: '/test/features/test.feature',
      lineNumber: 20,
      scenarioName: 'Individual Scenario',
      tags: '@unit',
    };

    // Behave reads results from the JSON file; stub it with realistic output.
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
    (testExecutor as any).readBehaveResults = async () => ({ output: jsonOutput, returnCode: 0 });

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