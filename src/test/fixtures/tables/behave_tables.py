import json
from pathlib import Path
from behave import given


@given('I receive table setup "{scope}"')
@given('I receive table setup "{scope}":')
def receive_table_setup(context, scope):
    context.table_setups = getattr(context, "table_setups", [])
    context.table_setups.append({"scope": scope, "table": [context.table.headings] + [row.cells for row in context.table]})


@given('I retain table setup "{scope}"')
def retain_table_setup(context, scope):
    context.table_setups.append({"continued": scope})


@given('I record table "{entry}"')
def record_table(context, entry):
    with Path("table-ledger.jsonl").open("a") as ledger:
        ledger.write(json.dumps({"entry": entry, "setup": context.table_setups}) + "\n")
