from behave import given, when, then
import time
import random

# Mock data and state for testing
class TestContext:
    def __init__(self):
        self.is_logged_in = False
        self.current_page = None
        self.api_token = None
        self.api_response = None
        self.database_data = []
        self.theme = "light"
        self.response_time = 0
        self.user_count = 0
        self.is_authorized = False
        self.error_message = None

# Global test context
test_context = TestContext()

# ============================================================================
# Basic Smoke Test Steps
# ============================================================================

@given('I am on the login page')
def step_impl(context):
    test_context.current_page = "login"
    print(f"Navigated to login page")

@when('I enter valid credentials')
def step_impl(context):
    # Simulate entering credentials
    test_context.api_token = "valid_token_12345"
    print(f"Entered valid credentials")

@when('I click the login button')
def step_impl(context):
    # Simulate login process
    test_context.is_logged_in = True
    test_context.current_page = "dashboard"
    print(f"Clicked login button")

@then('I should be logged in successfully')
def step_impl(context):
    assert test_context.is_logged_in, "User should be logged in"
    assert test_context.current_page == "dashboard", "User should be on dashboard"
    print(f"Login successful - user is on {test_context.current_page}")

# ============================================================================
# UI Validation Test Steps
# ============================================================================

@given('I am on the dashboard')
def step_impl(context):
    test_context.current_page = "dashboard"
    print(f"User is on dashboard")

@when('I navigate to the settings page')
def step_impl(context):
    test_context.current_page = "settings"
    print(f"Navigated to settings page")

@when('I change the theme to dark mode')
def step_impl(context):
    test_context.theme = "dark"
    print(f"Changed theme to {test_context.theme}")

@then('the theme should be applied correctly')
def step_impl(context):
    assert test_context.theme == "dark", "Theme should be dark"
    print(f"Theme applied: {test_context.theme}")

@then('the UI should be responsive')
def step_impl(context):
    # Simulate responsive UI check
    assert test_context.current_page == "settings", "Should be on settings page"
    print(f"UI is responsive on {test_context.current_page}")

# ============================================================================
# API Integration Test Steps
# ============================================================================

@given('I have a valid API token')
def step_impl(context):
    test_context.api_token = "valid_api_token_67890"
    assert test_context.api_token is not None, "API token should be present"
    print(f"API token available: {test_context.api_token[:10]}...")

@when('I make a POST request to /api/users')
def step_impl(context):
    # Simulate API request
    test_context.api_response = {"status": 201, "message": "User created"}
    print(f"Made POST request to /api/users")

@when('I include valid user data')
def step_impl(context):
    # Simulate including user data
    user_data = {"name": "Test User", "email": "test@example.com"}
    print(f"Included user data: {user_data}")

@then('the response should have status 201')
def step_impl(context):
    assert test_context.api_response["status"] == 201, "Response status should be 201"
    print(f"Response status: {test_context.api_response['status']}")

@then('the user should be created in the database')
def step_impl(context):
    # Simulate database check
    assert test_context.api_response["status"] == 201, "User creation should be successful"
    print(f"User created in database: {test_context.api_response['message']}")

# ============================================================================
# Load Testing Steps
# ============================================================================

@given('I have {user_count:d} concurrent users')
def step_impl(context, user_count):
    test_context.user_count = user_count
    print(f"Simulating {user_count} concurrent users")

@when('they all access the application simultaneously')
def step_impl(context):
    # Simulate concurrent access
    test_context.response_time = random.uniform(0.5, 2.0)  # Random response time
    print(f"All {test_context.user_count} users accessed simultaneously")

@then('the response time should be less than {max_response_time:d} seconds')
def step_impl(context, max_response_time):
    assert test_context.response_time < max_response_time, f"Response time {test_context.response_time:.2f}s should be less than {max_response_time}s"
    print(f"Response time: {test_context.response_time:.2f}s (max: {max_response_time}s)")

@then('the system should remain stable')
def step_impl(context):
    # Simulate stability check
    assert test_context.response_time > 0, "System should respond"
    print(f"System remained stable under {test_context.user_count} users")

# ============================================================================
# Security Authentication Test Steps
# ============================================================================

@given('I am an unauthorized user')
def step_impl(context):
    test_context.is_authorized = False
    test_context.api_token = None
    print(f"User is unauthorized")

@when('I try to access a protected resource')
def step_impl(context):
    # Simulate unauthorized access attempt
    test_context.current_page = "login"  # Redirected to login
    test_context.error_message = "Authentication required"
    print(f"Attempted to access protected resource")

@then('I should be redirected to the login page')
def step_impl(context):
    assert test_context.current_page == "login", "Should be redirected to login"
    print(f"Redirected to: {test_context.current_page}")

@then('I should see an authentication error message')
def step_impl(context):
    assert test_context.error_message is not None, "Error message should be present"
    print(f"Error message: {test_context.error_message}")

# ============================================================================
# Database Operations Test Steps
# ============================================================================

@given('I have a clean test database')
def step_impl(context):
    test_context.database_data = []
    print(f"Database cleaned - {len(test_context.database_data)} records")

@when('I insert test data')
def step_impl(context):
    # Simulate data insertion
    test_data = {"id": 1, "name": "Test Record", "value": "test_value"}
    test_context.database_data.append(test_data)
    print(f"Inserted test data: {test_data}")

@when('I query the database')
def step_impl(context):
    # Simulate database query
    print(f"Querying database for {len(test_context.database_data)} records")

@then('I should retrieve the correct data')
def step_impl(context):
    assert len(test_context.database_data) > 0, "Should have data in database"
    assert test_context.database_data[0]["name"] == "Test Record", "Should retrieve correct data"
    print(f"Retrieved {len(test_context.database_data)} records")

@then('the data should be properly formatted')
def step_impl(context):
    for record in test_context.database_data:
        assert "id" in record, "Record should have id field"
        assert "name" in record, "Record should have name field"
        assert "value" in record, "Record should have value field"
    print(f"All {len(test_context.database_data)} records are properly formatted")
