import * as vscode from "vscode";
import { Scenario, ParsedFeature, TestGroup, BehaveExtensionContext } from "../types";
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
  private readonly scenarios = new Map<string, Scenario>();

  public scenarioSnapshot(): ReadonlyMap<string, Scenario> {
    return new Map(this.scenarios);
  }

  public scenarioFor(id: string): Scenario | undefined {
    return this.scenarios.get(id);
  }
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
  public async discoverTests(isCurrent: () => boolean = () => true, token?: vscode.CancellationToken): Promise<void> {
    const filePaths = await this.context.discoveryManager.discoverTestFiles({ forceRefresh: true }, token);

    if (!isCurrent()) {return;}
    const features = new Map<string, ParsedFeature>();

    // First pass: collect all scenarios from all feature files
    const allScenarios: Array<{ scenario: Scenario; file: vscode.Uri }> = [];

    for (const filePath of filePaths) {
      try {
        const file = vscode.Uri.file(filePath);
        const content = await vscode.workspace.fs.readFile(file);
        if (!isCurrent()) {return;}
        const text = new TextDecoder().decode(content);
        const parsed = this.context.featureParser.parseFeatureContent(text);

        if (parsed) {
          features.set(filePath, parsed);
          for (const scenario of parsed.scenarios) {
            scenario.filePath = file.fsPath;
          }
          allScenarios.push(
            ...parsed.scenarios.map((scenario) => ({ scenario, file }))
          );
        }
      } catch (fileError) {
        if (!isCurrent()) {return;}
        this.context.logger.error(
          `Failed to process feature file ${filePath}: ${errMsg(fileError)}`
        );
      }
    }

    if (!isCurrent()) {return;}
    this.testController.items.replace([]);
    this.discoveredTests.clear();
    this.scenarioOutlineParents.clear();
    this.scenarios.clear();

    // Second pass: organize all scenarios using the current strategy
    const allScenarioObjects = allScenarios.map((item) => item.scenario);
    const organizedGroups =
      this.context.organizationManager.organizeTests(allScenarioObjects);

    // Third pass: create test hierarchy based on organization
    const strategyType = this.context.organizationManager.getStrategy().strategyType;
    if (strategyType === "TagBasedOrganization") {
      this.createTagBasedTestHierarchy(organizedGroups, allScenarios);
    } else if (strategyType === "FeatureBasedOrganization") {
      for (const [filePath, parsed] of features) {
        this.addParsedFeature(vscode.Uri.file(filePath), parsed);
      }
    } else {
      this.createFeatureBasedTestHierarchy(organizedGroups, allScenarios);
    }
  }

  public async addFeatureFileToTestController(file: vscode.Uri, isCurrent: () => boolean = () => true): Promise<void> {
    try {
      if (!file?.fsPath) {
        throw new Error("Invalid file URI provided");
      }

      const content = await vscode.workspace.fs.readFile(file);
      if (!isCurrent()) {return;}
      const text = new TextDecoder().decode(content);
      const parsed = this.context.featureParser.parseFeatureContent(text);

      if (!parsed || typeof parsed.featureLineNumber !== 'number') {
        this.context.logger.warn(`Invalid or unparsable feature file: ${file.fsPath}`);
        return;
      }

      if (isCurrent()) {
        for (const scenario of parsed.scenarios) {scenario.filePath = file.fsPath;}
        this.addParsedFeature(file, parsed);
      }
    } catch (error) {
      if (!isCurrent()) {return;}
      this.context.logger.error(
        `Failed to add feature file to test controller: ${errMsg(error)}`,
        { filePath: file.fsPath }
      );
      throw error;
    }
  }

  private addParsedFeature(file: vscode.Uri, parsed: ParsedFeature): void {
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

    for (const scenarios of scenarioGroups.values()) {
      this.addScenarioGroupToFeature(featureItem, file, scenarios);
    }

    this.testController.items.add(featureItem);
    this.discoveredTests.set(file.fsPath, featureItem);
  }

  /**
   * Add one outline group (or single scenario) under a feature item. Outline
   * groups with a known outline line become an outline node with example
   * children; everything else is added as flat scenario items.
   */
  private addScenarioGroupToFeature(
    featureItem: vscode.TestItem,
    file: vscode.Uri,
    scenarios: Scenario[]
  ): void {
    const first = scenarios[0];

    if (scenarios.length > 1 && first?.isScenarioOutline && first.outlineLineNumber && typeof first.featureLineNumber === 'number') {
      const outlineItem = this.createOutlineTestItem(
        file,
        extractOutlineName(first.name),
        scenarios,
        `${file.fsPath}:outline:${first.outlineLineNumber}`
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
        const key = `${scenario.filePath}:outline:${scenario.outlineLineNumber ?? scenario.lineNumber}`;
        const group = groups.get(key) ?? [];
        group.push(scenario);
        groups.set(key, group);
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

    const blockGroups = new Map<number | string, Scenario[]>();
    for (const example of examples) {
      const key = example.examplesBlockLineNumber ?? example.examplesBlockName ?? "";
      const list = blockGroups.get(key) ?? [];
      list.push(example);
      blockGroups.set(key, list);
    }

    const hasNamedBlock = Array.from(blockGroups.values()).some((block) => Boolean(block[0]?.examplesBlockName));
    const useBlockHierarchy = blockGroups.size > 1 || hasNamedBlock;

    if (!useBlockHierarchy) {
      for (const example of examples) {
        this.appendExampleChild(outlineItem, file, example, testId);
      }
      return outlineItem;
    }

    for (const blockExamples of blockGroups.values()) {
      const blockItem = this.createExamplesBlockTestItem(file, blockExamples[0]?.examplesBlockName ?? "", blockExamples, testId);
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
    this.scenarios.set(id, scenario);
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

  private createFeatureBasedTestHierarchy(
    organizedGroups: TestGroup[],
    _allScenarios: Array<{ scenario: Scenario; file: vscode.Uri }>
  ): void {
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
  }
}
