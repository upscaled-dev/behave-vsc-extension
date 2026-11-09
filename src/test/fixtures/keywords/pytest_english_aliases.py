import json
from pathlib import Path
from pytest_bdd import given, parsers, scenarios

scenarios("../features/english-aliases.feature")


def record(entry, setup, payload):
    with Path("english-alias-ledger.jsonl").open("a") as ledger:
        ledger.write(json.dumps({"entry": entry, "setup": setup, "payload": payload}) + "\n")


@given("I prepare English setup", target_fixture="english_setup")
def prepare_setup(docstring):
    return [docstring]


@given("I continue English setup")
def continue_setup(english_setup):
    english_setup.append("continued")


@given(parsers.parse('I begin English "{entry}"'), target_fixture="english_payload")
def begin(entry, docstring=None):
    return docstring


@given(parsers.parse('I record English "{entry}"'))
def finish(entry, english_setup, english_payload):
    assert not (entry == "example-wildcard" and Path("fail-english-alias").exists()), "requested alias retry failure"
    record(entry, english_setup, english_payload)
