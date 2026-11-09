@table_feature
Feature: Background table continuation
  Background:
    Given I receive table setup "feature":
      | value        |
      | feature\|pipe |
    And I retain table setup "feature"

  @left_rule
  Rule: Left table scope
    Background:
      Given I receive table setup "left":
        | value     |
        | left\|pipe |
      But I retain table setup "left"

    @left_outline
    Scenario Outline: Left table row
      Given I record table "<entry>"
      Examples: Selected rows
        | entry    |
        | left-one |
        | left-two |

  @right_rule
  Rule: Right table scope
    Background:
      Given I receive table setup "right":
        | value      |
        | right\|pipe |
      And I retain table setup "right"

    @right_leaf
    Scenario: Right table row
      Given I record table "right-one"
