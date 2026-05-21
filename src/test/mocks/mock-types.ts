import { ExtensionConfig } from '../../core/extension-config';
import { TestExecutor } from '../../core/test-executor';
import { TestDiscoveryManager } from '../../core/test-discovery-manager';
import { TestOrganizationManager } from '../../core/test-organization';
import { FeatureParser } from '../../parsers/feature-parser';
import { BehaveJsonParser } from '../../utils/behave-json-parser';
import { TestItemMapping } from '../../utils/test-item-mapping';
import { CommandBuilder } from '../../core/command-builders/command-builder-interface';

export interface MockTestProvider {
  organizationManager: {
    getAvailableStrategies: () => Array<{ name: string; description: string; strategy: { strategyType: string } }>;
    getStrategy: () => { strategyType: string };
    setStrategy: (strategy: { strategyType: string }) => void;
  };
  discoveryManager: {
    clearCache: () => void;
  };
  discoverTests: () => Promise<void>;
  forceRefreshTestExplorer: () => Promise<void>;
}

export const createMockExtensionConfig = (): ExtensionConfig => {
  return {
    getFramework: () => 'behave',
    getPytestCommand: () => 'python3 -m pytest',
    getIntelligentBehaveCommand: () => Promise.resolve('behave'),
    getTestFilePattern: () => '**/*.feature',
    getMaxParallelProcesses: () => 4,
    getOrganizationStrategy: () => 'tag',
    isFrameworkAutoDetectionEnabled: () => true,
    isValid: () => true,
    getValidationErrors: () => [],
    reload: () => {},
    setFramework: () => Promise.resolve(),
  } as unknown as ExtensionConfig;
};

export const createMockTestExecutor = (): TestExecutor => {
  return {
    runScenario: () => Promise.resolve(),
    debugScenario: () => Promise.resolve(),
    runFeatureFile: () => Promise.resolve(),
    runAllTests: () => Promise.resolve(),
    runTestsInParallel: () => {},
    executeTestWithOutput: () => Promise.resolve({ success: true, output: '', error: '', duration: 0 }),
    runScenarioWithOutput: () => Promise.resolve({ success: true, output: '', error: '', duration: 0 }),
    runFeatureFileWithOutput: () => Promise.resolve({ success: true, output: '', error: '', duration: 0 }),
    discoverFeatureFiles: () => Promise.resolve([]),
    runAllTestsInParallel: () => Promise.resolve(),
    validateBehaveInstallation: () => true,
    dispose: () => {},
    runAllTestsWithTags: () => Promise.resolve(),
    runAllTestsWithTagsOutput: () => Promise.resolve({ success: true, output: '', error: '', duration: 0 }),
    setContext: () => {},
    reloadConfiguration: () => {},
  } as unknown as TestExecutor;
};

export const createMockTestDiscoveryManager = (): TestDiscoveryManager => {
  return {
    discoverTests: () => Promise.resolve([]),
    getCacheStats: () => ({ hits: 0, misses: 0, size: 0 }),
    clearCache: () => {},
  } as unknown as TestDiscoveryManager;
};

export const createMockTestOrganizationManager = (): TestOrganizationManager => {
  return {
    getAvailableStrategies: () => [],
    getStrategy: () => ({ strategyType: 'TagBasedOrganization' }),
    setStrategy: () => {},
  } as unknown as TestOrganizationManager;
};

export const createMockFeatureParser = (): FeatureParser => {
  return {
    parseFeatureFile: () => Promise.resolve({ scenarios: [], feature: { name: '', description: '' } }),
  } as unknown as FeatureParser;
};

export const createMockBehaveJsonParser = (): BehaveJsonParser => {
  return {
    parseBehaveJsonOutput: () => [],
  } as unknown as BehaveJsonParser;
};

export const createMockTestItemMapping = (): TestItemMapping => {
  return {
    getScenarioStatusForTestItem: () => 'passed',
  } as unknown as TestItemMapping;
};

export const createMockCommandBuilder = (): CommandBuilder => {
  return {
    buildScenarioCommand: () => Promise.resolve('behave test.feature:5'),
    buildFeatureCommand: () => Promise.resolve('behave test.feature'),
    buildTagCommand: () => Promise.resolve('behave --tags="@smoke"'),
    getFrameworkName: () => 'behave',
  } as unknown as CommandBuilder;
}; 