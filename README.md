# MCP Cookies

A Model Context Protocol (MCP) server that provides cookie-aware web fetching capabilities to LLMs. This server allows LLMs to fetch web content and download files using cookies from installed browsers, with automatic handling of authentication flows when cookies expire.

## Features

- **Multi-Browser Support**: Extracts cookies from Chrome, Edge, Brave, Opera, Firefox, and Safari
- **Cross-Platform**: Works on Windows, macOS, and Linux (with platform-specific browser support)
- **Automatic Login Handling**: Detects expired cookies and opens browser for re-authentication
- **Smart Cookie Extraction**: Only extracts cookies from the specific browser requested
- **Default Browser Detection**: Automatically detects and uses the system's default browser
- **Large File Support**: Streaming downloads with progress reporting for large files
- **Binary File Support**: Correctly handles both text and binary file downloads

## Installation

```bash
npm install
```

## Usage

### As an MCP Server

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "cookies": {
      "command": "node",
      "args": ["/path/to/mcp-cookies/index.js"]
    }
  }
}
```

### Available Tools

#### `fetch_with_cookies`

Fetches a URL using browser cookies.

```typescript
{
  url: string,              // URL to fetch
  browser?: string,         // Browser to use (default: system default)
  auto_login?: boolean      // Auto-open browser if login needed (default: true)
}
```

#### `download_with_cookies`

Downloads a file to disk using browser cookies.

```typescript
{
  url: string,              // URL to download
  output_path?: string,     // Where to save (optional)
  browser?: string,         // Browser to use (default: system default)
  auto_login?: boolean      // Auto-open browser if login needed (default: true)
}
```

### Browser Support

| Browser | Windows | macOS | Linux |
|---------|---------|-------|-------|
| Chrome  | ✅      | ✅    | ✅    |
| Edge    | ✅      | ✅    | ✅    |
| Brave   | ✅      | ✅    | ✅    |
| Opera   | ✅      | ✅    | ✅    |
| Firefox | ✅      | ✅    | ✅    |
| Safari  | ❌      | ✅    | ❌    |

## How It Works

1. **Cookie Extraction**: The server reads cookies directly from browser cookie stores:
   - Chromium browsers: Uses `chrome-cookies-secure` to decrypt cookies
   - Firefox: Reads from SQLite database (`cookies.sqlite`)
   - Safari: Uses `@mherod/get-cookie` on macOS

2. **Login Detection**: When fetching/downloading, the server detects login pages by:
   - Checking for redirects to different domains with login indicators
   - Scanning HTML content for login forms
   - Recognizing common SSO providers (Okta, Auth0, etc.)

3. **Automatic Re-authentication**: If login is required:
   - Opens the user's browser to the login page
   - Waits for authentication to complete (checks every 5 seconds)
   - Automatically retries with fresh cookies
   - Returns the originally requested content

## Development

```bash
# Run the server
npm start

# Run in development mode
node index.js
```

## Security Considerations

- Cookies are only read from local browser storage
- No cookies are transmitted or stored by the MCP server
- Cookies are only used for the specific domains requested
- All cookie access is read-only

## Requirements

- Node.js 18+
- Supported browser(s) installed
- Windows: May require elevation for some browsers
- macOS: May require Keychain access for Chrome/Edge

## License

MIT