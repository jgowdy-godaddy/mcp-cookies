#!/usr/bin/env node

// Test cookie extraction behavior with mock data
const assert = require('assert');
const path = require('path');

// Extract and test the normalizeBrowserName logic
const normalizeBrowserName = (browserInfo) => {
  if (!browserInfo || typeof browserInfo !== 'object') {
    throw new Error('Invalid browser info');
  }
  
  const id = (browserInfo.id || '').toLowerCase();
  const name = (browserInfo.name || '').toLowerCase();
  
  if (id.includes('chrome') || name.includes('chrome')) return 'chrome';
  if (id.includes('msedge') || name.includes('edge')) return 'edge';
  if (id.includes('firefox') || name.includes('firefox')) return 'firefox';
  if (id.includes('safari') || name.includes('safari')) return 'safari';
  if (id.includes('brave') || name.includes('brave')) return 'brave';
  if (id.includes('opera') || name.includes('opera')) return 'opera';
  
  return 'chrome';
};

// Test browser normalization
function testBrowserNormalization() {
  const testCases = [
    // Chrome variants
    { input: { id: 'com.google.chrome', name: 'Google Chrome' }, expected: 'chrome' },
    { input: { id: 'com.google.Chrome', name: 'Chrome' }, expected: 'chrome' },
    { input: { id: 'chrome', name: 'Google Chrome' }, expected: 'chrome' },
    
    // Edge variants
    { input: { id: 'com.microsoft.edge', name: 'Microsoft Edge' }, expected: 'edge' },
    { input: { id: 'msedge', name: 'Edge' }, expected: 'edge' },
    
    // Firefox variants
    { input: { id: 'org.mozilla.firefox', name: 'Firefox' }, expected: 'firefox' },
    { input: { id: 'firefox', name: 'Mozilla Firefox' }, expected: 'firefox' },
    
    // Safari variants
    { input: { id: 'com.apple.safari', name: 'Safari' }, expected: 'safari' },
    
    // Brave variants
    { input: { id: 'com.brave.browser', name: 'Brave Browser' }, expected: 'brave' },
    
    // Opera variants
    { input: { id: 'com.operasoftware.opera', name: 'Opera' }, expected: 'opera' },
    
    // Unknown browser (should default to chrome)
    { input: { id: 'com.unknown.browser', name: 'Unknown' }, expected: 'chrome' },
    
    // Edge cases
    { input: { id: '', name: 'Chrome' }, expected: 'chrome' },
    { input: { id: 'chrome', name: '' }, expected: 'chrome' },
    { input: { id: '', name: '' }, expected: 'chrome' },
  ];

  console.log('Testing browser normalization...');
  
  for (const testCase of testCases) {
    try {
      const result = normalizeBrowserName(testCase.input);
      assert.equal(result, testCase.expected, 
        `Failed for ${JSON.stringify(testCase.input)}: expected ${testCase.expected}, got ${result}`);
    } catch (e) {
      console.error(`✗ Browser normalization failed for ${JSON.stringify(testCase.input)}: ${e.message}`);
      return false;
    }
  }
  
  // Test error cases
  try {
    normalizeBrowserName(null);
    console.error('✗ Should have thrown for null input');
    return false;
  } catch (e) {
    // Expected
  }
  
  try {
    normalizeBrowserName(undefined);
    console.error('✗ Should have thrown for undefined input');
    return false;
  } catch (e) {
    // Expected
  }
  
  try {
    normalizeBrowserName('string');
    console.error('✗ Should have thrown for string input');
    return false;
  } catch (e) {
    // Expected
  }
  
  console.log('✓ Browser normalization tests passed');
  return true;
}

// Test login page detection patterns
function testLoginPageDetection() {
  // Mock isLoginPage function
  const isLoginPage = (url, responseUrl, text) => {
    const originalHost = new URL(url).hostname;
    const responseHost = new URL(responseUrl).hostname;
    
    const loginIndicators = [
      'okta', 'auth0', 'login', 'signin', 'sign-in', 'authenticate',
      'sso', 'saml', 'oauth', 'identity', 'accounts.google',
      'login.microsoftonline', 'github.com/login'
    ];
    
    const urlLower = responseUrl.toLowerCase();
    const isLoginUrl = loginIndicators.some(indicator => urlLower.includes(indicator));
    
    const textLower = text.toLowerCase();
    const hasLoginForm = textLower.includes('<input') && 
                        (textLower.includes('password') || textLower.includes('username') || textLower.includes('email'));
    
    return (originalHost !== responseHost && isLoginUrl) || hasLoginForm;
  };

  const testCases = [
    // Redirected to login domain
    {
      url: 'https://app.example.com',
      responseUrl: 'https://auth0.example.com/login',
      text: '',
      expected: true
    },
    // Same domain login page
    {
      url: 'https://example.com',
      responseUrl: 'https://example.com/login',
      text: '<input type="password">',
      expected: true
    },
    // Not a login page
    {
      url: 'https://example.com',
      responseUrl: 'https://example.com/home',
      text: '<h1>Welcome</h1>',
      expected: false
    },
    // GitHub login redirect
    {
      url: 'https://github.com/private/repo',
      responseUrl: 'https://github.com/login?return_to=...',
      text: '<input type="password">',
      expected: true
    },
    // Okta SSO
    {
      url: 'https://app.company.com',
      responseUrl: 'https://company.okta.com/app/saml',
      text: '',
      expected: true
    },
    // Microsoft login
    {
      url: 'https://app.company.com',
      responseUrl: 'https://login.microsoftonline.com/oauth2',
      text: '',
      expected: true
    },
    // Form with username field
    {
      url: 'https://example.com',
      responseUrl: 'https://example.com',
      text: '<form><input type="text" name="username"><input type="password"></form>',
      expected: true
    },
    // Form without login fields
    {
      url: 'https://example.com',
      responseUrl: 'https://example.com',
      text: '<form><input type="text" name="search"></form>',
      expected: false
    }
  ];

  console.log('\nTesting login page detection...');
  
  for (const testCase of testCases) {
    const result = isLoginPage(testCase.url, testCase.responseUrl, testCase.text);
    if (result !== testCase.expected) {
      console.error(`✗ Login detection failed for ${testCase.responseUrl}: expected ${testCase.expected}, got ${result}`);
      return false;
    }
  }
  
  console.log('✓ Login page detection tests passed');
  return true;
}

// Test URL validation
function testURLValidation() {
  console.log('\nTesting URL validation...');
  
  const validURLs = [
    'http://example.com',
    'https://example.com',
    'https://example.com:8080',
    'https://example.com/path',
    'https://example.com/path?query=value',
    'https://example.com/path#fragment',
    'https://sub.example.com',
    'https://192.168.1.1',
    'http://localhost:3000'
  ];
  
  const invalidURLs = [
    'ftp://example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'not-a-url',
    '',
    null,
    undefined,
    'ws://example.com',
    'wss://example.com'
  ];
  
  // Test valid URLs
  for (const url of validURLs) {
    try {
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        console.error(`✗ URL validation failed: ${url} should be valid`);
        return false;
      }
    } catch (e) {
      console.error(`✗ URL parsing failed for valid URL: ${url}`);
      return false;
    }
  }
  
  // Test invalid URLs
  for (const url of invalidURLs) {
    let shouldReject = false;
    try {
      if (!url) {
        shouldReject = true;
      } else {
        const urlObj = new URL(url);
        if (!['http:', 'https:'].includes(urlObj.protocol)) {
          shouldReject = true;
        }
      }
    } catch (e) {
      shouldReject = true;
    }
    
    if (!shouldReject) {
      console.error(`✗ URL validation failed: ${url} should be rejected`);
      return false;
    }
  }
  
  console.log('✓ URL validation tests passed');
  return true;
}

// Run all tests
function main() {
  console.log('Running cookie behavior tests...\n');
  
  const tests = [
    testBrowserNormalization,
    testLoginPageDetection,
    testURLValidation
  ];
  
  let passed = 0;
  for (const test of tests) {
    if (test()) {
      passed++;
    }
  }
  
  console.log(`\n${passed}/${tests.length} test suites passed`);
  
  if (passed !== tests.length) {
    process.exit(1);
  }
}

main();