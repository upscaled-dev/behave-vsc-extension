Feature: Execution selection
  @smoke @shared
  Scenario: First selected scenario
    Given I record "first"

  @regression @shared
  Scenario: Second selected scenario
    Given I record "second"

  Scenario: Duplicate title
    Given I record "duplicate-first"

  Scenario: Duplicate title
    Given I record "duplicate-second"

  @smoke
  Scenario Outline: Selected outline
    Given I record "<entry>"
    Examples:
      | entry       |
      | outline-one |
      | outline-two |

  Scenario: Retry scenario
    Given I record "retry"
