#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

async function runTestFile(name, file) {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running ${name}`);
    console.log('='.repeat(60));
    
    const test = spawn('node', [file], {
      stdio: 'inherit'
    });
    
    test.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

async function main() {
  const tests = [
    ['Cookie Mock Tests', path.join(__dirname, 'cookie-mock-test.js')],
    ['Integration Tests', path.join(__dirname, 'integration-tests.js')],
    ['Behavioral Tests', path.join(__dirname, 'behavioral-tests.js')]
  ];
  
  console.log('MCP Cookies Test Suite');
  console.log('=====================\n');
  
  const results = [];
  
  for (const [name, file] of tests) {
    const passed = await runTestFile(name, file);
    results.push({ name, passed });
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('Test Summary');
  console.log('='.repeat(60));
  
  let totalPassed = 0;
  for (const { name, passed } of results) {
    console.log(`${passed ? '✓' : '✗'} ${name}`);
    if (passed) totalPassed++;
  }
  
  console.log(`\nTotal: ${totalPassed}/${results.length} test suites passed`);
  
  if (totalPassed < results.length) {
    process.exit(1);
  }
}

main().catch(console.error);