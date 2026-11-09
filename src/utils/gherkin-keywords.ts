import languageCatalog from "./gherkin-languages.json";

type HeaderKeyword = "feature" | "rule" | "background" | "scenario" | "scenarioOutline" | "examples";
type StepKeyword = "given" | "when" | "then" | "and" | "but";
type KeywordName = HeaderKeyword | StepKeyword;

interface GherkinLanguage {
  readonly [keyword: string]: readonly string[] | string;
}

export interface GherkinKeywords {
  readonly words: Readonly<Record<KeywordName, readonly string[]>>;
  readonly stepPrefixes: readonly string[];
}
export type GherkinStepKind = StepKeyword | "star";

const catalog = languageCatalog as unknown as Readonly<Record<string, GherkinLanguage>>;
const headerKeywords: readonly HeaderKeyword[] = ["feature", "rule", "background", "scenario", "scenarioOutline", "examples"];
const stepKeywords: readonly StepKeyword[] = ["given", "when", "then", "and", "but"];
const allKeywords: readonly KeywordName[] = [...headerKeywords, ...stepKeywords];
function wordsFor(language: GherkinLanguage | undefined): Readonly<Record<KeywordName, readonly string[]>> {
  const words = {} as Record<KeywordName, readonly string[]>;
  for (const keyword of allKeywords) {
    const entries = language?.[keyword];
    words[keyword] = Array.isArray(entries) ? entries : [];
  }
  return words;
}

function createKeywords(source: GherkinLanguage | undefined): GherkinKeywords {
  const words = wordsFor(source);
  return { words, stepPrefixes: [...new Set(stepKeywords.flatMap((keyword) => words[keyword]))].sort((left, right) => right.length - left.length) };
}

const englishKeywords = createKeywords(catalog["en"]);
const languageHeader = /^#\s*language\s*:\s*(.*?)\s*$/u;

/** Resolve the leading Gherkin language header without treating docstring content as a directive. */
export function resolveGherkinKeywords(content: string): GherkinKeywords {
  for (const rawLine of content.split("\n")) {
    const line = rawLine.replace(/^\uFEFF/u, "").trim();
    if (line === "") {continue;}
    const match = languageHeader.exec(line);
    if (match) {
      const language = match[1] ?? "";
      return createKeywords(catalog[language]);
    }
    if (line.startsWith("#")) {continue;}
    break;
  }
  return englishKeywords;
}

function headingKeyword(line: string, keyword: HeaderKeyword, keywords: GherkinKeywords): string | undefined {
  return keywords.words[keyword].find((word) => line.startsWith(`${word}:`))?.concat(":");
}

function stepPrefix(line: string, keywords: GherkinKeywords): string | undefined {
  return stepKeyword(line, keywords)?.text;
}

export function stepKeyword(line: string, keywords = englishKeywords): { text: string; kind: GherkinStepKind } | undefined {
  const text = line.trimStart();
  for (const prefix of keywords.stepPrefixes) {
    if (!text.startsWith(prefix) || text.substring(prefix.length).trim().length === 0) {continue;}
    if (prefix.startsWith("*")) {return { text: prefix, kind: "star" };}
    for (const kind of stepKeywords) {
      if (keywords.words[kind].includes(prefix)) {return { text: prefix, kind };}
    }
  }
  return undefined;
}

export function featureKeyword(line: string, keywords = englishKeywords): string | undefined {
  return headingKeyword(line, "feature", keywords);
}

export function ruleKeyword(line: string, keywords = englishKeywords): string | undefined {
  return headingKeyword(line, "rule", keywords);
}

export function backgroundKeyword(line: string, keywords = englishKeywords): string | undefined {
  return headingKeyword(line, "background", keywords);
}

export function scenarioKeyword(line: string, keywords = englishKeywords): { length: number; isOutline: boolean } | undefined {
  const outline = headingKeyword(line, "scenarioOutline", keywords);
  if (outline) {return { length: outline.length, isOutline: true };}
  const scenario = headingKeyword(line, "scenario", keywords);
  return scenario === undefined ? undefined : { length: scenario.length, isOutline: false };
}

export function examplesKeyword(line: string, keywords = englishKeywords): string | undefined {
  return headingKeyword(line, "examples", keywords);
}

export function isStepLine(line: string, keywords = englishKeywords): boolean {
  return stepPrefix(line, keywords) !== undefined;
}

/** From a feature-file step, return its text without its localized Gherkin keyword. */
export function extractStepText(line: string, keywords = englishKeywords): string | undefined {
  const prefix = stepPrefix(line, keywords);
  return prefix === undefined ? undefined : line.trimStart().substring(prefix.length).trim();
}
