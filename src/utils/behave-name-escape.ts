/**
 * Behave's `--name` argument is matched as a regular expression (re.search), so
 * a scenario name containing regex metacharacters (e.g. "Add item (special)" or
 * "Price is $5") would otherwise match nothing or raise a regex error. Escape
 * the name so it matches literally.
 */
export function escapeBehaveNameRegex(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Escape a scenario name for embedding inside a double-quoted shell argument
 * (`--name="..."`). On top of the regex escaping, embedded double quotes are
 * escaped so they cannot terminate the argument; the regex backslash-escapes
 * also neutralize shell interpolation of `$` and backticks.
 */
export function escapeBehaveNameArg(name: string): string {
  return escapeBehaveNameRegex(name).replace(/"/g, '\\"');
}
