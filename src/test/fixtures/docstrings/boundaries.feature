Feature: Docstring boundaries
  Background:
    Given a boundary setup payload
      """
      Scenario: Phantom setup
      @phantom_setup
      """
    And boundary setup continues

  @real
  Scenario: Read boundary payload
    Given a boundary payload
      """text/plain
      Scenario: Phantom scenario
      Scenario Outline: Phantom outline
      Examples: Phantom examples
      @phantom
      Rule: Phantom rule
      Background: Phantom background
      Given phantom step
      ```
      '''
      """
    Then the boundary payload is intact

  Scenario Outline: Boundary row
    Given a boundary row "<value>"
      """
      Examples: Phantom row table
      | unrelated | columns |
      @phantom_row
      Then phantom row step
      """
    Then boundary row is "<value>"
    Examples: Real rows
      | value |
      | one   |
      | two   |

  @after
  Scenario: Following boundary scenario
    Given a boundary following scenario
