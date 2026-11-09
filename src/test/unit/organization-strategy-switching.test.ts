import { suite, test, setup } from 'mocha';
import * as assert from "assert";
import * as vscode from "vscode";
import { CommandManager } from '../../commands/command-manager';
import { TestOrganizationManager } from '../../core/test-organization';
import { Logger } from '../../utils/logger';
import { PytestResultParser } from '../../utils/pytest-result-parser';
import { CucumberJsonParser } from '../../utils/cucumber-json-parser';
import { BehaveExtensionContext } from '../../types';
import { createMockExtensionConfig, createMockTestExecutor, createMockTestDiscoveryManager, createMockFeatureParser, createMockBehaveJsonParser, createMockTestItemMapping, createMockCommandBuilder } from '../mocks/mock-types';

suite('Organization Strategy Switching Tests', () => {
  let commandManager: CommandManager;
  let organizationManager: TestOrganizationManager;
  let logger: Logger;
  let mockContext: BehaveExtensionContext;
  let mockTestProvider: any;

  setup(() => {
    // Create mock logger
    logger = Logger.create();
    
    // Create organization manager
    organizationManager = TestOrganizationManager.create(logger);
    
    // Create mock test provider
    mockTestProvider = {
      organizationManager: organizationManager,
      discoveryManager: {
        clearCache: () => {},
      },
      discoverTests: async () => {},
      refreshTests: async () => mockTestProvider.discoverTests(),
    };
    
    // Create mock context
    const pytestResultParser = PytestResultParser.create(logger);
    const cucumberJsonParser = CucumberJsonParser.create(logger);
    mockContext = {
      logger,
      config: createMockExtensionConfig(),
      testExecutor: createMockTestExecutor(),
      discoveryManager: createMockTestDiscoveryManager(),
      organizationManager,
      featureParser: createMockFeatureParser(),
      behaveJsonParser: createMockBehaveJsonParser(),
      pytestResultParser,
      cucumberJsonParser,
      testItemMapping: createMockTestItemMapping(),
      commandBuilder: createMockCommandBuilder(),
    };
    
    // Create command manager with mock test provider
    commandManager = CommandManager.create(mockContext);
    (commandManager as any).testProvider = mockTestProvider;
  });

  test('Should have all required organization strategies available', () => {
    const strategies = organizationManager.getAvailableStrategies();
    
    assert.ok(Array.isArray(strategies));
    assert.ok(strategies.length >= 5, 'Should have at least 5 strategies');
    
    const strategyTypes = strategies.map(s => s.strategy.strategyType);
    assert.ok(strategyTypes.includes('TagBasedOrganization'));
    assert.ok(strategyTypes.includes('FileBasedOrganization'));
    assert.ok(strategyTypes.includes('ScenarioTypeOrganization'));
    assert.ok(strategyTypes.includes('FlatOrganization'));
    assert.ok(strategyTypes.includes('FeatureBasedOrganization'));
  });

  test('Should switch to TagBasedOrganization correctly', async () => {
    await (commandManager as any).setStrategyByValue('tag');
    
    const newStrategy = organizationManager.getStrategy();
    assert.strictEqual(newStrategy.strategyType, 'TagBasedOrganization');
  });

  test('Should switch to FileBasedOrganization correctly', async () => {
    await (commandManager as any).setStrategyByValue('file');
    
    const strategy = organizationManager.getStrategy();
    assert.strictEqual(strategy.strategyType, 'FileBasedOrganization');
  });

  test('Should switch to ScenarioTypeOrganization correctly', async () => {
    await (commandManager as any).setStrategyByValue('scenarioType');
    
    const strategy = organizationManager.getStrategy();
    assert.strictEqual(strategy.strategyType, 'ScenarioTypeOrganization');
  });

  test('Should switch to FlatOrganization correctly', async () => {
    await (commandManager as any).setStrategyByValue('flat');
    
    const strategy = organizationManager.getStrategy();
    assert.strictEqual(strategy.strategyType, 'FlatOrganization');
  });

  test('Should switch to FeatureBasedOrganization correctly', async () => {
    await (commandManager as any).setStrategyByValue('feature');
    
    const strategy = organizationManager.getStrategy();
    assert.strictEqual(strategy.strategyType, 'FeatureBasedOrganization');
  });

  test('Should await one discovery using the selected organization strategy', async () => {
    let releaseDiscovery!: () => void;
    const discoveryCompleted = new Promise<void>((resolve) => { releaseDiscovery = resolve; });
    let discoveryStarted!: () => void;
    const started = new Promise<void>((resolve) => { discoveryStarted = resolve; });
    let discoveries = 0;
    let completed = false;
    let discoveredStrategy: string | undefined;

    mockTestProvider.discoverTests = async () => {
      discoveries++;
      discoveredStrategy = organizationManager.getStrategy().strategyType;
      discoveryStarted();
      await discoveryCompleted;
    };
    const changing = (commandManager as any).setStrategyByValue('file').then(() => { completed = true; });

    await started;
    assert.strictEqual(discoveredStrategy, 'FileBasedOrganization');
    assert.strictEqual(completed, false, 'The organization command must wait for discovery completion');
    releaseDiscovery();
    await changing;
    assert.strictEqual(completed, true);
    assert.strictEqual(discoveries, 1, 'A strategy change rebuilds the tree once');
  });

  test('A superseded failure cannot roll back or notify after the newer strategy succeeds', async () => {
    const changes: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
    mockTestProvider.refreshTests = () => new Promise<void>((resolve, reject) => {changes.push({ resolve, reject });});
    const showInformation = vscode.window.showInformationMessage;
    const messages: string[] = [];
    const errors: string[] = [];
    (vscode.window as any).showInformationMessage = (message: string) => {messages.push(message); return Promise.resolve(undefined);};
    commandManager['showErrorMessage'] = (message: string) => {errors.push(message);};
    try {
      const older = commandManager['setStrategyByValue']('file');
      const newer = commandManager['setStrategyByValue']('flat');
      assert.strictEqual(changes.length, 2);
      changes[1]!.resolve();
      await newer;
      const committed = organizationManager.getStrategy();
      assert.strictEqual(committed.strategyType, 'FlatOrganization');
      changes[0]!.reject(new Error('superseded discovery failed'));
      await older;
      assert.strictEqual(organizationManager.getStrategy(), committed);
      assert.strictEqual(messages.length, 1);
      assert.strictEqual(errors.length, 0);
      assert.strictEqual(commandManager['pendingOrganizationChange'], undefined);
    } finally {
      (vscode.window as any).showInformationMessage = showInformation;
    }
  });

  test('Should persist strategy changes across calls', async () => {
    await (commandManager as any).setStrategyByValue('tag');
    const tagStrategy = organizationManager.getStrategy();
    
    await (commandManager as any).setStrategyByValue('file');
    const fileStrategy = organizationManager.getStrategy();
    
    await (commandManager as any).setStrategyByValue('flat');
    const flatStrategy = organizationManager.getStrategy();
    
    assert.strictEqual(tagStrategy.strategyType, 'TagBasedOrganization');
    assert.strictEqual(fileStrategy.strategyType, 'FileBasedOrganization');
    assert.strictEqual(flatStrategy.strategyType, 'FlatOrganization');
    
    // Final strategy should be flat
    assert.strictEqual(organizationManager.getStrategy().strategyType, 'FlatOrganization');
  });

  test('Should handle invalid strategy values gracefully', async () => {
    try {
      await (commandManager as any).setStrategyByValue('invalid-strategy');
    } catch {
      // Expected to throw
    }
    
    // Strategy should fall back to first available strategy
    const finalStrategy = organizationManager.getStrategy();
    assert.notStrictEqual(finalStrategy, undefined);
  });

  test('Should provide correct strategy descriptions', () => {
    const strategies = organizationManager.getAvailableStrategies();
    
    for (const strategy of strategies) {
      assert.strictEqual(typeof strategy.name, "string");
      assert.strictEqual(typeof strategy.description, "string");
      assert.ok(strategy.name.length > 0);
      assert.ok(strategy.description.length > 0);
      assert.notStrictEqual(strategy.strategy.getDescription(), undefined);
    }
  });

  test('Should ensure all strategy types have proper implementations', () => {
    const strategies = organizationManager.getAvailableStrategies();
    
    for (const strategy of strategies) {
      // Test that the strategy has required methods
      assert.strictEqual(typeof strategy.strategy.getDescription, "function");
      assert.strictEqual(typeof strategy.strategy.strategyType, "string");
      
      // Test that description is not empty
      const description = strategy.strategy.getDescription();
      assert.strictEqual(typeof description, "string");
      assert.ok(description.length > 0);
    }
  });
}); 