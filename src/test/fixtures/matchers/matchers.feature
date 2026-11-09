Feature: Matcher navigation

  Scenario: Runnable matcher forms
    Given I have 12 things
    And I have alpha
    When I select code 42
    Then I finish matchers

  Scenario Outline: Numeric outline navigation
    Given I have <count> things
    Then I finish matchers

    Examples:
      | count |
      | 7     |

  Scenario: Navigation negatives
    When I have 12 things
    Then I typed count 12
