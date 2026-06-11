import * as vscode from "vscode";
import { Scenario, TestGroup, BehaveExtensionContext } from "../types";
import { extractOutlineName } from "../utils/scenario-outline";

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

/**
 * Builds the Test Explorer tree: discovers feature files, parses them, and
 * creates the TestItem hierarchy for the active organization strategy.
 *
 * The builder writes into the provider's shared `discoveredTests` and
 * `scenarioOutlineParents` maps (passed by reference) so the provider's
 * run/status logic keeps working against the same state.
 */
export class TestTreeBuilder {
  constructor(
    private readonly testController: vscode.TestController,
    private readonly context: BehaveExtensionContext,
    private readonly discoveredTests: Map<string, vscode.TestItem>,
    private readonly scenarioOutlineParents: Map<string, string>
  ) {}

  /**
   * Discover all feature files and rebuild the test tree. Throws on discovery
   * failure; per-file parse errors are logged and skipped.
   */
  public async discoverTests(): Promise<void> {
    const pattern = this.context.config.testFilePattern;

    if (!pattern || pattern.trim() === "") {
      throw new Error("Test file pattern is empty or invalid");
    }

    const filePaths = await this.context.discoveryManager.discoverTestFiles({
      pattern,
      forceRefresh: true,
    });

    this.testController.items.replace([]);
    this.discoveredTests.clear();

    // First pass: collect all scenarios from all feature files
    const allScenarios: Array<{ scenario: Scenario; file: vscode.Uri }> = [];

    for (const filePath of filePaths) {
      try {
        const file = vscode.Uri.file(filePath);
        const content = await vscode.workspace.fs.readFile(file);
        const text = new TextDecoder().decode(content);
        const parsed = this.context.featureParser.parseFeatureContent(text);

        if (parsed) {
          for (const scenario of parsed.scenarios) {
            scenario.filePath = file.fsPath;
          }
          allScenarios.push(
            ...parsed.scenarios.map((scenario) => ({ scenario, file }))
          );
        }
      } catch (fileError) {
        this.context.logger.error(
          `Failed to process feature file ${filePath}: ${errMsg(fileError)}`
        );
      }
    }

    // Second pass: organize all scenarios using the current strategy
    const allScenarioObjects = allScenarios.map((item) => item.scenario);
    const organizedGroups =
      this.context.organizationManager.organizeTests(allScenarioObjects);

    // Third pass: create test hierarchy based on organization
    const strategyType = this.context.organizationManager.getStrategy().strategyType;
    if (strategyType === "TagBasedOrganization") {
      this.createTagBasedTestHierarchy(organizedGroups, allScenarios);
    } else if (strategyType === "FeatureBasedOrganization") {
      await this.createHierarchicalFeatureBasedTestHierarchy(
        organizedGroups,
        allScenarios
      );
    } else {
      await this.createFeatureBasedTestHierarchy(organizedGroups, allScenarios);
    }
  }

  public async addFeatureFileToTestController(file: vscode.Uri): Promise<void> {
    try {
      if (!file?.fsPath) {
        throw new Error("Invalid file URI provided");
      }

      const content = await vscode.workspace.fs.readFile(file);
      const text = new TextDecoder().decode(content);
      const parsed = this.context.featureParser.parseFeatureContent(text);

      if (!parsed || typeof parsed.featureLineNumber !== 'number') {
        this.context.logger.warn(`Invalid or unparsable feature file: ${file.fsPath}`);
        return;
      }

      const featureItem = this.testController.createTestItem(
        file.fsPath,
        parsed.feature,
        file
      );

      featureItem.canResolveChildren = true;

      if (parsed.featureLineNumber && parsed.featureLineNumber > 0) {
        featureItem.range = new vscode.Range(
          parsed.featureLineNumber - 1,
          0,
          parsed.featureLineNumber - 1,
          0
        );
      }

      const scenarioGroups = this.groupScenariosByOutline(parsed.scenarios);

      for (const [outlineName, scenarios] of scenarioGroups) {
        this.addScenarioGroupToFeature(featureItem, file, outlineName, scenarios);
      }

      this.testController.items.add(featureItem);
      this.discoveredTests.set(file.fsPath, featureItem);
    } catch (error) {
      this.context.logger.error(
        `Failed to add feature file to test controller: ${errMsg(error)}`,
        { filePath: file.fsPath }
      );
      throw error;
    }
  }

  /**
   * Add one outline group (or single scenario) under a feature item. Outline
   * groups with a known outline line become an outline node with example
   * children; everything else is added as flat scenario items.
   */
  private addScenarioGroupToFeature(
    featureItem: vscode.TestItem,
    file: vscode.Uri,
    outlineName: string,
    scenarios: Scenario[]
  ): void {
    const isMultiExampleOutline =
      scenarios.length > 1 && scenarios[0]?.isScenarioOutline;

    if (isMultiExampleOutline && scenarios[0]?.outlineLineNumber && typeof scenarios[0].featureLineNumber === 'number') {
      const outlineItem = this.createOutlineTestItem(
        file,
        outlineName,
        scenarios,
        `${file.fsPath}:outline:${outlineName}`
      );
      featureItem.children.add(outlineItem);
      return;
    }

    for (const scenario of scenarios) {
      if (typeof scenario.featureLineNumber === 'number') {
        featureItem.children.add(this.createScenarioTestItem(file, scenario));
      } else {
        this.context.logger.warn(`Scenario missing featureLineNumber, skipping: ${scenario.name}`);
      }
    }
  }

  private groupScenariosByOutline(scenarios: Scenario[]): Map<string, Scenario[]> {
    const groups = new Map<string, Scenario[]>();

    for (const scenario of scenarios) {
      if (scenario.isScenarioOutline) {
        // Group examples under their original outline name
        const outlineName = extractOutlineName(scenario.name);
        const group = groups.get(outlineName) ?? [];
        group.push(scenario);
        groups.set(outlineName, group);
      } else {
        // Regular scenario - use file path and line number for uniqueness
        const groupKey = `${scenario.filePath}:${scenario.lineNumber}`;
        groups.set(groupKey, [scenario]);
      }
    }

    return groups;
  }

  private createOutlineTestItem(
    file: vscode.Uri,
    outlineName: string,
    examples: Scenario[],
    testId: string
  ): vscode.TestItem {
    const outlineItem = this.testController.createTestItem(
      testId,
      `Scenario Outline: ${outlineName}`,
      file
    );

    outlineItem.canResolveChildren = false;
    outlineItem.description = `${examples.length} example(s)`;

    if (
      examples.length > 0 &&
      examples[0]?.outlineLineNumber &&
      examples[0].outlineLineNumber > 0
    ) {
      const outlineLine = examples[0].outlineLineNumber - 1;
      outlineItem.range = new vscode.Range(outlineLine, 0, outlineLine, 0);
    } else {
      outlineItem.range = undefined;
    }

    const blockGroups = new Map<string, Scenario[]>();
    for (const example of examples) {
      const key = example.examplesBlockName ?? "";
      const list = blockGroups.get(key) ?? [];
      list.push(example);
      blockGroups.set(key, list);
    }

    const hasNamedBlock = Array.from(blockGroups.keys()).some((k) => k !== "");
    const useBlockHierarchy = blockGroups.size > 1 || hasNamedBlock;

    if (!useBlockHierarchy) {
      for (const example of examples) {
        this.appendExampleChild(outlineItem, file, example, testId);
      }
      return outlineItem;
    }

    for (const [blockName, blockExamples] of blockGroups) {
      const blockItem = this.createExamplesBlockTestItem(file, blockName, blockExamples, testId);
      outlineItem.children.add(blockItem);
    }
    return outlineItem;
  }

  private createExamplesBlockTestItem(
    file: vscode.Uri,
    blockName: string,
    examples: Scenario[],
    outlineTestId: string
  ): vscode.TestItem {
    const first = examples[0];
    const blockLine = first?.examplesBlockLineNumber ?? 0;
    const blockId = `${first?.filePath ?? ""}:examples:${blockLine}`;
    const label = blockName ? `Examples: ${blockName}` : "Examples";
    const tags = first?.examplesBlockTags ?? [];

    const blockItem = this.testController.createTestItem(blockId, label, file);
    blockItem.canResolveChildren = false;
    blockItem.description = `${examples.length} example(s)`;
    if (tags.length > 0) {
      blockItem.description += ` | Tags: ${tags.join(", ")}`;
    }
    if (blockLine > 0) {
      blockItem.range = new vscode.Range(blockLine - 1, 0, blockLine - 1, 0);
    }

    for (const example of examples) {
      this.appendExampleChild(blockItem, file, example, outlineTestId);
    }
    return blockItem;
  }

  private appendExampleChild(
    parent: vscode.TestItem,
    file: vscode.Uri,
    example: Scenario,
    outlineTestId: string
  ): void {
    if (typeof example.featureLineNumber !== "number") {
      this.context.logger.warn(`Outline example missing featureLineNumber, skipping: ${example.name}`);
      return;
    }
    const exampleItem = this.createScenarioTestItem(file, example, outlineTestId);
    parent.children.add(exampleItem);
  }

  public createScenarioTestItem(
    file: vscode.Uri,
    scenario: Scenario,
    parentTestId?: string
  ): vscode.TestItem {
    // Always use absolute file path and scenario.lineNumber for ID
    const id = `${scenario.filePath}:${scenario.lineNumber}`;
    const scenarioItem = this.testController.createTestItem(
      id,
      scenario.name,
      file
    );

    if (scenario.lineNumber && scenario.lineNumber > 0) {
      scenarioItem.range = new vscode.Range(
        scenario.lineNumber - 1,
        0,
        scenario.lineNumber - 1,
        0
      );
    }

    scenarioItem.canResolveChildren = false;
    scenarioItem.description = `Line ${scenario.lineNumber}`;

    // Add tags as metadata
    if (scenario.tags && scenario.tags.length > 0) {
      scenarioItem.description += ` | Tags: ${scenario.tags.join(", ")}`;
    }

    // Only store parent relationships in hierarchy view
    if (
      this.context.organizationManager.getStrategy().strategyType === "FeatureBasedOrganization" &&
      scenario.outlineLineNumber
    ) {
      const parentId = parentTestId ?? `${scenario.filePath}:${scenario.outlineLineNumber}`;
      this.scenarioOutlineParents.set(id, parentId);
    }

    return scenarioItem;
  }

  private createTagBasedTestHierarchy(
    organizedGroups: TestGroup[],
    _allScenarios: Array<{ scenario: Scenario; file: vscode.Uri }>
  ): void {
    for (const group of organizedGroups) {
      if (group.scenarios.length > 0) {
        const groupItem = this.testController.createTestItem(
          group.id,
          group.label,
          undefined
        );
        groupItem.canResolveChildren = true;
        groupItem.description = group.description ?? "";
        groupItem.range = undefined;

        for (const scenario of group.scenarios) {
          const scenarioItem = this.createScenarioTestItem(
            vscode.Uri.file(scenario.filePath),
            scenario
          );
          groupItem.children.add(scenarioItem);
        }

        this.testController.items.add(groupItem);
      }
    }
  }

  private async createFeatureBasedTestHierarchy(
    organizedGroups: TestGroup[],
    _allScenarios: Array<{ scenario: Scenario; file: vscode.Uri }>
  ): Promise<void> {
    for (const group of organizedGroups) {
      if (group.scenarios.length > 0) {
        const groupItem = this.testController.createTestItem(
          `group:${group.id}`,
          group.label,
          undefined
        );
        groupItem.canResolveChildren = true;
        groupItem.description = group.description ?? "";
        groupItem.range = undefined;

        for (const scenario of group.scenarios) {
          const scenarioItem = this.createScenarioTestItem(
            vscode.Uri.file(scenario.filePath),
            scenario
          );
          groupItem.children.add(scenarioItem);
        }

        this.testController.items.add(groupItem);
      }
    }

    // Small delay to ensure UI updates properly
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  private async createHierarchicalFeatureBasedTestHierarchy(
    _organizedGroups: TestGroup[],
    allScenarios: Array<{ scenario: Scenario; file: vscode.Uri }>
  ): Promise<void> {
    // For FeatureBasedOrganization, feature files are root items with scenarios as children
    const uniqueFeatureFiles = new Set<string>();
    for (const { file } of allScenarios) {
      uniqueFeatureFiles.add(file.fsPath);
    }

    for (const filePath of uniqueFeatureFiles) {
      const file = vscode.Uri.file(filePath);
      await this.addFeatureFileToTestController(file);
    }
  }
}
