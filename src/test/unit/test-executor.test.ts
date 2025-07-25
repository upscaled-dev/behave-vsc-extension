import * as assert from "assert";
import * as vscode from "vscode";
import { TestExecutor } from "../../core/test-executor.js";
import { TestExecutionOptions } from "../../types/index.js";
import { PythonDetector } from '../../utils/python-detector';
import { expect } from 'chai';
import { CommandManager } from '../../commands/command-manager';

suite("TestExecutor Unit Tests", () => {
  let testExecutor: TestExecutor;

  setup(() => {
    // Mock workspace configuration
    const mockConfig = {
      get: (key: string, defaultValue: any) => {
        switch (key) {
          case "behaveCommand":
            return "behave";
          case "workingDirectory":
            return "/test/working/dir";
          case "autoDiscoverTests":
            return true;
          case "testFilePattern":
            return "**/*.feature";
          default:
            return defaultValue;
        }
      },
    };

    // Mock terminal creation
    const mockTerminal = {
      show: () => {},
      sendText: (text: string) => {
        // Only check for file path and line number if present
        if (text.includes(":")) {
          assert.ok(text.includes("/test/path/test.feature:5"));
        } else {
          assert.ok(text.includes("/test/path/test.feature"));
        }
      },
    };

    // Fix type mismatches in mocks
    const mockStartDebugging = (_workspace: any, _config: any) =>
      Promise.resolve(true);

    const mockWorkspace = {
      getConfiguration: () => mockConfig,
      workspaceFolders: undefined,
    } as any;
    const mockWindow = {
      createTerminal: () => mockTerminal,
      showErrorMessage: () => {},
    } as any;
    const mockDebug = { startDebugging: mockStartDebugging } as any;
    testExecutor = new TestExecutor(mockWorkspace, mockWindow, mockDebug);
  });

  test("Should load configuration correctly", () => {
    // Mock workspace configuration
    const mockConfig = {
      get: (key: string, defaultValue: any) => {
        switch (key) {
          case "behaveCommand":
            return "behave";
          case "workingDirectory":
            return "/test/working/dir";
          case "autoDiscoverTests":
            return true;
          case "testFilePattern":
            return "**/*.feature";
          default:
            return defaultValue;
        }
      },
    };

    // Mock vscode.workspace.getConfiguration
    const originalGetConfiguration = vscode.workspace.getConfiguration;
    vscode.workspace.getConfiguration = () => mockConfig as any;

    // Test that TestExecutor can be instantiated
    assert.doesNotThrow(() => {
      new TestExecutor();
    });

    // Restore original function
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

  test("Should reload configuration", () => {
    // This test verifies the method exists and doesn't throw
    assert.doesNotThrow(() => {
      testExecutor.reloadConfiguration();
    });
  });

  test("Should build behave command correctly", async () => {
    const options: TestExecutionOptions = {
      filePath: "/test/path/test.feature",
      lineNumber: 5,
      scenarioName: "Test Scenario",
    };

    // Mock workspace configuration
    const mockConfig = {
      get: (key: string, defaultValue: any) => {
        switch (key) {
          case "behaveCommand":
            return "behave";
          case "workingDirectory":
            return "/test/working/dir";
          case "autoDiscoverTests":
            return true;
          case "testFilePattern":
            return "**/*.feature";
          default:
            return defaultValue;
        }
      },
    };

    // Mock terminal creation
    const sentCommands: string[] = [];
    const mockTerminal = {
      show: () => {},
      sendText: (text: string) => {
        sentCommands.push(text);
        // Print the actual command for debugging
         
        console.log("COMMAND SENT TO TERMINAL:", text);
      },
    };

    const originalCreateTerminal = vscode.window.createTerminal;
    const originalGetConfiguration = vscode.workspace.getConfiguration;

    vscode.window.createTerminal = () => mockTerminal as any;
    vscode.workspace.getConfiguration = () => mockConfig as any;

    // Create a fresh TestExecutor instance with the mocked configuration
    const freshTestExecutor = new TestExecutor();

    // Test run scenario
    await freshTestExecutor.runScenario(options);

    // Check that the behave command was sent (it should be the last command)
     
    console.log("ALL SENT COMMANDS:", sentCommands);
    const behaveCommand = sentCommands.find((cmd) =>
      cmd.includes("/test/path/test.feature:5")
    );
    assert.ok(
      behaveCommand,
      `Expected command with path not found. All commands: ${JSON.stringify(
        sentCommands
      )}`
    );

    // Restore original functions
    vscode.window.createTerminal = originalCreateTerminal;
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

  test("Should build behave command without line number", async () => {
    const options: TestExecutionOptions = {
      filePath: "/test/path/test.feature",
      scenarioName: "Test Scenario",
    };

    // Mock workspace configuration
    const mockConfig = {
      get: (key: string, defaultValue: any) => {
        switch (key) {
          case "behaveCommand":
            return "behave";
          case "workingDirectory":
            return "/test/working/dir";
          case "autoDiscoverTests":
            return true;
          case "testFilePattern":
            return "**/*.feature";
          default:
            return defaultValue;
        }
      },
    };

    // Mock terminal creation
    const sentCommands: string[] = [];
    const mockTerminal = {
      show: () => {},
      sendText: (text: string) => {
        sentCommands.push(text);
      },
    };

    const originalCreateTerminal = vscode.window.createTerminal;
    const originalGetConfiguration = vscode.workspace.getConfiguration;

    vscode.window.createTerminal = () => mockTerminal as any;
    vscode.workspace.getConfiguration = () => mockConfig as any;

    // Create a fresh TestExecutor instance with the mocked configuration
    const freshTestExecutor = new TestExecutor();

    // Test run scenario
    await freshTestExecutor.runScenario(options);

    // Check that the behave command was sent (it should be the last command)
    const behaveCommand = sentCommands.find((cmd) =>
      cmd.includes("/test/path/test.feature")
    );
    assert.ok(
      behaveCommand,
      `Expected command with path not found. All commands: ${JSON.stringify(
        sentCommands
      )}`
    );
    assert.ok(
      !behaveCommand.includes(":"),
      `Command should not include line number: ${behaveCommand}`
    );

    // Restore original functions
    vscode.window.createTerminal = originalCreateTerminal;
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

  test("Should create debug configuration correctly", async () => {
    const options: TestExecutionOptions = {
      filePath: "/test/path/test.feature",
      lineNumber: 5,
      scenarioName: "Test Scenario",
      debug: true,
    };

    // Mock debug.startDebugging
    const mockStartDebugging = (_workspace: any, _config: any) => {
      assert.strictEqual(_config.name, "Debug: Test Scenario");
      assert.strictEqual(_config.type, "python");
      assert.strictEqual(_config.request, "launch");
      assert.strictEqual(_config.module, "behave");
      assert.deepStrictEqual(_config.args, [
        "/test/path/test.feature:5",
        "--name",
        "Test Scenario",
      ]);
      assert.strictEqual(_config.cwd, "/test/working/dir");
      assert.strictEqual(_config.console, "integratedTerminal");
      assert.strictEqual(_config.justMyCode, false);
      return Promise.resolve(true);
    };

    const originalStartDebugging = vscode.debug.startDebugging;
    vscode.debug.startDebugging = mockStartDebugging;

    // Test debug scenario
    await testExecutor.debugScenario(options);

    // Restore original function
    vscode.debug.startDebugging = originalStartDebugging;
  });

  test("Should create debug configuration without scenario name", async () => {
    const options: TestExecutionOptions = {
      filePath: "/test/path/test.feature",
      lineNumber: 5,
      debug: true,
    };

    // Mock debug.startDebugging
    const mockStartDebugging = (_workspace: any, _config: any) => {
      assert.strictEqual(_config.name, "Debug: Test Scenario");
      assert.strictEqual(_config.type, "python");
      assert.strictEqual(_config.request, "launch");
      assert.strictEqual(_config.module, "behave");
      assert.deepStrictEqual(_config.args, ["/test/path/test.feature:5"]);
      assert.strictEqual(_config.cwd, "/test/working/dir");
      assert.strictEqual(_config.console, "integratedTerminal");
      assert.strictEqual(_config.justMyCode, false);
      return Promise.resolve(true);
    };

    const originalStartDebugging = vscode.debug.startDebugging;
    vscode.debug.startDebugging = mockStartDebugging;

    // Test debug scenario
    await testExecutor.debugScenario(options);

    // Restore original function
    vscode.debug.startDebugging = originalStartDebugging;
  });

  test("Should handle debug configuration error", async () => {
    const options: TestExecutionOptions = {
      filePath: "/test/path/test.feature",
      lineNumber: 5,
      scenarioName: "Test Scenario",
      debug: true,
    };

    // Mock debug.startDebugging to throw error

    const mockStartDebugging = (_workspace: any, _config: any) => {
      throw new Error("Debug configuration error");
    };

    // Mock window.showErrorMessage
    const mockShowErrorMessage = (_message: string) => {
      assert.ok(_message.includes("Failed to start debug session"));
      return Promise.resolve("OK");
    };

    const originalStartDebugging = vscode.debug.startDebugging;
    const originalShowErrorMessage = vscode.window.showErrorMessage;

    vscode.debug.startDebugging = mockStartDebugging;
    vscode.window.showErrorMessage = mockShowErrorMessage;

    // Test debug scenario with error
    await testExecutor.debugScenario(options);

    // Restore original functions
    vscode.debug.startDebugging = originalStartDebugging;
    vscode.window.showErrorMessage = originalShowErrorMessage;
  });

  test("Should run feature file", async () => {
    const filePath = "/test/path/test.feature";

    // Mock workspace configuration
    const mockConfig = {
      get: (key: string, defaultValue: any) => {
        switch (key) {
          case "behaveCommand":
            return "behave";
          case "workingDirectory":
            return "/test/working/dir";
          case "autoDiscoverTests":
            return true;
          case "testFilePattern":
            return "**/*.feature";
          default:
            return defaultValue;
        }
      },
    };

    // Mock terminal creation
    const sentCommands: string[] = [];
    const mockTerminal = {
      show: () => {},
      sendText: (text: string) => {
        sentCommands.push(text);
      },
    };

    const originalCreateTerminal = vscode.window.createTerminal;
    const originalGetConfiguration = vscode.workspace.getConfiguration;

    vscode.window.createTerminal = () => mockTerminal as any;
    vscode.workspace.getConfiguration = () => mockConfig as any;

    // Create a fresh TestExecutor instance with the mocked configuration
    const freshTestExecutor = new TestExecutor();

    // Test run feature file
    await freshTestExecutor.runFeatureFile({ filePath });

    // Check that the behave command was sent
    const behaveCommand = sentCommands.find((cmd) => cmd.includes(filePath));
    assert.ok(
      behaveCommand,
      `Expected command with path not found. All commands: ${JSON.stringify(
        sentCommands
      )}`
    );
    assert.ok(
      behaveCommand.includes("behave"),
      `Command should include 'behave': ${behaveCommand}`
    );

    // Restore original functions
    vscode.window.createTerminal = originalCreateTerminal;
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

  test("Should run all tests", async () => {
    // Mock workspace configuration
    const mockConfig = {
      get: (key: string, defaultValue: any) => {
        switch (key) {
          case "behaveCommand":
            return "behave";
          case "workingDirectory":
            return "/test/working/dir";
          case "autoDiscoverTests":
            return true;
          case "testFilePattern":
            return "**/*.feature";
          default:
            return defaultValue;
        }
      },
    };

    // Mock terminal creation
    const sentCommands: string[] = [];
    const mockTerminal = {
      show: () => {},
      sendText: (text: string) => {
        sentCommands.push(text);
      },
    };

    const originalCreateTerminal = vscode.window.createTerminal;
    const originalGetConfiguration = vscode.workspace.getConfiguration;

    vscode.window.createTerminal = () => mockTerminal as any;
    vscode.workspace.getConfiguration = () => mockConfig as any;

    // Create a fresh TestExecutor instance with the mocked configuration
    const freshTestExecutor = new TestExecutor();

    // Test run all tests
    await freshTestExecutor.runAllTests();

    // Check that the behave command was sent and does NOT include any .feature file
    const behaveCommand = sentCommands.find((cmd) => cmd.includes("behave"));
    assert.ok(
      behaveCommand,
      `Expected behave command not found. All commands: ${JSON.stringify(
        sentCommands
      )}`
    );
    assert.ok(
      !/\.feature/.test(behaveCommand),
      `Command should not include any .feature file: ${behaveCommand}`
    );

    // Restore original functions
    vscode.window.createTerminal = originalCreateTerminal;
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

  test("Should execute test with output", async () => {
    const options: TestExecutionOptions = {
      filePath: "/test/path/test.feature",
      lineNumber: 5,
    };

    // Collect all sent commands
    const sentCommands: string[] = [];
    const mockTerminal = {
      show: () => {},
      sendText: (text: string) => {
        sentCommands.push(text);
      },
    };

    const originalCreateTerminal = vscode.window.createTerminal;
    vscode.window.createTerminal = () => mockTerminal as any;

    // Create a fresh TestExecutor instance to ensure the mock is used
    const freshTestExecutor = new TestExecutor();

    // Test execute test with output
    const result = await freshTestExecutor.executeTestWithOutput(options);

    // Assert that a behave command with the correct file and line was sent
    const behaveCommand = sentCommands.find(
      (cmd) =>
        cmd.includes("behave") && cmd.includes("/test/path/test.feature:5")
    );
    assert.ok(
      behaveCommand,
      `Expected behave command with file and line not found. All commands: ${JSON.stringify(
        sentCommands
      )}`
    );

    assert.ok(result);
    assert.strictEqual(result.success, true);
    assert.strictEqual(typeof result.output, "string");
    assert.strictEqual(typeof result.duration, "number");
    assert.ok(result.duration > 0);

    // Restore original function
    vscode.window.createTerminal = originalCreateTerminal;
  });

  test("Should validate behave installation", () => {
    // Mock terminal creation
    const sentCommands: string[] = [];
    const mockTerminal = {
      show: () => {},
      sendText: (text: string) => {
        sentCommands.push(text);
      },
    };

    const originalCreateTerminal = vscode.window.createTerminal;
    vscode.window.createTerminal = () => mockTerminal as any;

    // Create a fresh TestExecutor instance to avoid using the global one
    const freshTestExecutor = new TestExecutor();

    // Test validate behave installation
    const result = freshTestExecutor.validateBehaveInstallation();

    // Check that the behave --version command was sent
    const behaveCommand = sentCommands.find((cmd) =>
      cmd.includes("behave --version")
    );
    assert.ok(
      behaveCommand,
      `Expected behave --version command not found. All commands: ${JSON.stringify(
        sentCommands
      )}`
    );

    assert.strictEqual(typeof result, "boolean");
    assert.strictEqual(result, true);

    // Restore original function
    vscode.window.createTerminal = originalCreateTerminal;
  });

  test("Should handle custom working directory", async () => {
    // Mock the ExtensionConfig singleton
    const mockExtensionConfig = {
      behaveCommand: "behave",
      workingDirectory: "/custom/working/dir",
      autoDiscoverTests: true,
      testFilePattern: "**/*.feature",
      parallelExecution: false,
      maxParallelProcesses: 4,
      outputFormat: "pretty",
      tags: "",
      dryRun: false,
      reload: () => {},
      validate: () => {},
      isValid: () => true,
      getValidationErrors: () => [],
      addChangeListener: () => {},
      removeChangeListener: () => {},
      dispose: () => {},
      getAllConfig: () => ({
        behaveCommand: "behave",
        workingDirectory: "/custom/working/dir",
        autoDiscoverTests: true,
        testFilePattern: "**/*.feature",
        parallelExecution: false,
        maxParallelProcesses: 4,
        outputFormat: "pretty",
        tags: "",
        dryRun: false,
      }),
      getIntelligentBehaveCommand: async () => "behave",
    };

    // Mock terminal creation
    const sentCommands: string[] = [];
    const mockTerminal = {
      show: () => {},
      sendText: (text: string) => {
        sentCommands.push(text);
      },
    };

    const originalCreateTerminal = vscode.window.createTerminal;
    vscode.window.createTerminal = () => mockTerminal as any;

    // Create a TestExecutor with mocked ExtensionConfig
    const testExecutor = new TestExecutor();
    // Replace the config with our mock
    (testExecutor as any).config = mockExtensionConfig;

    // Test run scenario
    await testExecutor.runScenario({
      filePath: "/test/path/test.feature",
      lineNumber: 5,
      scenarioName: "Test",
    });

    // Check that the behave command was sent
    const behaveCommand = sentCommands.find((cmd) => cmd.includes("behave"));
    assert.ok(
      behaveCommand,
      `Expected behave command not found. All commands: ${JSON.stringify(
        sentCommands
      )}`
    );

    // Check that the cd command was sent (if working directory is different)
    const cdCommand = sentCommands.find((cmd) =>
      cmd.includes('cd "/custom/working/dir"')
    );
    if (process.cwd() !== "/custom/working/dir") {
      assert.ok(
        cdCommand,
        `Expected cd command not found. All commands: ${JSON.stringify(
          sentCommands
        )}`
      );
    }

    // Restore original function
    vscode.window.createTerminal = originalCreateTerminal;
  });
});

suite('PythonDetector', () => {
  test('should prefer venv python if detected', async () => {
    const detector = PythonDetector.getInstance();
    // Mock detectVenvPython to return a fake venv path
    detector.detectVenvPython = async () => '/fake/venv/bin/python';
    // Mock testBehaveCommand to always return false for direct behave, true for venv
    detector.testBehaveCommand = async (cmd: string) => cmd.startsWith('/fake/venv/bin/python');
    const command = await detector.getBestBehaveCommand();
    expect(command).to.equal('/fake/venv/bin/python -m behave');
    detector.clearCache();
  });
});

suite('CommandManager TestItemMap', () => {
  test('should add and retrieve test items from the map', () => {
    const manager = CommandManager.getInstance();
    manager.clearTestItemMap();
    const fakeTestItem = { id: 'test1' } as any;
    manager.addTestItemToMap('/path/to/file.feature', 10, 'Scenario Name', fakeTestItem);
    const found = manager.getTestItemFromMap('/path/to/file.feature', 10, 'Scenario Name');
    expect(found).to.equal(fakeTestItem);
    manager.clearTestItemMap();
  });

  test('should clear the map', () => {
    const manager = CommandManager.getInstance();
    const fakeTestItem = { id: 'test2' } as any;
    manager.addTestItemToMap('/path/to/file.feature', 20, 'Another Scenario', fakeTestItem);
    manager.clearTestItemMap();
    const found = manager.getTestItemFromMap('/path/to/file.feature', 20, 'Another Scenario');
    expect(found).to.be.undefined;
  });

  test('should block test execution when discovery is in progress', () => {
    const manager = CommandManager.getInstance();
    manager.setTestDiscoveryInProgress(true);
    expect(manager.getIsTestRunning()).to.be.true;
    manager.setTestDiscoveryInProgress(false);
    expect(manager.getIsTestRunning()).to.be.false;
  });
});

test('Should run only the specific scenario outline example from CodeLens', async () => {
  const manager = CommandManager.getInstance();
  // Spy on testExecutor.runScenario
  let calledWith: any = null;
  manager['testExecutor'].runScenario = async (opts: any) => {
    calledWith = opts;
    return Promise.resolve();
  };
  manager['testExecutor'].runScenarioWithOutput = async (opts: any) => {
    calledWith = opts;
    return { success: true, duration: 1, output: '', error: "" };
  };
  // Simulate running a scenario outline example from CodeLens
  const filePath = '/path/to/file.feature';
  const lineNumber = 10;
  const scenarioName = '1: Login with different credentials - username: admin, password: secret, result: success';
  await manager['runScenario'](filePath, lineNumber, scenarioName);
  // Should run only the specific example
  expect(calledWith).to.include({ filePath, lineNumber, scenarioName });
});

test('Should debug only the specific scenario outline example from CodeLens with quoted name', async () => {
  const manager = CommandManager.getInstance();
  // Spy on testExecutor.debugScenario
  let calledWith: any = null;
  manager['testExecutor'].debugScenario = async (opts: any) => {
    calledWith = opts;
    return Promise.resolve();
  };
  // Simulate debugging a scenario outline example from CodeLens
  const filePath = '/path/to/file.feature';
  const lineNumber = 10;
  const scenarioName = '1: Login with different credentials - username: admin, password: secret, result: success';
  await manager['debugScenario'](filePath, lineNumber, scenarioName);
  // Should pass the scenarioName without quotes (TestExecutor handles quoting internally)
  expect(calledWith).to.include({ filePath, lineNumber });
  expect(calledWith.scenarioName).to.equal(scenarioName);
});

suite('Behave Command Consistency', () => {
  let testExecutor: TestExecutor;
  let sentCommands: string[];
  let debugArgs: any[];
  let mockExtensionConfig: any;

  setup(() => {
    sentCommands = [];
    debugArgs = [];
    mockExtensionConfig = {
      getIntelligentBehaveCommand: async () => 'behave',
      tags: undefined,
      outputFormat: undefined,
      dryRun: false,
    };
    testExecutor = new TestExecutor();
    (testExecutor as any).config = mockExtensionConfig;
    // Mock terminal
    (testExecutor as any).executeCommand = (cmd: string) => {
      sentCommands.push(cmd);
    };
    // Mock debug
    (testExecutor as any).debug = {
      startDebugging: (_ws: any, config: any) => {
        debugArgs.push(config.args);
        return Promise.resolve(true);
      },
    };
    // Mock fs.existsSync to always return true
    (testExecutor as any).fs = { existsSync: () => true };
    // Patch fs.existsSync globally for scenario outline detection
    (require('fs').existsSync as any) = () => true;
  });

  test('debugScenario and runScenario generate the same command for scenario outline', async () => {
    const options = {
      filePath: '/test/path/outline.feature',
      scenarioName: 'Outline Scenario',
      lineNumber: 10,
    };
    // Run scenario outline
    await testExecutor.runScenario(options);
    // Debug scenario outline
    await testExecutor.debugScenario(options);
    // Extract the behave command from runScenario
    const runCmd = sentCommands.find(cmd => cmd.includes('behave'));
    assert.ok(runCmd, 'No behave command was captured for runScenario');
    // Extract the behave args from debugScenario
    const debugCmdArgs = debugArgs[0];
    // The run command should include --name="Outline Scenario"
    assert.ok(runCmd!.includes('--name="Outline Scenario"'));
    // The debug args should include --name and the scenario name as separate arguments
    const debugNameIdx = debugCmdArgs.findIndex((arg: string) => arg === '--name');
    assert.ok(debugNameIdx !== -1 && debugCmdArgs[debugNameIdx + 1] === 'Outline Scenario');
    // The file path should match
    assert.ok(runCmd!.includes(options.filePath));
    assert.strictEqual(debugCmdArgs[0].startsWith(options.filePath), true);
  });

  test('debugScenario and runScenario generate the same command for scenario outline example', async () => {
    const exampleName = '1: Outline Scenario - param: value';
    const options = {
      filePath: '/test/path/outline.feature',
      scenarioName: exampleName,
      lineNumber: 12,
    };
    
    // Run scenario outline example
    await testExecutor.runScenario(options);
    
    // Debug scenario outline example
    await testExecutor.debugScenario(options);
    
    // Extract the behave command from runScenario
    const runCmd = sentCommands.find(cmd => cmd.includes('behave'));
    assert.ok(runCmd, 'No behave command was captured for runScenario (example)');
    // Extract the behave args from debugScenario
    assert.ok(debugArgs[0], 'No debug args were captured for debugScenario (example)');
    const debugCmdArgs = debugArgs[0];
    // The run command should include --name with the original outline name
    assert.ok(runCmd!.includes('--name="Outline Scenario"'));
    // The debug args should include --name and the original outline name as separate arguments
    const debugNameIdx = debugCmdArgs.findIndex((arg: string) => arg === '--name');
    assert.ok(debugNameIdx !== -1 && debugCmdArgs[debugNameIdx + 1] === 'Outline Scenario');
    // The file path should match
    assert.ok(runCmd!.includes(options.filePath));
    assert.strictEqual(debugCmdArgs[0].startsWith(options.filePath), true);
  });
});
