import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Logger } from "../utils/logger";
import { backgroundKeyword, examplesKeyword, featureKeyword, resolveGherkinKeywords, ruleKeyword, scenarioKeyword, stepKeyword } from "../utils/gherkin-keywords";
import { FeatureParser } from "../parsers/feature-parser";
import { scanBehaveEnvironment, scanPythonStepDefinitions, StaticStepDefinition, StepFramework } from "./python-step-definition-scanner";
import { ExtensionConfig } from "../core/extension-config";
import { FrameworkFactory } from "../core/framework-factory";

export { extractStepText } from "../utils/gherkin-keywords";

/**
 * Definition provider that jumps from a Gherkin step in a .feature file
 * to its matching `@given`/`@when`/`@then`/`@step` decorator in a Python file.
 */
export class StepDefinitionProvider implements vscode.DefinitionProvider {
  private readonly logger: Logger;
  private readonly stepGlobs: readonly string[] | undefined;

  /** Cache parsed step defs per file (invalidated when file mtime changes). */
  private readonly cache = new Map<string, { mtimeMs: number; defs: StaticStepDefinition[] }>();

  constructor(stepGlobs: readonly string[] | undefined, logger?: Logger) {
    this.stepGlobs = stepGlobs;
    this.logger = logger ?? Logger.create();
  }

  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location[] | undefined> {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) {return undefined;}
    const config = ExtensionConfig.forResource(document.uri);
    const parser = FeatureParser.create();
    const content = document.getText();
    const step = this.stepContext(content, position.line, parser);
    if (!step) {return undefined;}
    const selectedFramework = !config.hasExplicitFramework() && config.isFrameworkAutoDetectionEnabled()
      ? await FrameworkFactory.autoDetect(path.resolve(folder.uri.fsPath, config.workingDirectory || "."), { notify: false })
      : config.getFramework();
    if (selectedFramework !== "behave" && selectedFramework !== "pytest-bdd") {return undefined;}
    const framework: StepFramework = selectedFramework === "pytest-bdd" ? "pytest" : "behave";

    const matcher = this.behaveMatcher(document.uri.fsPath, folder.uri.fsPath);
    const files = await this.findStepFiles(folder, config.stepDefinitionPaths);
    const matches: vscode.Location[] = [];

    for (const file of files) {
      const defs = this.parseStepFile(file, matcher.matcher, matcher.customTypes, framework === "behave");
      for (const def of defs) {
        if (def.framework === framework && (def.keyword === "step" || def.keyword === step.kind) && step.texts.some((text) => def.matches(text))) {
          matches.push(new vscode.Location(
            vscode.Uri.file(file),
            new vscode.Range(def.line, 0, def.line, 0)
          ));
        }
      }
    }

    return matches.length > 0 ? matches : undefined;
  }

  private behaveMatcher(featurePath: string, root: string): { matcher: "parse" | "cfparse" | "re" | undefined; customTypes: boolean } {
    let directory = path.dirname(featurePath);
    while (directory.startsWith(root)) {
      const environment = path.join(directory, "environment.py");
      if (fs.existsSync(path.join(directory, "steps")) || fs.existsSync(environment)) {
        try {
          const content = fs.readFileSync(environment, "utf8");
          return scanBehaveEnvironment(content);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {return { matcher: undefined, customTypes: true };}
          return { matcher: "parse", customTypes: false };
        }
      }
      const parent = path.dirname(directory);
      if (parent === directory) {break;}
      directory = parent;
    }
    return { matcher: "parse", customTypes: false };
  }

  private stepContext(content: string, line: number, parser: FeatureParser): { kind: "given" | "when" | "then"; texts: string[] } | undefined {
    const keywords = resolveGherkinKeywords(content);
    const lines = parser.structuralLines(content, keywords);
    const current = stepKeyword(lines[line] ?? "", keywords);
    if (!current) {return undefined;}
    let kind = current.kind;
    for (let index = line - 1; (kind === "and" || kind === "but" || kind === "star") && index >= 0; index--) {
      const previousLine = lines[index] ?? "";
      if (isSectionBoundary(previousLine, keywords)) {return undefined;}
      const previous = stepKeyword(previousLine, keywords);
      if (previous) {kind = previous.kind;}
    }
    if (kind !== "given" && kind !== "when" && kind !== "then") {return undefined;}
    const text = (lines[line] ?? "").trimStart().substring(current.text.length).trim();
    let texts = [text];
    for (let index = line - 1; index >= 0; index--) {
      const candidate = lines[index] ?? "";
      if (isSectionBoundary(candidate, keywords) && !scenarioKeyword(candidate.trim(), keywords)) {break;}
      const heading = scenarioKeyword(candidate.trim(), keywords);
      if (!heading) {continue;}
      if (heading.isOutline) {
        const rows = parser.parseFeatureContent(content)?.scenarios.filter((scenario) => scenario.outlineLineNumber === index + 1) ?? [];
        let missingValue = false;
        const values = rows.map((row) => text.replace(/<([^>]+)>/gu, (whole, key: string) => {
          if (row.exampleValues && Object.hasOwn(row.exampleValues, key)) {return row.exampleValues[key] ?? "";}
          missingValue = true;
          return whole;
        }));
        if (missingValue) {return undefined;}
        texts = values;
      }
      break;
    }
    return { kind, texts };
  }

  private async findStepFiles(folder: vscode.WorkspaceFolder, globs: readonly string[]): Promise<string[]> {
    const seen = new Set<string>();
    for (const glob of this.stepGlobs ?? globs) {
      const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, glob), "**/node_modules/**");
      for (const uri of uris) {seen.add(uri.fsPath);}
    }
    return Array.from(seen);
  }

  private parseStepFile(filePath: string, matcher: "parse" | "cfparse" | "re" | undefined, customTypes: boolean, implicitBehave: boolean): StaticStepDefinition[] {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return [];
    }
    const cacheKey = `${filePath}\u0000${matcher ?? "unresolved"}\u0000${customTypes}\u0000${implicitBehave}`;
    const cached = this.cache.get(cacheKey);
    if (cached?.mtimeMs === stat.mtimeMs) {return cached.defs;}

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch (error) {
      this.logger.warn(`Could not read step file: ${filePath}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    const defs = scanPythonStepDefinitions(content, matcher ?? null, customTypes, implicitBehave);
    this.cache.set(cacheKey, { mtimeMs: stat.mtimeMs, defs });
    return defs;
  }
}

function isSectionBoundary(line: string, keywords: ReturnType<typeof resolveGherkinKeywords>): boolean {
  const trimmed = line.trim();
  return [featureKeyword(trimmed, keywords), ruleKeyword(trimmed, keywords), backgroundKeyword(trimmed, keywords),
    scenarioKeyword(trimmed, keywords), examplesKeyword(trimmed, keywords)].some((value) => value !== undefined);
}
