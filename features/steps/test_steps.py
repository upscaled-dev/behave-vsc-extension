from behave import given, when, then

@given('I am on the test page')
def step_impl(context):
    """Step that always passes"""
    pass

@when('I click the test button')
def step_impl(context):
    """Step that always passes"""
    pass

@then('I should see the test result')
def step_impl(context):
    """Step that always passes"""
    pass

@then('I should see a failing result')
def step_impl(context):
    """Step that always passes"""
    pass

@then('this step will fail because it is not implemented')
def step_impl(context):
    """Step that always fails - this is intentional for testing"""
    assert False, "This step is intentionally failing to test the extension"

@given('I have a "{input}" value')
def step_impl(context, input):
    """Step for scenario outline that always passes"""
    context.input = input

@when('I process the input')
def step_impl(context):
    """Step for scenario outline that always passes"""
    pass

@then('I should get "{expected}" result')
def step_impl(context, expected):
    """Step for scenario outline that passes for most cases but fails for 'fail' input"""
    if context.input == 'fail':
        assert False, f"Intentionally failing for input '{context.input}'"
    assert context.input is not None
