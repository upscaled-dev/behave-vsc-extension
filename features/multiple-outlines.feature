@feature @multiple-outlines
Feature: Multiple Scenario Outlines Test
  As a test developer
  I want to test multiple scenario outlines
  So that I can validate different parameter combinations

  @smoke @login
  Scenario Outline: User login with different credentials
    Given I am on the login page
    When I enter username "<username>" and password "<password>"
    And I click the login button
    Then I should see "<expected_result>"

    Examples:
      | username | password | expected_result |
      | admin    | admin123 | dashboard       |
      | user     | user123  | dashboard       |
      | invalid  | wrong    | error message   |

  @api @datavalidation
  Scenario Outline: API data validation with various input types
    Given I have a valid API endpoint
    When I send "<data_type>" data with value "<input_value>"
    Then the response should contain "<validation_result>"
    And the status code should be "<status_code>"

    Examples:
      | data_type | input_value | validation_result | status_code |
      | string    | hello       | valid             | 200         |
      | number    | 42          | valid             | 200         |
      | email     | test@test   | invalid           | 400         |
      | empty     |             | invalid           | 400         |

  @performance @load-testing
  Scenario Outline: Load testing with different user loads and response time expectations
    Given I have configured the load testing environment
    When I simulate "<concurrent_users>" concurrent users
    And I set the maximum response time to "<max_response_time>" seconds
    Then the system should handle the load successfully
    And the average response time should be less than "<max_response_time>" seconds

    Examples:
      | concurrent_users | max_response_time |
      | 10               | 2                 |
      | 50               | 5                 |
      | 100              | 10                |
      | 500              | 15                |
