import json
from pathlib import Path
from behave import given, use_step_matcher

use_step_matcher("re")


@given(r'column values "(?P<first>[^"]*)" "(?P<middle>[^"]*)" "(?P<last>[^"]*)"')
def record_columns(context, first, middle, last):
    with Path("ledger.txt").open("a") as ledger:
        ledger.write(json.dumps([first, middle, last]) + "\n")


use_step_matcher("parse")
