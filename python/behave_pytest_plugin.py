"""Select collected pytest-bdd items by Gherkin source location."""
import importlib
import json
import os

import pytest

FEATURE_LIMIT = 16 * 1024 * 1024
REPORT_LIMIT = 16 * 1024 * 1024
DETAIL_LIMIT = 1024 * 1024
NODE_LIMIT = 10000
PRIORITY = {"passed": 0, "skipped": 1, "failed": 2, "errored": 3}


def pytest_addoption(parser):
    group = parser.getgroup("behave-test-runner")
    for name in ("project-root", "feature", "name", "report"):
        group.addoption("--btr-" + name, default="")
    group.addoption("--btr-line", type=int, default=0)


def _template(item):
    function = getattr(item, "obj", None)
    function = getattr(function, "__func__", function)
    template = getattr(function, "__scenario__", None)
    if template is None:
        module = importlib.import_module("pytest_bdd.scenario")
        registry = getattr(module, "scenario_wrapper_template_registry", None)
        if registry is not None and function is not None:
            template = registry.get(function)
    if template is None and "_pytest_bdd_example" in getattr(item, "fixturenames", ()):
        raise pytest.UsageError("Unsupported pytest-bdd scenario metadata. Use a supported pytest-bdd 8.x or 9.x runtime.")
    if template is not None and (not isinstance(getattr(template, "line_number", None), int)
                                 or not isinstance(getattr(template, "name", None), str)
                                 or not getattr(getattr(template, "feature", None), "filename", None)):
        raise pytest.UsageError("Unsupported pytest-bdd scenario metadata. Check the installed pytest-bdd version.")
    return template


def _scenarios(children):
    for child in children:
        if child.scenario is not None:
            yield child.scenario
        if child.rule is not None:
            yield from _scenarios(child.rule.children)


def _row_ordinal(item):
    callspec = getattr(item, "callspec", None)
    context = callspec.params.get("_pytest_bdd_example") if callspec else None
    matches = []
    for marker in item.iter_markers("parametrize"):
        if marker.args and marker.args[0] == "_pytest_bdd_example":
            for index, parameter in enumerate(marker.args[1]):
                if parameter.values[0] is context:
                    matches.append(index)
    if len(matches) != 1:
        raise pytest.UsageError("Cannot identify this pytest-bdd Examples row from its collected parameter metadata.")
    return matches[0]


def _real(path):
    return os.path.normcase(os.path.realpath(path))


class CollectionRun:
    def __init__(self, config):
        self.config = config
        self.root = os.path.abspath(config.getoption("btr_project_root"))
        self.real_root = _real(self.root)
        self.feature = config.getoption("btr_feature")
        self.line = config.getoption("btr_line")
        self.name = config.getoption("btr_name")
        self.report = config.getoption("btr_report")
        self.scenarios = {}
        self.records = {}
        self.selected = {}
        self.phases = {}
        self.detail_remaining = DETAIL_LIMIT

    def source_scenarios(self, filename):
        feature = _real(filename)
        if feature not in self.scenarios:
            from gherkin.parser import Parser
            from pytest_bdd.gherkin_parser import GherkinDocument
            with open(filename, "rb") as stream:
                source = stream.read(FEATURE_LIMIT + 1)
            if len(source) > FEATURE_LIMIT:
                raise pytest.UsageError("The feature exceeds the 16 MiB collection mapping limit.")
            document = GherkinDocument.from_dict(Parser().parse(source.decode("utf-8-sig")))
            self.scenarios[feature] = {
                scenario.location.line: (scenario.name, [entry.location.line for examples in scenario.examples
                                                         for entry in (examples.table_body or [])])
                for scenario in _scenarios(document.feature.children)
            }
        return self.scenarios[feature]

    def location(self, item, template):
        real_feature = _real(template.feature.filename)
        if os.path.commonpath([self.real_root, real_feature]) != self.real_root:
            raise pytest.UsageError("A collected pytest-bdd feature is outside the admitted project folder.")
        feature = os.path.join(self.root, os.path.relpath(real_feature, self.real_root))
        line = template.line_number
        row = line
        if template.templated:
            rows = self.source_scenarios(template.feature.filename).get(line, ("", []))[1]
            ordinal = _row_ordinal(item)
            if ordinal >= len(rows):
                raise pytest.UsageError("Collected pytest-bdd Examples metadata does not match the feature source. Refresh tests and retry.")
            row = rows[ordinal]
        return {"featurePath": feature, "scenarioLine": line, "lineNumber": row,
                "nodeId": item.nodeid, "status": "errored", "detail": ""}

    def prepare(self, items):
        for item in items:
            template = _template(item)
            if template is None:
                continue
            if len(self.records) >= NODE_LIMIT:
                raise pytest.UsageError("pytest-bdd collection exceeds the 10,000 mapped node limit.")
            if item.nodeid in self.records:
                raise pytest.UsageError("Duplicate collected pytest node identity. Remove duplicate collection arguments.")
            record = self.location(item, template)
            self.records[item.nodeid] = record
            if not self.feature or _real(record["featurePath"]) == _real(self.feature):
                if self.line:
                    matches = self.line in (record["scenarioLine"], record["lineNumber"])
                else:
                    matches = not self.name or template.name == self.name
                if matches:
                    self.selected[item.nodeid] = record
        if self.feature and not self.selected:
            raise pytest.UsageError("No collected pytest-bdd binding matches the selected feature/scenario/row. Check pytest collection configuration and refresh tests.")
        if self.feature and self.name and not self.line:
            locations = {(entry["featurePath"], entry["scenarioLine"]) for entry in self.selected.values()}
            declarations = [name for name, _ in self.source_scenarios(self.feature).values() if name == self.name]
            if len(locations) != 1 or len(declarations) != 1:
                raise pytest.UsageError("The selected scenario name is ambiguous. Select it by source line.")

    def select(self, items):
        if self.feature:
            removed = [item for item in items if item.nodeid not in self.selected]
            items[:] = [item for item in items if item.nodeid in self.selected]
            if removed:
                self.config.hook.pytest_deselected(items=removed)
        active = {item.nodeid for item in items}
        for node, entry in self.selected.items():
            if node not in active or self.config.option.collectonly:
                entry.update(status="skipped", detail="")

    def observe(self, item, report):
        entry = self.selected.get(item.nodeid)
        if entry is None:
            return
        status = None
        if report.failed:
            status = "failed" if report.when == "call" else "errored"
        elif report.skipped:
            status = "skipped"
        elif report.when == "call":
            status = "passed"
        if status is not None:
            previous = self.phases.get(item.nodeid)
            if previous is None or PRIORITY[status] > PRIORITY[previous]:
                self.phases[item.nodeid] = status
                entry.update(status=status, detail="")
        if (report.failed or report.skipped) and self.detail_remaining:
            text = (report.when + ": " + str(report.longrepr))[:self.detail_remaining]
            encoded = text.encode("utf-8")[:self.detail_remaining]
            detail = encoded.decode("utf-8", errors="ignore")
            self.detail_remaining -= len(detail.encode("utf-8"))
            entry["detail"] += detail

    def write(self):
        if not self.report:
            return
        size = 0
        with open(self.report, "w", encoding="utf-8") as stream:
            for chunk in json.JSONEncoder(ensure_ascii=False).iterencode(list(self.selected.values())):
                size += len(chunk.encode("utf-8"))
                if size > REPORT_LIMIT:
                    raise pytest.UsageError("pytest-bdd report exceeds the 16 MiB limit.")
                stream.write(chunk)


def pytest_configure(config):
    if getattr(config.option, "numprocesses", None) or hasattr(config, "workerinput"):
        raise pytest.UsageError("Behave Test Runner does not support distributed pytest execution. Remove the worker option.")
    config._behave_collection_run = CollectionRun(config)


def pytest_sessionstart(session):
    run = session.config._behave_collection_run
    if run.feature:
        # Configuration has already been discovered from cwd. Only widen collection now.
        session.config.args = [run.root]


@pytest.hookimpl(hookwrapper=True, tryfirst=True)
def pytest_collection_modifyitems(config, items):
    run = config._behave_collection_run
    run.prepare(items)
    yield
    run.select(items)


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item):
    outcome = yield
    item.config._behave_collection_run.observe(item, outcome.get_result())


def pytest_sessionfinish(session):
    session.config._behave_collection_run.write()
