import json
from pathlib import Path
from pytest_bdd import given, then, parsers, scenarios

scenarios("../features/boundaries.feature")


def record(entry, setup):
    entry["setup"] = setup
    with Path("ledger.txt").open("a") as ledger:
        ledger.write(json.dumps(entry) + "\n")


@given("a boundary setup payload", target_fixture="boundary_setup")
def setup_payload(docstring):
    return [docstring]


@given("boundary setup continues")
def continue_setup(boundary_setup):
    boundary_setup.append("continued")


@given("a boundary payload", target_fixture="boundary_payload")
def payload(docstring):
    return docstring


@then("the boundary payload is intact")
def check_payload(boundary_payload, boundary_setup):
    assert "CORRUPTED" not in boundary_payload
    record({"kind": "payload", "text": boundary_payload}, boundary_setup)


@given(parsers.parse('a boundary row "{value}"'), target_fixture="boundary_row")
def row(value, docstring):
    return value, docstring


@then(parsers.parse('boundary row is "{value}"'))
def check_row(value, boundary_row, boundary_setup):
    assert boundary_row[0] == value
    record({"kind": "row", "value": value, "text": boundary_row[1]}, boundary_setup)


@given("a boundary following scenario")
def following(boundary_setup):
    record({"kind": "following"}, boundary_setup)
