#!/usr/bin/env python3
"""
Parallel Behave Test Runner

This script demonstrates how to run behave tests in parallel.
It can be used as a reference for the parallel execution feature.
"""

import subprocess
import concurrent.futures
import sys
import os
import time
from typing import List, Dict, Any


def run_behave_file(feature_file: str, behave_command: str = "behave",
                   tags: str = None, output_format: str = "pretty",
                   dry_run: bool = False) -> Dict[str, Any]:
    """Run behave for a single feature file"""
    try:
        cmd = [behave_command, feature_file]

        # Add tags if specified
        if tags:
            cmd.extend(["--tags", tags])

        # Add output format
        if output_format and output_format != "pretty":
            cmd.extend(["--format", output_format])

        # Add dry run option
        if dry_run:
            cmd.append("--dry-run")

        print(f"Running: {' '.join(cmd)}")

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=os.getcwd(),
            timeout=300  # 5 minute timeout
        )

        return {
            'file': feature_file,
            'success': result.returncode == 0,
            'output': result.stdout,
            'error': result.stderr,
            'returncode': result.returncode,
            'duration': 0  # Could be enhanced with timing
        }
    except subprocess.TimeoutExpired:
        return {
            'file': feature_file,
            'success': False,
            'output': '',
            'error': 'Test execution timed out after 5 minutes',
            'returncode': 1,
            'duration': 300
        }
    except Exception as e:
        return {
            'file': feature_file,
            'success': False,
            'output': '',
            'error': str(e),
            'returncode': 1,
            'duration': 0
        }


def run_tests_in_parallel(feature_files: List[str], max_processes: int = 4,
                         behave_command: str = "behave", tags: str = None,
                         output_format: str = "pretty", dry_run: bool = False) -> List[Dict[str, Any]]:
    """Run multiple feature files in parallel"""

    print(f"Running {len(feature_files)} feature files in parallel (max {max_processes} processes)")
    print(f"Command: {behave_command}")
    if tags:
        print(f"Tags: {tags}")
    if output_format != "pretty":
        print(f"Output format: {output_format}")
    if dry_run:
        print("DRY RUN MODE - No actual tests will be executed")
    print("-" * 60)

    start_time = time.time()
    results = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_processes) as executor:
        # Submit all tasks
        future_to_file = {
            executor.submit(
                run_behave_file,
                file,
                behave_command,
                tags,
                output_format,
                dry_run
            ): file for file in feature_files
        }

        # Process completed tasks
        for future in concurrent.futures.as_completed(future_to_file):
            result = future.result()
            results.append(result)

            status = "✓ PASS" if result['success'] else "✗ FAIL"
            print(f"{status} {result['file']}")

            if not result['success'] and result['error']:
                print(f"  Error: {result['error']}")

    end_time = time.time()
    total_duration = end_time - start_time

    # Summary
    passed = sum(1 for r in results if r['success'])
    failed = len(results) - passed

    print("-" * 60)
    print(f"Summary: {passed} passed, {failed} failed")
    print(f"Total execution time: {total_duration:.2f} seconds")

    if failed > 0:
        print("\nFailed tests:")
        for result in results:
            if not result['success']:
                print(f"  - {result['file']}: {result['error']}")

    return results


def main():
    """Main function to demonstrate parallel execution"""

    # Example usage
    feature_files = [
        "features/test.feature",
        "features/advanced-example.feature"
    ]

    # Filter out non-existent files
    existing_files = [f for f in feature_files if os.path.exists(f)]

    if not existing_files:
        print("No feature files found!")
        sys.exit(1)

    # Run tests in parallel
    results = run_tests_in_parallel(
        feature_files=existing_files,
        max_processes=2,
        behave_command="behave",
        tags="@smoke",  # Only run smoke tests
        output_format="pretty",
        dry_run=False
    )

    # Exit with appropriate code
    failed_count = sum(1 for r in results if not r['success'])
    sys.exit(failed_count)


if __name__ == "__main__":
    main()
