from pathlib import Path
from pytest_bdd import given, parsers, scenarios

scenarios("../features/containers.feature")


@given(parsers.parse('I record container "{entry}"'))
def record_container(entry):
    with Path("ledger.txt").open("a") as ledger:
        ledger.write(entry + "\n")
    assert not (entry == "b-one" and Path("fail-container").exists()), "container failure"
