"""Step definitions for account-operations.feature.

Demonstrates the multi/named/tagged Examples + Background + Rule
features supported by the parser. Keep implementations minimal —
this is a runnable demo, not a real banking system.
"""

from behave import given, when, then


# --- Background steps (run before every scenario) -------------------------


@given('the bank is open')
def step_bank_is_open(context):
    context.bank_open = True


@given('the audit log is empty')
def step_audit_log_empty(context):
    context.audit_log = []


# --- Withdrawal scenarios -------------------------------------------------


@given('I have {balance:d} in my account')
def step_set_balance(context, balance):
    assert context.bank_open, "bank must be open before account operations"
    context.balance = balance


@when('I withdraw {amount:d}')
def step_withdraw(context, amount):
    context.balance -= amount
    context.audit_log.append(f"withdraw {amount}")


@when('I try to withdraw {amount:d}')
def step_try_withdraw(context, amount):
    context.last_error = None
    if amount < 0:
        context.last_error = "Invalid Amount"
    elif amount > context.balance:
        context.last_error = "Insufficient Funds"
    else:
        # Would succeed — record it
        context.balance -= amount
        context.audit_log.append(f"withdraw {amount}")


@then('my new balance should be {new_balance:d}')
def step_check_balance(context, new_balance):
    assert context.balance == new_balance, (
        f"expected balance {new_balance}, got {context.balance}"
    )


@then('I should see an error: "{error}"')
def step_check_error(context, error):
    assert context.last_error == error, (
        f"expected error '{error}', got '{context.last_error}'"
    )
