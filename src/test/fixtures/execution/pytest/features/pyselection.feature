Feature: Pytest execution selection
  @smoke
  Scenario: Pytest first
    Given I record "pytest-first"

  @regression
  Scenario: Pytest second
    Given I record "pytest-second"

  Scenario Outline: Pytest outline
    Given I record "<entry>"
    Examples:
      | entry              |
      | pytest-outline-one |
      | pytest-outline-two |
