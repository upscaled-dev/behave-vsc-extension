import * as assert from "assert";
import * as vscode from "vscode";
import { Logger } from "../../utils/logger.js";

suite("Logger Singleton Tests", () => {
  test("Logger.create() without parameters should return singleton instance", () => {
    // Create multiple logger instances without parameters
    const logger1 = Logger.create();
    const logger2 = Logger.create();
    const logger3 = Logger.create();
    
    // All should be the same instance
    assert.strictEqual(logger1, logger2, "Logger instances should be the same");
    assert.strictEqual(logger2, logger3, "Logger instances should be the same");
    assert.strictEqual(logger1, logger3, "Logger instances should be the same");
  });

  test("Logger.create() with parameters should return new instances", () => {
    // Create logger instances with parameters (for testing)
    const testOutputChannel = vscode.window.createOutputChannel("Test Logger");
    const logger1 = Logger.create(testOutputChannel);
    const logger2 = Logger.create(testOutputChannel);
    
    // These should be different instances
    assert.notStrictEqual(logger1, logger2, "Logger instances with parameters should be different");
    
    // Clean up
    testOutputChannel.dispose();
  });

  test("Logger.getInstance() should always return the same instance", () => {
    const instance1 = Logger.getInstance();
    const instance2 = Logger.getInstance();
    const instance3 = Logger.getInstance();
    
    // All should be the same instance
    assert.strictEqual(instance1, instance2, "getInstance should return the same instance");
    assert.strictEqual(instance2, instance3, "getInstance should return the same instance");
    assert.strictEqual(instance1, instance3, "getInstance should return the same instance");
  });

  test("Logger.create() without parameters should return the same instance as getInstance()", () => {
    const createInstance = Logger.create();
    const getInstance = Logger.getInstance();
    
    // They should be the same
    assert.strictEqual(createInstance, getInstance, "create() and getInstance() should return the same instance");
  });

  test("Multiple activations should not create multiple output channels", () => {
    // Simulate multiple extension activations
    const logger1 = Logger.create();
    const logger2 = Logger.create();
    const logger3 = Logger.create();
    
    // All should be the same instance, preventing multiple output channels
    assert.strictEqual(logger1, logger2, "Multiple activations should use singleton");
    assert.strictEqual(logger2, logger3, "Multiple activations should use singleton");
    
    // Test that they all log to the same output channel
    const originalAppendLine = logger1["outputChannel"].appendLine;
    let logCount = 0;
    
    // Mock the appendLine method to count calls
    logger1["outputChannel"].appendLine = (line: string) => {
      logCount++;
      originalAppendLine.call(logger1["outputChannel"], line);
    };
    
    // Log from different instances
    logger1.info("Test message 1");
    logger2.info("Test message 2");
    logger3.info("Test message 3");
    
    // Should have logged 3 times to the same output channel
    assert.strictEqual(logCount, 3, "All log calls should go to the same output channel");
    
    // Restore original method
    logger1["outputChannel"].appendLine = originalAppendLine;
  });
}); 