# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Running the MCP Server
```bash
npm start                # Start the MCP server
node index.js           # Alternative way to start the server
```

### Development
```bash
npm install             # Install dependencies
```

Note: No tests are currently implemented. The `npm test` command will exit with an error.

## Architecture Overview

This is a Model Context Protocol (MCP) server that provides cookie-aware web fetching capabilities. The architecture consists of:

### Core Components

1. **MCP Server Setup** (`CookieFetchServer` class)
   - Uses `@modelcontextprotocol/sdk` for MCP protocol implementation
   - Exposes two tools: `fetch_with_cookies` and `download_with_cookies`
   - Runs on stdio transport for communication with LLM clients

2. **Cookie Extraction Strategy**
   - **Chromium browsers** (Chrome, Edge, Brave, Opera): Uses `chrome-cookies-secure` with browser-specific profile paths
   - **Firefox**: Direct SQLite access to `cookies.sqlite` database
   - **Safari**: Uses `@mherod/get-cookie` (macOS only)
   - Each browser has isolated cookie storage - no sharing between browsers

3. **Browser Detection**
   - Uses `default-browser` package to detect system default
   - Maps detected browsers to internal names via `normalizeBrowserName()`
   - No fallback assumptions - fails if browser cannot be detected

4. **Login Flow Handling**
   - `isLoginPage()` detects authentication pages by:
     - Domain redirects with login indicators (okta, auth0, sso, etc.)
     - HTML content with login forms
   - `waitForLogin()` polls for fresh cookies every 5 seconds (2-minute timeout)
   - Both fetch and download operations automatically handle re-authentication

### Key Design Decisions

- **Platform-specific dependencies**: `@mherod/get-cookie` only loads on non-Windows platforms, `winreg` was installed but is not currently used
- **No cookie persistence**: All cookies are read-only from browser storage
- **Streaming downloads**: Uses Node.js streams for efficient large file handling
- **Auto-login by default**: Can be disabled via `auto_login: false` parameter

### Browser Profile Locations

The server knows where each browser stores its cookies:
- Chrome: `AppData/Local/Google/Chrome/User Data` (Windows), `Library/Application Support/Google/Chrome` (macOS)
- Edge: `AppData/Local/Microsoft/Edge/User Data` (Windows)
- Firefox: Profile-based, searches for default profile in platform-specific locations
- Safari: Handled by `@mherod/get-cookie` on macOS

### Error Handling

- Throws errors when default browser detection fails
- Returns MCP error responses for tool failures
- Console.error for debug logging (visible in server logs, not to LLM)