Feature: User Authentication
  As a user
  I want to be able to log in and register
  So that I can access the application

  @smoke @authentication
  Scenario: Basic login functionality
    Given I am on the login page
    And I have valid credentials
    When I enter "testuser" as username
    And I enter "testpass" as password
    And I click the login button
    Then I should be logged in successfully

  @regression @authentication
  Scenario: Login with invalid credentials
    Given I am on the login page
    And I have invalid credentials
    When I enter "invalid" as username
    And I enter "wrong" as password
    And I click the login button
    Then I should see an error message

  @feature @registration
  Scenario: User registration
    Given I am on the registration page
    When I enter "newuser" as username
    And I enter "newpass" as password
    And I click the register button
    Then I should be registered successfully

  @critical @authentication
  Scenario Outline: Login with different user types
    Given I am on the login page
    And I have <user_type> credentials
    When I enter "<username>" as username
    And I enter "<password>" as password
    And I click the login button
    Then I should see "<expected_message>"

    Examples:
      | user_type | username    | password    | expected_message        |
      | admin     | admin_user  | admin_pass  | Welcome Administrator   |
      | regular   | user123     | user_pass   | Welcome User            |
      | guest     | guest_user  | guest_pass  | Welcome Guest           |

  @regression @validation
  Scenario Outline: Form validation for registration
    Given I am on the registration page
    When I enter "<username>" as username
    And I enter "<password>" as password
    And I enter "<email>" as email
    And I click the register button
    Then I should see "<validation_message>"

    Examples:
      | username | password | email              | validation_message           |
      |          | pass123  | user@example.com   | Username is required         |
      | user123  |          | user@example.com   | Password is required         |
      | user123  | pass123  |                    | Email is required            |
      | user123  | pass123  | invalid-email      | Please enter a valid email   |
      | a        | pass123  | user@example.com   | Username must be 3+ chars    |
      | user123  | 123      | user@example.com   | Password must be 6+ chars    |

  @performance @stress
  Scenario Outline: Concurrent user login simulation
    Given I am on the login page
    And I have valid credentials
    When <concurrent_users> users try to login simultaneously
    And I enter "user<user_id>" as username
    And I enter "pass<user_id>" as password
    And I click the login button
    Then the response time should be less than "<max_response_time>" seconds
    And I should see "Login successful"

    Examples:
      | concurrent_users | user_id | max_response_time |
      | 10              | 1       | 2.0               |
      | 50              | 2       | 3.0               |
      | 100             | 3       | 5.0               |
      | 200             | 4       | 8.0               |

  @security @authentication
  Scenario Outline: Security validation for login attempts
    Given I am on the login page
    When I attempt to login with "<input_type>" input
    And I enter "<username>" as username
    And I enter "<password>" as password
    And I click the login button
    Then I should see "<security_message>"
    And the account should be "<account_status>"

    Examples:
      | input_type | username     | password     | security_message           | account_status |
      | sql_inject | admin' OR 1=1 | any_pass     | Invalid login attempt     | locked         |
      | xss        | <script>alert('xss')</script> | pass123    | Invalid characters detected | active        |
      | normal     | valid_user   | valid_pass   | Login successful          | active         |
      | brute_force| admin        | wrong_pass   | Too many failed attempts  | locked         | 