from pathlib import Path
from pytest_bdd import given, parsers, scenarios, then

scenarios("../features/french.feature")


def record(entry, french_setup):
    with Path("french-ledger.txt").open("a") as ledger:
        ledger.write(f"{entry}:{french_setup}\n")


@given("une préparation française", target_fixture="french_setup")
def prepare():
    return "préparé"


@given(parsers.parse('je commence "{entry}"'), target_fixture="french_entry")
def begin(entry):
    return entry


@then(parsers.parse('j\'enregistre "{entry}"'))
def finish(entry, french_entry, french_setup):
    assert french_entry == entry
    record(entry, french_setup)
