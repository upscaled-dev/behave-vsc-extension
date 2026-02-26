import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { ParsedFeature, Scenario } from "../types/index";
import { Logger } from "../utils/logger";
import { getLanguageRegistry } from "../i18n/language-registry";
import { detectLanguage } from "../i18n/language-detector";
import { GherkinKeywords } from "../i18n/types";

/**
 * Parser for Gherkin feature files with multi-language support
 */
export class FeatureParser {
  /**
   * Parse a feature file and extract scenarios
   * @param filePath - Path to the feature file
   * @param languageCode - Optional language code (auto-detected if not provided)
   * @returns Parsed feature data
   */
  public static parseFeatureFile(filePath: string, languageCode?: string): ParsedFeature | null {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return this.parseFeatureContent(content, languageCode);
    } catch (error) {
      Logger.getInstance().error("Error parsing feature file:", { error });
      return null;
    }
  }

  /**
   * Parse feature content and extract scenarios
   * @param content - Feature file content
   * @param languageCode - Optional language code (auto-detected if not provided)
   * @returns Parsed feature data with line number information
   */
  public static parseFeatureContent(content: string, languageCode?: string): ParsedFeature | null {
    try {
      const detectionResult = detectLanguage(content);
      const finalLanguageCode = languageCode ?? detectionResult.languageCode;
      const registry = getLanguageRegistry();
      const languageInfo = registry.getLanguage(finalLanguageCode);
      
      if (!languageInfo) {
        Logger.getInstance().warn(`Language '${finalLanguageCode}' not found, falling back to English`);
      }

      const englishKeywords = registry.getLanguage('en')?.keywords;
      if (!englishKeywords) {
        throw new Error('English language keywords not found');
      }
      
      const keywords = languageInfo?.keywords ?? englishKeywords;
      const lines = content.split("\n");
      const featureInfo = this.extractFeatureInfo(lines, keywords);

      if (featureInfo.name === "Unknown Feature") {
        return null;
      }

      const scenarios = this.extractScenarios(lines, featureInfo.lineNumber, keywords);

      return {
        feature: featureInfo.name,
        scenarios,
        filePath: "",
        featureLineNumber: featureInfo.lineNumber,
      };
    } catch (error) {
      Logger.getInstance().error("Error parsing feature content:", { error });
      return null;
    }
  }

  /**
   * Extract feature name and line number from content
   * @param lines - Feature file lines
   * @param keywords - Gherkin keywords for the detected language
   * @returns Feature info with name and line number
   */
  private static extractFeatureInfo(lines: string[], keywords: GherkinKeywords): {
    name: string;
    lineNumber: number;
  } {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line) {
        const trimmed = line.trim();
        for (const featureKeyword of keywords.feature) {
          if (trimmed.startsWith(featureKeyword)) {
            return {
              name: trimmed.substring(featureKeyword.length).trim(),
              lineNumber: i + 1,
            };
          }
        }
      }
    }
    return { name: "Unknown Feature", lineNumber: 1 };
  }

  /**
   * Extract scenarios from content
   * @param lines - Feature file lines
   * @param featureLineNumber - Line number of the feature
   * @param keywords - Gherkin keywords for the detected language
   * @returns Array of scenarios
   */
  private static extractScenarios(lines: string[], featureLineNumber: number, keywords: GherkinKeywords): Scenario[] {
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
    let outlineLineNumber = 1;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith("@") && !currentScenario) {
        const tagMatches = trimmed.match(/@\w+/g);
        if (tagMatches) {
          currentScenarioTags.push(...tagMatches);
        }
      } else if (this.matchesKeyword(trimmed, keywords.scenario)) {
        if (currentScenario) {
          if (isCurrentScenarioOutline) {
            scenarioOutlines.push({
              scenario: currentScenario,
              examplesData: currentExamplesData,
              examplesHeaders: currentExamplesHeaders,
              examplesLineNumbers: currentExamplesLineNumbers,
              outlineLineNumber,
            });
          } else {
            scenarios.push(currentScenario);
          }
        }

        const matchedKeyword = this.findMatchedKeyword(trimmed, keywords.scenario);
        const scenarioName = trimmed.substring(matchedKeyword.length).trim();

        if (!scenarioName) {
          Logger.getInstance().warn(
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
          filePath: "",
          isScenarioOutline: false,
          featureLineNumber,
        };
        inExamplesSection = false;
        isCurrentScenarioOutline = false;
        currentExamplesData = [];
        currentExamplesHeaders = [];
        currentExamplesLineNumbers = [];
        currentScenarioTags = [];
      } else if (this.matchesKeyword(trimmed, keywords.scenario_outline)) {
        if (currentScenario) {
          if (isCurrentScenarioOutline) {
            scenarioOutlines.push({
              scenario: currentScenario,
              examplesData: currentExamplesData,
              examplesHeaders: currentExamplesHeaders,
              examplesLineNumbers: currentExamplesLineNumbers,
              outlineLineNumber,
            });
          } else {
            scenarios.push(currentScenario);
          }
        }

        const matchedKeyword = this.findMatchedKeyword(trimmed, keywords.scenario_outline);
        const scenarioName = trimmed.substring(matchedKeyword.length).trim();

        if (!scenarioName) {
          Logger.getInstance().warn(
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
          filePath: "",
          isScenarioOutline: true,
          featureLineNumber,
        };
        outlineLineNumber = lineNumber;
        inExamplesSection = false;
        isCurrentScenarioOutline = true;
        currentExamplesData = [];
        currentExamplesHeaders = [];
        currentExamplesLineNumbers = [];
        currentScenarioTags = [];
      } else if (trimmed.startsWith("@") && currentScenario) {
        const tagMatches = trimmed.match(/@\w+/g);
        if (tagMatches) {
          currentScenarioTags.push(...tagMatches);
        }
      } else if (this.matchesKeyword(trimmed, keywords.examples) && isCurrentScenarioOutline) {
        inExamplesSection = true;
        currentExamplesData = [];
        currentExamplesHeaders = [];
        currentExamplesLineNumbers = [];
      } else if (
        inExamplesSection &&
        trimmed.startsWith("|") &&
        trimmed.endsWith("|")
      ) {
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
        (this.matchesKeyword(trimmed, keywords.given) ||
          this.matchesKeyword(trimmed, keywords.when) ||
          this.matchesKeyword(trimmed, keywords.then) ||
          this.matchesKeyword(trimmed, keywords.and) ||
          this.matchesKeyword(trimmed, keywords.but))
      ) {
        currentScenario.steps.push(trimmed);
      } else if (
        inExamplesSection &&
        (this.matchesKeyword(trimmed, keywords.scenario) ||
          this.matchesKeyword(trimmed, keywords.scenario_outline) ||
          this.matchesKeyword(trimmed, keywords.feature))
      ) {
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
              featureLineNumber, // Add featureLineNumber
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
   * Check if a line matches any of the given keywords
   * @param line - Line to check
   * @param keywords - Array of keywords to match
   * @returns True if line starts with any keyword
   */
  private static matchesKeyword(line: string, keywords: string[]): boolean {
    return keywords.some(keyword => line.startsWith(keyword));
  }

  /**
   * Find the matched keyword from a line
   * @param line - Line to check
   * @param keywords - Array of keywords to match
   * @returns The matched keyword or empty string
   */
  private static findMatchedKeyword(line: string, keywords: string[]): string {
    return keywords.find(keyword => line.startsWith(keyword)) ?? '';
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
    const startLine = scenarioLineNumber - 1;
    let endLine = startLine;

    const content = lines.join('\n');
    const detectionResult = detectLanguage(content);
    const registry = getLanguageRegistry();
    const languageInfo = registry.getLanguage(detectionResult.languageCode);
    const englishKeywords = registry.getLanguage('en')?.keywords;
    if (!englishKeywords) {
      throw new Error('English language keywords not found');
    }
    const keywords = languageInfo?.keywords ?? englishKeywords;

    for (let i = scenarioLineNumber; i < lines.length; i++) {
      const line = lines[i]?.trim() ?? "";
      if (
        this.matchesKeyword(line, keywords.scenario) ||
        this.matchesKeyword(line, keywords.scenario_outline) ||
        this.matchesKeyword(line, keywords.feature)
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

    const detectionResult = detectLanguage(content);
    const registry = getLanguageRegistry();
    const languageInfo = registry.getLanguage(detectionResult.languageCode);
    const englishKeywords = registry.getLanguage('en')?.keywords;
    if (!englishKeywords) {
      throw new Error('English language keywords not found');
    }
    const keywords = languageInfo?.keywords ?? englishKeywords;

    const allTags = this.extractTags(content);
    const parsedFeature = this.parseFeatureContent(content);
    const scenarioOutlineExamples =
      parsedFeature?.scenarios.filter(
        (s) => s.isScenarioOutline && /^\d+:\s*.+\s*-\s*/.test(s.name)
      ) ?? [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (
        this.matchesKeyword(trimmed, keywords.scenario) ||
        this.matchesKeyword(trimmed, keywords.scenario_outline)
      ) {
        const isScenarioOutline = this.matchesKeyword(trimmed, keywords.scenario_outline);
        const matchedKeyword = isScenarioOutline 
          ? this.findMatchedKeyword(trimmed, keywords.scenario_outline)
          : this.findMatchedKeyword(trimmed, keywords.scenario);
        const scenarioName = trimmed.substring(matchedKeyword.length).trim();

        const scenarioRange = this.getScenarioRange(lines, lineNumber);

        codeLenses.push(
          new vscode.CodeLens(scenarioRange, {
            title: isScenarioOutline
              ? "▶️ Run Scenario Outline"
              : "▶️ Run Scenario",
            command: "behaveTestRunner.runScenario",
            arguments: [filePath, lineNumber, scenarioName],
          })
        );

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

    if (lines.length > 0) {
      let featureLineIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (typeof line === "string" && this.matchesKeyword(line.trim(), keywords.feature)) {
          featureLineIndex = i;
          break;
        }
      }

      if (featureLineIndex >= 0) {
        let featureEndLine = featureLineIndex;
        for (let i = featureLineIndex + 1; i < lines.length; i++) {
          const line = lines[i]?.trim() ?? "";
          if (
            this.matchesKeyword(line, keywords.scenario) ||
            this.matchesKeyword(line, keywords.scenario_outline)
          ) {
            break;
          }
          featureEndLine = i;
        }
        const featureRange = new vscode.Range(0, 0, featureEndLine, 0);

        codeLenses.push(
          new vscode.CodeLens(featureRange, {
            title: "📁 Run Feature File",
            command: "behaveTestRunner.runFeatureFile",
            arguments: [filePath],
          })
        );

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
