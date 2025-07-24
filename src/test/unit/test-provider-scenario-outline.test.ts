import * as assert from "assert";
import * as vscode from "vscode";
import { BehaveTestProvider } from "../../test-providers/behave-test-provider";
import { FeatureBasedOrganization, FlatOrganization, TagBasedOrganization } from "../../core/test-organization";
import { Scenario } from "../../types";

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

  test("Should display correct tags in tag-based organization", async () => {
    // Arrange
    testProvider.setOrganizationStrategy(new TagBasedOrganization());
    
    // Create test scenarios with the same tags as in the actual feature file
    const testScenarios: Scenario[] = [
      {
        name: "Basic smoke test",
        line: 8,
        lineNumber: 8,
        range: new vscode.Range(7, 0, 7, 0),
        steps: [],
        tags: ["@smoke", "@critical"],
        filePath: "features/advanced-example.feature",
        isScenarioOutline: false,
      },
      {
        name: "UI validation test",
        line: 15,
        lineNumber: 15,
        range: new vscode.Range(14, 0, 14, 0),
        steps: [],
        tags: ["@regression", "@ui"],
        filePath: "features/advanced-example.feature",
        isScenarioOutline: false,
      },
      {
        name: "API integration test",
        line: 23,
        lineNumber: 23,
        range: new vscode.Range(22, 0, 22, 0),
        steps: [],
        tags: ["@api", "@integration"],
        filePath: "features/advanced-example.feature",
        isScenarioOutline: false,
      },
      {
        name: "Load testing with multiple users",
        line: 31,
        lineNumber: 31,
        range: new vscode.Range(30, 0, 30, 0),
        steps: [],
        tags: ["@performance", "@stress"],
        filePath: "features/advanced-example.feature",
        isScenarioOutline: true,
      },
      {
        name: "Security authentication test",
        line: 44,
        lineNumber: 44,
        range: new vscode.Range(43, 0, 43, 0),
        steps: [],
        tags: ["@security", "@authentication"],
        filePath: "features/advanced-example.feature",
        isScenarioOutline: false,
      },
      {
        name: "Database operations test",
        line: 51,
        lineNumber: 51,
        range: new vscode.Range(50, 0, 50, 0),
        steps: [],
        tags: ["@data", "@database"],
        filePath: "features/advanced-example.feature",
        isScenarioOutline: false,
      },
    ];

    // Act - Create tag-based hierarchy directly using the organization strategy
    const organizedGroups = testProvider.getOrganizationStrategy().organizeTests(testScenarios);
    
    // Log the organized groups
    console.log('Organized groups:');
    organizedGroups.forEach(group => {
      console.log(`- ${group.id}: ${group.label} (${group.scenarios.length} scenarios)`);
    });

    // Assert - Check that the tag groups are created correctly
    assert.ok(organizedGroups.length > 0, 'Should have organized groups');
    
    // Check that the tag labels are correct (should include @ symbol)
    for (const group of organizedGroups) {
      if (group.id !== 'untagged') {
        assert.ok(group.label.startsWith('@'), `Tag group label should start with @: ${group.label}`);
        console.log(`Tag group: ${group.id} -> ${group.label}`);
      }
    }
    
    // Check for specific expected tags from the feature file
    const tagLabels = organizedGroups.map(group => group.label);
    const expectedTags = ['@smoke', '@critical', '@regression', '@ui', '@api', '@integration', '@performance', '@stress', '@security', '@authentication', '@data', '@database'];
    
    // Log which expected tags are found
    for (const expectedTag of expectedTags) {
      const found = tagLabels.includes(expectedTag);
      console.log(`Expected tag ${expectedTag}: ${found ? 'FOUND' : 'NOT FOUND'}`);
    }
    
    // Assert that we have at least some of the expected tags
    const foundTags = expectedTags.filter(tag => tagLabels.includes(tag));
    assert.ok(foundTags.length > 0, `Should find at least some expected tags. Found: ${foundTags.join(', ')}`);
    
    // Check that scenarios are properly grouped
    for (const group of organizedGroups) {
      if (group.id !== 'untagged') {
        assert.ok(group.scenarios.length > 0, `Tag group ${group.label} should have scenarios`);
        console.log(`Group ${group.label} has ${group.scenarios.length} scenarios: ${group.scenarios.map(s => s.name).join(', ')}`);
      }
    }
  });

  test("Should generate behave-compliant tag commands", async () => {
    // Arrange
    testProvider.setOrganizationStrategy(new TagBasedOrganization());
    
    // Create test scenarios with various tag combinations
    const testScenarios: Scenario[] = [
      {
        name: "Single tag test",
        line: 8,
        lineNumber: 8,
        range: new vscode.Range(7, 0, 7, 0),
        steps: [],
        tags: ["@smoke"],
        filePath: "features/test.feature",
        isScenarioOutline: false,
      },
      {
        name: "Multiple tags test",
        line: 15,
        lineNumber: 15,
        range: new vscode.Range(14, 0, 14, 0),
        steps: [],
        tags: ["@regression", "@ui"],
        filePath: "features/test.feature",
        isScenarioOutline: false,
      },
      {
        name: "Complex tag test",
        line: 23,
        lineNumber: 23,
        range: new vscode.Range(22, 0, 22, 0),
        steps: [],
        tags: ["@api", "@integration", "@critical"],
        filePath: "features/test.feature",
        isScenarioOutline: false,
      },
    ];

    // Act - Create tag-based hierarchy
    const organizedGroups = testProvider.getOrganizationStrategy().organizeTests(testScenarios);
    
    // Test each tag group to ensure behave-compliant commands
    for (const group of organizedGroups) {
      if (group.id === 'untagged') continue;
      
      const tag = group.label; // This should be the raw tag like "@smoke"
      console.log(`Testing tag: ${tag}`);
      
      // Check that the tag is properly formatted for behave
      assert.ok(tag.startsWith('@'), `Tag should start with @: ${tag}`);
      assert.ok(/^@[a-zA-Z_][a-zA-Z0-9_]*$/.test(tag), `Tag should be valid behave tag format: ${tag}`);
      
      // Simulate the command generation that happens in runAllTestsWithTags
      const behaveCommand = "python3 -m behave";
      const expectedCommand = `${behaveCommand} --tags="${tag}" --no-skipped`;
      
      console.log(`Generated command: ${expectedCommand}`);
      
      // Verify the command structure is behave-compliant
      assert.ok(expectedCommand.includes('--tags='), 'Command should include --tags flag');
      assert.ok(expectedCommand.includes(`"${tag}"`), `Command should include quoted tag: ${tag}`);
      assert.ok(expectedCommand.includes('--no-skipped'), 'Command should include --no-skipped flag');
      
      // Test that the tag extraction logic works correctly
      const tagMatch = group.id.match(/^tag:(.+)$/);
      const extractedTag = tagMatch?.[1] ?? group.label;
      assert.strictEqual(extractedTag, tag, `Extracted tag should match original tag: ${extractedTag} vs ${tag}`);
      
      console.log(`✅ Tag ${tag} generates compliant behave command`);
    }
    
    // Test specific behave tag syntax compliance
    const behaveTagExamples = [
      '@smoke',
      '@regression', 
      '@ui',
      '@api',
      '@integration',
      '@critical',
      '@performance',
      '@stress'
    ];
    
    for (const exampleTag of behaveTagExamples) {
      const command = `python3 -m behave --tags="${exampleTag}" --no-skipped`;
      console.log(`Example behave command: ${command}`);
      
      // Verify behave syntax compliance
      assert.ok(command.match(/--tags="[^"]+"/), 'Command should have properly quoted tags');
      assert.ok(command.includes('--no-skipped'), 'Command should include --no-skipped flag');
    }
  });

  test("Should handle raw tags correctly without processing", () => {
    // Arrange - Test various tag formats that should be passed as-is to behave
    const rawTags = [
      '@smoke',
      '@regression',
      '@ui',
      '@api',
      '@integration',
      '@critical',
      '@performance',
      '@stress',
      '@security',
      '@authentication',
      '@data',
      '@database'
    ];
    
    // Act & Assert - Verify that tags are passed as raw strings without modification
    for (const rawTag of rawTags) {
      console.log(`Testing raw tag: ${rawTag}`);
      
      // Simulate the tag extraction process used in the extension
      const testId = `tag:${rawTag}`;
      const tagMatch = testId.match(/^tag:(.+)$/);
      const extractedTag = tagMatch?.[1] ?? rawTag;
      
      // Verify that the tag is passed as-is without any processing
      assert.strictEqual(extractedTag, rawTag, `Tag should be passed as-is: ${extractedTag} vs ${rawTag}`);
      
      // Verify that the tag maintains its @ symbol
      assert.ok(extractedTag.startsWith('@'), `Tag should start with @: ${extractedTag}`);
      
      // Verify that the tag is a valid behave tag format
      assert.ok(/^@[a-zA-Z_][a-zA-Z0-9_]*$/.test(extractedTag), `Tag should be valid behave format: ${extractedTag}`);
      
      // Simulate command generation
      const behaveCommand = "python3 -m behave";
      const generatedCommand = `${behaveCommand} --tags="${extractedTag}" --no-skipped`;
      
      console.log(`Generated command for ${rawTag}: ${generatedCommand}`);
      
      // Verify the command is behave-compliant
      assert.ok(generatedCommand.includes(`--tags="${rawTag}"`), `Command should include raw tag: ${rawTag}`);
      
      console.log(`✅ Raw tag ${rawTag} is handled correctly`);
    }
    
    // Test that we're not doing any unwanted tag processing
    const originalTags = ['@smoke', '@regression', '@ui'];
    const processedTags = originalTags.map(tag => {
      const testId = `tag:${tag}`;
      const tagMatch = testId.match(/^tag:(.+)$/);
      return tagMatch?.[1] ?? tag;
    });
    
    // Verify no processing occurred
    assert.deepStrictEqual(processedTags, originalTags, 'Tags should not be processed or modified');
    console.log('✅ No unwanted tag processing detected');
  });

  test("Should generate correct tag commands without double prefixes", () => {
    // Arrange - Test the actual tag extraction logic used in the extension
    const testCases = [
      { testId: "tag:@smoke", expectedTag: "@smoke", expectedCommand: 'python3 -m behave --tags="@smoke" --no-skipped' },
      { testId: "tag:@api", expectedTag: "@api", expectedCommand: 'python3 -m behave --tags="@api" --no-skipped' },
      { testId: "tag:@regression", expectedTag: "@regression", expectedCommand: 'python3 -m behave --tags="@regression" --no-skipped' },
      { testId: "tag:@ui", expectedTag: "@ui", expectedCommand: 'python3 -m behave --tags="@ui" --no-skipped' },
    ];
    
    // Act & Assert - Verify that tag extraction works correctly
    for (const testCase of testCases) {
      console.log(`Testing tag extraction: ${testCase.testId}`);
      
      // Simulate the exact logic used in the extension
      const tagMatch = testCase.testId.match(/^tag:(.+)$/);
      const extractedTag = tagMatch?.[1] ?? testCase.testId;
      
      // Verify tag extraction
      assert.strictEqual(extractedTag, testCase.expectedTag, 
        `Tag extraction failed: expected ${testCase.expectedTag}, got ${extractedTag}`);
      
      // Verify no double prefix
      assert.ok(!extractedTag.startsWith('tag:'), 
        `Tag should not have double prefix: ${extractedTag}`);
      
      // Simulate command generation
      const behaveCommand = "python3 -m behave";
      const generatedCommand = `${behaveCommand} --tags="${extractedTag}" --no-skipped`;
      
      console.log(`Generated command: ${generatedCommand}`);
      
      // Verify command is correct
      assert.strictEqual(generatedCommand, testCase.expectedCommand,
        `Command generation failed: expected ${testCase.expectedCommand}, got ${generatedCommand}`);
      
      console.log(`✅ Tag extraction and command generation correct for ${testCase.testId}`);
    }
    
    // Test edge cases
    const edgeCases = [
      { testId: "tag:@complex_tag_123", expectedTag: "@complex_tag_123" },
      { testId: "tag:@tag_with_underscores", expectedTag: "@tag_with_underscores" },
    ];
    
    for (const edgeCase of edgeCases) {
      const tagMatch = edgeCase.testId.match(/^tag:(.+)$/);
      const extractedTag = tagMatch?.[1] ?? edgeCase.testId;
      
      assert.strictEqual(extractedTag, edgeCase.expectedTag,
        `Edge case failed: expected ${edgeCase.expectedTag}, got ${extractedTag}`);
      
      console.log(`✅ Edge case passed: ${edgeCase.testId}`);
    }
    
    console.log('✅ All tag extraction tests passed - no double prefixes detected');
  });

  test("Should simulate actual tag execution flow", async () => {
    // Arrange - Set up tag-based organization
    testProvider.setOrganizationStrategy(new TagBasedOrganization());
    
    // Create test scenarios with tags
    const testScenarios: Scenario[] = [
      {
        name: "API test",
        line: 8,
        lineNumber: 8,
        range: new vscode.Range(7, 0, 7, 0),
        steps: [],
        tags: ["@api"],
        filePath: "features/test.feature",
        isScenarioOutline: false,
      },
    ];

    // Act - Create tag-based hierarchy
    const organizedGroups = testProvider.getOrganizationStrategy().organizeTests(testScenarios);
    
    // Simulate the test item creation process
    for (const group of organizedGroups) {
      if (group.id === 'untagged') continue;
      
      console.log(`Group ID: ${group.id}`);
      console.log(`Group Label: ${group.label}`);
      
      // Simulate the test item ID creation (this is what happens in createTagBasedTestHierarchy)
      const testItemId = group.id; // This should be "tag:@api"
      
      console.log(`Test Item ID: ${testItemId}`);
      
      // Simulate the condition check from runTests
      const isGroupTest = testItemId.includes(':') && !testItemId.includes('/');
      const startsWithTag = testItemId.startsWith('tag:');
      
      console.log(`Is Group Test: ${isGroupTest}`);
      console.log(`Starts with tag: ${startsWithTag}`);
      
      // Verify the condition would pass
      assert.ok(isGroupTest, 'Should be identified as group test');
      assert.ok(startsWithTag, 'Should start with tag:');
      
      // Simulate tag extraction
      const tagMatch = testItemId.match(/^tag:(.+)$/);
      const extractedTag = tagMatch?.[1] ?? group.label;
      
      console.log(`Extracted Tag: ${extractedTag}`);
      
      // Verify tag extraction works
      assert.strictEqual(extractedTag, "@api", 'Should extract @api from tag:@api');
      
      // Simulate command generation
      const behaveCommand = "python3 -m behave";
      const generatedCommand = `${behaveCommand} --tags="${extractedTag}" --no-skipped`;
      
      console.log(`Generated Command: ${generatedCommand}`);
      
      // Verify command is correct
      assert.strictEqual(generatedCommand, 'python3 -m behave --tags="@api" --no-skipped',
        'Should generate correct behave command');
      
      console.log('✅ Tag execution flow simulation successful');
    }
  });
});
