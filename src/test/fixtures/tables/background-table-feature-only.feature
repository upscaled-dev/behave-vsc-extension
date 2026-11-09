@table_feature
Feature: Background table continuation
  Background:
    Given I receive table setup "feature":
      | value        |
      | feature\|pipe |
    And I retain table setup "feature"

  @feature_outline
  Scenario Outline: Feature table row
    Given I record table "<entry>"
    Examples: Selected rows
      | entry    |
      | left-one |
      | left-two |
