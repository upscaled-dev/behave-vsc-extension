from pathlib import Path
from pytest_bdd import given as setup, when as action, then as verify, parsers as p, scenarios

scenarios("../features/matchers.feature")


def record(value):
    with Path("matcher-ledger.txt").open("a") as ledger:
        ledger.write(value + "\n")


async def local_async():
    setup = None
    return setup


def local_multiline(
):
    action = None
    verify = None
    return action, verify


@setup(
    p.parse("I have {count:d} things")
)
def count(count):
    record(f"parse:{count}")


@setup(
    p.cfparse("I have {value:w}")
)
def value(value):
    record(f"cfparse:{value}")


@action(
    p.re(r"I select code (?P<code>\d+)")
)
def code(code):
    record(f"re:{code}")


@verify("I finish matchers")
def finish():
    record("done")


@verify("I typed count {count:d}")
def typed_count():
    record("literal")
