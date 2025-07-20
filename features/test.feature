@feature @test
Feature: Test Feature
  As a test user
  I want to test the behave test runner extension
  So that I can verify it works correctly

  @smoke @passing
  Scenario: Passing scenario
    Given I am on the test page
    When I click the test button
    Then I should see the test result

  @smoke @failing
  Scenario: Failing scenario
    Given I am on the test page
    When I click the test button
    Then I should see a failing result
    And this step will fail because it is not implemented

  @smoke @outline
  Scenario Outline: Test scenario outline
    Given I have a "<input>" value
    When I process the input
    Then I should get "<expected>" result

    Examples:
      | input | expected |
      | hello | world    |
      | test  | pass     |
      | fail  | error    |
