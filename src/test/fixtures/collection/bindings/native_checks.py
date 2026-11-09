from pathlib import Path


def test_native_pytest_is_retained():
    with Path("native-ledger.txt").open("a") as ledger:
        ledger.write("native\n")
