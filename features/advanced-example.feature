@feature @advanced
Feature: Advanced Test Examples
  As a test developer
  I want to run various types of tests
  So that I can validate different scenarios

  @smoke @critical
  Scenario: Basic smoke test
    Given I am on the login page
    When I enter valid credentials
    And I click the login button
    Then I should be logged in successfully

  @regression @ui
  Scenario: UI validation test
    Given I am on the dashboard
    When I navigate to the settings page
    And I change the theme to dark mode
    Then the theme should be applied correctly
    And the UI should be responsive

  @api @integration
  Scenario: API integration test
    Given I have a valid API token
    When I make a POST request to /api/users
    And I include valid user data
    Then the response should have status 201
    And the user should be created in the database

  @performance @stress
  Scenario Outline: Load testing with multiple users
    Given I have <user_count> concurrent users
    When they all access the application simultaneously
    Then the response time should be less than <max_response_time> seconds
    And the system should remain stable

    Examples:
      | user_count | max_response_time |
      | 10         | 2                 |
      | 50         | 5                 |
      | 100        | 10                |

  @security @authentication
  Scenario: Security authentication test
    Given I am an unauthorized user
    When I try to access a protected resource
    Then I should be redirected to the login page
    And I should see an authentication error message

  @data @database
  Scenario: Database operations test
    Given I have a clean test database
    When I insert test data
    And I query the database
    Then I should retrieve the correct data
    And the data should be properly formatted
