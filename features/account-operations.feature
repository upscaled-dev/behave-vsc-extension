Feature: Account Operations

  Background:
    Given the bank is open
    And the audit log is empty

  Rule: Account holders may withdraw funds up to their balance

    Scenario Outline: Valid Withdrawals
      Given I have <balance> in my account
      When I withdraw <amount>
      Then my new balance should be <new_balance>

      Examples: Standard Amounts

        | balance | amount | new_balance |
        | 100     | 20     | 80          |
        | 50      | 50     | 0           |

      @high_value
      Examples: High Value Amounts

        | balance | amount | new_balance |
        | 1000    | 500    | 500         |

  Rule: Withdrawals beyond the balance are rejected

    Scenario Outline: Invalid Withdrawals
      Given I have <balance> in my account
      When I try to withdraw <amount>
      Then I should see an error: "<error>"

      Examples:

        | balance | amount | error               |
        | 10      | 20     | Insufficient Funds  |
        | 100     | -5     | Invalid Amount      |
