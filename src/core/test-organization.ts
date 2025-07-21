import { Scenario, TestGroup, TestOrganizationStrategy } from "../types";
import { Logger } from "../utils/logger";

export class TagBasedOrganization implements TestOrganizationStrategy {
  private logger = Logger.getInstance();

  // Add a strategy type identifier that won't be minified
  public readonly strategyType = "TagBasedOrganization";

  organizeTests(scenarios: Scenario[]): TestGroup[] {
    try {
      this.logger.debug("Organizing tests by tags", {
        scenarioCount: scenarios.length,
      });

      if (scenarios.length === 0) {
        this.logger.debug("No scenarios to organize, returning empty group");
        return [
          {
            id: "all",
            label: "All Scenarios",
            description: "0 scenario(s)",
            scenarios: [],
          },
        ];
      }

      // Group scenarios by all their tags
      const tagGroups = new Map<string, Scenario[]>();
      const untaggedScenarios: Scenario[] = [];

      this.logger.debug("Processing scenarios for tag grouping", {
        totalScenarios: scenarios.length,
      });

      for (const scenario of scenarios) {
        this.logger.debug("Processing scenario", {
          name: scenario.name,
          tags: scenario.tags,
          hasTags: scenario.tags && scenario.tags.length > 0,
        });

        if (scenario.tags && scenario.tags.length > 0) {
          for (const tag of scenario.tags) {
            this.logger.debug("Processing tag", { tag });
            if (tag && !tagGroups.has(tag)) {
              tagGroups.set(tag, []);
              this.logger.debug("Created new tag group", { tag });
            }
            const group = tagGroups.get(tag);
            if (group) {
              group.push(scenario);
              this.logger.debug("Added scenario to tag group", {
                tag,
                scenarioName: scenario.name,
              });
            }
          }
        } else {
          untaggedScenarios.push(scenario);
          this.logger.debug("Added scenario to untagged group", {
            scenarioName: scenario.name,
          });
        }
      }

      const groups: TestGroup[] = [];

      this.logger.debug("Creating tag groups", {
        tagGroupCount: tagGroups.size,
        untaggedCount: untaggedScenarios.length,
      });

      // Create groups for tagged scenarios
      for (const [tag, tagScenarios] of tagGroups) {
        this.logger.debug("Creating tag group", {
          tag,
          scenarioCount: tagScenarios.length,
        });
        groups.push({
          id: `tag:${tag}`,
          label: tag,
          description: `${tagScenarios.length} scenario(s)`,
          scenarios: tagScenarios,
        });
      }

      // Create group for untagged scenarios if any exist
      if (untaggedScenarios.length > 0) {
        this.logger.debug("Creating untagged group", {
          scenarioCount: untaggedScenarios.length,
        });
        groups.push({
          id: "untagged",
          label: "Untagged",
          description: `${untaggedScenarios.length} scenario(s)`,
          scenarios: untaggedScenarios,
        });
      }

      this.logger.debug("Tag-based organization completed", {
        groupCount: groups.length,
        totalScenarios: scenarios.length,
        groupLabels: groups.map((g) => g.label),
      });

      return groups;
    } catch (error) {
      this.logger.error("Failed to organize tests by tags", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Fallback to flat organization
      this.logger.debug("Falling back to flat organization due to error");
      return [
        {
          id: "all",
          label: "All Scenarios",
          description: `${scenarios.length} scenario(s)`,
          scenarios,
        },
      ];
    }
  }

  getGroupLabel(group: TestGroup): string {
    return group.label;
  }

  getGroupDescription(group: TestGroup): string {
    return group.description ?? "";
  }

  getDescription(): string {
    return "Group scenarios by their tags";
  }
}

export class FileBasedOrganization implements TestOrganizationStrategy {
  private logger = Logger.getInstance();

  // Add a strategy type identifier that won't be minified
  public readonly strategyType = "FileBasedOrganization";

  organizeTests(scenarios: Scenario[]): TestGroup[] {
    try {
      this.logger.debug("Organizing tests by file", {
        scenarioCount: scenarios.length,
      });

      // Group scenarios by their file path
      const fileGroups = new Map<string, Scenario[]>();

      for (const scenario of scenarios) {
        const filePath = scenario.filePath;
        if (!fileGroups.has(filePath)) {
          fileGroups.set(filePath, []);
        }
        const group = fileGroups.get(filePath);
        if (group) {
          group.push(scenario);
        }
      }

      const groups: TestGroup[] = [];

      // Create groups for each file
      for (const [filePath, fileScenarios] of fileGroups) {
        const fileName = filePath.split("/").pop() ?? filePath;
        groups.push({
          id: `file:${filePath}`,
          label: fileName,
          description: `${fileScenarios.length} scenario(s) in ${filePath}`,
          scenarios: fileScenarios,
        });
      }

      this.logger.debug("File-based organization completed", {
        groupCount: groups.length,
        totalScenarios: scenarios.length,
      });

      return groups;
    } catch (error) {
      this.logger.error("Failed to organize tests by file", { error });
      // Fallback to flat organization
      return [
        {
          id: "all",
          label: "All Scenarios",
          description: `${scenarios.length} scenario(s)`,
          scenarios,
        },
      ];
    }
  }

  getGroupLabel(group: TestGroup): string {
    return group.label;
  }

  getGroupDescription(group: TestGroup): string {
    return group.description ?? "";
  }

  getDescription(): string {
    return "Group scenarios by their file location";
  }
}

export class ScenarioTypeOrganization implements TestOrganizationStrategy {
  private logger = Logger.getInstance();

  // Add a strategy type identifier that won't be minified
  public readonly strategyType = "ScenarioTypeOrganization";

  organizeTests(scenarios: Scenario[]): TestGroup[] {
    try {
      this.logger.debug("Organizing tests by scenario type", {
        scenarioCount: scenarios.length,
      });

      const regularScenarios: Scenario[] = [];
      const outlineScenarios: Scenario[] = [];

      for (const scenario of scenarios) {
        if (scenario.isScenarioOutline) {
          outlineScenarios.push(scenario);
        } else {
          regularScenarios.push(scenario);
        }
      }

      const groups: TestGroup[] = [];

      if (regularScenarios.length > 0) {
        groups.push({
          id: "regular",
          label: "Regular Scenarios",
          description: `${regularScenarios.length} scenario(s)`,
          scenarios: regularScenarios,
        });
      }

      if (outlineScenarios.length > 0) {
        groups.push({
          id: "outlines",
          label: "Scenario Outlines",
          description: `${outlineScenarios.length} outline(s)`,
          scenarios: outlineScenarios,
        });
      }

      this.logger.debug("Scenario type organization completed", {
        groupCount: groups.length,
        regularCount: regularScenarios.length,
        outlineCount: outlineScenarios.length,
      });

      return groups;
    } catch (error) {
      this.logger.error("Failed to organize tests by scenario type", { error });
      // Fallback to flat organization
      return [
        {
          id: "all",
          label: "All Scenarios",
          description: `${scenarios.length} scenario(s)`,
          scenarios,
        },
      ];
    }
  }

  getGroupLabel(group: TestGroup): string {
    return group.label;
  }

  getGroupDescription(group: TestGroup): string {
    return group.description ?? "";
  }

  getDescription(): string {
    return "Group by regular scenarios vs scenario outlines";
  }
}

export class FlatOrganization implements TestOrganizationStrategy {
  private logger = Logger.getInstance();

  // Add a strategy type identifier that won't be minified
  public readonly strategyType = "FlatOrganization";

  organizeTests(scenarios: Scenario[]): TestGroup[] {
    this.logger.debug("Using flat organization", {
      scenarioCount: scenarios.length,
    });

    return [
      {
        id: "all",
        label: "All Scenarios",
        description: `${scenarios.length} scenario(s)`,
        scenarios,
      },
    ];
  }

  getGroupLabel(group: TestGroup): string {
    return group.label;
  }

  getGroupDescription(group: TestGroup): string {
    return group.description ?? "";
  }

  getDescription(): string {
    return "No grouping, all scenarios in one list";
  }
}

export class FeatureBasedOrganization implements TestOrganizationStrategy {
  private logger = Logger.getInstance();
  public readonly strategyType = "FeatureBasedOrganization";

  organizeTests(scenarios: Scenario[]): TestGroup[] {
    this.logger.debug("Organizing tests by feature file (hierarchical)", {
      scenarioCount: scenarios.length,
    });
    // Group scenarios by their file path
    const fileGroups = new Map<string, Scenario[]>();
    for (const scenario of scenarios) {
      const filePath = scenario.filePath;
      if (!fileGroups.has(filePath)) {
        fileGroups.set(filePath, []);
      }
      fileGroups.get(filePath)?.push(scenario);
    }
    const groups: TestGroup[] = [];
    for (const [filePath, fileScenarios] of fileGroups) {
      const fileName = filePath.split("/").pop() ?? filePath;
      groups.push({
        id: `feature:${filePath}`,
        label: fileName,
        description: `${fileScenarios.length} scenario(s) in ${filePath}`,
        scenarios: fileScenarios,
      });
    }
    this.logger.debug("Feature-based (hierarchical) organization completed", {
      groupCount: groups.length,
      totalScenarios: scenarios.length,
    });
    return groups;
  }
  getGroupLabel(group: TestGroup): string {
    return group.label;
  }
  getGroupDescription(group: TestGroup): string {
    return group.description ?? "";
  }
  getDescription(): string {
    return "Hierarchical: Feature file as root, scenarios as children";
  }
}

export class TestOrganizationManager {
  private static instance: TestOrganizationManager;
  private currentStrategy: TestOrganizationStrategy;
  private logger = Logger.getInstance();

  private constructor() {
    this.currentStrategy = new FeatureBasedOrganization();
  }

  public static getInstance(): TestOrganizationManager {
    if (!TestOrganizationManager.instance) {
      TestOrganizationManager.instance = new TestOrganizationManager();
    }
    return TestOrganizationManager.instance;
  }

  public setStrategy(strategy: TestOrganizationStrategy): void {
    try {
      this.logger.info("Changing test organization strategy", {
        from: this.currentStrategy.constructor.name,
        to: strategy.constructor.name,
      });
      this.currentStrategy = strategy;
    } catch (error) {
      this.logger.error("Failed to set organization strategy", { error });
    }
  }

  public getStrategy(): TestOrganizationStrategy {
    return this.currentStrategy;
  }

  public organizeTests(scenarios: Scenario[]): TestGroup[] {
    try {
      this.logger.debug("TestOrganizationManager.organizeTests called", {
        strategy: this.currentStrategy.constructor.name,
        scenarioCount: scenarios.length,
      });

      const result = this.currentStrategy.organizeTests(scenarios);

      this.logger.debug("TestOrganizationManager.organizeTests completed", {
        strategy: this.currentStrategy.constructor.name,
        resultGroupCount: result.length,
        resultLabels: result.map((g) => g.label),
      });

      return result;
    } catch (error) {
      this.logger.error("Failed to organize tests", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        strategy: this.currentStrategy.constructor.name,
      });
      // Fallback to flat organization
      this.logger.debug(
        "Falling back to flat organization due to error in TestOrganizationManager"
      );
      return new FlatOrganization().organizeTests(scenarios);
    }
  }

  public getAvailableStrategies(): {
    name: string;
    description: string;
    strategy: TestOrganizationStrategy;
  }[] {
    return [
      {
        name: "Feature-based (Hierarchical)",
        description:
          "Hierarchical: Feature file as root, scenarios as children",
        strategy: new FeatureBasedOrganization(),
      },
      {
        name: "Tag-based",
        description: "Group scenarios by their tags",
        strategy: new TagBasedOrganization(),
      },
      {
        name: "File-based",
        description: "Group scenarios by their file location",
        strategy: new FileBasedOrganization(),
      },
      {
        name: "Scenario Type",
        description: "Group by regular scenarios vs scenario outlines",
        strategy: new ScenarioTypeOrganization(),
      },
      {
        name: "Flat",
        description: "No grouping, all scenarios in one list",
        strategy: new FlatOrganization(),
      },
    ];
  }
}
