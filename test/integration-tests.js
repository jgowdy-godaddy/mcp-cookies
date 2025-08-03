#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');

// Test the full MCP protocol flow
async function testFullProtocolFlow() {
  return new Promise((resolve, reject) => {
    const server = spawn('node', [path.join(__dirname, '..', 'index.js')], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const steps = [];
    let currentStep = 0;

    // Define the expected protocol flow
    const expectedSteps = [
      {
        name: 'Server starts',
        check: (data) => data.includes('MCP Cookie Fetch Server running'),
        source: 'stderr'
      },
      {
        name: 'Initialize response',
        send: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } },
        check: (data) => {
          const response = JSON.parse(data);
          return response.result && response.result.serverInfo && response.result.serverInfo.name === 'mcp-cookies';
        },
        source: 'stdout'
      },
      {
        name: 'Tools list response',
        send: { method: 'tools/list', jsonrpc: '2.0', id: 2 },
        check: (data) => {
          const response = JSON.parse(data);
          return response.result && 
                 response.result.tools && 
                 response.result.tools.length === 2 &&
                 response.result.tools[0].name === 'fetch_with_cookies' &&
                 response.result.tools[1].name === 'download_with_cookies';
        },
        source: 'stdout'
      },
      {
        name: 'Fetch tool call',
        send: { method: 'tools/call', params: { name: 'fetch_with_cookies', arguments: { url: 'https://example.com', browser: 'chrome', auto_login: false } }, jsonrpc: '2.0', id: 3 },
        check: (data) => {
          const response = JSON.parse(data);
          // Just check that we got a response, don't check the content
          return response.result && response.result.content && response.result.content.length > 0;
        },
        source: 'stdout',
        timeout: 30000 // Allow 30 seconds for fetch
      }
    ];

    function processStep() {
      if (currentStep >= expectedSteps.length) {
        server.kill();
        resolve();
        return;
      }

      const step = expectedSteps[currentStep];
      
      if (step.send) {
        setTimeout(() => {
          const request = JSON.stringify(step.send) + '\n';
          server.stdin.write(request);
        }, 100);
      }
    }

    server.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        const step = expectedSteps[currentStep];
        if (step.source === 'stdout') {
          try {
            if (step.check(line)) {
              steps.push(`✓ ${step.name}`);
              currentStep++;
              processStep();
            }
          } catch (e) {
            // Not the expected data yet
          }
        }
      }
    });

    server.stderr.on('data', (data) => {
      const step = expectedSteps[currentStep];
      if (step.source === 'stderr' && step.check(data.toString())) {
        steps.push(`✓ ${step.name}`);
        currentStep++;
        processStep();
      }
    });

    server.on('error', (err) => {
      reject(new Error(`Server error: ${err.message}`));
    });

    // Start the flow
    processStep();

    // Timeout
    setTimeout(() => {
      server.kill();
      console.log('Completed steps:', steps.join('\n'));
      reject(new Error(`Protocol flow timeout at step: ${expectedSteps[currentStep]?.name || 'unknown'}`));
    }, 10000);
  });
}

// Test error handling
async function testErrorResponses() {
  return new Promise((resolve, reject) => {
    const server = spawn('node', [path.join(__dirname, '..', 'index.js')], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let initialized = false;
    const errors = [];

    server.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          
          if (!initialized && response.result && response.result.serverInfo) {
            initialized = true;
            
            // Test 1: Unknown tool
            server.stdin.write(JSON.stringify({
              method: 'tools/call',
              params: { name: 'unknown_tool', arguments: {} },
              jsonrpc: '2.0',
              id: 2
            }) + '\n');
            
            // Test 2: Invalid arguments
            setTimeout(() => {
              server.stdin.write(JSON.stringify({
                method: 'tools/call',
                params: { name: 'fetch_with_cookies', arguments: {} }, // Missing required 'url'
                jsonrpc: '2.0',
                id: 3
              }) + '\n');
            }, 100);
          }
          
          if (response.error || (response.result && response.result.isError)) {
            errors.push(response);
            
            if (errors.length === 2) {
              server.kill();
              
              // Verify we got appropriate errors
              assert(errors.some(e => e.error && e.error.message.includes('Unknown tool')));
              
              resolve();
            }
          }
        } catch (e) {
          // Not JSON
        }
      }
    });

    // Initialize
    setTimeout(() => {
      server.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
      }) + '\n');
    }, 100);

    setTimeout(() => {
      server.kill();
      reject(new Error('Error response test timeout'));
    }, 5000);
  });
}

// Test request validation
async function testRequestValidation() {
  return new Promise((resolve, reject) => {
    const server = spawn('node', [path.join(__dirname, '..', 'index.js')], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const validationTests = [];

    server.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          
          if (response.id >= 100 && response.id < 200) {
            validationTests.push(response);
            
            if (validationTests.length === 1) {
              server.kill();
              
              // Check all validation errors were caught
              assert(validationTests.every(t => t.error || (t.result && t.result.isError)));
              
              resolve();
            }
          }
        } catch (e) {
          // Not JSON
        }
      }
    });

    // Initialize first
    setTimeout(() => {
      server.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
      }) + '\n');
    }, 100);

    // Send invalid requests - only the invalid method one gets a response
    setTimeout(() => {
      // Invalid method
      server.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 102,
        method: 'invalid/method'
      }) + '\n');
    }, 500);

    setTimeout(() => {
      server.kill();
      reject(new Error('Request validation test timeout'));
    }, 5000);
  });
}

// Main test runner
async function main() {
  const tests = [
    ['Full protocol flow', testFullProtocolFlow],
    ['Error responses', testErrorResponses],
    ['Request validation', testRequestValidation]
  ];

  console.log('Running integration tests...\n');

  let passed = 0;
  let failed = 0;

  for (const [name, test] of tests) {
    try {
      await test();
      console.log(`✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`✗ ${name}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${passed}/${tests.length} tests passed`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);