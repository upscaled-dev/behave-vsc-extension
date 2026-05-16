import { suite, test, setup } from 'mocha';
import { assert } from 'chai';
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
      forceRefreshTestExplorer: async () => {},
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
    
    assert.isArray(strategies);
    assert.isAtLeast(strategies.length, 5, 'Should have at least 5 strategies');
    
    const strategyTypes = strategies.map(s => s.strategy.strategyType);
    assert.include(strategyTypes, 'TagBasedOrganization');
    assert.include(strategyTypes, 'FileBasedOrganization'); 
    assert.include(strategyTypes, 'ScenarioTypeOrganization');
    assert.include(strategyTypes, 'FlatOrganization');
    assert.include(strategyTypes, 'FeatureBasedOrganization');
  });

  test('Should switch to TagBasedOrganization correctly', async () => {
    await (commandManager as any).setStrategyByValue('tag');
    
    const newStrategy = organizationManager.getStrategy();
    assert.equal(newStrategy.strategyType, 'TagBasedOrganization');
  });

  test('Should switch to FileBasedOrganization correctly', async () => {
    await (commandManager as any).setStrategyByValue('file');
    
    const strategy = organizationManager.getStrategy();
    assert.equal(strategy.strategyType, 'FileBasedOrganization');
  });

  test('Should switch to ScenarioTypeOrganization correctly', async () => {
    await (commandManager as any).setStrategyByValue('scenarioType');
    
    const strategy = organizationManager.getStrategy();
    assert.equal(strategy.strategyType, 'ScenarioTypeOrganization');
  });

  test('Should switch to FlatOrganization correctly', async () => {
    await (commandManager as any).setStrategyByValue('flat');
    
    const strategy = organizationManager.getStrategy();
    assert.equal(strategy.strategyType, 'FlatOrganization');
  });

  test('Should switch to FeatureBasedOrganization correctly', async () => {
    await (commandManager as any).setStrategyByValue('feature');
    
    const strategy = organizationManager.getStrategy();
    assert.equal(strategy.strategyType, 'FeatureBasedOrganization');
  });

  test('Should call all refresh methods when switching strategies', async () => {
    let cacheCleared = false;
    let testsDiscovered = false;
    let explorerRefreshed = false;
    
    mockTestProvider.discoveryManager.clearCache = () => { cacheCleared = true; };
    mockTestProvider.discoverTests = async () => { testsDiscovered = true; };
    mockTestProvider.forceRefreshTestExplorer = async () => { explorerRefreshed = true; };
    
    await (commandManager as any).setStrategyByValue('file');
    
    // Allow time for async operations
    await new Promise(resolve => setTimeout(resolve, 150));
    
    assert.isTrue(cacheCleared, 'Cache should be cleared');
    assert.isTrue(testsDiscovered, 'Tests should be rediscovered');
    assert.isTrue(explorerRefreshed, 'Test Explorer should be refreshed');
  });

  test('Should persist strategy changes across calls', async () => {
    await (commandManager as any).setStrategyByValue('tag');
    const tagStrategy = organizationManager.getStrategy();
    
    await (commandManager as any).setStrategyByValue('file');
    const fileStrategy = organizationManager.getStrategy();
    
    await (commandManager as any).setStrategyByValue('flat');
    const flatStrategy = organizationManager.getStrategy();
    
    assert.equal(tagStrategy.strategyType, 'TagBasedOrganization');
    assert.equal(fileStrategy.strategyType, 'FileBasedOrganization');
    assert.equal(flatStrategy.strategyType, 'FlatOrganization');
    
    // Final strategy should be flat
    assert.equal(organizationManager.getStrategy().strategyType, 'FlatOrganization');
  });

  test('Should handle invalid strategy values gracefully', async () => {
    try {
      await (commandManager as any).setStrategyByValue('invalid-strategy');
    } catch {
      // Expected to throw
    }
    
    // Strategy should fall back to first available strategy
    const finalStrategy = organizationManager.getStrategy();
    assert.isDefined(finalStrategy);
  });

  test('Should provide correct strategy descriptions', () => {
    const strategies = organizationManager.getAvailableStrategies();
    
    for (const strategy of strategies) {
      assert.isString(strategy.name);
      assert.isString(strategy.description);
      assert.isNotEmpty(strategy.name);
      assert.isNotEmpty(strategy.description);
      assert.isDefined(strategy.strategy.getDescription());
    }
  });

  test('Should ensure all strategy types have proper implementations', () => {
    const strategies = organizationManager.getAvailableStrategies();
    
    for (const strategy of strategies) {
      // Test that the strategy has required methods
      assert.isFunction(strategy.strategy.getDescription);
      assert.isString(strategy.strategy.strategyType);
      
      // Test that description is not empty
      const description = strategy.strategy.getDescription();
      assert.isString(description);
      assert.isNotEmpty(description);
    }
  });
}); 