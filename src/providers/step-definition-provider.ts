import * as vscode from "vscode";
import * as fs from "fs";
import { Logger } from "../utils/logger";

/**
 * Definition provider that jumps from a Gherkin step in a .feature file
 * to its matching `@given`/`@when`/`@then`/`@step` decorator in a Python file.
 *
 * Supports both behave and pytest-bdd styles:
 *   @given('I am on the page')                     -- plain text
 *   @given('I have <count> users')                 -- behave <param>
 *   @when(parsers.parse("I enter {name}"))         -- pytest-bdd parsers.parse
 *   @then(parsers.re(r"^count is (\d+)$"))         -- pytest-bdd parsers.re (raw regex)
 *
 * And/But in feature files match decorators of any keyword (the previous step's
 * keyword would determine intent, but we match permissively for simplicity).
 */
export class StepDefinitionProvider implements vscode.DefinitionProvider {
  private readonly logger: Logger;
  private readonly stepGlobs: string[];

  /** Cache parsed step defs per file (invalidated when file mtime changes). */
  private readonly cache = new Map<string, { mtimeMs: number; defs: ParsedStepDef[] }>();

  constructor(stepGlobs: string[], logger?: Logger) {
    this.stepGlobs = stepGlobs;
    this.logger = logger ?? Logger.create();
  }

  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location[] | undefined> {
    const line = document.lineAt(position.line).text;
    const stepText = extractStepText(line);
    if (!stepText) {return undefined;}

    const files = await this.findStepFiles();
    const matches: vscode.Location[] = [];

    for (const file of files) {
      const defs = this.parseStepFile(file);
      for (const def of defs) {
        if (def.regex.test(stepText)) {
          matches.push(new vscode.Location(
            vscode.Uri.file(file),
            new vscode.Range(def.line, 0, def.line, 0)
          ));
        }
      }
    }

    return matches.length > 0 ? matches : undefined;
  }

  private async findStepFiles(): Promise<string[]> {
    const seen = new Set<string>();
    for (const glob of this.stepGlobs) {
      const uris = await vscode.workspace.findFiles(glob, "**/node_modules/**");
      for (const uri of uris) {seen.add(uri.fsPath);}
    }
    return Array.from(seen);
  }

  private parseStepFile(filePath: string): ParsedStepDef[] {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return [];
    }
    const cached = this.cache.get(filePath);
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

    const defs = extractStepDefsFromSource(content);
    this.cache.set(filePath, { mtimeMs: stat.mtimeMs, defs });
    return defs;
  }
}

export interface ParsedStepDef {
  /** 0-based line number of the decorator. */
  line: number;
  /** Regex anchored at start/end that matches the full step text. */
  regex: RegExp;
  /** Original pattern string (for debugging). */
  pattern: string;
}

const STEP_KEYWORDS = "(?:Given|When|Then|And|But) ";
const STEP_LINE_RE = new RegExp(`^\\s*${STEP_KEYWORDS}(.+?)\\s*$`);
const DECORATOR_RE = /^\s*@(given|when|then|step)\s*\(\s*(.+?)\s*\)\s*$/i;

/** From a feature-file line like `  Given I have 5 users`, return `I have 5 users`. */
export function extractStepText(line: string): string | undefined {
  const match = STEP_LINE_RE.exec(line);
  return match?.[1];
}

/**
 * Extract all step definitions from a Python source file. Handles:
 *   @given('text')
 *   @given("text")
 *   @when(parsers.parse('text'))
 *   @then(parsers.re(r'pattern'))
 *   @step(parsers.cfparse('text'))
 */
export function extractStepDefsFromSource(content: string): ParsedStepDef[] {
  const defs: ParsedStepDef[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = DECORATOR_RE.exec(line);
    if (!match) {continue;}

    const argText = match[2] ?? "";
    const parsed = parseDecoratorArg(argText);
    if (!parsed) {continue;}

    const regex = parsed.isRegex
      ? safeCompileRegex(anchorIfNeeded(parsed.text))
      : safeCompileRegex(`^${patternToRegexSource(parsed.text)}$`);
    if (!regex) {continue;}

    defs.push({ line: i, regex, pattern: parsed.text });
  }

  return defs;
}

interface DecoratorArg {
  text: string;
  isRegex: boolean;
}

/**
 * Parse the argument to a decorator like `'foo'`, `"foo"`, `parsers.parse('foo')`,
 * `parsers.re(r'foo')`. Returns the unwrapped string and whether it is raw regex.
 */
function parseDecoratorArg(arg: string): DecoratorArg | undefined {
  // Plain string: 'foo' or "foo"
  const plain = extractFirstString(arg);
  // Strip any leading parsers.xxx( wrapper
  const wrapped = /^parsers\.(parse|cfparse|re|string)\s*\(\s*(.+?)\s*\)\s*$/i.exec(arg);
  if (wrapped) {
    const inner = wrapped[2] ?? "";
    const innerStr = extractFirstString(inner);
    if (innerStr === undefined) {return undefined;}
    return { text: innerStr, isRegex: (wrapped[1] ?? "").toLowerCase() === "re" };
  }
  if (plain === undefined) {return undefined;}
  return { text: plain, isRegex: false };
}

/**
 * Pull the first single- or double-quoted string from a Python expression.
 * Handles the `r"..."` / `r'...'` raw-string prefix (the prefix is dropped;
 * the caller flags isRegex separately).
 */
export function extractFirstString(expr: string): string | undefined {
  const stripped = expr.replace(/^[rRbBuU]+/, "");
  const m = /^(['"])((?:\\.|(?!\1).)*)\1/.exec(stripped);
  return m?.[2];
}

/**
 * Convert a behave/pytest-bdd pattern to a regex source. Both `<name>`
 * (behave) and `{name}` / `{name:type}` (pytest-bdd) become wildcard captures.
 * All other regex specials are escaped.
 */
export function patternToRegexSource(pattern: string): string {
  // Escape regex specials, except < > { } which we replace below
  let escaped = pattern.replace(/[.*+?^$|()\\[\]\\]/g, "\\$&");
  // <name>  -> .+
  escaped = escaped.replace(/<[^>]+>/g, ".+?");
  // {name} or {name:type} -> .+
  escaped = escaped.replace(/\{[^}]*\}/g, ".+?");
  return escaped;
}

function anchorIfNeeded(pattern: string): string {
  let p = pattern;
  if (!p.startsWith("^")) {p = `^${p}`;}
  if (!p.endsWith("$")) {p = `${p}$`;}
  return p;
}

function safeCompileRegex(source: string): RegExp | undefined {
  try {
    return new RegExp(source);
  } catch {
    return undefined;
  }
}
