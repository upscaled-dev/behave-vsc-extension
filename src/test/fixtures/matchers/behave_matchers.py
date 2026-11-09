from pathlib import Path
from behave import given as setup, when as action, then as verify, use_step_matcher


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


use_step_matcher("parse")


@setup(
    "I have {count:d} things"
)
def count(context, count):
    record(f"parse:{count}")


use_step_matcher("cfparse")


@setup(
    "I have {value:w}"
)
def value(context, value):
    record(f"cfparse:{value}")


use_step_matcher("re")


@action(
    r"I select code (?P<code>\d+)"
)
def code(context, code):
    record(f"re:{code}")


use_step_matcher("parse")


@verify("I finish matchers")
def finish(context):
    record("done")


@verify("I typed count {count:d}")
def typed_count(context, count):
    record(f"typed:{count}")
