import json
from pathlib import Path
from behave import given


def record(entry, setup, payload):
    with Path("english-alias-ledger.jsonl").open("a") as ledger:
        ledger.write(json.dumps({"entry": entry, "setup": setup, "payload": payload}) + "\n")


@given("I prepare English setup")
def prepare_setup(context):
    context.english_setup = [context.text]


@given("I continue English setup")
def continue_setup(context):
    context.english_setup.append("continued")


@given('I begin English "{entry}"')
def begin(context, entry):
    context.english_payload = context.text


@given('I record English "{entry}"')
def finish(context, entry):
    assert not (entry == "example-wildcard" and Path("fail-english-alias").exists()), "requested alias retry failure"
    record(entry, context.english_setup, context.english_payload)
