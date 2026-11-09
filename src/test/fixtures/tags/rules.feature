@tag_rule_feature @tag_shared
Feature: Inherited Rule tags
  Background:
    Given tag scope setup "feature"

  Scenario: Feature tag child
    Given I record tag scope "root"

  @tag_red @tag_shared
  Rule: Red scope
    Background:
      Given tag scope setup "red"

    @tag_direct @tag_shared
    Scenario: Red tag child
      Given I record tag scope "red-first"

    @tag_outline @tag_shared
    Scenario Outline: Rule tag rows
      Given I record tag scope "<entry>"

      @tag_left @tag_shared
      Examples: Left
        | entry    |
        | red-left |

      @tag_right @tag_shared
      Examples: Right
        | entry     |
        | red-right |

  @tag_blue @tag_shared
  Rule: Blue scope
    Background:
      Given tag scope setup "blue"

    Scenario: Blue tag child
      Given I record tag scope "blue-first"

  Rule: Plain scope
    Background:
      Given tag scope setup "plain"

    Scenario: Plain tag child
      Given I record tag scope "plain-first"
