# MCP Cookies Test Suite

This directory contains the test suite for the MCP Cookies server.

## Test Files

- `cookie-mock-test.js` - Unit tests for browser normalization, login detection, and URL validation
- `integration-tests.js` - Tests for MCP protocol flow and error handling
- `behavioral-tests.js` - End-to-end tests for the server's behavior
- `run-all-tests.js` - Test runner that executes all test suites

## Running Tests

```bash
# Run all tests
npm test

# Run individual test suites
npm run test:mock        # Fast unit tests
npm run test:integration # MCP protocol tests
npm run test:behavioral  # Full behavioral tests (slower, requires internet)
```

## Known Issues

The behavioral tests make real HTTP requests to external services, which can:
- Be slow (30+ seconds per test)
- Fail due to network issues
- Timeout on slow connections

For CI/CD environments, consider running only the mock and integration tests:
```bash
npm run test:mock && npm run test:integration
```

## Test Coverage

- Browser detection and normalization
- Login page detection patterns
- URL validation and sanitization
- MCP protocol compliance
- Error handling and edge cases
- Cookie extraction behavior (mocked)
- Concurrent request handling
- Path traversal prevention