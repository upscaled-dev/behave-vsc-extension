@feature @demo
Feature: Demo Output Display
  As a user
  I want to see behave output in the terminal
  So that I can understand what happened during test execution

  @smoke @passing
  Scenario: Passing scenario
    Given I am on the demo page
    When I perform a successful action
    Then I should see success

  @smoke @failing
  Scenario: Failing scenario
    Given I am on the demo page
    When I perform a failing action
    Then I should see a failure
    And this demo step will fail because it is not implemented
