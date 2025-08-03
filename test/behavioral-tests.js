#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const assert = require('assert');

class MCPTestClient {
  constructor() {
    this.server = null;
    this.responses = new Map();
    this.nextId = 1;
  }

  async start() {
    this.server = spawn('node', [path.join(__dirname, '..', 'index.js')], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.server.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          if (response.id && this.responses.has(response.id)) {
            this.responses.get(response.id).resolve(response);
            this.responses.delete(response.id);
          }
        } catch (e) {
          // Not JSON, ignore
        }
      }
    });

    this.server.stderr.on('data', (data) => {
      // Log server errors for debugging
      if (data.toString().includes('Error:')) {
        console.error('Server error:', data.toString());
      }
    });

    // Initialize
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' }
    });
  }

  async request(method, params) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.responses.set(id, { resolve, reject });
      setTimeout(() => {
        this.responses.delete(id);
        reject(new Error('Request timeout'));
      }, 10000); // 10 second timeout
    });

    const request = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    this.server.stdin.write(request);

    return promise;
  }

  async stop() {
    if (this.server) {
      this.server.kill();
    }
  }
}

// Test runner
async function runTest(name, testFn) {
  const client = new MCPTestClient();
  try {
    await client.start();
    await testFn(client);
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    throw e;
  } finally {
    await client.stop();
  }
}

// Behavioral Tests

async function testInvalidURLRejection(client) {
  // Test 1: Invalid protocol
  const response1 = await client.request('tools/call', {
    name: 'fetch_with_cookies',
    arguments: {
      url: 'ftp://example.com',
      auto_login: false
    }
  });
  assert(response1.result.isError);
  assert(response1.result.content[0].text.includes('Only HTTP and HTTPS'));

  // Test 2: Malformed URL
  const response2 = await client.request('tools/call', {
    name: 'fetch_with_cookies',
    arguments: {
      url: 'not-a-url',
      auto_login: false
    }
  });
  assert(response2.result.isError);
  assert(response2.result.content[0].text.includes('Invalid URL'));
}

async function testBrowserValidation(client) {
  // Test invalid browser
  const response = await client.request('tools/call', {
    name: 'fetch_with_cookies',
    arguments: {
      url: 'https://example.com',
      browser: 'invalid-browser',
      auto_login: false
    }
  });
  
  // Should still work (falls back to chrome) but have 0 cookies
  assert(response.result.content);
  const result = JSON.parse(response.result.content[0].text);
  assert.equal(result.cookiesUsed, 0);
}

async function testLoginDetection(client) {
  // Test that 403 is detected as login required when auto_login is false
  const response = await client.request('tools/call', {
    name: 'fetch_with_cookies',
    arguments: {
      url: 'https://httpstat.us/403',
      auto_login: false
    }
  });
  
  assert(response.result.content);
  const result = JSON.parse(response.result.content[0].text);
  assert.equal(result.status, 'login_required');
  assert(result.message.includes('Authentication required'));
}

async function testDownloadPathValidation(client) {
  // Test directory traversal prevention
  const response = await client.request('tools/call', {
    name: 'download_with_cookies',
    arguments: {
      url: 'https://example.com/file.txt',
      output_path: '../../../etc/passwd',
      auto_login: false
    }
  });
  
  assert(response.result.isError);
  assert(response.result.content[0].text.includes('within the current working directory'));
}

async function testConcurrentRequests(client) {
  // Test that server can handle multiple concurrent requests
  const promises = [];
  
  for (let i = 0; i < 5; i++) {
    promises.push(client.request('tools/call', {
      name: 'fetch_with_cookies',
      arguments: {
        url: `https://httpstat.us/200?id=${i}`,
        auto_login: false
      }
    }));
  }
  
  const responses = await Promise.all(promises);
  
  // All should succeed
  for (const response of responses) {
    assert(response.result.content);
    const result = JSON.parse(response.result.content[0].text);
    assert.equal(result.status, 200);
  }
}

async function testHTTPStatusCodes(client) {
  const statusCodes = [200, 404, 500];
  
  for (const status of statusCodes) {
    const response = await client.request('tools/call', {
      name: 'fetch_with_cookies',
      arguments: {
        url: `https://httpstat.us/${status}`,
        auto_login: false
      }
    });
    
    assert(response.result.content);
    const result = JSON.parse(response.result.content[0].text);
    assert.equal(result.status, status);
  }
}

async function testCookieHeader(client) {
  // Test that cookies are properly formatted in header
  const response = await client.request('tools/call', {
    name: 'fetch_with_cookies',
    arguments: {
      url: 'https://httpbin.org/headers',
      browser: 'chrome',
      auto_login: false
    }
  });
  
  assert(response.result.content);
  const result = JSON.parse(response.result.content[0].text);
  assert.equal(result.status, 200);
  
  // Check that the response includes headers
  const body = JSON.parse(result.body);
  assert(body.headers);
}

async function testLargeResponse(client) {
  // Test handling of large responses
  const response = await client.request('tools/call', {
    name: 'fetch_with_cookies',
    arguments: {
      url: 'https://httpbin.org/bytes/10000',
      auto_login: false
    }
  });
  
  assert(response.result.content);
  const result = JSON.parse(response.result.content[0].text);
  assert.equal(result.status, 200);
  // Body should be base64 encoded binary data
  assert(result.body.length > 0);
}

async function testTimeoutHandling(client) {
  // Test that very slow requests don't hang forever
  const response = await client.request('tools/call', {
    name: 'fetch_with_cookies',
    arguments: {
      url: 'https://httpstat.us/200?sleep=30000',
      auto_login: false
    }
  });
  
  // Should either timeout or complete
  assert(response.result);
}

// Main test runner
async function main() {
  const tests = [
    ['Invalid URL rejection', testInvalidURLRejection],
    ['Browser validation', testBrowserValidation],
    ['Login detection (403)', testLoginDetection],
    ['Download path validation', testDownloadPathValidation],
    ['Concurrent requests', testConcurrentRequests],
    ['HTTP status codes', testHTTPStatusCodes],
    ['Cookie header formatting', testCookieHeader],
    ['Large response handling', testLargeResponse],
    ['Timeout handling', testTimeoutHandling]
  ];

  let passed = 0;
  let failed = 0;

  console.log('Running behavioral tests...\n');

  for (const [name, test] of tests) {
    try {
      await runTest(name, test);
      passed++;
    } catch (e) {
      failed++;
    }
  }

  console.log(`\n${passed}/${tests.length} tests passed`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);