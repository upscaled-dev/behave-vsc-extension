from pathlib import Path
from behave import given


@given('I record container "{entry}"')
def record_container(context, entry):
    with Path("ledger.txt").open("a") as ledger:
        ledger.write(entry + "\n")
    assert not (entry == "b-one" and Path("fail-container").exists()), "container failure"
