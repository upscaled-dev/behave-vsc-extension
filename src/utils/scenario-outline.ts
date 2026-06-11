/**
 * Helpers for scenario-outline example labels.
 *
 * The feature parser names each generated example
 * `"<index>: <outline name> - <values>"` (see FeatureParser). Every layer that
 * needs to recognise an example label or recover the outline name from one
 * must share these helpers — divergent local copies of this logic previously
 * caused run/debug paths to classify the same test differently.
 */

const EXAMPLE_LABEL_PATTERN = /^\d+:\s*.+\s*-\s*/;

/** Whether a scenario name is a parser-generated outline example label. */
export function isScenarioOutlineExampleName(scenarioName?: string): boolean {
  if (!scenarioName) {
    return false;
  }
  return EXAMPLE_LABEL_PATTERN.test(scenarioName);
}

/**
 * Recover the original outline name from an example label
 * (e.g. `"1: Login with different credentials - username: admin"` ->
 * `"Login with different credentials"`). Returns the input unchanged when it
 * is not an example label.
 */
export function extractOutlineName(scenarioName: string): string {
  const match = /^(\d+):\s*(.*?)\s*-\s*/.exec(scenarioName);
  const extracted = match?.[2]?.trim();
  if (!extracted) {
    return scenarioName;
  }
  return extracted;
}
