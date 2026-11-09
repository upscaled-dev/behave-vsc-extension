Feature: Examples column integrity
  Scenario Outline: Column values
    Given column values "<first>" "<middle>" "<last>"

    @primary
    Examples: Empty positions
      | first | middle | last |
      |       | center | end  |
      | start |        | end  |
      | start | center |      |
      |       |        |      |

    @secondary
    Examples: Escaped separator
      | first       | middle | last |
      | left\|right | center | end  |
