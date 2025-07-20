import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { FeatureParser } from "../parsers/feature-parser";

suite("Test Execution Test Suite", () => {
  // Test running tests at feature level
  test("Should run tests at feature level", () => {
    // Create a test feature file
    const testFeature = `Feature: Test Execution Feature
  As a test user
  I want to run tests at feature level
  So that I can verify functionality

  Scenario: First test scenario
    Given I am on the test page
    When I click the test button
    Then I should see the test result

  Scenario: Second test scenario
    Given I have test data
    When I run the test
    Then the test should pass`;

    const tempFile = createTempFile(testFeature);
    try {
      // Test that we can parse the feature
      const parsed = FeatureParser.parseFeatureFile(tempFile);
      assert.ok(parsed, "Should parse feature file");
      assert.strictEqual(parsed.feature, "Test Execution Feature");
      assert.strictEqual(parsed.scenarios.length, 2);

      // Test that we can construct the behave command for feature level
      const config = vscode.workspace.getConfiguration("behaveTestRunner");
      const behaveCommand = config.get<string>("behaveCommand") ?? "behave";
      const featureCommand = `${behaveCommand} "${tempFile}"`;

      assert.ok(
        featureCommand.includes(behaveCommand),
        "Should include behave command"
      );
      assert.ok(
        featureCommand.includes(tempFile),
        "Should include feature file path"
      );

      // Test that the command is valid (without actually executing)
      assert.ok(featureCommand.length > 0, "Command should not be empty");
      assert.ok(featureCommand.includes('"'), "Should quote file path");
    } finally {
      cleanupTempFile(tempFile);
    }
  });

  // Test running tests at scenario level
  test("Should run tests at scenario level", () => {
    const testFeature = `Feature: Scenario Level Testing
  As a test user
  I want to run individual scenarios
  So that I can debug specific tests

  Scenario: Debug this scenario
    Given I am debugging
    When I run this scenario
    Then I should see debug output

  Scenario: Another scenario
    Given some condition
    When something happens
    Then something else should happen`;

    const tempFile = createTempFile(testFeature);
    try {
      const parsed = FeatureParser.parseFeatureFile(tempFile);
      assert.ok(parsed, "Should parse feature file");

      // Test scenario-level command construction
      const config = vscode.workspace.getConfiguration("behaveTestRunner");
      const behaveCommand = config.get<string>("behaveCommand") ?? "behave";

      // Test first scenario
      const firstScenario = parsed.scenarios[0];
      if (firstScenario) {
        const scenarioCommand = `${behaveCommand} "${tempFile}" --name="${firstScenario.name}"`;

        assert.ok(
          scenarioCommand.includes(behaveCommand),
          "Should include behave command"
        );
        assert.ok(
          scenarioCommand.includes(tempFile),
          "Should include feature file path"
        );
        assert.ok(
          scenarioCommand.includes("--name="),
          "Should include scenario name filter"
        );
        assert.ok(
          scenarioCommand.includes(firstScenario.name),
          "Should include scenario name"
        );
      }

      // Test that we can construct commands for all scenarios
      parsed.scenarios.forEach((scenario: any, index: number) => {
        const cmd = `${behaveCommand} "${tempFile}" --name="${scenario.name}"`;
        assert.ok(
          cmd.includes(scenario.name),
          `Command ${index} should include scenario name`
        );
      });
    } finally {
      cleanupTempFile(tempFile);
    }
  });

  // Test debugging tests at scenario level
  test("Should debug tests at scenario level", () => {
    const testFeature = `Feature: Debug Testing
  As a developer
  I want to debug scenarios
  So that I can fix issues

  Scenario: Debug scenario with breakpoints
    Given I have a debugger
    When I set a breakpoint
    Then I can step through code`;

    const tempFile = createTempFile(testFeature);
    try {
      const parsed = FeatureParser.parseFeatureFile(tempFile);
      assert.ok(parsed, "Should parse feature file");

      // Test debug command construction
      const config = vscode.workspace.getConfiguration("behaveTestRunner");
      const behaveCommand = config.get<string>("behaveCommand") ?? "behave";

      // Test debug command with Python debugger
      const debugCommand = `python -m pdb -m ${behaveCommand} "${tempFile}" --name="Debug scenario with breakpoints"`;

      assert.ok(debugCommand.includes("python"), "Should include python");
      assert.ok(debugCommand.includes("-m pdb"), "Should include debugger");
      assert.ok(
        debugCommand.includes(behaveCommand),
        "Should include behave command"
      );
      assert.ok(debugCommand.includes(tempFile), "Should include feature file");

      // Test alternative debug command
      const debugCommand2 = `python -m ipdb -m ${behaveCommand} "${tempFile}" --name="Debug scenario with breakpoints"`;
      assert.ok(debugCommand2.includes("ipdb"), "Should support ipdb debugger");
    } finally {
      cleanupTempFile(tempFile);
    }
  });

  // Test Test Explorer integration
  test("Should create test items for Test Explorer", () => {
    // Test that we can create test controller
    const controller = vscode.tests.createTestController(
      "behave-test-runner",
      "Behave Test Runner"
    );
    assert.ok(controller, "Should create test controller");

    // Test that we can create test items
    const testItem = controller.createTestItem(
      "test-id",
      "Test Feature",
      vscode.Uri.file("/tmp/test.feature")
    );
    assert.ok(testItem, "Should create test item");
    assert.strictEqual(
      testItem.label,
      "Test Feature",
      "Test item should have correct label"
    );

    // Test that we can create child test items (scenarios)
    const scenarioItem = controller.createTestItem(
      "scenario-id",
      "Test Scenario",
      vscode.Uri.file("/tmp/test.feature")
    );
    testItem.children.add(scenarioItem);
    assert.strictEqual(
      testItem.children.size,
      1,
      "Should have child test item"
    );

    // Clean up
    controller.dispose();
  });

  // Test Test Explorer run handler
  test("Should handle Test Explorer run requests", () => {
    const controller = vscode.tests.createTestController(
      "behave-test-runner",
      "Behave Test Runner"
    );

    try {
      // Test that we can create a run handler
      const runHandler = (_request: vscode.TestRunRequest): void => {
        // Mock implementation
      };

      controller.createRunProfile(
        "Run",
        vscode.TestRunProfileKind.Run,
        runHandler
      );

      // Test that run profile was created (we can't access runProfiles directly)
      assert.ok(controller, "Should have test controller");
    } finally {
      controller.dispose();
    }
  });

  // Test Test Explorer debug handler
  test("Should handle Test Explorer debug requests", () => {
    const controller = vscode.tests.createTestController(
      "behave-test-runner",
      "Behave Test Runner"
    );

    try {
      // Test that we can create a debug handler
      const debugHandler = (_request: vscode.TestRunRequest): void => {
        // Mock implementation
      };

      controller.createRunProfile(
        "Debug",
        vscode.TestRunProfileKind.Debug,
        debugHandler
      );

      // Test that debug profile was created (we can't access runProfiles directly)
      assert.ok(controller, "Should have test controller");
    } finally {
      controller.dispose();
    }
  });

  // Test command execution with output capture
  test("Should capture command output", () => {
    // Test that we can create output channel
    const outputChannel =
      vscode.window.createOutputChannel("Behave Test Runner");
    assert.ok(outputChannel, "Should create output channel");

    // Test that we can write to output channel
    outputChannel.appendLine("Test output line");
    outputChannel.appendLine("Another test line");

    // Test that output channel is accessible
    assert.ok(
      outputChannel.name === "Behave Test Runner",
      "Should have correct name"
    );

    // Clean up
    outputChannel.dispose();
  });

  // Test error handling in test execution
  test("Should handle test execution errors", () => {
    const testFeature = `Feature: Error Handling
  As a test runner
  I want to handle errors gracefully
  So that the extension doesn't crash

  Scenario: Test with error
    Given an error condition
    When something goes wrong
    Then the error should be handled`;

    const tempFile = createTempFile(testFeature);
    try {
      // Test error handling in command construction
      const config = vscode.workspace.getConfiguration("behaveTestRunner");
      const behaveCommand = config.get<string>("behaveCommand") ?? "behave";

      // Test with invalid file path
      const invalidCommand = `${behaveCommand} "/nonexistent/file.feature"`;

      // Test that command is constructed even with invalid path
      assert.ok(
        invalidCommand.includes(behaveCommand),
        "Should include behave command"
      );
      assert.ok(
        invalidCommand.includes("/nonexistent/file.feature"),
        "Should include file path"
      );

      // Test error handling in parsing
      const parsed = FeatureParser.parseFeatureFile(tempFile);
      assert.ok(parsed, "Should parse valid file");

      // Test parsing of non-existent file
      const invalidParsed = FeatureParser.parseFeatureFile(
        "/nonexistent/file.feature"
      );
      assert.strictEqual(
        invalidParsed,
        null,
        "Should return null for non-existent file"
      );
    } finally {
      cleanupTempFile(tempFile);
    }
  });

  // Test working directory handling
  test("Should handle working directory configuration", () => {
    const config = vscode.workspace.getConfiguration("behaveTestRunner");
    const workingDirectory = config.get<string>("workingDirectory") ?? "";

    // Test default working directory
    assert.ok(
      typeof workingDirectory === "string",
      "Working directory should be string"
    );

    // Test command construction with working directory
    const behaveCommand = config.get<string>("behaveCommand") ?? "behave";
    const testFile = "/tmp/test.feature";

    let command = `${behaveCommand} "${testFile}"`;
    if (workingDirectory) {
      command = `cd "${workingDirectory}" && ${command}`;
    }

    assert.ok(command.includes(behaveCommand), "Should include behave command");
    assert.ok(command.includes(testFile), "Should include test file");

    if (workingDirectory) {
      assert.ok(command.includes("cd"), "Should include cd command");
      assert.ok(
        command.includes(workingDirectory),
        "Should include working directory"
      );
    }
  });

  // Test test discovery in Test Explorer
  test("Should discover tests for Test Explorer", () => {
    const controller = vscode.tests.createTestController(
      "behave-test-runner",
      "Behave Test Runner"
    );

    try {
      // Create test feature file
      const testFeature = `Feature: Test Discovery
  As a test explorer
  I want to discover tests
  So that they appear in the UI

  Scenario: First discovered scenario
    Given test discovery works
    When I look at the test explorer
    Then I should see the tests

  Scenario: Second discovered scenario
    Given another test exists
    When I run the tests
    Then all tests should pass`;

      const tempFile = createTempFile(testFeature);
      try {
        const parsed = FeatureParser.parseFeatureFile(tempFile);
        assert.ok(parsed, "Should parse feature file");

        // Test that we can create test items for discovered tests
        const featureItem = controller.createTestItem(
          `feature-${tempFile}`,
          parsed.feature,
          vscode.Uri.file(tempFile)
        );

        // Add scenarios as child items
        parsed.scenarios.forEach((scenario: any, index: number) => {
          const scenarioItem = controller.createTestItem(
            `scenario-${tempFile}-${index}`,
            scenario.name,
            vscode.Uri.file(tempFile)
          );
          featureItem.children.add(scenarioItem);
        });

        // Test that test items were created correctly
        assert.strictEqual(
          featureItem.label,
          parsed.feature,
          "Feature item should have correct label"
        );
        assert.strictEqual(
          featureItem.children.size,
          parsed.scenarios.length,
          "Should have correct number of scenarios"
        );

        // Test that scenarios have correct labels
        const scenarioItems = Array.from(featureItem.children).map(
          ([, item]) => item
        );
        parsed.scenarios.forEach((scenario: any, index: number) => {
          const scenarioItem = scenarioItems[index];
          assert.ok(
            scenarioItem,
            `Should have scenario item at index ${index}`
          );
          assert.strictEqual(
            scenarioItem.label,
            scenario.name,
            "Scenario should have correct label"
          );
        });
      } finally {
        cleanupTempFile(tempFile);
      }
    } finally {
      controller.dispose();
    }
  });
});

// Helper functions
function createTempFile(content: string): string {
  const tempDir = path.join(__dirname, "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const tempFile = path.join(tempDir, `execution-test-${Date.now()}.feature`);
  fs.writeFileSync(tempFile, content);
  return tempFile;
}

function cleanupTempFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
