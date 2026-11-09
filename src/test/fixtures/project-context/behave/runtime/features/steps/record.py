from pathlib import Path
from behave import given


@given("I record my project")
def record(context):
    with Path("ledger.txt").open("a") as ledger:
        ledger.write(str(Path.cwd()) + "\n")
