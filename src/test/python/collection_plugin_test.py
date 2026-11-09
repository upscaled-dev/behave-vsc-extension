"""Bounded fault checks for the shipped plugin; run with either supported runtime."""
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "python"))
import behave_pytest_plugin as plugin
import pytest


class PluginBoundaries(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="behave-plugin-bounds-")
        self.root = Path(self.directory.name)
        self.feature = self.root / "source.feature"
        options = {"btr_project_root": str(self.root), "btr_feature": "", "btr_line": 0,
                   "btr_name": "", "btr_report": str(self.root / "report.json")}
        self.run = plugin.CollectionRun(SimpleNamespace(getoption=options.__getitem__))

    def tearDown(self):
        self.directory.cleanup()

    def item(self, index=0):
        template = SimpleNamespace(feature=SimpleNamespace(filename=str(self.feature)), line_number=2,
                                   name="Source scenario", templated=False)
        function = lambda: None
        function.__scenario__ = template
        return SimpleNamespace(obj=function, nodeid="binding::test_" + str(index), fixturenames=[])

    def test_node_limit_prevents_unbounded_mapping(self):
        self.assertEqual(plugin.NODE_LIMIT, 10000)
        with self.assertRaisesRegex(pytest.UsageError, "10,000"):
            self.run.prepare([self.item(index) for index in range(10001)])

    def test_feature_reads_stop_at_16_mib(self):
        self.feature.write_bytes(b"x" * (plugin.FEATURE_LIMIT + 1))
        item = self.item()
        item.obj.__scenario__.templated = True
        with self.assertRaisesRegex(pytest.UsageError, "16 MiB"):
            self.run.location(item, item.obj.__scenario__)

    def test_all_failure_details_share_one_utf8_budget(self):
        items = [self.item(0), self.item(1)]
        self.run.prepare(items)
        for item in items:
            self.run.observe(item, SimpleNamespace(failed=True, skipped=False, when="call", longrepr="😀" * plugin.DETAIL_LIMIT))
        self.assertLessEqual(sum(len(record["detail"].encode("utf-8")) for record in self.run.selected.values()), plugin.DETAIL_LIMIT)
        self.run.write()
        self.assertEqual(len(json.loads((self.root / "report.json").read_text())), 2)

    def test_report_write_rejects_oversized_node_identity(self):
        self.run.selected = {"one": {"nodeId": "x" * (plugin.REPORT_LIMIT + 1)}}
        with self.assertRaisesRegex(pytest.UsageError, "16 MiB"):
            self.run.write()
        self.assertLessEqual((self.root / "report.json").stat().st_size, plugin.REPORT_LIMIT)

    def test_distributed_configuration_is_rejected(self):
        with self.assertRaisesRegex(pytest.UsageError, "distributed"):
            plugin.pytest_configure(SimpleNamespace(option=SimpleNamespace(numprocesses=2)))

    def test_missing_runtime_outcome_stays_errored(self):
        self.run.prepare([self.item()])
        self.run.write()
        self.assertEqual(json.loads((self.root / "report.json").read_text())[0]["status"], "errored")


if __name__ == "__main__":
    unittest.main()
