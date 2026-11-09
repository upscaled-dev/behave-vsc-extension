Feature: Collected catalog
  Scenario Outline: Catalog line <value>
    Given a catalog entry
    Examples: duplicated values
      | value |
      | same  |
      | same  |
    Examples: another block
      | value |
      | other |
