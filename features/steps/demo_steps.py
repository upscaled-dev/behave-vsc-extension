from behave import given, when, then

@given('I am on the demo page')
def step_impl(context):
    """User is on the demo page"""
    pass

@when('I perform a successful action')
def step_impl(context):
    """Perform a successful action"""
    pass

@then('I should see success')
def step_impl(context):
    """Should see success message"""
    pass

@when('I perform a failing action')
def step_impl(context):
    """Perform a failing action"""
    pass

@then('I should see a failure')
def step_impl(context):
    """Should see failure message"""
    pass

@then('this demo step will fail because it is not implemented')
def step_impl(context):
    """This step will fail because it's not implemented"""
    raise NotImplementedError("This step is intentionally not implemented to demonstrate failure output")
 