import json
from pathlib import Path
from behave import given, then


def record(entry, setup):
    entry["setup"] = setup
    with Path("ledger.txt").open("a") as ledger:
        ledger.write(json.dumps(entry) + "\n")


@given("a boundary setup payload")
def setup_payload(context):
    context.boundary_setup = [context.text]


@given("boundary setup continues")
def continue_setup(context):
    context.boundary_setup.append("continued")


@given("a boundary payload")
def payload(context):
    context.boundary_payload = context.text


@then("the boundary payload is intact")
def check_payload(context):
    assert "CORRUPTED" not in context.boundary_payload
    record({"kind": "payload", "text": context.boundary_payload}, context.boundary_setup)


@given('a boundary row "{value}"')
def row(context, value):
    context.boundary_row = (value, context.text)


@then('boundary row is "{value}"')
def check_row(context, value):
    assert context.boundary_row[0] == value
    record({"kind": "row", "value": value, "text": context.boundary_row[1]}, context.boundary_setup)


@given("a boundary following scenario")
def following(context):
    record({"kind": "following"}, context.boundary_setup)
