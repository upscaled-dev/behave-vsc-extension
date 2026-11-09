from pathlib import Path
from behave import given, then


def record(entry, context):
    with Path("french-ledger.txt").open("a") as ledger:
        ledger.write(f"{entry}:{context.french_setup}\n")


@given("une préparation française")
def prepare(context):
    context.french_setup = "préparé"


@given('je commence "{entry}"')
def begin(context, entry):
    context.french_entry = entry


@then('j\'enregistre "{entry}"')
def finish(context, entry):
    assert context.french_entry == entry
    record(entry, context)
