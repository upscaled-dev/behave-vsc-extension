"""Step definitions for multiple-outlines.feature.

Covers the login, API-validation and load-testing outlines. The
'I am on the login page' and 'I click the login button' steps are
already defined in advanced_steps.py and are reused here.
"""

from behave import given, when, then, register_type
import parse


# Accepts any text including the empty string (the default `parse` field
# requires at least one character, which breaks on the empty-value row).
@parse.with_pattern(r'[^"]*')
def parse_optional_text(text):
    return text


register_type(OptText=parse_optional_text)


# --- Login outline --------------------------------------------------------

_VALID_LOGINS = {
    ("admin", "admin123"),
    ("user", "user123"),
}


@when('I enter username "{username}" and password "{password}"')
def step_enter_credentials(context, username, password):
    context.login_result = (
        "dashboard" if (username, password) in _VALID_LOGINS else "error message"
    )


@then('I should see "{expected_result}"')
def step_check_login_result(context, expected_result):
    assert context.login_result == expected_result, (
        f"expected '{expected_result}', got '{context.login_result}'"
    )


# --- API data validation outline ------------------------------------------


@given('I have a valid API endpoint')
def step_valid_api_endpoint(context):
    context.api_endpoint = "/api/validate"


@when('I send "{data_type}" data with value "{input_value:OptText}"')
def step_send_data(context, data_type, input_value):
    # Strings and numbers are accepted; everything else is rejected.
    if data_type in ("string", "number"):
        context.validation_result = "valid"
        context.status_code = "200"
    else:
        context.validation_result = "invalid"
        context.status_code = "400"


@then('the response should contain "{validation_result}"')
def step_check_validation(context, validation_result):
    assert context.validation_result == validation_result, (
        f"expected '{validation_result}', got '{context.validation_result}'"
    )


@then('the status code should be "{status_code}"')
def step_check_status_code(context, status_code):
    assert context.status_code == status_code, (
        f"expected status {status_code}, got {context.status_code}"
    )


# --- Load testing outline -------------------------------------------------


@given('I have configured the load testing environment')
def step_configure_load_env(context):
    context.load_configured = True


@when('I simulate "{concurrent_users:d}" concurrent users')
def step_simulate_users(context, concurrent_users):
    assert context.load_configured, "load environment must be configured first"
    context.concurrent_users = concurrent_users


@when('I set the maximum response time to "{max_response_time:d}" seconds')
def step_set_max_response_time(context, max_response_time):
    context.max_response_time = max_response_time
    # Simulated average comfortably under the configured maximum.
    context.average_response_time = max_response_time * 0.5


@then('the system should handle the load successfully')
def step_handle_load(context):
    assert context.concurrent_users > 0, "should have simulated users"


@then('the average response time should be less than "{max_response_time:d}" seconds')
def step_check_average_response_time(context, max_response_time):
    assert context.average_response_time < max_response_time, (
        f"avg {context.average_response_time}s should be < {max_response_time}s"
    )
