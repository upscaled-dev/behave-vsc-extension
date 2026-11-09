from pathlib import Path
from pytest_bdd import given, parsers, scenarios

scenarios("../features/pyselection.feature")


@given(parsers.parse('I record "{entry}"'))
def record(entry):
    with Path("ledger.txt").open("a") as ledger:
        ledger.write(entry + "\n")
    print("recorded " + entry)
    assert not (entry == "pytest-outline-two" and Path("fail-outline").exists()), "requested outline failure"
