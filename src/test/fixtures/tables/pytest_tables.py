import json
from pathlib import Path
from pytest_bdd import given, parsers, scenarios

scenarios("../features/tables.feature")


@given(parsers.parse('I receive table setup "{scope}":'), target_fixture="table_setups")
def receive_table_setup(request, scope, datatable):
    if scope == "feature":
        request.node.table_setups = []
    request.node.table_setups.append({"scope": scope, "table": datatable})
    return request.node.table_setups


@given(parsers.parse('I retain table setup "{scope}"'), target_fixture="table_setups")
def retain_table_setup(request, scope):
    request.node.table_setups.append({"continued": scope})
    return request.node.table_setups


@given(parsers.parse('I record table "{entry}"'))
def record_table(request, entry):
    with Path("table-ledger.jsonl").open("a") as ledger:
        ledger.write(json.dumps({"entry": entry, "setup": request.node.table_setups}) + "\n")
