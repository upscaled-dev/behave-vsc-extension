import { suite, test, setup } from 'mocha';
import { assert } from 'chai';
import { PytestResultParser } from '../../utils/pytest-result-parser';
import { Logger } from '../../utils/logger';

suite('Pytest Result Parser Tests', () => {
  let parser: PytestResultParser;
  let logger: Logger;

  setup(() => {
    logger = Logger.create();
    parser = PytestResultParser.create(logger);
  });

  test('Should parse pytest output with passing tests', () => {
    const output = `
=========================================== test session starts ============================================
platform darwin -- Python 3.9.6, pytest-7.4.4, pluggy-1.5.0
collected 3 items

tests/test_pytest_bdd_example.py::test_login_different_user_types[admin-admin_user-admin_pass-Welcome Administrator] PASSED [ 33%]
tests/test_pytest_bdd_example.py::test_login_different_user_types[regular-user123-user_pass-Welcome User] PASSED [ 66%]
tests/test_pytest_bdd_example.py::test_login_different_user_types[guest-guest_user-guest_pass-Welcome Guest] PASSED [100%]

============================================ 3 passed in 0.05s =============================================
`;

    const result = parser.parsePytestOutput(output);

    assert.equal(result.summary.total, 3);
    assert.equal(result.summary.passed, 3);
    assert.equal(result.summary.failed, 0);
    assert.equal(result.summary.skipped, 0);
    assert.equal(result.summary.errors, 0);

    assert.equal(result.tests.length, 3);
    assert.isDefined(result.tests[0]);
    assert.equal(result.tests[0]!.name, 'test_login_different_user_types[admin-admin_user-admin_pass-Welcome Administrator]');
    assert.equal(result.tests[0]!.status, 'passed');
    assert.isDefined(result.tests[1]);
    assert.equal(result.tests[1]!.name, 'test_login_different_user_types[regular-user123-user_pass-Welcome User]');
    assert.equal(result.tests[1]!.status, 'passed');
    assert.isDefined(result.tests[2]);
    assert.equal(result.tests[2]!.name, 'test_login_different_user_types[guest-guest_user-guest_pass-Welcome Guest]');
    assert.equal(result.tests[2]!.status, 'passed');
  });

  test('Should parse pytest output with mixed results', () => {
    const output = `
=========================================== test session starts ============================================
platform darwin -- Python 3.9.6, pytest-7.4.4, pluggy-1.5.0
collected 4 items

tests/test_example.py::test_passing PASSED [ 25%]
tests/test_example.py::test_failing FAILED [ 50%]
tests/test_example.py::test_skipped SKIPPED [ 75%]
tests/test_example.py::test_error ERROR [100%]

============================================ 1 passed, 1 failed, 1 skipped, 1 error in 0.05s =============================================
`;

    const result = parser.parsePytestOutput(output);

    assert.equal(result.summary.total, 4);
    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 1);
    assert.equal(result.summary.skipped, 1);
    assert.equal(result.summary.errors, 1);

    assert.equal(result.tests.length, 4);
    assert.isDefined(result.tests[0]);
    assert.equal(result.tests[0]!.status, 'passed');
    assert.isDefined(result.tests[1]);
    assert.equal(result.tests[1]!.status, 'failed');
    assert.isDefined(result.tests[2]);
    assert.equal(result.tests[2]!.status, 'skipped');
    assert.isDefined(result.tests[3]);
    assert.equal(result.tests[3]!.status, 'error');
  });

  test('Should handle empty output', () => {
    const result = parser.parsePytestOutput('');
    
    assert.equal(result.summary.total, 0);
    assert.equal(result.summary.passed, 0);
    assert.equal(result.summary.failed, 0);
    assert.equal(result.summary.skipped, 0);
    assert.equal(result.summary.errors, 0);
    assert.equal(result.tests.length, 0);
  });

  test('Should handle output without test results', () => {
    const output = `
=========================================== test session starts ============================================
platform darwin -- Python 3.9.6, pytest-7.4.4, pluggy-1.5.0
collected 0 items

============================================ no tests ran in 0.00s =============================================
`;

    const result = parser.parsePytestOutput(output);
    
    assert.equal(result.summary.total, 0);
    assert.equal(result.summary.passed, 0);
    assert.equal(result.summary.failed, 0);
    assert.equal(result.summary.skipped, 0);
    assert.equal(result.summary.errors, 0);
    assert.equal(result.tests.length, 0);
  });

  test('Should extract test duration when available', () => {
    const output = `
tests/test_example.py::test_slow PASSED [100%] 2.34s
`;

    const result = parser.parsePytestOutput(output);
    
    assert.equal(result.tests.length, 1);
    assert.isDefined(result.tests[0]);
    assert.equal(result.tests[0]!.duration, 2.34);
  });

  test('Should map pytest statuses correctly', () => {
    const output = `
tests/test_example.py::test_passed PASSED [ 25%]
tests/test_example.py::test_failed FAILED [ 50%]
tests/test_example.py::test_skipped SKIPPED [ 75%]
tests/test_example.py::test_error ERROR [100%]
`;

    const result = parser.parsePytestOutput(output);
    
    assert.isDefined(result.tests[0]);
    assert.equal(result.tests[0]!.status, 'passed');
    assert.isDefined(result.tests[1]);
    assert.equal(result.tests[1]!.status, 'failed');
    assert.isDefined(result.tests[2]);
    assert.equal(result.tests[2]!.status, 'skipped');
    assert.isDefined(result.tests[3]);
    assert.equal(result.tests[3]!.status, 'error');
  });

  test('Should get status from exit code', () => {
    assert.equal(parser.getStatusFromExitCode(0), 'passed');
    assert.equal(parser.getStatusFromExitCode(1), 'failed');
    assert.equal(parser.getStatusFromExitCode(2), 'failed');
  });

  test('Should parse summary line with mixed results', () => {
    const output = `=========================== 4 failed, 16 passed in 0.60s ===========================`;

    const result = parser.parsePytestOutput(output);
    
    assert.equal(result.summary.total, 20);
    assert.equal(result.summary.passed, 16);
    assert.equal(result.summary.failed, 4);
    assert.equal(result.summary.skipped, 0);
    assert.equal(result.summary.errors, 0);
    
    // Should create synthetic test results when individual tests can't be parsed
    assert.equal(result.tests.length, 20);
    assert.equal(result.tests.filter(t => t.status === 'passed').length, 16);
    assert.equal(result.tests.filter(t => t.status === 'failed').length, 4);
  });

  test('Should parse summary line with passed first', () => {
    const output = `=========================== 16 passed, 4 failed in 0.60s ===========================`;

    const result = parser.parsePytestOutput(output);
    
    assert.equal(result.summary.total, 20);
    assert.equal(result.summary.passed, 16);
    assert.equal(result.summary.failed, 4);
    assert.equal(result.summary.skipped, 0);
    assert.equal(result.summary.errors, 0);
  });

  test('Should parse pytest output as behave-compatible format', () => {
    const output = `
tests/test_pytest_bdd_example.py::test_login_different_user_types[admin-admin_user-admin_pass-Welcome Administrator] PASSED [ 33%]
tests/test_pytest_bdd_example.py::test_login_different_user_types[regular-user123-user_pass-Welcome User] PASSED [ 66%]
tests/test_pytest_bdd_example.py::test_login_different_user_types[guest-guest_user-guest_pass-Welcome Guest] FAILED [100%]
=========================== 2 passed, 1 failed in 0.05s ===========================
`;

    const result = parser.parsePytestOutputAsBehaveCompatible(output);
    
    assert.equal(result.length, 3);
    assert.equal(result[0]!.filePath, 'tests/features/pytest_bdd_example.feature');
    assert.equal(result[0]!.lineNumber, 1);
    assert.equal(result[0]!.name, 'test_login_different_user_types[admin-admin_user-admin_pass-Welcome Administrator]');
    assert.equal(result[0]!.status, 'passed');
    
    assert.equal(result[1]!.status, 'passed');
    assert.equal(result[2]!.status, 'failed');
  });

  test('Should parse short test summary info section', () => {
    const output = `
============================= short test summary info ==============================
FAILED tests/test_pytest_bdd_example.py::test_concurrent_user_login[10-1-2.0] - ValueError: could not convert string to float: '"2.0"'
FAILED tests/test_pytest_bdd_example.py::test_concurrent_user_login[50-2-3.0] - ValueError: could not convert string to float: '"3.0"'
FAILED tests/test_pytest_bdd_example.py::test_concurrent_user_login[100-3-5.0] - ValueError: could not convert string to float: '"5.0"'
FAILED tests/test_pytest_bdd_example.py::test_concurrent_user_login[200-4-8.0] - ValueError: could not convert string to float: '"8.0"'
=========================== 4 failed, 16 passed in 0.60s ===========================
`;

    const result = parser.parsePytestOutput(output);
    
    assert.equal(result.tests.length, 4);
    assert.equal(result.summary.total, 20);
    assert.equal(result.summary.passed, 16);
    assert.equal(result.summary.failed, 4);
    
    // Check that the failed tests were parsed correctly
    assert.equal(result.tests[0]!.name, 'tests/test_pytest_bdd_example.py::test_concurrent_user_login[10-1-2.0]');
    assert.equal(result.tests[0]!.status, 'failed');
    assert.equal(result.tests[0]!.error, 'ValueError: could not convert string to float: \'"2.0"\'');
  });
}); 