@feature_alias
Feature: English keyword aliases

  Background:
    Given I prepare English setup
      """text/plain
      Scenario: Phantom background
      @phantom_background
      """
    * I continue English setup

  @example_alias
  Example: Alias example
    Given I begin English "example"
      """text/plain
      Scenario: Phantom scenario
      Scenario Template: Phantom template
      Scenarios: Phantom rows
      @phantom_step
      """
    * I record English "example-wildcard"

  @template_alias
  Scenario Template: Alias template
    Given I begin English "<entry>"
    * I record English "<entry>-wildcard"

    @rows_alias
    Scenarios: Alias rows
      | entry |
      | one   |
      | two   |

  Scenario: Original scenario control
    Given I begin English "control"
    * I record English "control-wildcard"

  Scenario Outline: Original outline control
    Given I begin English "<entry>"
    * I record English "<entry>-wildcard"
    Examples: Control rows
      | entry |
      | three |
