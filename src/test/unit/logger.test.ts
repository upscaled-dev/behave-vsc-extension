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

    logger = new Logger(mockOutputChannel);
  });

  test("Should create singleton instance", () => {
    const logger1 = Logger.getInstance();
    const logger2 = Logger.getInstance();
    assert.strictEqual(logger1, logger2);
  });

  test("raw process chunks preserve output channel text and ordering", () => {
    let displayed = "";
    const channel = { append: (text: string) => {displayed += text;}, dispose: () => {} } as unknown as vscode.OutputChannel;
    const raw = new Logger(channel);
    for (const chunk of ["test_pytest_", "first ", "PASSED", "\nnext"]) {raw.appendOutput(chunk);}
    assert.strictEqual(displayed, "test_pytest_first PASSED\nnext");
    raw.dispose();
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

    // Mock output channel
    const mockChannel = {
      appendLine: (line: string) => {
        loggedMessages.push(line);
      },
      dispose: () => {
        // Mock dispose method
      },
    };

    const freshLogger = new Logger(mockChannel as unknown as vscode.OutputChannel);
    freshLogger.setLogLevel(LogLevel.DEBUG);

    freshLogger.debug("Debug message", { test: "data" });

    assert.ok(loggedMessages.some((msg) => msg.includes("DEBUG")));
    assert.ok(loggedMessages.some((msg) => msg.includes("Debug message")));

    // Clean up
    freshLogger.dispose();
  });

  test("Should not log debug messages when level is higher", () => {
    const loggedMessages: string[] = [];

    // Mock output channel
    const mockChannel = {
      appendLine: (line: string) => {
        loggedMessages.push(line);
      },
      dispose: () => {
        // Mock dispose method
      },
    };

    const freshLogger = new Logger(mockChannel as unknown as vscode.OutputChannel);
    freshLogger.setLogLevel(LogLevel.INFO);

    const initialCount = loggedMessages.length;
    freshLogger.debug("Debug message");

    // Should not log debug messages when level is INFO
    assert.strictEqual(loggedMessages.length, initialCount);

    // Clean up
    freshLogger.dispose();
  });

  test("Should log info messages", () => {
    const loggedMessages: string[] = [];

    // Mock output channel
    const mockChannel = {
      appendLine: (line: string) => {
        loggedMessages.push(line);
      },
      dispose: () => {
        // Mock dispose method
      },
    };

    const freshLogger = new Logger(mockChannel as unknown as vscode.OutputChannel);
    freshLogger.setLogLevel(LogLevel.INFO);

    freshLogger.info("Info message");

    assert.ok(loggedMessages.some((msg) => msg.includes("INFO")));
    assert.ok(loggedMessages.some((msg) => msg.includes("Info message")));

    // Clean up
    freshLogger.dispose();
  });

  test("Should log warning messages", () => {
    const loggedMessages: string[] = [];

    // Mock output channel
    const mockChannel = {
      appendLine: (line: string) => {
        loggedMessages.push(line);
      },
      dispose: () => {
        // Mock dispose method
      },
    };

    const freshLogger = new Logger(mockChannel as unknown as vscode.OutputChannel);
    freshLogger.setLogLevel(LogLevel.WARN);

    freshLogger.warn("Warning message");

    assert.ok(loggedMessages.some((msg) => msg.includes("WARN")));
    assert.ok(loggedMessages.some((msg) => msg.includes("Warning message")));

    // Clean up
    freshLogger.dispose();
  });

  test("Should log error messages", () => {
    const loggedMessages: string[] = [];

    // Mock output channel
    const mockChannel = {
      appendLine: (line: string) => {
        loggedMessages.push(line);
      },
      dispose: () => {
        // Mock dispose method
      },
    };

    const freshLogger = new Logger(mockChannel as unknown as vscode.OutputChannel);
    freshLogger.setLogLevel(LogLevel.ERROR);

    freshLogger.error("Error message");

    assert.ok(loggedMessages.some((msg) => msg.includes("ERROR")));
    assert.ok(loggedMessages.some((msg) => msg.includes("Error message")));

    // Clean up
    freshLogger.dispose();
  });

  test("Should log data objects as JSON", () => {
    const loggedMessages: string[] = [];

    // Mock output channel
    const mockChannel = {
      appendLine: (line: string) => {
        loggedMessages.push(line);
      },
      dispose: () => {
        // Mock dispose method
      },
    };

    const freshLogger = new Logger(mockChannel as unknown as vscode.OutputChannel);
    freshLogger.setLogLevel(LogLevel.INFO);

    const testData = { key: "value", number: 123, array: [1, 2, 3] };
    freshLogger.info("Test message", testData);

    // Should log the message and the data object
    assert.ok(loggedMessages.some((msg) => msg.includes("Test message")));
    assert.ok(loggedMessages.some((msg) => msg.includes("value")));
    assert.ok(loggedMessages.some((msg) => msg.includes("123")));

    // Clean up
    freshLogger.dispose();
  });

  test("Should include timestamp in log messages", () => {
    const loggedMessages: string[] = [];

    // Mock output channel
    const mockChannel = {
      appendLine: (line: string) => {
        loggedMessages.push(line);
      },
      dispose: () => {
        // Mock dispose method
      },
    };

    const freshLogger = new Logger(mockChannel as unknown as vscode.OutputChannel);
    freshLogger.setLogLevel(LogLevel.INFO);

    freshLogger.info("Test message");

    // Should include timestamp in ISO format
    assert.ok(
      loggedMessages.some((msg) =>
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(msg)
      )
    );

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

    const freshLogger = new Logger(mockChannel as unknown as vscode.OutputChannel);
    freshLogger.showOutput();

    assert.strictEqual(showCalled, true);

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

    const freshLogger = new Logger(mockChannel as unknown as vscode.OutputChannel);
    freshLogger.clearOutput();

    assert.strictEqual(clearCalled, true);

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

    const freshLogger = new Logger(mockChannel as unknown as vscode.OutputChannel);
    freshLogger.dispose();

    assert.strictEqual(disposeCalled, true);

    // Restore original function
  });

  test("Should handle different log levels correctly", () => {
    let loggedMessages: string[] = [];

    // Mock output channel
    const mockChannel = {
      appendLine: (line: string) => {
        loggedMessages.push(line);
      },
      dispose: () => {
        // Mock dispose method
      },
    };

    const freshLogger = new Logger(mockChannel as unknown as vscode.OutputChannel);

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

    // Clean up
    freshLogger.dispose();
  });
});
