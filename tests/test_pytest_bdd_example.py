import pytest
from pytest_bdd import given, when, then, scenario, parsers
from pathlib import Path

# Define the feature file path
feature_file = Path(__file__).parent / "features" / "pytest_bdd_example.feature"

# Create a context fixture that pytest-bdd will use
@pytest.fixture
def context():
    """Context fixture for sharing data between steps"""
    return {}

# Basic scenarios
@scenario(feature_file, "Basic login functionality")
def test_basic_login():
    pass

@scenario(feature_file, "Login with invalid credentials")
def test_invalid_login():
    pass

@scenario(feature_file, "User registration")
def test_user_registration():
    pass

# Scenario outlines
@scenario(feature_file, "Login with different user types")
def test_login_different_user_types():
    pass

@scenario(feature_file, "Form validation for registration")
def test_form_validation_registration():
    pass

@scenario(feature_file, "Concurrent user login simulation")
def test_concurrent_user_login():
    pass

@scenario(feature_file, "Security validation for login attempts")
def test_security_validation_login():
    pass

# Given steps
@given("I am on the login page")
def i_am_on_login_page(context):
    context["page"] = "login"

@given("I am on the registration page")
def i_am_on_registration_page(context):
    context["page"] = "registration"

@given("I have valid credentials")
def i_have_valid_credentials(context):
    context["username"] = "testuser"
    context["password"] = "testpass"

@given("I have invalid credentials")
def i_have_invalid_credentials(context):
    context["username"] = "invalid"
    context["password"] = "wrong"

@given(parsers.parse("I have {user_type} credentials"))
def i_have_user_type_credentials(user_type, context):
    context["user_type"] = user_type

@given("I have valid credentials")
def i_have_valid_credentials_for_concurrent(context):
    context["credentials"] = "valid"

# When steps
@when(parsers.parse("I enter {username} as username"))
def i_enter_username(username, context):
    context["username"] = username

@when(parsers.parse("I enter {password} as password"))
def i_enter_password(password, context):
    context["password"] = password

@when(parsers.parse("I enter {email} as email"))
def i_enter_email(email, context):
    context["email"] = email

@when("I click the login button")
def i_click_login_button(context):
    context["action"] = "login_clicked"

@when("I click the register button")
def i_click_register_button(context):
    context["action"] = "register_clicked"

@when(parsers.parse("{concurrent_users:d} users try to login simultaneously"))
def concurrent_users_login(concurrent_users, context):
    context["concurrent_users"] = concurrent_users

@when(parsers.parse("I attempt to login with {input_type} input"))
def attempt_login_with_input_type(input_type, context):
    context["input_type"] = input_type

# Then steps
@then("I should be logged in successfully")
def i_should_be_logged_in(context):
    assert context.get("action") == "login_clicked"
    # Handle quoted strings from feature file
    username = context.get("username", "").strip('"')
    password = context.get("password", "").strip('"')
    assert username == "testuser"
    assert password == "testpass"

@then("I should see an error message")
def i_should_see_error_message(context):
    assert context.get("action") == "login_clicked"
    username = context.get("username", "").strip('"')
    password = context.get("password", "").strip('"')
    assert username == "invalid"
    assert password == "wrong"

@then("I should be registered successfully")
def i_should_be_registered(context):
    assert context.get("action") == "register_clicked"
    username = context.get("username", "").strip('"')
    password = context.get("password", "").strip('"')
    assert username == "newuser"
    assert password == "newpass"

@then(parsers.parse("I should see {expected_message}"))
def i_should_see_message(expected_message, context):
    # This step handles various expected messages for different scenarios
    if expected_message == "Welcome Administrator":
        assert context.get("user_type") == "admin"
    elif expected_message == "Welcome User":
        assert context.get("user_type") == "regular"
    elif expected_message == '"Welcome Guest"':
        assert context.get("user_type") == "guest"
    elif expected_message == "Login successful":
        assert context.get("concurrent_users") is not None
    elif expected_message == "Invalid login attempt":
        assert context.get("input_type") == "sql_inject"
    elif expected_message == "Invalid characters detected":
        assert context.get("input_type") == "xss"
    elif expected_message == "Login successful":
        assert context.get("input_type") == "normal"
    elif expected_message == "Too many failed attempts":
        assert context.get("input_type") == "brute_force"
    elif expected_message == "Username is required":
        assert context.get("username") == ""
    elif expected_message == "Password is required":
        assert context.get("password") == ""
    elif expected_message == "Email is required":
        assert context.get("email") == ""
    elif expected_message == "Please enter a valid email":
        assert context.get("email") == "invalid-email"
    elif expected_message == "Username must be 3+ chars":
        assert len(context.get("username", "")) < 3
    elif expected_message == "Password must be 6+ chars":
        assert len(context.get("password", "")) < 6

@then(parsers.parse("the response time should be less than {max_response_time} seconds"))
def response_time_should_be_less_than(max_response_time, context):
    # Simulate response time check
    import time
    time.sleep(0.1)  # Simulate some processing time
    assert float(max_response_time) > 0.1

@then(parsers.parse("the account should be {account_status}"))
def account_should_be_status(account_status, context):
    if account_status == "locked":
        assert context.get("input_type") in ["sql_inject", "brute_force"]
    elif account_status == "active":
        assert context.get("input_type") in ["xss", "normal"] 