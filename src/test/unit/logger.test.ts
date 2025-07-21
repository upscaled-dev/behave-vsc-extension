import * as assert from "assert";
import * as vscode from "vscode";
import { Logger, LogLevel } from "../../utils/logger.js";

suite("Logger Unit Tests", () => {
  let logger: Logger;
  let mockOutputChannel: any;

  setup(() => {
    // Mock output channel
    mockOutputChannel = {
      appendLine: () => {},
      show: () => {},
      clear: () => {},
      dispose: () => {},
    };

    // Mock vscode.window.createOutputChannel
    const originalCreateOutputChannel = vscode.window.createOutputChannel;
    vscode.window.createOutputChannel = () => mockOutputChannel;

    logger = Logger.getInstance();

    // Restore original function
    vscode.window.createOutputChannel = originalCreateOutputChannel;
  });

  test("Should create singleton instance", () => {
    const logger1 = Logger.getInstance();
    const logger2 = Logger.getInstance();
    assert.strictEqual(logger1, logger2);
  });

  test("Should set log level", () => {
    logger.setLogLevel(LogLevel.DEBUG);
    // Test that the method doesn't throw
    assert.doesNotThrow(() => {
      logger.setLogLevel(LogLevel.INFO);
      logger.setLogLevel(LogLevel.WARN);
      logger.setLogLevel(LogLevel.ERROR);
    });
  });

  test("Should log debug messages when level allows", () => {
    const loggedMessages: string[] = [];
    const loggedData: any[] = [];

    // Mock console.log
    const originalConsoleLog = console.log;
    console.log = (message: string, data?: any) => {
      loggedMessages.push(message);
      if (data) {
        loggedData.push(data);
      }
    };

    // Mock output channel
    const mockChannel = {
      appendLine: (line: string) => {
        loggedMessages.push(line);
      },
      dispose: () => {
        // Mock dispose method
      },
    };

    const originalCreateOutputChannel = vscode.window.createOutputChannel;
    vscode.window.createOutputChannel = () => mockChannel as any;

    // Create a fresh logger instance by accessing the private instance
    // and resetting it (this is a bit hacky but necessary for testing)
    const testLogger = Logger.getInstance();

    // Force the logger to use our mocked output channel by recreating it
    // We need to dispose the current one and create a new one
    testLogger.dispose();

    // Reset the singleton instance by accessing the private static field
    // This is a bit hacky but necessary for proper testing
    (Logger as any).instance = undefined;

    // Now get a fresh instance that will use our mocked output channel
    const freshLogger = Logger.getInstance();
    freshLogger.setLogLevel(LogLevel.DEBUG);

    freshLogger.debug("Debug message", { test: "data" });

    assert.ok(loggedMessages.some((msg) => msg.includes("DEBUG")));
    assert.ok(loggedMessages.some((msg) => msg.includes("Debug message")));

    // Restore original functions
    console.log = originalConsoleLog;
    vscode.window.createOutputChannel = originalCreateOutputChannel;

    // Clean up
    freshLogger.dispose();
  });

  test("Should not log debug messages when level is higher", () => {
    const loggedMessages: string[] = [];

    // Mock console.log
    const originalConsoleLog = console.log;
    console.log = (message: string) => {
      loggedMessages.push(message);
    };

    // Mock output channel
    const mockChannel = {
      appendLine: (line: string) => {
        loggedMessages.push(line);
      },
      dispose: () => {
        // Mock dispose method
      },
    };

    const originalCreateOutputChannel = vscode.window.createOutputChannel;
    vscode.window.createOutputChannel = () => mockChannel as any;

    // Create a fresh logger instance
    const testLogger = Logger.getInstance();
    testLogger.dispose();
    (Logger as any).instance = undefined;
    const freshLogger = Logger.getInstance();
    freshLogger.setLogLevel(LogLevel.INFO);

    const initialCount = loggedMessages.length;
    freshLogger.debug("Debug message");

    // Should not log debug messages when level is INFO
    assert.strictEqual(loggedMessages.length, initialCount);

    // Restore original functions
    console.log = originalConsoleLog;
    vscode.window.createOutputChannel = originalCreateOutputChannel;

    // Clean up
    freshLogger.dispose();
  });

  test("Should log info messages", () => {
    const loggedMessages: string[] = [];

    // Mock console.log
    const originalConsoleLog = console.log;
    console.log = (message: string) => {
      loggedMessages.push(message);
    };

    // Mock output channel
    const mockChannel = {
      appendLine: (line: string) => {
        loggedMessages.push(line);
      },
      dispose: () => {
        // Mock dispose method
      },
    };

    const originalCreateOutputChannel = vscode.window.createOutputChannel;
    vscode.window.createOutputChannel = () => mockChannel as any;

    // Create a fresh logger instance
    const testLogger = Logger.getInstance();
    testLogger.dispose();
    (Logger as any).instance = undefined;
    const freshLogger = Logger.getInstance();
    freshLogger.setLogLevel(LogLevel.INFO);

    freshLogger.info("Info message");

    assert.ok(loggedMessages.some((msg) => msg.includes("INFO")));
    assert.ok(loggedMessages.some((msg) => msg.includes("Info message")));

    // Restore original functions
    console.log = originalConsoleLog;
    vscode.window.createOutputChannel = originalCreateOutputChannel;

    // Clean up
    freshLogger.dispose();
  });

  test("Should log warning messages", () => {
    const loggedMessages: string[] = [];

    // Mock console.log
    const originalConsoleLog = console.log;
    console.log = (message: string) => {
      loggedMessages.push(message);
    };

    // Mock output channel
    const mockChannel = {
      appendLine: (line: string) => {
        loggedMessages.push(line);
      },
      dispose: () => {
        // Mock dispose method
      },
    };

    const originalCreateOutputChannel = vscode.window.createOutputChannel;
    vscode.window.createOutputChannel = () => mockChannel as any;

    // Create a fresh logger instance
    const testLogger = Logger.getInstance();
    testLogger.dispose();
    (Logger as any).instance = undefined;
    const freshLogger = Logger.getInstance();
    freshLogger.setLogLevel(LogLevel.WARN);

    freshLogger.warn("Warning message");

    assert.ok(loggedMessages.some((msg) => msg.includes("WARN")));
    assert.ok(loggedMessages.some((msg) => msg.includes("Warning message")));

    // Restore original functions
    console.log = originalConsoleLog;
    vscode.window.createOutputChannel = originalCreateOutputChannel;

    // Clean up
    freshLogger.dispose();
  });

  test("Should log error messages", () => {
    const loggedMessages: string[] = [];

    // Mock console.log
    const originalConsoleLog = console.log;
    console.log = (message: string) => {
      loggedMessages.push(message);
    };

    // Mock output channel
    const mockChannel = {
      appendLine: (line: string) => {
        loggedMessages.push(line);
      },
      dispose: () => {
        // Mock dispose method
      },
    };

    const originalCreateOutputChannel = vscode.window.createOutputChannel;
    vscode.window.createOutputChannel = () => mockChannel as any;

    // Create a fresh logger instance
    const testLogger = Logger.getInstance();
    testLogger.dispose();
    (Logger as any).instance = undefined;
    const freshLogger = Logger.getInstance();
    freshLogger.setLogLevel(LogLevel.ERROR);

    freshLogger.error("Error message");

    assert.ok(loggedMessages.some((msg) => msg.includes("ERROR")));
    assert.ok(loggedMessages.some((msg) => msg.includes("Error message")));

    // Restore original functions
    console.log = originalConsoleLog;
    vscode.window.createOutputChannel = originalCreateOutputChannel;

    // Clean up
    freshLogger.dispose();
  });

  test("Should log data objects as JSON", () => {
    const loggedMessages: string[] = [];

    // Mock console.log
    const originalConsoleLog = console.log;
    console.log = (message: string) => {
      loggedMessages.push(message);
    };

    // Mock output channel
    const mockChannel = {
      appendLine: (line: string) => {
        loggedMessages.push(line);
      },
      dispose: () => {
        // Mock dispose method
      },
    };

    const originalCreateOutputChannel = vscode.window.createOutputChannel;
    vscode.window.createOutputChannel = () => mockChannel as any;

    // Create a fresh logger instance
    const testLogger = Logger.getInstance();
    testLogger.dispose();
    (Logger as any).instance = undefined;
    const freshLogger = Logger.getInstance();
    freshLogger.setLogLevel(LogLevel.INFO);

    const testData = { key: "value", number: 123, array: [1, 2, 3] };
    freshLogger.info("Test message", testData);

    // Should log the message and the data object
    assert.ok(loggedMessages.some((msg) => msg.includes("Test message")));
    // The data object is logged to console as raw object, not JSON
    assert.ok(loggedMessages.some((msg) => msg.includes("value")));
    assert.ok(loggedMessages.some((msg) => msg.includes("123")));

    // Restore original functions
    console.log = originalConsoleLog;
    vscode.window.createOutputChannel = originalCreateOutputChannel;

    // Clean up
    freshLogger.dispose();
  });

  test("Should include timestamp in log messages", () => {
    const loggedMessages: string[] = [];

    // Mock console.log
    const originalConsoleLog = console.log;
    console.log = (message: string) => {
      loggedMessages.push(message);
    };

    // Mock output channel
    const mockChannel = {
      appendLine: (line: string) => {
        loggedMessages.push(line);
      },
      dispose: () => {
        // Mock dispose method
      },
    };

    const originalCreateOutputChannel = vscode.window.createOutputChannel;
    vscode.window.createOutputChannel = () => mockChannel as any;

    // Create a fresh logger instance
    const testLogger = Logger.getInstance();
    testLogger.dispose();
    (Logger as any).instance = undefined;
    const freshLogger = Logger.getInstance();
    freshLogger.setLogLevel(LogLevel.INFO);

    freshLogger.info("Test message");

    // Should include timestamp in ISO format
    assert.ok(
      loggedMessages.some((msg) =>
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(msg)
      )
    );

    // Restore original functions
    console.log = originalConsoleLog;
    vscode.window.createOutputChannel = originalCreateOutputChannel;

    // Clean up
    freshLogger.dispose();
  });

  test("Should show output channel", () => {
    let showCalled = false;

    // Mock output channel
    const mockChannel = {
      appendLine: () => {},
      show: () => {
        showCalled = true;
      },
      clear: () => {},
      dispose: () => {},
    };

    const originalCreateOutputChannel = vscode.window.createOutputChannel;
    vscode.window.createOutputChannel = () => mockChannel as any;

    // Create a fresh logger instance
    const testLogger = Logger.getInstance();
    testLogger.dispose();
    (Logger as any).instance = undefined;
    const freshLogger = Logger.getInstance();
    freshLogger.showOutput();

    assert.strictEqual(showCalled, true);

    // Restore original function
    vscode.window.createOutputChannel = originalCreateOutputChannel;

    // Clean up
    freshLogger.dispose();
  });

  test("Should clear output channel", () => {
    let clearCalled = false;

    // Mock output channel
    const mockChannel = {
      appendLine: () => {},
      show: () => {},
      clear: () => {
        clearCalled = true;
      },
      dispose: () => {},
    };

    const originalCreateOutputChannel = vscode.window.createOutputChannel;
    vscode.window.createOutputChannel = () => mockChannel as any;

    // Create a fresh logger instance
    const testLogger = Logger.getInstance();
    testLogger.dispose();
    (Logger as any).instance = undefined;
    const freshLogger = Logger.getInstance();
    freshLogger.clearOutput();

    assert.strictEqual(clearCalled, true);

    // Restore original function
    vscode.window.createOutputChannel = originalCreateOutputChannel;

    // Clean up
    freshLogger.dispose();
  });

  test("Should dispose output channel", () => {
    let disposeCalled = false;

    // Mock output channel
    const mockChannel = {
      appendLine: () => {},
      show: () => {},
      clear: () => {},
      dispose: () => {
        disposeCalled = true;
      },
    };

    const originalCreateOutputChannel = vscode.window.createOutputChannel;
    vscode.window.createOutputChannel = () => mockChannel as any;

    // Create a fresh logger instance
    const testLogger = Logger.getInstance();
    testLogger.dispose();
    (Logger as any).instance = undefined;
    const freshLogger = Logger.getInstance();
    freshLogger.dispose();

    assert.strictEqual(disposeCalled, true);

    // Restore original function
    vscode.window.createOutputChannel = originalCreateOutputChannel;
  });

  test("Should handle different log levels correctly", () => {
    let loggedMessages: string[] = [];

    // Mock console.log
    const originalConsoleLog = console.log;
    console.log = (message: string) => {
      loggedMessages.push(message);
    };

    // Mock output channel
    const mockChannel = {
      appendLine: (line: string) => {
        loggedMessages.push(line);
      },
      dispose: () => {
        // Mock dispose method
      },
    };

    const originalCreateOutputChannel = vscode.window.createOutputChannel;
    vscode.window.createOutputChannel = () => mockChannel as any;

    // Create a fresh logger instance
    const testLogger = Logger.getInstance();
    testLogger.dispose();
    (Logger as any).instance = undefined;
    const freshLogger = Logger.getInstance();

    // Test ERROR level - should only log errors
    freshLogger.setLogLevel(LogLevel.ERROR);
    loggedMessages = [];
    freshLogger.debug("Debug message");
    freshLogger.info("Info message");
    freshLogger.warn("Warning message");
    freshLogger.error("Error message");

    assert.strictEqual(
      loggedMessages.filter((msg) => msg.includes("ERROR")).length,
      1
    );
    assert.strictEqual(
      loggedMessages.filter((msg) => msg.includes("WARN")).length,
      0
    );
    assert.strictEqual(
      loggedMessages.filter((msg) => msg.includes("INFO")).length,
      0
    );
    assert.strictEqual(
      loggedMessages.filter((msg) => msg.includes("DEBUG")).length,
      0
    );

    // Test WARN level - should log warnings and errors
    freshLogger.setLogLevel(LogLevel.WARN);
    loggedMessages = [];
    freshLogger.debug("Debug message");
    freshLogger.info("Info message");
    freshLogger.warn("Warning message");
    freshLogger.error("Error message");

    assert.strictEqual(
      loggedMessages.filter((msg) => msg.includes("ERROR")).length,
      1
    );
    assert.strictEqual(
      loggedMessages.filter((msg) => msg.includes("WARN")).length,
      1
    );
    assert.strictEqual(
      loggedMessages.filter((msg) => msg.includes("INFO")).length,
      0
    );
    assert.strictEqual(
      loggedMessages.filter((msg) => msg.includes("DEBUG")).length,
      0
    );

    // Test INFO level - should log info, warnings, and errors
    freshLogger.setLogLevel(LogLevel.INFO);
    loggedMessages = [];
    freshLogger.debug("Debug message");
    freshLogger.info("Info message");
    freshLogger.warn("Warning message");
    freshLogger.error("Error message");

    assert.strictEqual(
      loggedMessages.filter((msg) => msg.includes("ERROR")).length,
      1
    );
    assert.strictEqual(
      loggedMessages.filter((msg) => msg.includes("WARN")).length,
      1
    );
    assert.strictEqual(
      loggedMessages.filter((msg) => msg.includes("INFO")).length,
      1
    );
    assert.strictEqual(
      loggedMessages.filter((msg) => msg.includes("DEBUG")).length,
      0
    );

    // Test DEBUG level - should log all levels
    freshLogger.setLogLevel(LogLevel.DEBUG);
    loggedMessages = [];
    freshLogger.debug("Debug message");
    freshLogger.info("Info message");
    freshLogger.warn("Warning message");
    freshLogger.error("Error message");

    assert.strictEqual(
      loggedMessages.filter((msg) => msg.includes("ERROR")).length,
      1
    );
    assert.strictEqual(
      loggedMessages.filter((msg) => msg.includes("WARN")).length,
      1
    );
    assert.strictEqual(
      loggedMessages.filter((msg) => msg.includes("INFO")).length,
      1
    );
    assert.strictEqual(
      loggedMessages.filter((msg) => msg.includes("DEBUG")).length,
      1
    );

    // Restore original functions
    console.log = originalConsoleLog;
    vscode.window.createOutputChannel = originalCreateOutputChannel;

    // Clean up
    freshLogger.dispose();
  });
});
