@feature @test-scenario-outline
Feature: Test Scenario Outline Detection
  As a test developer
  I want to test scenario outline detection
  So that I can validate the detection logic

  @smoke @regular
  Scenario: Regular scenario
    Given I am on the test page
    When I click the test button
    Then I should see the test result

  @smoke @outline
  Scenario Outline: Test with different values
    Given I have a "<input>" value
    When I process the input
    Then I should get "<expected>" result

    Examples:
      | input | expected |
      | hello | world    |
      | test  | pass     |
      | fail  | error    |
