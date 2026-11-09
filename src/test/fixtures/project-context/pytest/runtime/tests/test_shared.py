from pathlib import Path
from pytest_bdd import given, scenarios

scenarios("../features/shared.feature")


@given("I record my project")
def record():
    with Path("ledger.txt").open("a") as ledger:
        ledger.write(str(Path.cwd()) + "\n")
