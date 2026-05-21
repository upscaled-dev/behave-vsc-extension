import * as assert from 'assert';
import { FrameworkFactory } from '../../../core/framework-factory';
import { ExtensionConfig } from '../../../core/extension-config';
import { BehaveCommandBuilder } from '../../../core/command-builders/behave-command-builder';
import { PytestBddCommandBuilder } from '../../../core/command-builders/pytest-bdd-command-builder';

suite('FrameworkFactory Unit Tests', () => {
  let mockConfig: ExtensionConfig;

  setup(() => {
    mockConfig = {
      getIntelligentBehaveCommand: async () => 'python3 -m behave',
      getPytestCommand: () => 'pytest',
    } as any;
  });

  test('Should create BehaveCommandBuilder for behave framework', () => {
    const commandBuilder = FrameworkFactory.createCommandBuilder('behave', mockConfig);
    
    assert.ok(commandBuilder instanceof BehaveCommandBuilder);
    assert.strictEqual(commandBuilder.getFrameworkName(), 'behave');
  });

  test('Should create PytestBddCommandBuilder for pytest-bdd framework', () => {
    const commandBuilder = FrameworkFactory.createCommandBuilder('pytest-bdd', mockConfig);
    
    assert.ok(commandBuilder instanceof PytestBddCommandBuilder);
    assert.strictEqual(commandBuilder.getFrameworkName(), 'pytest-bdd');
  });

  test('Should handle case-insensitive framework names', () => {
    const behaveBuilder = FrameworkFactory.createCommandBuilder('BEHAVE', mockConfig);
    const pytestBuilder = FrameworkFactory.createCommandBuilder('PYTEST-BDD', mockConfig);
    
    assert.ok(behaveBuilder instanceof BehaveCommandBuilder);
    assert.ok(pytestBuilder instanceof PytestBddCommandBuilder);
  });

  test('Should throw error for unsupported framework', () => {
    assert.throws(() => {
      FrameworkFactory.createCommandBuilder('unsupported', mockConfig);
    }, /Unsupported framework: unsupported/);
  });

  test('Should return supported frameworks list', () => {
    const supportedFrameworks = FrameworkFactory.getSupportedFrameworks();
    
    assert.ok(Array.isArray(supportedFrameworks));
    assert.ok(supportedFrameworks.includes('behave'));
    assert.ok(supportedFrameworks.includes('pytest-bdd'));
  });

  test('Should check if framework is supported', () => {
    assert.strictEqual(FrameworkFactory.isFrameworkSupported('behave'), true);
    assert.strictEqual(FrameworkFactory.isFrameworkSupported('pytest-bdd'), true);
    assert.strictEqual(FrameworkFactory.isFrameworkSupported('unsupported'), false);
  });

  test('Should handle case-insensitive framework support check', () => {
    assert.strictEqual(FrameworkFactory.isFrameworkSupported('BEHAVE'), true);
    assert.strictEqual(FrameworkFactory.isFrameworkSupported('Pytest-BDD'), true);
    assert.strictEqual(FrameworkFactory.isFrameworkSupported('UNSUPPORTED'), false);
  });

  test('Should auto-detect framework as behave by default', async () => {
    // When no specific workspace path is provided and no config files exist
    const detectedFramework = await FrameworkFactory.autoDetect();
    
    // Should default to behave for backward compatibility
    assert.strictEqual(detectedFramework, 'behave');
  });

  // Note: Additional auto-detection tests would require mocking the file system
  // and VS Code workspace APIs, which would be more complex integration tests
}); 