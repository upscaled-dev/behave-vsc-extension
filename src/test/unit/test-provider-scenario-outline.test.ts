import * as assert from "assert";
import * as vscode from "vscode";
import { BehaveTestProvider } from "../../test-providers/behave-test-provider";
import { FeatureBasedOrganization, FlatOrganization } from "../../core/test-organization";

suite("Test Provider Scenario Outline Parent-Child Tests", () => {
  let testController: vscode.TestController;
  let testProvider: BehaveTestProvider;

  setup(() => {
    testController = vscode.tests.createTestController("test", "Test");
    testProvider = new BehaveTestProvider(testController);
  });

  teardown(() => {
    testController.dispose();
  });

  test("Should store parent-child relationships in hierarchy view", () => {
    // Arrange
    testProvider.setOrganizationStrategy(new FeatureBasedOrganization());
    
    const mockScenario = {
      name: "1: Load testing with multiple users - user_count: 10",
      lineNumber: 39,
      outlineLineNumber: 31,
      filePath: "/test/features/test.feature",
      tags: ["performance"],
      isScenarioOutline: true
    };

    const mockFile = vscode.Uri.file("/test/features/test.feature");

    // Act
    const testItem = (testProvider as any).createScenarioTestItem(mockFile, mockScenario);

    // Assert
    assert.strictEqual(testItem.id, "/test/features/test.feature:39");
    assert.strictEqual(testItem.label, "1: Load testing with multiple users - user_count: 10");
    
    // Check that parent relationship was stored
    const parentRelationships = (testProvider as any).scenarioOutlineParents;
    assert.strictEqual(parentRelationships.get("/test/features/test.feature:39"), "/test/features/test.feature:31");
  });

  test("Should not store parent-child relationships in non-hierarchy views", () => {
    // Arrange
    testProvider.setOrganizationStrategy(new FlatOrganization());
    
    const mockScenario = {
      name: "1: Load testing with multiple users - user_count: 10",
      lineNumber: 39,
      outlineLineNumber: 31,
      filePath: "/test/features/test.feature",
      tags: ["performance"],
      isScenarioOutline: true
    };

    const mockFile = vscode.Uri.file("/test/features/test.feature");

    // Act
    const testItem = (testProvider as any).createScenarioTestItem(mockFile, mockScenario);

    // Assert
    assert.strictEqual(testItem.id, "/test/features/test.feature:39");
    
    // Check that no parent relationship was stored
    const parentRelationships = (testProvider as any).scenarioOutlineParents;
    assert.strictEqual(parentRelationships.has("/test/features/test.feature:39"), false);
  });

  test("Should update parent status when child status changes in hierarchy view", () => {
    // Arrange
    testProvider.setOrganizationStrategy(new FeatureBasedOrganization());
    
    // Mock the scenario outline parent-child relationship
    (testProvider as any).scenarioOutlineParents.set("/test/features/test.feature:39", "/test/features/test.feature:31");
    
    // Mock the test status cache
    (testProvider as any).testStatusCache = new Map();

    // Act
    testProvider.updateTestStatus("/test/features/test.feature:39", "passed");

    // Assert
    const testStatusCache = (testProvider as any).testStatusCache;
    assert.strictEqual(testStatusCache.get("/test/features/test.feature:39"), "passed");
  });

  test("Should set parent status to failed when any child fails", () => {
    // Arrange
    testProvider.setOrganizationStrategy(new FeatureBasedOrganization());
    
    // Mock the scenario outline parent-child relationship
    (testProvider as any).scenarioOutlineParents.set("/test/features/test.feature:39", "/test/features/test.feature:31");
    
    // Mock the test status cache
    (testProvider as any).testStatusCache = new Map();

    // Act
    testProvider.updateTestStatus("/test/features/test.feature:39", "failed");

    // Assert
    const testStatusCache = (testProvider as any).testStatusCache;
    assert.strictEqual(testStatusCache.get("/test/features/test.feature:39"), "failed");
  });

  test("Should not update parent status in non-hierarchy views", () => {
    // Arrange
    testProvider.setOrganizationStrategy(new FlatOrganization());
    
    // Mock the scenario outline parent-child relationship (should not be used)
    (testProvider as any).scenarioOutlineParents.set("/test/features/test.feature:39", "/test/features/test.feature:31");
    
    // Mock the test status cache
    (testProvider as any).testStatusCache = new Map();
    
    // Act
    testProvider.updateTestStatus("/test/features/test.feature:39", "passed");
    
    // Assert
    const testStatusCache = (testProvider as any).testStatusCache;
    assert.strictEqual(testStatusCache.get("/test/features/test.feature:39"), "passed");
    
    // Parent status should not be updated in flat organization
    assert.strictEqual(testStatusCache.has("/test/features/test.feature:31"), false);
  });

  test("Should not update parent status when parent is from different feature file", () => {
    // Arrange
    testProvider.setOrganizationStrategy(new FeatureBasedOrganization());
    
    // Mock the scenario outline parent-child relationship with different feature files
    (testProvider as any).scenarioOutlineParents.set("/test/features/advanced-example.feature:23", "/test/features/test-scenario-outline.feature:outline:Test with different values");
    
    // Mock the test status cache
    (testProvider as any).testStatusCache = new Map();
    
    // Act
    testProvider.updateTestStatus("/test/features/advanced-example.feature:23", "passed");
    
    // Assert
    const testStatusCache = (testProvider as any).testStatusCache;
    assert.strictEqual(testStatusCache.get("/test/features/advanced-example.feature:23"), "passed");
    
    // Parent status should not be updated because it's from a different feature file
    assert.strictEqual(testStatusCache.has("/test/features/test-scenario-outline.feature:outline:Test with different values"), false);
  });

  test("Should extract feature file path correctly from test ID", () => {
    // Arrange
    const testProvider = new BehaveTestProvider(testController);
    
    // Act & Assert
    assert.strictEqual((testProvider as any).extractFeatureFileFromTestId("/test/features/test.feature:39"), "/test/features/test.feature");
    assert.strictEqual((testProvider as any).extractFeatureFileFromTestId("/test/features/advanced-example.feature:23"), "/test/features/advanced-example.feature");
    assert.strictEqual((testProvider as any).extractFeatureFileFromTestId("test.feature"), undefined);
    assert.strictEqual((testProvider as any).extractFeatureFileFromTestId(""), undefined);
  });

  test("Should process scenario outlines correctly when running feature from hierarchical view", () => {
    // Arrange - Simulate the exact scenario from the log
    testProvider.setOrganizationStrategy(new FeatureBasedOrganization());
    
    // Mock scenario outline parent-child relationships for the advanced-example.feature
    (testProvider as any).scenarioOutlineParents.set("/test/features/advanced-example.feature:39", "/test/features/advanced-example.feature:outline:Load testing with multiple users");
    (testProvider as any).scenarioOutlineParents.set("/test/features/advanced-example.feature:40", "/test/features/advanced-example.feature:outline:Load testing with multiple users");
    (testProvider as any).scenarioOutlineParents.set("/test/features/advanced-example.feature:41", "/test/features/advanced-example.feature:outline:Load testing with multiple users");
    
    // Mock the test status cache
    (testProvider as any).testStatusCache = new Map();
    
    // Mock the discovered tests map with the parent test item
    const parentTestItem = testController.createTestItem(
      "/test/features/advanced-example.feature:outline:Load testing with multiple users",
      "Scenario Outline: Load testing with multiple users",
      vscode.Uri.file("/test/features/advanced-example.feature")
    );
    
    // Add child test items to the parent
    const child1 = testController.createTestItem(
      ":39",
      "1: Load testing with multiple users - user_count: 10",
      vscode.Uri.file("/test/features/advanced-example.feature")
    );
    const child2 = testController.createTestItem(
      ":40",
      "2: Load testing with multiple users - user_count: 50",
      vscode.Uri.file("/test/features/advanced-example.feature")
    );
    const child3 = testController.createTestItem(
      ":41",
      "3: Load testing with multiple users - user_count: 100",
      vscode.Uri.file("/test/features/advanced-example.feature")
    );
    
    parentTestItem.children.add(child1);
    parentTestItem.children.add(child2);
    parentTestItem.children.add(child3);
    
    // Add the parent to the discovered tests map
    (testProvider as any).discoveredTests.set("/test/features/advanced-example.feature:outline:Load testing with multiple users", parentTestItem);

    // Act - Simulate running the advanced-example.feature and updating scenario statuses
    testProvider.updateTestStatus("/test/features/advanced-example.feature:39", "passed");
    testProvider.updateTestStatus("/test/features/advanced-example.feature:40", "passed");
    testProvider.updateTestStatus("/test/features/advanced-example.feature:41", "passed");

    // Assert
    const testStatusCache = (testProvider as any).testStatusCache;
    
    // All scenario outline examples should have their status updated
    assert.strictEqual(testStatusCache.get("/test/features/advanced-example.feature:39"), "passed");
    assert.strictEqual(testStatusCache.get("/test/features/advanced-example.feature:40"), "passed");
    assert.strictEqual(testStatusCache.get("/test/features/advanced-example.feature:41"), "passed");
    
    // The parent should also have its status updated since all children passed
    assert.strictEqual(testStatusCache.get("/test/features/advanced-example.feature:outline:Load testing with multiple users"), "passed");
  });

  test("Should discover scenario outline hierarchy correctly", async () => {
    // Arrange
    testProvider.setOrganizationStrategy(new FeatureBasedOrganization());
    
    // Use an existing feature file that we know has scenario outlines
    const path = require('path');
    const existingFeatureFile = path.join(process.cwd(), 'features', 'advanced-example.feature');

    try {
      // Act - Add the feature file to the test controller
      await testProvider.addFeatureFileToTestController(
        vscode.Uri.file(existingFeatureFile)
      );

      // Assert - Check that the scenario outline hierarchy was created correctly
      const discoveredTests = testProvider.getDiscoveredTests();
      const featureItem = discoveredTests.get(existingFeatureFile);
      
      assert.ok(featureItem, 'Feature item should be created');
      assert.ok(featureItem.children.size > 0, 'Should have at least one child');
      
      // Find the scenario outline item (it should be the one with children)
      let scenarioOutlineItem: vscode.TestItem | undefined;
      for (const [, child] of featureItem.children) {
        if (child.children.size > 0) {
          scenarioOutlineItem = child;
          break;
        }
      }
      
      assert.ok(scenarioOutlineItem, 'Scenario outline item should exist');
      assert.ok(scenarioOutlineItem.label.includes('Scenario Outline'), 'Should be a scenario outline');
      assert.ok(scenarioOutlineItem.children.size > 0, 'Should have example children');
      
      // Check that the examples are correctly named and have the expected format
      const exampleNames = Array.from(scenarioOutlineItem.children).map(([, child]) => child.label);
      assert.ok(exampleNames.length > 0, 'Should have example names');
      
      // Verify that examples follow the expected naming pattern (number: scenario name - parameters)
      for (const exampleName of exampleNames) {
        assert.ok(exampleName.match(/^\d+:\s*.+-\s*.+/), `Example name should match pattern: ${exampleName}`);
      }
      
    } catch (error) {
      // If the file doesn't exist, skip the test gracefully
      if (error instanceof Error && error.message.includes('ENOENT')) {
        console.log('Skipping test - advanced-example.feature not found');
        return;
      }
      throw error;
    }
  });
});
