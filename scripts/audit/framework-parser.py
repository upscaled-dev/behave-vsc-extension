"""Observe installed framework models; disagreements are evidence, not test failures."""
import json
import pathlib
import sys
from importlib.metadata import version

from behave.parser import parse_file
from pytest_bdd.parser import FeatureParser


def tags(values):
    return sorted(str(value).lstrip("@") for value in values)


def observe_behave(filename):
    feature = parse_file(str(filename))
    result = []
    for template in feature.walk_scenarios():
        for scenario in getattr(template, "scenarios", [template]):
            result.append({
                "name": scenario.name, "line": scenario.line,
                "tags": tags(scenario.effective_tags),
                "steps": [step.keyword.strip() + " " + step.name for step in scenario.steps],
                "backgroundSteps": [step.keyword.strip() + " " + step.name
                                    for step in (scenario.background_steps or [])],
            })
    return result


def observe_pytest(filename):
    feature = FeatureParser(str(filename.parent), filename.name).parse()
    # These are model scopes, not pytest collection marks or execution results.
    return [{
        "name": scenario.name, "line": scenario.line_number,
        "featureTags": tags(feature.tags), "tags": tags(scenario.tags),
        "ruleTags": tags(scenario.rule.tags) if scenario.rule else [],
        "steps": [step.keyword.strip() + " " + step.name for step in scenario._steps],
        "backgroundSteps": [step.keyword.strip() + " " + step.name
                            for step in scenario.all_background_steps],
        "examples": [{"line": example.line_number, "name": example.name,
                      "tags": tags(example.tags), "rows": example.examples}
                     for example in scenario.examples],
    } for scenario in feature.scenarios.values()]


result = {"versions": {name: version(name) for name in ("behave", "pytest", "pytest-bdd")},
          "python": sys.version, "fixtures": {}}
for filename in sorted((pathlib.Path(sys.argv[1]) / "semantics").glob("*.feature")):
    observed = {}
    for framework, reader in (("behave", observe_behave), ("pytest-bdd", observe_pytest)):
        try:
            observed[framework] = {"scenarios": reader(filename)}
        except Exception as error:
            observed[framework] = {"error": type(error).__name__ + ": " + str(error)}
    result["fixtures"][filename.stem] = observed
expected = json.loads(pathlib.Path(__file__).with_name("parser-fixtures.json").read_text())
assert set(result["fixtures"]) == set(expected), "Missing audit fixtures"
for framework in ("behave", "pytest-bdd"):
    assert len(result["fixtures"]["feature-tags"][framework]["scenarios"]) == 2, "Invalid framework probe"
print(json.dumps(result, indent=2, ensure_ascii=False))
