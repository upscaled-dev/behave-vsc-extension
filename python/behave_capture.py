"""Keep native formatter destinations separate from Test Explorer's JSON report."""

import sys

from behave.formatter._registry import select_formatter_class
from behave.formatter.base import Formatter, StreamOpener
from behave.formatter.json import JSONFormatter

# Resolve during Behave's formatter validation, before it resets runtime registries.
# In particular, steps must bind the same step registry as the native runner.
VISIBLE_FORMATTERS = {
    name: select_formatter_class(name)
    for name in ("pretty", "plain", "json", "progress", "steps")
}


class ReportFormatter(JSONFormatter):
    def background(self, background):
        # A Rule Background replaces the current JSON element before the next
        # scenario callback can finalize the preceding scenario's status.
        self.finish_current_scenario()
        self.current_scenario = None
        super(ReportFormatter, self).background(background)


class CaptureFormatter(Formatter):
    name = "btr-capture"
    description = "Selected output and an independent Test Explorer report"

    def __init__(self, stream_opener, config):
        super(CaptureFormatter, self).__init__(stream_opener, config)
        visible = VISIBLE_FORMATTERS[config.userdata["btr_format"]]
        self.formatters = [visible(stream_opener, config)]
        if stream_opener.name:
            # Keep native files while also publishing the selected format to VS Code.
            self.formatters.append(visible(StreamOpener(stream=sys.stdout), config))
        self.formatters.append(ReportFormatter(StreamOpener(config.userdata["btr_report"]), config))

    def _dispatch(self, method, *args):
        for formatter in self.formatters:
            callback = getattr(formatter, method, None)
            if callback is not None:
                callback(*args)

    def uri(self, uri):
        self._dispatch("uri", uri)

    def feature(self, feature):
        self._dispatch("feature", feature)

    def rule(self, rule):
        self._dispatch("rule", rule)

    def background(self, background):
        self._dispatch("background", background)

    def scenario(self, scenario):
        self._dispatch("scenario", scenario)

    def step(self, step):
        self._dispatch("step", step)

    def match(self, match):
        self._dispatch("match", match)

    def result(self, step):
        self._dispatch("result", step)

    def embedding(self, mime_type, data):
        self._dispatch("embedding", mime_type, data)

    def eof(self):
        self._dispatch("eof")

    def close(self):
        self._dispatch("close")
