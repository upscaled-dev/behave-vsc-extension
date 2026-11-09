@tag_feature @tag_shared
@tag_shared
Feature: Inherited feature tags
  Background:
    Given tag scope setup "feature"

  @tag_direct @tag_shared @tag_direct
  Scenario: First tag child
    Given I record tag scope "first"

  Scenario: Second tag child
    Given I record tag scope "second"

  @tag_outline @tag_shared
  Scenario Outline: Tag rows
    Given I record tag scope "<entry>"

    @tag_left @tag_shared @tag_left
    Examples: Left
      | entry    |
      | left-one |
      | left-two |

    @tag_right @tag_shared
    Examples: Right
      | entry     |
      | right-one |

  Scenario: Following tag child
    Given I record tag scope "following"
