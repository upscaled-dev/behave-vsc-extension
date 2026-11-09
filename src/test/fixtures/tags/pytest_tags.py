import json
from pathlib import Path
from pytest_bdd import given, parsers, scenarios

scenarios("../features/tags.feature")


@given(parsers.parse('tag scope setup "{scope}"'))
def setup_scope(request, scope):
    if scope == "feature":
        request.node.tag_scopes = []
    request.node.tag_scopes.append(scope)


@given(parsers.parse('I record tag scope "{entry}"'))
def record_scope(request, entry):
    tags = {"@" + marker.name for marker in request.node.iter_markers() if marker.name.startswith("tag_")}
    with Path("tag-ledger.jsonl").open("a") as ledger:
        ledger.write(json.dumps({"entry": entry, "tags": sorted(tags), "setup": request.node.tag_scopes}) + "\n")
    assert not (entry in ("left-one", "red-right") and Path("fail-tag").exists()), "tag scope failure"
