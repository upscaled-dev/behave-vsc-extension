Feature: Quoted descriptions
  """ feature decoration
  Given feature description text
  ``` further feature decoration

  Background:
    Given a boundary setup payload
      """
      Scenario: Phantom setup
      @phantom_setup
      """
    And boundary setup continues

  @real
  Scenario: Read boundary payload
    """ scenario decoration
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

  Rule: Quoted rule
    """ rule decoration
    Given rule description text
    ''' further rule decoration

    @after
    Scenario: Following boundary scenario
      Given a boundary following scenario
