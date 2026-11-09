import json
from pathlib import Path
from pytest_bdd import given, parsers, scenarios

scenarios("../features/columns.feature")


@given(parsers.re(r'column values "(?P<first>[^"]*)" "(?P<middle>[^"]*)" "(?P<last>[^"]*)"'))
def record_columns(first, middle, last):
    with Path("ledger.txt").open("a") as ledger:
        ledger.write(json.dumps([first, middle, last]) + "\n")
