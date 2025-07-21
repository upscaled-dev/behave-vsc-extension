#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

console.log('🧪 Running Behave Test Runner Extension Tests\n');

const testSuites = [
  { name: 'Parser Tests', command: 'npm run test:parser' },
  { name: 'TestExecutor Tests', command: 'npm run test:execution' },
  { name: 'Logger Tests', command: 'npm run test:logger' },
  { name: 'CommandManager Tests', command: 'npm run test:commands' },
  { name: 'Unit Tests', command: 'npm run test:unit' },
  { name: 'Integration Tests', command: 'npm run test:integration' },
  { name: 'All Tests', command: 'npm test' }
];

async function runTests() {
	let allPassed = true;

	for (const suite of testSuites) {
		console.log(`\n📋 Running ${suite.name}...`);
		console.log('─'.repeat(50));

		try {
			const output = execSync(suite.command, {
				encoding: 'utf8',
				stdio: 'pipe'
			});

			// Extract pass/fail count
			const match = output.match(/(\d+) passing/);
			const passing = match ? parseInt(match[1]) : 0;

			console.log(`✅ ${suite.name} passed: ${passing} tests`);

			// Show last few lines of output for context
			const lines = output.split('\n');
			const lastLines = lines.slice(-5).filter(line => line.trim());
			if (lastLines.length > 0) {
				console.log('\nLast output:');
				lastLines.forEach(line => console.log(`  ${line}`));
			}

		} catch (error) {
			console.log(`❌ ${suite.name} failed`);
			console.log('Error output:');
			console.log(error.stdout || error.message);
			allPassed = false;
		}
	}

	console.log('\n' + '='.repeat(50));
	if (allPassed) {
		console.log('🎉 All test suites passed!');
		process.exit(0);
	} else {
		console.log('💥 Some test suites failed!');
		process.exit(1);
	}
}

// Handle command line arguments
const args = process.argv.slice(2);
if (args.length > 0) {
	const suite = args[0].toLowerCase();
	const testSuite = testSuites.find(s => s.name.toLowerCase().includes(suite));

	if (testSuite) {
		console.log(`📋 Running ${testSuite.name}...`);
		try {
			execSync(testSuite.command, { stdio: 'inherit' });
			console.log('✅ Test suite passed!');
		} catch (error) {
			console.log('❌ Test suite failed!');
			process.exit(1);
		}
	} else {
		console.log('Available test suites:');
		testSuites.forEach(s => console.log(`  - ${s.name.toLowerCase()}`));
		process.exit(1);
	}
} else {
	runTests();
}
