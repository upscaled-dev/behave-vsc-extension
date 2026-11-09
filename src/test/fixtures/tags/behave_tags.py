import json
from pathlib import Path
from behave import given


@given('tag scope setup "{scope}"')
def setup_scope(context, scope):
    if scope == "feature":
        context.tag_scopes = []
    context.tag_scopes.append(scope)


@given('I record tag scope "{entry}"')
def record_scope(context, entry):
    with Path("tag-ledger.jsonl").open("a") as ledger:
        ledger.write(json.dumps({"entry": entry, "tags": sorted("@" + tag for tag in set(context.tags)),
                                 "setup": context.tag_scopes}) + "\n")
    assert not (entry in ("left-one", "red-right") and Path("fail-tag").exists()), "tag scope failure"
