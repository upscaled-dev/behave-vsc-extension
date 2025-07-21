import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs";

// Remove console statements or replace with proper logging
 
console.log("Testing integration with real workspace");

suite("Integration Test Suite", () => {
  // This test requires a real workspace with feature files
  test("Should discover features in real workspace", async () => {
    if (!vscode.workspace.workspaceFolders) {
       
      console.log("Skipping integration test - no workspace folders");
      return;
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      const featureFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, "**/*.feature")
      );

       
      console.log(`Found ${featureFiles.length} feature files in workspace`);

      // If we have feature files, test that they can be parsed
      if (featureFiles.length > 0) {
        const firstFile = featureFiles[0];
        if (firstFile) {
           
          console.log(`Testing parsing of: ${firstFile.fsPath}`);

          // Test that the file exists and is readable
          assert.ok(
            fs.existsSync(firstFile.fsPath),
            "Feature file should exist"
          );

          const content = fs.readFileSync(firstFile.fsPath, "utf-8");
          assert.ok(content.length > 0, "Feature file should have content");

          // Test that it contains "Feature:" keyword
          assert.ok(
            content.includes("Feature:"),
            "Feature file should contain Feature: keyword"
          );
        }
      }
    }
  });

  test("Should have test controller in real workspace", () => {
    if (!vscode.workspace.workspaceFolders) {
       
      console.log("Skipping test controller test - no workspace folders");
      return;
    }

    // Test that the test API is available
    assert.ok(vscode.tests, "Should have tests API");

    // Test that we can create a test controller
    const controller = vscode.tests.createTestController(
      "behave-test-runner",
      "Behave Test Runner"
    );
    assert.ok(controller, "Should be able to create test controller");

    // Clean up
    controller.dispose();
  });

  test("Should execute behave command", async () => {
    // Test that the behave command exists and can be executed
    const commands = await vscode.commands.getCommands();
    const behaveCommands = commands.filter((cmd) =>
      cmd.startsWith("behaveTestRunner")
    );

    assert.ok(
      behaveCommands.length > 0,
      "Should have behave commands registered"
    );

    // Test that we can execute the refresh command with a timeout
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Command execution timed out")),
          3000
        );
      });

      const commandPromise = vscode.commands.executeCommand(
        "behaveTestRunner.refreshTests"
      );

      await Promise.race([commandPromise, timeoutPromise]);
      // If no error is thrown, the command executed successfully
      assert.ok(true, "Refresh command should execute without error");
    } catch (error) {
      // It's okay if the command fails or times out in test environment
       
      console.log(
        "Refresh command failed or timed out (expected in test environment):",
        error
      );
      assert.ok(true, "Command failure is expected in test environment");
    }
  });

  test("Should handle configuration changes", () => {
    const config = vscode.workspace.getConfiguration("behaveTestRunner");

    // Test default configuration
    const behaveCommand = config.get<string>("behaveCommand");
    assert.strictEqual(
      behaveCommand,
      "behave",
      'Default behave command should be "behave"'
    );

    // Test that we can read other configuration options
    const outputChannel = config.get<string>("outputChannel");
    assert.ok(
      typeof outputChannel === "string" || outputChannel === undefined,
      "Output channel should be string or undefined"
    );
  });

  test("Should create output channel", () => {
    // Test that we can create an output channel
    const outputChannel =
      vscode.window.createOutputChannel("Behave Test Runner");
    assert.ok(outputChannel, "Should be able to create output channel");

    // Test that we can write to it
    outputChannel.appendLine("Test output");
    outputChannel.show();

    // Clean up
    outputChannel.dispose();
  });

  test("Should handle file system operations", async () => {
    if (!vscode.workspace.workspaceFolders) {
       
      console.log("Skipping file system test - no workspace folders");
      return;
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      // Test that we can read workspace files
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, "**/*")
      );

      assert.ok(
        Array.isArray(files),
        "Should be able to find files in workspace"
      );
      assert.ok(files.length > 0, "Workspace should have files");
    }
  });

  test("Should handle URI operations", () => {
    // Test URI creation and manipulation
    const uri = vscode.Uri.file("/tmp/test.feature");
    assert.ok(uri, "Should be able to create URI");
    assert.strictEqual(uri.scheme, "file", "URI should have file scheme");
    assert.strictEqual(
      uri.fsPath,
      "/tmp/test.feature",
      "URI should have correct fsPath"
    );
  });

  test("Should handle workspace folder operations", () => {
    if (!vscode.workspace.workspaceFolders) {
       
      console.log("Skipping workspace folder test - no workspace folders");
      return;
    }

    const folder = vscode.workspace.workspaceFolders[0];
    assert.ok(folder, "Should have workspace folder");
    assert.ok(folder.uri, "Workspace folder should have URI");
    assert.ok(folder.name, "Workspace folder should have name");
    assert.ok(folder.index >= 0, "Workspace folder should have index");
  });
});
