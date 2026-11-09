Feature: Container identity
  @first @shared
  Scenario Outline: Repeated
    Given I record container "<entry>"
    Examples: Same
      | entry |
      | a-one |
      | a-two |

  @second @shared
  Scenario Outline: Repeated
    Given I record container "<entry>"
    Examples: Same
      | entry |
      | b-one |
      | b-two |

  @blocks @shared
  Scenario Outline: Named blocks
    Given I record container "<entry>"
    @left
    Examples: Same
      | entry |
      | named-left |
    @right
    Examples: Same
      | entry |
      | named-right |

  @bare @shared
  Scenario Outline: Unnamed blocks
    Given I record container "<entry>"
    Examples:
      | entry |
      | bare-left |
    Examples:
      | entry |
      | bare-right |

  @legacy @shared
  Scenario Outline: Legacy block
    Given I record container "<entry>"
    Examples:
      | entry |
      | legacy-one |
      | legacy-two |

  @single @shared
  Scenario Outline: Single row
    Given I record container "<entry>"
    Examples:
      | entry |
      | single |
