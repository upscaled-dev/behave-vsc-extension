const { spawn } = require('child_process');
const path = require('path');

console.log('Running tests with coverage...');

// First, ensure the code is compiled
const compileProcess = spawn('npm', ['run', 'compile'], {
  stdio: 'inherit'
});

compileProcess.on('close', (code) => {
  if (code !== 0) {
    console.error('Compilation failed');
    process.exit(code);
  }
  
  // Run tests with c8 coverage using JSON configuration file
  const testProcess = spawn('c8', [
    '--config', 'c8.config.json',
    'node',
    './out/test/runTest.js'
  ], {
    stdio: 'inherit'
  });
  
  testProcess.on('close', (testCode) => {
    console.log(`Tests completed with code ${testCode}`);
    process.exit(testCode);
  });
}); 