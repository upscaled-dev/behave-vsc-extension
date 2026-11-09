export type DefinitionKeyword = "given" | "when" | "then" | "step";
export type BehaveMatcher = "parse" | "cfparse" | "re" | undefined;
export type StepFramework = "behave" | "pytest";

export interface StaticStepDefinition {
  readonly line: number;
  readonly framework: StepFramework;
  readonly keyword: DefinitionKeyword;
  readonly pattern: string;
  matches(text: string): boolean;
}

type Matcher = Exclude<BehaveMatcher, undefined> | "literal";
interface Decorator { readonly framework: StepFramework; readonly keyword: DefinitionKeyword; }
const decoratorNames = new Set<DefinitionKeyword>(["given", "when", "then", "step"]);
type Binding = Decorator | { readonly kind: "parser" | "matcher" | "registrar" | "unknown" };

class BindingState {
  public matcher: BehaveMatcher;
  public customTypes: boolean;
  private readonly bindings = new Map<string, Binding>();
  public constructor(matcher: BehaveMatcher, customTypes: boolean, implicitBehave = false) {
    this.matcher = matcher; this.customTypes = customTypes;
    this.bindings.set("use_step_matcher", { kind: "matcher" });
    this.bindings.set("step_matcher", { kind: "matcher" });
    this.bindings.set("register_type", { kind: "registrar" });
    if (implicitBehave) {for (const keyword of decoratorNames) {this.bindings.set(keyword, { framework: "behave", keyword });}}
  }
  public bind(name: string, binding: Binding, conditional = false): void {
    const effective = conditional ? { kind: "unknown" } as const : binding;
    const previous = this.bindings.get(name);
    if (bindingKind(previous) === "matcher" && bindingKind(effective) !== "matcher") {this.matcher = undefined;}
    if (bindingKind(previous) === "registrar" && bindingKind(effective) !== "registrar") {this.customTypes = true;}
    this.bindings.set(name, effective);
  }
  public decorator(name: string): Decorator | undefined {const binding = this.bindings.get(name); return binding && "framework" in binding ? binding : undefined;}
  public has(name: string, kind: "parser" | "matcher" | "registrar" | "unknown"): boolean {return bindingKind(this.bindings.get(name)) === kind;}
  public uncertainAll(): void {this.matcher = undefined; this.customTypes = true; for (const name of this.bindings.keys()) {this.bindings.set(name, { kind: "unknown" });}}
}

function bindingKind(binding: Binding | undefined): "parser" | "matcher" | "registrar" | "unknown" | undefined {
  return binding && "kind" in binding ? binding.kind : undefined;
}

interface SourceStatement { readonly text: string; readonly line: number; readonly indentation: number; }

export function scanPythonStepDefinitions(content: string, inheritedBehaveMatcher?: BehaveMatcher | null, customTypes = false, implicitBehave = false): StaticStepDefinition[] {
  const state = new BindingState(inheritedBehaveMatcher === null ? undefined : inheritedBehaveMatcher ?? "parse", customTypes, implicitBehave);
  const definitions: StaticStepDefinition[] = [];
  for (const statement of moduleStatements(content)) {
    const conditional = statement.indentation > 0 || isCompound(statement.text);
    foldStatement(statement.text, state, conditional);
    if (!conditional && statement.text.startsWith("@")) {
      const definition = parseDecorator(statement.text, statement.line, state);
      if (definition) {definitions.push(definition);}
    }
  }
  return definitions;
}

export function scanBehaveEnvironment(content: string, initial: BehaveMatcher = "parse"): { matcher: BehaveMatcher; customTypes: boolean } {
  const state = new BindingState(initial, false);
  for (const statement of moduleStatements(content)) {
    foldStatement(statement.text, state, statement.indentation > 0 || isCompound(statement.text));
  }
  return { matcher: state.matcher, customTypes: state.customTypes };
}

function* moduleStatements(content: string): Iterable<SourceStatement> {
  const lines = maskTripleStrings(content.split("\n")).map(withoutComment);
  const source = `${lines.join("\n")}\n`;
  let start = 0;
  let startLine = 0;
  let bodyIndentation: number | undefined;
  for (const token of syntaxCharacters(source)) {
    if (token.character !== "\n" || token.depth !== 0 || source[token.index - 1] === "\\") {continue;}
    const text = source.substring(start, token.index).trim();
    const line = startLine;
    const indentation = [...(lines[line]?.match(/^[ \t]*/u)?.[0] ?? "")]
      .reduce((width, character) => (character === "\t" ? width + 8 - width % 8 : width + 1), 0);
    start = token.index + 1;
    startLine = token.line + 1;
    if (!text) {continue;}
    if (bodyIndentation !== undefined) {
      if (indentation > bodyIndentation) {continue;}
      bodyIndentation = undefined;
    }
    yield { text, line, indentation };
    if (/^(?:async\s+)?(?:def|class)\s+/u.test(text)) {bodyIndentation = indentation;}
  }
  // An incomplete statement cannot establish a literal matcher selection.
  if (source.substring(start).trim() && bodyIndentation === undefined) {
    yield { text: source.substring(start).trim(), line: startLine, indentation: 0 };
  }
}

function isCompound(text: string): boolean {
  return /^(?:(?:async\s+)?(?:for|with)|if|elif|else|while|try|except|finally|match|case)\b/u.test(text);
}

function foldStatement(text: string, state: BindingState, conditional: boolean): void {
  const declaration = /^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)\b/u.exec(text);
  if (declaration) {
    const colon = topLevelIndex(text, ":");
    invalidateExpressionEffects(text.substring(declaration[0].length, colon < 0 ? text.length : colon), state);
    state.bind(declaration[1] ?? "", { kind: "unknown" }, conditional);
    return;
  }
  if (text.startsWith("@")) {return;}
  if (splitTopLevel(text.replace(/;\s*$/u, ""), ";").length > 1) {state.uncertainAll(); return;}
  const colon = isCompound(text) ? topLevelIndex(text, ":") : -1;
  const header = colon >= 0 ? text.substring(0, colon) : text;
  const inline = colon >= 0 ? text.substring(colon + 1).trim() : undefined;
  if (isCompound(text)) {invalidateExpressionEffects(header, state);}
  const loop = /^(?:async\s+)?for\s+([\s\S]+?)\s+in\b/u.exec(header);
  if (loop) {invalidateTargets(loop[1] ?? "", state);}
  if (/^(?:async\s+)?with\s+/u.test(header)) {
    const items = header.replace(/^(?:async\s+)?with\s+/u, "");
    for (const item of splitTopLevel(items, ",")) {
      const alias = topLevelKeyword(item, "as");
      if (alias >= 0) {invalidateTargets(item.substring(alias + 2), state);}
    }
  }
  if (/^except\b/u.test(header)) {
    const alias = topLevelKeyword(header, "as");
    if (alias >= 0) {invalidateTargets(header.substring(alias + 2), state);}
  }
  if (/^(?:match|case)\b/u.test(header)) {state.uncertainAll();}
  if (inline !== undefined && !inline) {return;}
  const statement = (inline ?? text).replace(/;\s*$/u, "").trim();
  invalidateExpressionEffects(statement, state, true);
  const deleted = /^del\s+([\s\S]+)$/u.exec(statement);
  if (deleted) {invalidateTargets(deleted[1] ?? "", state); return;}
  const from = /^from\s+([\w.]+)\s+import\s+(.+)$/u.exec(statement);
  if (from) {
    const module = from[1] ?? "";
    for (const part of (from[2] ?? "").split(",")) {
      const imported = /^\s*([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/u.exec(part);
      if (!imported) {state.uncertainAll(); return;}
      const name = imported[1] ?? "";
      const alias = imported[2] ?? name;
      let binding: Binding = { kind: "unknown" };
      if ((module === "behave" || module === "pytest_bdd") && decoratorNames.has(name as DefinitionKeyword)) {
        binding = { framework: module === "behave" ? "behave" : "pytest", keyword: name as DefinitionKeyword };
      } else if (module === "pytest_bdd" && name === "parsers") {binding = { kind: "parser" };}
      else if (module === "behave" && (name === "use_step_matcher" || name === "step_matcher")) {binding = { kind: "matcher" };}
      else if (module === "behave" && name === "register_type") {binding = { kind: "registrar" };}
      state.bind(alias, binding, conditional);
    }
    return;
  }
  const imports = /^import\s+(.+)$/u.exec(statement);
  if (imports) {
    for (const part of (imports[1] ?? "").split(",")) {
      const imported = /^\s*([\w.]+)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/u.exec(part);
      if (!imported) {state.uncertainAll(); return;}
      const module = imported[1] ?? "";
      const alias = imported[2];
      state.bind(alias ?? module.split(".")[0] ?? "", { kind: module === "pytest_bdd.parsers" && alias ? "parser" : "unknown" }, conditional);
    }
    return;
  }
  if (/^(?:from|import)\b/u.test(statement)) {state.uncertainAll(); return;}
  let targetStart = 0;
  for (const token of syntaxCharacters(statement)) {
    if (token.character !== "=" || token.depth !== 0 || statement[token.index + 1] === "=" || "=!<>:".includes(statement[token.index - 1] ?? "")) {continue;}
    const target = statement.substring(targetStart, token.index);
    const annotation = topLevelIndex(target, ":");
    invalidateTargets(annotation < 0 ? target : target.substring(0, annotation), state);
    targetStart = token.index + 1;
  }
  if (targetStart > 0) {return;}
  const prefix = /^([A-Za-z_]\w*)\s*\(/u.exec(statement)?.[1] ?? "";
  if (state.has(prefix, "registrar")) {state.customTypes = true;}
  if (state.has(prefix, "matcher")) {
    const call = /^\w+\s*\((.*)\)\s*$/u.exec(statement);
    const value = pythonString(call?.[1] ?? "")?.value;
    state.matcher = !conditional && (value === "parse" || value === "cfparse" || value === "re") ? value : undefined;
  }
}

function invalidateExpressionEffects(text: string, state: BindingState, directCall = false): void {
  for (const token of syntaxCharacters(text)) {
    if (token.character === ":" && text[token.index + 1] === "=") {
      const target = /([A-Za-z_]\w*)\s*$/u.exec(text.substring(0, token.index))?.[1];
      if (target) {state.bind(target, { kind: "unknown" });} else {state.uncertainAll();}
    }
    if ((directCall && token.index === 0) || /[\w.]/u.test(text[token.index - 1] ?? "")) {continue;}
    const name = /^([A-Za-z_]\w*)\s*\(/u.exec(text.substring(token.index))?.[1] ?? "";
    if (state.has(name, "matcher")) {state.matcher = undefined;}
    if (state.has(name, "registrar")) {state.customTypes = true;}
  }
}

function invalidateTargets(text: string, state: BindingState): void {
  const targets = bindingTargets(text.trim());
  if (!targets) {state.uncertainAll(); return;}
  for (const target of targets) {state.bind(target, { kind: "unknown" });}
}

function bindingTargets(text: string): string[] | undefined {
  if (/^\*?[A-Za-z_]\w*$/u.test(text)) {return [text.replace(/^\*/u, "")];}
  const parts = splitTopLevel(text, ",");
  if (parts.length > 1) {
    if (parts[parts.length - 1]?.trim() === "") {parts.pop();}
    const targets = parts.map((part) => bindingTargets(part.trim()));
    return targets.some((target) => target === undefined) ? undefined : targets.flatMap((target) => target ?? []);
  }
  if ((text.startsWith("(") && text.endsWith(")")) || (text.startsWith("[") && text.endsWith("]"))) {
    const close = [...syntaxCharacters(text)].find((token) => token.depth === 0 && ")]".includes(token.character));
    if (close?.index === text.length - 1) {return bindingTargets(text.substring(1, text.length - 1).trim());}
  }
  return undefined;
}

function* syntaxCharacters(text: string): Iterable<{ character: string; index: number; depth: number; line: number }> {
  let quote: string | undefined;
  let escaped = false;
  let depth = 0;
  let line = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index] ?? "";
    const physicalLine = line;
    if (character === "\n") {line++;}
    if (quote) {if (escaped) {escaped = false;} else if (character === "\\") {escaped = true;} else if (character === quote) {quote = undefined;} continue;}
    if (character === "'" || character === '"') {quote = character; continue;}
    if (")]}".includes(character)) {depth--;}
    yield { character, index, depth, line: physicalLine };
    if ("([{".includes(character)) {depth++;}
  }
}

function topLevelIndex(text: string, character: string): number {
  for (const token of syntaxCharacters(text)) {if (token.depth === 0 && token.character === character) {return token.index;}}
  return -1;
}

function topLevelKeyword(text: string, keyword: string): number {
  for (const token of syntaxCharacters(text)) {
    if (token.depth === 0 && text.substring(token.index, token.index + keyword.length) === keyword
      && !/[\w]/u.test(text[token.index - 1] ?? "") && !/[\w]/u.test(text[token.index + keyword.length] ?? "")) {return token.index;}
  }
  return -1;
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (const token of syntaxCharacters(text)) {
    if (token.depth === 0 && token.character === separator) {parts.push(text.substring(start, token.index)); start = token.index + 1;}
  }
  parts.push(text.substring(start));
  return parts;
}

function parseDecorator(text: string, line: number, state: BindingState): StaticStepDefinition | undefined {
  const call = /^@([A-Za-z_]\w*)\s*\(([\s\S]*)\)$/u.exec(text);
  if (!call) {return undefined;}
  const name = call[1] ?? "";
  const decorator = state.decorator(name);
  if (!decorator) {return undefined;}
  const argumentsList = splitArguments(call[2] ?? "");
  const argument = argumentsList[0];
  if (!argument || !supportedDecoratorArguments(argumentsList, decorator.framework)) {return undefined;}
  const parser = /^([A-Za-z_]\w*)\.(parse|cfparse|re|string)\(([\s\S]*)\)$/u.exec(argument);
  const mode: Matcher | undefined = parser ? parser[2] as Matcher : decorator.framework === "pytest" ? "literal" : state.matcher;
  const parserArguments = parser?.[3]?.replace(/,\s*$/u, "");
  if (!mode || (parser && (!state.has(parser[1] ?? "", "parser") || splitArguments(parserArguments ?? "").length !== 1))) {return undefined;}
  const literal = pythonString(parserArguments ?? argument);
  if (!literal) {return undefined;}
  const matches = mode === "literal" ? fullMatcher(`^${escapeRegex(literal.value)}$`, false)
    : mode === "parse" || mode === "cfparse" ? parseMatcher(literal.value, decorator.framework === "pytest", state.customTypes && decorator.framework === "behave")
      : regexMatcher(literal.value, decorator.framework);
  return matches ? { line, framework: decorator.framework, keyword: decorator.keyword, pattern: literal.value, matches } : undefined;
}

function supportedDecoratorArguments(argumentsList: readonly string[], framework: StepFramework): boolean {
  if (framework === "behave") {return argumentsList.length === 1;}
  const metadata = argumentsList.slice(1);
  return metadata.length <= 1 && metadata.every((argument) => /^target_fixture\s*=\s*/u.test(argument)
    && pythonString(argument.replace(/^target_fixture\s*=\s*/u, "")) !== undefined);
}

function splitArguments(text: string): string[] {
  const values = splitTopLevel(text, ",").map((value) => value.trim());
  if (values.length > 1 && values[values.length - 1] === "") {values.pop();}
  return values;
}

function pythonString(expression: string): { value: string } | undefined {
  const match = /^([rRuU]{0,2})(['"])((?:\\.|(?!\2)[\s\S])*)\2$/u.exec(expression.trim());
  const prefix = match?.[1] ?? "";
  if (!match || !/^(?:r|u)?$/iu.test(prefix)) {return undefined;}
  const raw = /r/iu.test(prefix);
  const value = raw ? match[3] ?? "" : decodeEscapes(match[3] ?? "");
  return value === undefined ? undefined : { value };
}

function decodeEscapes(value: string): string | undefined {
  if (/\\(?:N\{|x(?![0-9a-fA-F]{2})|u(?![0-9a-fA-F]{4})|U(?![0-9a-fA-F]{8}))/u.test(value)) {return undefined;}
  try {
    return value.replace(/\\(?:([\\'"abfnrtv])|x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|([0-7]{1,3}))/gu, (whole, simple: string | undefined, hex: string | undefined, small: string | undefined, large: string | undefined, octal: string | undefined) => {
      if (simple) {return ({ "\\": "\\", "'": "'", '"': '"', a: "\u0007", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" } as Record<string, string>)[simple] ?? whole;}
      const code = hex ?? small ?? large ?? octal;
      return code ? String.fromCodePoint(Number.parseInt(code, octal ? 8 : 16)) : whole;
    });
  } catch {return undefined;}
}

function parseMatcher(pattern: string, ignoreCase: boolean, customTypes: boolean): ((text: string) => boolean) | undefined {
  const field = /\{([A-Za-z_]\w*)?(?::([dfw]))?\}/gu;
  const names = new Map<string, { group: string; type: string }>();
  let cursor = 0; let source = "^";
  for (const match of pattern.matchAll(field)) {
    if (match.index === undefined) {return undefined;}
    const before = pattern.substring(cursor, match.index);
    if (/[{}]/u.test(before)) {return undefined;}
    source += escapeRegex(before);
    const type = match[2] ?? "";
    if (customTypes && type) {return undefined;}
    const value = typePattern(type);
    if (!value) {return undefined;}
    const name = match[1];
    const repeated = name ? names.get(name) : undefined;
    if (repeated && repeated.type !== type) {return undefined;}
    if (repeated) {source += `\\k<${repeated.group}>`;}
    else {const group = `field${names.size}`; source += name ? `(?<${group}>${value})` : `(?:${value})`; if (name) {names.set(name, { group, type });}}
    cursor = match.index + match[0].length;
  }
  if (/[{}]/u.test(pattern.substring(cursor))) {return undefined;}
  return fullMatcher(`${source}${escapeRegex(pattern.substring(cursor))}$`, ignoreCase);
}

function typePattern(type: string): string | undefined {
  if (type === "") {return ".+?";}
  if (type === "w") {return "[\\p{L}\\p{N}_]+";}
  if (type === "d") {return "[-+ ]?[-+ ]?[0-9]+|[-+ ]?0[xX][0-9a-fA-F]+|[-+ ]?0[bB][01]+|[-+ ]?0[oO][0-7]+";}
  if (type === "f") {return "[-+ ]?(?:\\d*\\.\\d+|nan|NAN|inf|INF)";}
  return undefined;
}

function regexMatcher(pattern: string, framework: StepFramework): ((text: string) => boolean) | undefined {
  const anchored = pattern.startsWith("^") || pattern.endsWith("$");
  if ((framework === "behave" && anchored) || /\\(?!d)|\(\?(?!P<)|\||\^|\$/u.test(framework === "pytest" ? pattern.replace(/^\^|\$$/gu, "") : pattern)) {return undefined;}
  const body = framework === "pytest" ? pattern.replace(/^\^|\$$/gu, "") : pattern;
  return fullMatcher(`^(?:${body.replace(/\(\?P</gu, "(?<")})$`, false);
}

function fullMatcher(source: string, ignoreCase: boolean): ((text: string) => boolean) | undefined {
  try {const regex = new RegExp(source, ignoreCase ? "iu" : "u"); return (text) => regex.exec(text)?.[0] === text;} catch {return undefined;}
}
function escapeRegex(value: string): string {return value.replace(/[.*+?^$|()\\[\]{}]/gu, "\\$&");}

function maskTripleStrings(lines: readonly string[]): string[] {
  let delimiter: string | undefined;
  return lines.map((line) => {
    const visible = withoutComment(line);
    if (delimiter) {if (countDelimiter(line, delimiter) % 2 === 1) {delimiter = undefined;} return "";}
    const token = tripleDelimiter(visible);
    if (!token) {return line;}
    if (countDelimiter(visible, token) % 2 === 1) {delimiter = token;}
    return "";
  });
}
function tripleDelimiter(line: string): string | undefined {
  let quote: string | undefined; let escaped = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index] ?? "";
    if (quote) {if (escaped) {escaped = false;} else if (character === "\\") {escaped = true;} else if (character === quote) {quote = undefined;}}
    else if ((character === "'" || character === '"') && line.substring(index, index + 3) === character.repeat(3)) {return character.repeat(3);}
    else if (character === "'" || character === '"') {quote = character;}
  }
  return undefined;
}
function withoutComment(line: string): string {
  let quote: string | undefined; let escaped = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index] ?? "";
    if (quote) {if (escaped) {escaped = false;} else if (character === "\\") {escaped = true;} else if (character === quote) {quote = undefined;}}
    else if (character === "'" || character === '"') {quote = character;} else if (character === "#") {return line.substring(0, index);}
  }
  return line;
}
function countDelimiter(line: string, delimiter: string): number {
  let count = 0;
  for (let index = 0; index <= line.length - delimiter.length; index++) {
    if (line.substring(index, index + delimiter.length) === delimiter && (index === 0 || line[index - 1] !== "\\")) {count++; index += delimiter.length - 1;}
  }
  return count;
}
