import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { ParsedFeature, Scenario } from "../types/index";

/**
 * Parser for Gherkin feature files
 */
export class FeatureParser {
  /**
   * Parse a feature file and extract scenarios
   * @param filePath - Path to the feature file
   * @returns Parsed feature data
   */
  public static parseFeatureFile(filePath: string): ParsedFeature | null {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return this.parseFeatureContent(content);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error parsing feature file:", error);
      return null;
    }
  }

  /**
   * Parse feature content and extract scenarios
   * @param content - Feature file content
   * @returns Parsed feature data with line number information
   */
  public static parseFeatureContent(content: string): ParsedFeature | null {
    try {
      const lines = content.split("\n");
      const featureInfo = this.extractFeatureInfo(lines);

      // Return null if no valid feature name was found
      if (featureInfo.name === "Unknown Feature") {
        return null;
      }

      const scenarios = this.extractScenarios(lines);

      return {
        feature: featureInfo.name,
        scenarios,
        filePath: "", // Will be set by caller
        featureLineNumber: featureInfo.lineNumber,
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error parsing feature content:", error);
      return null;
    }
  }

  /**
   * Extract feature name and line number from content
   * @param lines - Feature file lines
   * @returns Feature info with name and line number
   */
  private static extractFeatureInfo(lines: string[]): {
    name: string;
    lineNumber: number;
  } {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line) {
        const trimmed = line.trim();
        if (trimmed.startsWith("Feature:")) {
          return {
            name: trimmed.substring(8).trim(),
            lineNumber: i + 1, // 1-based line number
          };
        }
      }
    }
    return { name: "Unknown Feature", lineNumber: 1 };
  }

  /**
   * Extract scenarios from content
   * @param lines - Feature file lines
   * @returns Array of scenarios
   */
  private static extractScenarios(lines: string[]): Scenario[] {
    const scenarios: Scenario[] = [];
    const scenarioOutlines: Array<{
      scenario: Scenario;
      examplesData: string[][];
      examplesHeaders: string[];
      examplesLineNumbers: number[];
      outlineLineNumber: number;
    }> = [];

    let currentScenario: Scenario | null = null;
    let currentExamplesData: string[][] = [];
    let currentExamplesHeaders: string[] = [];
    let currentExamplesLineNumbers: number[] = [];
    let isCurrentScenarioOutline = false;
    let inExamplesSection = false;
    let lineNumber = 1;
    let currentScenarioTags: string[] = [];
    let outlineLineNumber = 1; // Track the scenario outline line number

    for (const line of lines) {
      const trimmed = line.trim();

      // Extract tags that come before scenarios
      if (trimmed.startsWith("@") && !currentScenario) {
        const tagMatches = trimmed.match(/@\w+/g);
        if (tagMatches) {
          currentScenarioTags.push(...tagMatches);
        }
      } else if (trimmed.startsWith("Scenario:")) {
        // Save previous scenario if exists
        if (currentScenario) {
          if (isCurrentScenarioOutline) {
            // This was a scenario outline, save it with its examples
            scenarioOutlines.push({
              scenario: currentScenario,
              examplesData: currentExamplesData,
              examplesHeaders: currentExamplesHeaders,
              examplesLineNumbers: currentExamplesLineNumbers,
              outlineLineNumber,
            });
          } else {
            // Regular scenario
            scenarios.push(currentScenario);
          }
        }

        const scenarioName = trimmed.substring(9).trim();

        // Validate scenario name
        if (!scenarioName) {
          console.warn(
            `Warning: Empty scenario name found at line ${lineNumber} in feature file`
          );
        }

        currentScenario = {
          name: scenarioName || "Unnamed Scenario",
          line: lineNumber,
          range: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0),
          lineNumber,
          steps: [],
          tags: currentScenarioTags,
          filePath: "", // Will be set by caller
          isScenarioOutline: false,
        };
        inExamplesSection = false;
        isCurrentScenarioOutline = false;
        currentExamplesData = [];
        currentExamplesHeaders = [];
        currentExamplesLineNumbers = [];
        currentScenarioTags = [];
      } else if (trimmed.startsWith("Scenario Outline:")) {
        // Save previous scenario if exists
        if (currentScenario) {
          if (isCurrentScenarioOutline) {
            // This was a scenario outline, save it with its examples
            scenarioOutlines.push({
              scenario: currentScenario,
              examplesData: currentExamplesData,
              examplesHeaders: currentExamplesHeaders,
              examplesLineNumbers: currentExamplesLineNumbers,
              outlineLineNumber,
            });
          } else {
            // Regular scenario
            scenarios.push(currentScenario);
          }
        }

        const scenarioName = trimmed.substring(17).trim();

        // Validate scenario outline name
        if (!scenarioName) {
          console.warn(
            `Warning: Empty scenario outline name found at line ${lineNumber} in feature file`
          );
        }

        currentScenario = {
          name: scenarioName || "Unnamed Scenario Outline",
          line: lineNumber,
          range: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0),
          lineNumber,
          steps: [],
          tags: currentScenarioTags,
          filePath: "", // Will be set by caller
          isScenarioOutline: true,
        };
        // Store the outline line number for later use
        outlineLineNumber = lineNumber;
        inExamplesSection = false;
        isCurrentScenarioOutline = true;
        currentExamplesData = [];
        currentExamplesHeaders = [];
        currentExamplesLineNumbers = [];
        currentScenarioTags = [];
      } else if (trimmed.startsWith("@") && currentScenario) {
        // Extract tags for the current scenario (after scenario line)
        const tagMatches = trimmed.match(/@\w+/g);
        if (tagMatches) {
          currentScenarioTags.push(...tagMatches);
        }
      } else if (trimmed === "Examples:" && isCurrentScenarioOutline) {
        inExamplesSection = true;
        currentExamplesData = [];
        currentExamplesHeaders = [];
        currentExamplesLineNumbers = [];
      } else if (
        inExamplesSection &&
        trimmed.startsWith("|") &&
        trimmed.endsWith("|")
      ) {
        // Parse Examples table
        const cells = trimmed
          .substring(1, trimmed.length - 1)
          .split("|")
          .map((cell) => cell.trim())
          .filter((cell) => cell.length > 0);

        if (currentExamplesHeaders.length === 0) {
          currentExamplesHeaders = cells;
        } else {
          currentExamplesData.push(cells);
          currentExamplesLineNumbers.push(lineNumber);
        }
      } else if (
        currentScenario &&
        (trimmed.startsWith("Given ") ||
          trimmed.startsWith("When ") ||
          trimmed.startsWith("Then ") ||
          trimmed.startsWith("And ") ||
          trimmed.startsWith("But "))
      ) {
        currentScenario.steps.push(trimmed);
      } else if (
        inExamplesSection &&
        (trimmed.startsWith("Scenario:") ||
          trimmed.startsWith("Scenario Outline:") ||
          trimmed.startsWith("Feature:"))
      ) {
        // Stop at next scenario or feature
        inExamplesSection = false;
        isCurrentScenarioOutline = false;
      }

      lineNumber++;
    }

    // Save the last scenario
    if (currentScenario) {
      if (isCurrentScenarioOutline) {
        // This was a scenario outline, save it with its examples
        scenarioOutlines.push({
          scenario: currentScenario,
          examplesData: currentExamplesData,
          examplesHeaders: currentExamplesHeaders,
          examplesLineNumbers: currentExamplesLineNumbers,
          outlineLineNumber,
        });
      } else {
        // Regular scenario
        scenarios.push(currentScenario);
      }
    }

    // Now process Scenario Outlines and create individual scenarios for each example
    const finalScenarios: Scenario[] = [];

    // Add regular scenarios first
    finalScenarios.push(...scenarios);

    // Process scenario outlines
    for (const outline of scenarioOutlines) {
      if (outline.examplesData.length > 0) {
        // Create individual scenarios for each example
        for (let i = 0; i < outline.examplesData.length; i++) {
          const exampleData = outline.examplesData[i];
          if (exampleData) {
            // Create a more concise name for the example
            const exampleValues = exampleData
              .map((value, index) => {
                const header = outline.examplesHeaders[index];
                if (!header) {
                  return `param${index}: ${value}`;
                }
                // Truncate long header names to keep the name readable
                const shortHeader =
                  header.length > 15 ? `${header.substring(0, 12)}...` : header;
                return `${shortHeader}: ${value}`;
              })
              .join(", ");

            const exampleScenario: Scenario = {
              name: `${i + 1}: ${outline.scenario.name} - ${exampleValues}`,
              line: outline.examplesLineNumbers[i] ?? outline.scenario.line + i, // Use actual example line number
              range: new vscode.Range(
                (outline.examplesLineNumbers[i] ?? outline.scenario.line + i) -
                  1,
                0,
                (outline.examplesLineNumbers[i] ?? outline.scenario.line + i) -
                  1,
                0
              ),
              lineNumber:
                outline.examplesLineNumbers[i] ?? outline.scenario.line + i, // Use actual example line number
              steps: outline.scenario.steps,
              tags: outline.scenario.tags ?? [], // Ensure tags is always an array
              filePath: "", // Will be set by caller
              isScenarioOutline: true,
              outlineLineNumber: outline.outlineLineNumber, // Store the parent outline line number
            };

            finalScenarios.push(exampleScenario);
          }
        }
      } else {
        // No examples found, add as regular scenario
        finalScenarios.push(outline.scenario);
      }
    }

    return finalScenarios;
  }

  /**
   * Extract all unique tags from a feature file
   * @param content - Feature file content
   * @returns Array of unique tags
   */
  private static extractTags(content: string): string[] {
    const tags = new Set<string>();
    const lines = content.split("\n");

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
  private static getScenarioRange(
    lines: string[],
    scenarioLineNumber: number
  ): vscode.Range {
    const startLine = scenarioLineNumber - 1; // Convert to 0-based
    let endLine = startLine;

    // Find the end of this scenario (next scenario or end of file)
    for (let i = scenarioLineNumber; i < lines.length; i++) {
      const line = lines[i]?.trim() ?? "";
      // Stop at next scenario, scenario outline, or feature
      if (
        line.startsWith("Scenario:") ||
        line.startsWith("Scenario Outline:") ||
        line.startsWith("Feature:")
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
  public static provideScenarioCodeLenses(
    content: string,
    filePath: string
  ): vscode.CodeLens[] {
    const codeLenses: vscode.CodeLens[] = [];
    const lines = content.split("\n");
    let lineNumber = 1;

    // Extract all available tags from the feature file
    const allTags = this.extractTags(content);

    // Parse scenarios to get scenario outline examples
    const parsedFeature = this.parseFeatureContent(content);
    const scenarioOutlineExamples =
      parsedFeature?.scenarios.filter(
        (s) => s.isScenarioOutline && /^\d+:\s*.+\s*-\s*/.test(s.name)
      ) ?? [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (
        trimmed.startsWith("Scenario:") ||
        trimmed.startsWith("Scenario Outline:")
      ) {
        const scenarioName = trimmed.includes("Scenario:")
          ? trimmed.substring(9).trim()
          : trimmed.substring(17).trim();

        // Calculate the range for this scenario (multiline)
        const scenarioRange = this.getScenarioRange(lines, lineNumber);

        // Check if this is a scenario outline
        const isScenarioOutline = trimmed.startsWith("Scenario Outline:");

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
        if (typeof line === "string" && line.trim().startsWith("Feature:")) {
          featureLineIndex = i;
          break;
        }
      }

      if (featureLineIndex >= 0) {
        // Calculate feature range (from feature line to first scenario or end of file)
        let featureEndLine = featureLineIndex;
        for (let i = featureLineIndex + 1; i < lines.length; i++) {
          const line = lines[i]?.trim() ?? "";
          if (
            line.startsWith("Scenario:") ||
            line.startsWith("Scenario Outline:")
          ) {
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
  public static isValidFeatureFile(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === ".feature";
  }

  /**
   * Get all feature files in a directory
   * @param directory - Directory to search
   * @param depth - Current recursion depth (internal use)
   * @returns Array of feature file paths
   */
  public static getFeatureFiles(directory: string, depth = 0): string[] {
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
