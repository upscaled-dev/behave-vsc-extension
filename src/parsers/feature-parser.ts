import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { ParsedFeature, Scenario } from "../types/index";
import { Logger } from "../utils/logger";
import { isScenarioOutlineExampleName } from "../utils/scenario-outline";
import { backgroundKeyword, examplesKeyword, featureKeyword, GherkinKeywords, isStepLine, resolveGherkinKeywords, ruleKeyword, scenarioKeyword } from "../utils/gherkin-keywords";

/**
 * Parser for Gherkin feature files
 */
export class FeatureParser {
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? Logger.create();
  }

  public static create(logger?: Logger): FeatureParser {
    return new FeatureParser(logger);
  }

  /** Hide docstring bodies while retaining their physical source lines. */
  public structuralLines(content: string, keywords: GherkinKeywords): string[] {
    let delimiter: string | undefined;
    let context: "description" | "steps" | "step" = "description";
    return content.split("\n").map((line) => {
      const trimmed = line.trim();
      if (delimiter) {
        if (trimmed.startsWith(delimiter)) {delimiter = undefined;}
        return "";
      }
      if (trimmed === "" || trimmed.startsWith("#")) {return line;}
      const opening = /^("""|'''|```)/.exec(trimmed);
      if (context === "step" && opening) {
        delimiter = opening[1];
        context = "steps";
        return "";
      }
      if (featureKeyword(trimmed, keywords) || ruleKeyword(trimmed, keywords) || examplesKeyword(trimmed, keywords)) {
        context = "description";
      } else if (backgroundKeyword(trimmed, keywords) || scenarioKeyword(trimmed, keywords)) {
        context = "steps";
      } else if (context !== "description") {
        context = isStepLine(trimmed, keywords) ? "step" : "steps";
      }
      return line;
    });
  }

  /**
   * Parse a feature file and extract scenarios
   * @param filePath - Path to the feature file
   * @returns Parsed feature data
   */
  public parseFeatureFile(filePath: string): ParsedFeature | null {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return this.parseFeatureContent(content);
    } catch (error) {
      this.logger.error("Error parsing feature file:", { error });
      return null;
    }
  }

  /**
   * Parse feature content and extract scenarios
   * @param content - Feature file content
   * @returns Parsed feature data with line number information
   */
  public parseFeatureContent(content: string): ParsedFeature | null {
    try {
      const keywords = resolveGherkinKeywords(content);
      const lines = this.structuralLines(content, keywords);
      const featureInfo = this.extractFeatureInfo(lines, keywords);

      // Return null if no valid feature name was found
      if (featureInfo.name === "Unknown Feature") {
        return null;
      }

      // Pass featureLineNumber to extractScenarios
      const scenarios = this.extractScenarios(lines, featureInfo.lineNumber, keywords);

      return {
        feature: featureInfo.name,
        scenarios,
        filePath: "", // Will be set by caller
        featureLineNumber: featureInfo.lineNumber,
      };
    } catch (error) {
      this.logger.error(`Error parsing feature content: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Extract feature name and line number from content
   * @param lines - Feature file lines
   * @returns Feature info with name and line number
   */
  private extractFeatureInfo(lines: string[], keywords: GherkinKeywords): {
    name: string;
    lineNumber: number;
  } {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line) {
        const trimmed = line.trim();
        const feature = featureKeyword(trimmed, keywords);
        if (feature) {
          return {
            name: trimmed.substring(feature.length).trim(),
            lineNumber: i + 1, // 1-based line number
          };
        }
      }
    }
    return { name: "Unknown Feature", lineNumber: 1 };
  }

  /**
   * Extract scenarios from content. Supports:
   * - Background (feature-level and rule-level — steps attached to each child scenario)
   * - Rule (Gherkin 6+ — scenarios inside a Rule carry its name)
   * - Scenario Outline with one or more (named, tagged) Examples blocks
   * @param lines - Feature file lines
   * @returns Array of scenarios with expanded examples
   */
  private extractScenarios(lines: string[], featureLineNumber: number, keywords: GherkinKeywords): Scenario[] {
    interface ExamplesBlock {
      name?: string;
      tags: string[];
      headers: string[];
      data: string[][];
      lineNumbers: number[];
      blockLineNumber: number;
    }
    interface OutlineCollect {
      scenario: Scenario;
      examplesBlocks: ExamplesBlock[];
      outlineLineNumber: number;
    }

    const isTableRow = (s: string): boolean =>
      s.startsWith("|") && s.endsWith("|");
    const parseTableRow = (s: string): string[] =>
      s.substring(1, s.length - 1).split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());

    const regularScenarios: Scenario[] = [];
    const scenarioOutlines: OutlineCollect[] = [];

    let pendingTags: string[] = [];
    let featureTags: string[] = [];
    let ruleTags: string[] = [];
    let currentScenario: Scenario | null = null;
    let currentOutline: OutlineCollect | null = null;
    let currentExamplesBlock: ExamplesBlock | null = null;

    let featureBackgroundSteps: string[] = [];
    let ruleBackgroundSteps: string[] = [];
    let currentRuleName: string | undefined;
    let backgroundTarget: "feature" | "rule" | null = null; // active Background collection

    const flushCurrentScenario = (): void => {
      if (!currentScenario) {return;}
      if (currentOutline) {
        if (currentExamplesBlock) {
          currentOutline.examplesBlocks.push(currentExamplesBlock);
          currentExamplesBlock = null;
        }
        scenarioOutlines.push(currentOutline);
        currentOutline = null;
      } else {
        regularScenarios.push(currentScenario);
      }
      currentScenario = null;
    };

    const consumeTags = (): string[] => {
      const t = [...new Set(pendingTags)];
      pendingTags = [];
      return t;
    };

    const combinedBackgroundSteps = (): string[] => {
      return [...featureBackgroundSteps, ...ruleBackgroundSteps];
    };

    let lineNumber = 1;
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();

      if (trimmed === "" || trimmed.startsWith("#")) {
        lineNumber++;
        continue;
      }

      if (trimmed.startsWith("@")) {
        const matches = trimmed.match(/@\S+/g);
        if (matches) {pendingTags.push(...matches);}
        lineNumber++;
        continue;
      }

      if (featureKeyword(trimmed, keywords)) {
        featureTags = consumeTags();
        lineNumber++;
        continue;
      }

      const rule = ruleKeyword(trimmed, keywords);
      if (rule) {
        flushCurrentScenario();
        currentRuleName = trimmed.substring(rule.length).trim() || undefined;
        ruleBackgroundSteps = [];
        backgroundTarget = null;
        ruleTags = consumeTags();
        lineNumber++;
        continue;
      }

      if (backgroundKeyword(trimmed, keywords)) {
        flushCurrentScenario();
        backgroundTarget = currentRuleName ? "rule" : "feature";
        if (backgroundTarget === "feature") {
          featureBackgroundSteps = [];
        } else {
          ruleBackgroundSteps = [];
        }
        pendingTags = []; // Background can't be tagged
        lineNumber++;
        continue;
      }

      const keyword = scenarioKeyword(trimmed, keywords);
      if (keyword) {
        flushCurrentScenario();
        backgroundTarget = null;

        const isOutline = keyword.isOutline;
        const name = trimmed.substring(keyword.length).trim();
        if (!name) {
          this.logger.warn(`Empty ${isOutline ? "scenario outline" : "scenario"} name at line ${lineNumber}`);
        }

        const scenario: Scenario = {
          name: name || (isOutline ? "Unnamed Scenario Outline" : "Unnamed Scenario"),
          line: lineNumber,
          range: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0),
          lineNumber,
          steps: [],
          tags: [...new Set([...featureTags, ...ruleTags, ...consumeTags()])],
          filePath: "",
          isScenarioOutline: isOutline,
          featureLineNumber,
        };
        if (currentRuleName) {scenario.ruleName = currentRuleName;}
        const bg = combinedBackgroundSteps();
        if (bg.length > 0) {scenario.backgroundSteps = bg;}

        if (isOutline) {
          currentOutline = { scenario, examplesBlocks: [], outlineLineNumber: lineNumber };
        }
        currentScenario = scenario;
        lineNumber++;
        continue;
      }

      const examples = examplesKeyword(trimmed, keywords);
      if (examples && currentOutline) {
        if (currentExamplesBlock) {
          currentOutline.examplesBlocks.push(currentExamplesBlock);
        }
        const blockName = trimmed.substring(examples.length).trim() || undefined;
        currentExamplesBlock = {
          ...(blockName ? { name: blockName } : {}),
          tags: consumeTags(),
          headers: [],
          data: [],
          lineNumbers: [],
          blockLineNumber: lineNumber,
        };
        lineNumber++;
        continue;
      }

      if (currentExamplesBlock && isTableRow(trimmed)) {
        const cells = parseTableRow(trimmed);
        if (currentExamplesBlock.headers.length === 0) {
          currentExamplesBlock.headers = cells;
        } else {
          if (cells.length !== currentExamplesBlock.headers.length) {
            throw new Error(`Examples row at line ${lineNumber} has ${cells.length} cells; expected ${currentExamplesBlock.headers.length}`);
          }
          currentExamplesBlock.data.push(cells);
          currentExamplesBlock.lineNumbers.push(lineNumber);
        }
        lineNumber++;
        continue;
      }

      if (isStepLine(trimmed, keywords)) {
        if (backgroundTarget === "feature") {
          featureBackgroundSteps.push(trimmed);
        } else if (backgroundTarget === "rule") {
          ruleBackgroundSteps.push(trimmed);
        } else if (currentScenario) {
          currentScenario.steps.push(trimmed);
        }
        lineNumber++;
        continue;
      }

      // Data tables are step arguments, so any other non-step line terminates Background collection.
      if (backgroundTarget && !isTableRow(trimmed)) {
        backgroundTarget = null;
      }

      lineNumber++;
    }

    flushCurrentScenario();

    const finalScenarios: Scenario[] = [...regularScenarios];

    for (const outline of scenarioOutlines) {
      const allRows = outline.examplesBlocks.reduce((sum, b) => sum + b.data.length, 0);
      if (allRows === 0) {
        finalScenarios.push(outline.scenario);
        continue;
      }

      let exampleIndex = 0;
      for (const block of outline.examplesBlocks) {
        for (let i = 0; i < block.data.length; i++) {
          const row = block.data[i];
          if (!row) {continue;}
          exampleIndex++;
          const exampleLine = block.lineNumbers[i] ?? outline.scenario.line + exampleIndex;
          const exampleValues = row
            .map((value, idx) => {
              const header = block.headers[idx];
              if (!header) {return `param${idx}: ${value}`;}
              const shortHeader = header.length > 15 ? `${header.substring(0, 12)}...` : header;
              return `${shortHeader}: ${value}`;
            })
            .join(", ");

          const mergedTags = [...new Set([...(outline.scenario.tags ?? []), ...block.tags])];
          const exampleScenario: Scenario = {
            name: `${exampleIndex}: ${outline.scenario.name} - ${exampleValues}`,
            line: exampleLine,
            range: new vscode.Range(exampleLine - 1, 0, exampleLine - 1, 0),
            lineNumber: exampleLine,
            steps: outline.scenario.steps,
            tags: mergedTags,
            filePath: "",
            isScenarioOutline: true,
            outlineLineNumber: outline.outlineLineNumber,
            featureLineNumber,
            examplesBlockLineNumber: block.blockLineNumber,
            exampleValues: Object.fromEntries(block.headers.map((header, index) => [header, row[index] ?? ""])),
          };
          if (block.name) {exampleScenario.examplesBlockName = block.name;}
          if (block.tags.length > 0) {exampleScenario.examplesBlockTags = block.tags;}
          if (outline.scenario.ruleName) {exampleScenario.ruleName = outline.scenario.ruleName;}
          if (outline.scenario.backgroundSteps) {exampleScenario.backgroundSteps = outline.scenario.backgroundSteps;}
          finalScenarios.push(exampleScenario);
        }
      }
    }

    return finalScenarios;
  }

  /**
   * Extract all unique tags from a feature file
   * @param lines - Feature file lines outside docstrings
   * @returns Array of unique tags
   */
  private extractTags(lines: string[]): string[] {
    const tags = new Set<string>();

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("@")) {
        // Extract individual tags from the line
        const tagMatches = trimmed.match(/@\w+/g);
        if (tagMatches) {
          tagMatches.forEach((tag) => tags.add(tag));
        }
      }
    }

    return Array.from(tags).sort();
  }

  /**
   * Calculate the range for a scenario (from scenario line to next scenario or end of file)
   * @param lines - Array of file lines
   * @param scenarioLineNumber - 1-based line number of the scenario
   * @returns Range object spanning the scenario
   */
  private getScenarioRange(
    lines: string[],
    scenarioLineNumber: number,
    keywords: GherkinKeywords
  ): vscode.Range {
    const startLine = scenarioLineNumber - 1; // Convert to 0-based
    let endLine = startLine;

    // Find the end of this scenario (next scenario or end of file)
    for (let i = scenarioLineNumber; i < lines.length; i++) {
      const line = lines[i]?.trim() ?? "";
      // Stop at next scenario, scenario outline, or feature
      if (
        scenarioKeyword(line, keywords) ||
        featureKeyword(line, keywords)
      ) {
        break;
      }
      endLine = i;
    }

    return new vscode.Range(startLine, 0, endLine, 0);
  }

  /**
   * Provide CodeLens for scenarios in a feature file
   * @param content - Feature file content
   * @param filePath - Path to the feature file
   * @returns Array of CodeLens
   */
  public provideScenarioCodeLenses(
    content: string,
    filePath: string
  ): vscode.CodeLens[] {
    const codeLenses: vscode.CodeLens[] = [];
    const keywords = resolveGherkinKeywords(content);
    const lines = this.structuralLines(content, keywords);
    let lineNumber = 1;

    // Extract all available tags from the feature file
    const allTags = this.extractTags(lines);

    // Parse scenarios to get scenario outline examples
    const parsedFeature = this.parseFeatureContent(content);
    const scenarioOutlineExamples =
      parsedFeature?.scenarios.filter(
        (s) => s.isScenarioOutline && isScenarioOutlineExampleName(s.name)
      ) ?? [];

    for (const line of lines) {
      const trimmed = line.trim();

      const keyword = scenarioKeyword(trimmed, keywords);
      if (keyword) {
        const scenarioName = trimmed.substring(keyword.length).trim();

        // Calculate the range for this scenario (multiline)
        const scenarioRange = this.getScenarioRange(lines, lineNumber, keywords);

        // Check if this is a scenario outline
        const isScenarioOutline = keyword.isOutline;

        // Add Run Scenario CodeLens
        codeLenses.push(
          new vscode.CodeLens(scenarioRange, {
            title: isScenarioOutline
              ? "▶️ Run Scenario Outline"
              : "▶️ Run Scenario",
            command: "behaveTestRunner.runScenario",
            arguments: [filePath, lineNumber, scenarioName],
          })
        );

        // Add Debug Scenario CodeLens
        codeLenses.push(
          new vscode.CodeLens(scenarioRange, {
            title: isScenarioOutline
              ? "🐛 Debug Scenario Outline"
              : "🐛 Debug Scenario",
            command: "behaveTestRunner.debugScenario",
            arguments: [filePath, lineNumber, scenarioName],
          })
        );
      }

      lineNumber++;
    }

    // Add CodeLens for individual scenario outline examples
    for (const example of scenarioOutlineExamples) {
      const exampleRange = new vscode.Range(
        example.lineNumber - 1,
        0,
        example.lineNumber - 1,
        0
      );

      // Add Run Example CodeLens
      codeLenses.push(
        new vscode.CodeLens(exampleRange, {
          title: "▶️ Run Example",
          command: "behaveTestRunner.runScenario",
          arguments: [filePath, example.lineNumber, example.name],
        })
      );

      // Add Debug Example CodeLens
      codeLenses.push(
        new vscode.CodeLens(exampleRange, {
          title: "🐛 Debug Example",
          command: "behaveTestRunner.debugScenario",
          arguments: [filePath, example.lineNumber, example.name],
        })
      );
    }

    // Add feature-level CodeLens at the top of the file
    if (lines.length > 0) {
      // Find the Feature: line (it might be after tags)
      let featureLineIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (typeof line === "string" && featureKeyword(line.trim(), keywords)) {
          featureLineIndex = i;
          break;
        }
      }

      if (featureLineIndex >= 0) {
        // Calculate feature range (from feature line to first scenario or end of file)
        let featureEndLine = featureLineIndex;
        for (let i = featureLineIndex + 1; i < lines.length; i++) {
          const line = lines[i]?.trim() ?? "";
          if (scenarioKeyword(line, keywords)) {
            break;
          }
          featureEndLine = i;
        }
        const featureRange = new vscode.Range(0, 0, featureEndLine, 0);

        // Add Run Feature File CodeLens
        codeLenses.push(
          new vscode.CodeLens(featureRange, {
            title: "📁 Run Feature File",
            command: "behaveTestRunner.runFeatureFile",
            arguments: [filePath],
          })
        );

        // Add individual tag CodeLenses for all unique tags
        for (const tag of allTags) {
          codeLenses.push(
            new vscode.CodeLens(featureRange, {
              title: `🏷️ Run with ${tag}`,
              command: "behaveTestRunner.runFeatureFileWithTags",
              arguments: [filePath, tag],
            })
          );
        }
      }
    }

    return codeLenses;
  }

  /**
   * Check if a file is a valid feature file
   * @param filePath - Path to check
   * @returns True if it's a feature file
   */
  public isValidFeatureFile(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === ".feature";
  }

  /**
   * Get all feature files in a directory
   * @param directory - Directory to search
   * @param depth - Current recursion depth (internal use)
   * @returns Array of feature file paths
   */
  public getFeatureFiles(directory: string, depth = 0): string[] {
    // Prevent infinite recursion
    const MAX_DEPTH = 10;
    if (depth > MAX_DEPTH) {
      // console.warn(
      //   `Maximum recursion depth (${MAX_DEPTH}) reached for directory: ${directory}`
      // );
      return [];
    }

    const files: string[] = [];
    const items = fs.readdirSync(directory, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(directory, item.name);

      // Skip hidden files and common system directories
      if (
        item.name.startsWith(".") ||
        item.name === "node_modules" ||
        item.name === ".git" ||
        item.name === "__pycache__"
      ) {
        continue;
      }

      if (item.isDirectory()) {
        files.push(...this.getFeatureFiles(fullPath, depth + 1));
      } else if (this.isValidFeatureFile(fullPath)) {
        files.push(fullPath);
      }
    }

    return files;
  }
}
