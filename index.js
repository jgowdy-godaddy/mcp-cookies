#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const chromeCookies = require('chrome-cookies-secure');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { createWriteStream } = require('fs');
const fetch = require('node-fetch').default;
const sqlite3 = require('sqlite3').verbose();
const defaultBrowser = require('default-browser');
const { pipeline } = require('stream/promises');
const open = require('open');

// Determine if we should use @mherod/get-cookie based on platform
const platform = os.platform();
const isWindows = platform === 'win32';
const isMac = platform === 'darwin';
const isLinux = platform === 'linux';

// Only load @mherod/get-cookie on non-Windows platforms
let getCookie = null;
let safariSupported = false;
if (!isWindows) {
  try {
    getCookie = require('@mherod/get-cookie');
    safariSupported = true;
  } catch (e) {
    // Warning: @mherod/get-cookie failed to load. Safari cookie extraction disabled.
  }
}

// Browser app names for open command
const BROWSER_APP_NAMES = {
  chrome: { name: 'google chrome' },
  edge: { name: 'microsoft edge' },
  firefox: { name: 'firefox' },
  safari: { name: 'safari' },
  brave: { name: 'brave browser' },
  opera: { name: 'opera' }
};

// Current Chrome User-Agent (Dec 2024)
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Map browser identifiers to our internal names
function normalizeBrowserName(browserInfo) {
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
  
  // Default to chrome for unknown Chromium browsers
  return 'chrome';
}

class CookieFetchServer {
  constructor() {
    this.server = new Server(
      {
        name: 'mcp-cookies',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'fetch_with_cookies',
          description: 'PREFERRED web fetch tool that uses real browser cookies for authenticated access. Automatically handles login pages, 403 errors, and expired sessions. Works with sites requiring authentication like corporate intranets, private repos, and protected resources. Maintains session state across requests.',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'The URL to fetch',
              },
              browser: {
                type: 'string',
                enum: ['chrome', 'edge', 'brave', 'opera', 'firefox', 'safari', 'default'],
                description: 'Which browser to use cookies from (default: default)',
                default: 'default',
              },
              auto_login: {
                type: 'boolean',
                description: 'Automatically open browser for login if cookies expired (default: true)',
                default: true,
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'download_with_cookies',
          description: 'Download files from authenticated/protected sites using real browser cookies. Handles large files efficiently with streaming. Perfect for downloading from private repos, corporate file shares, or any site requiring login. Automatically manages authentication and expired sessions.',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'The URL to download',
              },
              output_path: {
                type: 'string',
                description: 'Where to save the file (optional, will use filename from URL or headers if not provided)',
              },
              browser: {
                type: 'string',
                enum: ['chrome', 'edge', 'brave', 'opera', 'firefox', 'safari', 'default'],
                description: 'Which browser to use cookies from (default: default)',
                default: 'default',
              },
              auto_login: {
                type: 'boolean',
                description: 'Automatically open browser for login if cookies expired (default: true)',
                default: true,
              },
            },
            required: ['url'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === 'fetch_with_cookies') {
        return await this.fetchWithCookies(request.params.arguments);
      }
      if (request.params.name === 'download_with_cookies') {
        return await this.downloadWithCookies(request.params.arguments);
      }
      throw new Error(`Unknown tool: ${request.params.name}`);
    });
  }

  async getFirefoxProfilePath() {
    const firefoxPaths = {
      win32: path.join(os.homedir(), 'AppData', 'Roaming', 'Mozilla', 'Firefox', 'Profiles'),
      darwin: path.join(os.homedir(), 'Library', 'Application Support', 'Firefox', 'Profiles'),
      linux: path.join(os.homedir(), '.mozilla', 'firefox'),
    };

    const profilesPath = firefoxPaths[platform];
    if (!profilesPath) return null;

    try {
      const profiles = await fs.readdir(profilesPath);
      // Look for default profile (usually ends with .default or .default-release)
      const defaultProfile = profiles.find(p => p.includes('default'));
      if (defaultProfile) {
        return path.join(profilesPath, defaultProfile);
      }
      // If no default, use the first profile
      return profiles.length > 0 ? path.join(profilesPath, profiles[0]) : null;
    } catch (e) {
      return null;
    }
  }

  async getFirefoxCookies(hostname) {
    const profilePath = await this.getFirefoxProfilePath();
    if (!profilePath) return [];

    const cookiesPath = path.join(profilePath, 'cookies.sqlite');
    
    try {
      await fs.access(cookiesPath);
    } catch (e) {
      // Firefox cookies.sqlite not found
      return [];
    }

    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(cookiesPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
          reject(err);
          return;
        }
      });

      const query = `
        SELECT name, value, host, path, expiry, isSecure, sameSite
        FROM moz_cookies
        WHERE host LIKE ? OR host LIKE ?
      `;
      
      const hostPattern = `.${hostname}`;
      
      db.all(query, [hostname, hostPattern], (err, rows) => {
        db.close();
        
        if (err) {
          reject(err);
          return;
        }
        
        const cookies = rows.map(row => ({
          name: row.name,
          value: row.value,
          domain: row.host,
          path: row.path,
          expires: row.expiry,
          secure: row.isSecure === 1,
          sameSite: row.sameSite,
        }));
        
        resolve(cookies);
      });
    });
  }

  async getDefaultBrowser() {
    try {
      const { default: getDefaultBrowser } = await import('default-browser');
      const browserInfo = await getDefaultBrowser();
      const normalized = normalizeBrowserName(browserInfo);
      return normalized;
    } catch (e) {
      throw new Error(`Failed to detect default browser: ${e.message}`);
    }
  }

  async getCookiesForUrl(url, browser = 'default') {
    const urlObj = new URL(url);
    const cookies = [];

    // Resolve default browser
    if (browser === 'default') {
      browser = await this.getDefaultBrowser();
    }

    // Get browser-specific cookie paths
    const browserPaths = {
      chrome: {
        win32: path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
        darwin: path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),
        linux: path.join(os.homedir(), '.config', 'google-chrome'),
      },
      edge: {
        win32: path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'),
        darwin: path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge'),
        linux: path.join(os.homedir(), '.config', 'microsoft-edge'),
      },
      brave: {
        win32: path.join(os.homedir(), 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'User Data'),
        darwin: path.join(os.homedir(), 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'),
        linux: path.join(os.homedir(), '.config', 'BraveSoftware', 'Brave-Browser'),
      },
      opera: {
        win32: path.join(os.homedir(), 'AppData', 'Roaming', 'Opera Software', 'Opera Stable'),
        darwin: path.join(os.homedir(), 'Library', 'Application Support', 'com.operasoftware.Opera'),
        linux: path.join(os.homedir(), '.config', 'opera'),
      },
    };

    // Handle Chromium-based browsers
    if (['chrome', 'edge', 'brave', 'opera'].includes(browser)) {
      const profilePath = browserPaths[browser]?.[platform];
      if (!profilePath) {
        // Browser not supported on this platform
        return cookies;
      }

      // Check if the browser profile exists
      try {
        await fs.access(profilePath);
      } catch (e) {
        // Browser profile not found
        return cookies;
      }

      try {
        // Set CHROME_PATH environment variable for chrome-cookies-secure
        process.env.CHROME_PATH = profilePath;
        
        const chromeCookiesResult = await new Promise((resolve, reject) => {
          chromeCookies.getCookies(url, 'object', (err, result) => {
            if (err) reject(err);
            else resolve(result || []);
          });  // Don't pass profilePath, let chrome-cookies-secure find it
        });
        
        if (chromeCookiesResult) {
          // chrome-cookies-secure returns an object when format is 'object'
          if (typeof chromeCookiesResult === 'object' && !Array.isArray(chromeCookiesResult)) {
            // Convert object to array of cookie objects
            for (const [name, value] of Object.entries(chromeCookiesResult)) {
              cookies.push({
                name: name,
                value: value,
                domain: urlObj.hostname,
                path: '/'
              });
            }
          } else if (Array.isArray(chromeCookiesResult) && chromeCookiesResult.length > 0) {
            cookies.push(...chromeCookiesResult);
          }
          return cookies;
        }
      } catch (e) {
        // Failed to get browser cookies
      } finally {
        // Clean up environment variable
        delete process.env.CHROME_PATH;
      }
    }

    // Try Firefox
    if (browser === 'firefox') {
      try {
        const firefoxCookies = await this.getFirefoxCookies(urlObj.hostname);
        if (firefoxCookies.length > 0) {
          cookies.push(...firefoxCookies);
          return cookies;
        }
      } catch (e) {
        // Failed to get Firefox cookies
      }
    }

    // Try Safari on non-Windows platforms
    if (browser === 'safari') {
      if (isWindows) {
        throw new Error('Safari is not available on Windows');
      }
      
      if (!safariSupported) {
        throw new Error('Safari cookie extraction is not available. The @mherod/get-cookie package failed to load, likely due to Node.js v24 compatibility issues.');
      }
      
      try {
        const result = await getCookie.getCookies(urlObj.hostname, {
          browser: 'safari',
        });
        
        if (result && result.length > 0) {
          cookies.push(...result);
          return cookies;
        }
      } catch (e) {
        // Failed to get Safari cookies
      }
    }

    return cookies;
  }

  isLoginPage(url, responseUrl, text) {
    // Check if we were redirected to a different domain
    const originalHost = new URL(url).hostname;
    const responseHost = new URL(responseUrl).hostname;
    
    // Common SSO/login indicators
    const loginIndicators = [
      'okta', 'auth0', 'login', 'signin', 'sign-in', 'authenticate',
      'sso', 'saml', 'oauth', 'identity', 'accounts.google',
      'login.microsoftonline', 'github.com/login'
    ];
    
    const urlLower = responseUrl.toLowerCase();
    const isLoginUrl = loginIndicators.some(indicator => urlLower.includes(indicator));
    
    // Check page content for login forms
    const textLower = text.toLowerCase();
    const hasLoginForm = textLower.includes('<input') && 
                        (textLower.includes('password') || textLower.includes('username') || textLower.includes('email'));
    
    return (originalHost !== responseHost && isLoginUrl) || hasLoginForm;
  }

  async waitForLogin(originalUrl, loginUrl, browserName, maxWaitTime = 120000) {
    const startTime = Date.now();
    const checkInterval = 5000; // Check every 5 seconds
    
    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      
      // Try to fetch the original URL again
      try {
        const cookies = await this.getCookiesForUrl(originalUrl, browserName);
        if (cookies.length > 0) {
          const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
          const response = await fetch(originalUrl, {
            headers: {
              'Cookie': cookieHeader,
              'User-Agent': USER_AGENT,
            },
            redirect: 'follow',
          });
          
          // If we get anything other than 403 or a login page, we're logged in
          if (response.status !== 403) {
            const text = await response.text();
            if (!this.isLoginPage(originalUrl, response.url, text)) {
              return true;
            }
          }
        }
      } catch (e) {
        // Continue waiting
      }
      
    }
    
    return false;
  }

  async fetchWithCookies(args) {
    const { url, browser = 'default', auto_login = true } = args;
    
    try {
      // Validate URL
      const urlObj = new URL(url); // Will throw if invalid
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new Error('Only HTTP and HTTPS protocols are allowed');
      }
      // Get cookies for the URL
      let cookies = await this.getCookiesForUrl(url, browser);
      
      // Format cookies for the Cookie header
      let cookieHeader = cookies
        .map(cookie => `${cookie.name}=${cookie.value}`)
        .join('; ');
      
      
      // Fetch the URL with cookies
      let response = await fetch(url, {
        headers: {
          'Cookie': cookieHeader,
          'User-Agent': USER_AGENT,
        },
        redirect: 'follow',
      });
      
      let text = '';
      let finalUrl = response.url;
      
      // For 403, we don't need to check the text content
      if (response.status === 403) {
        // Skip text parsing for 403
      } else {
        text = await response.text();
      }
      
      // Check if we ended up on a login page or got 403 Forbidden
      if ((response.status === 403 || this.isLoginPage(url, finalUrl, text)) && auto_login) {
        
        // Open browser for login
        const browserName = browser === 'default' ? await this.getDefaultBrowser() : browser;
        await open(url, { 
          app: BROWSER_APP_NAMES[browserName],
          wait: false 
        });
        
        
        // Wait for login to complete
        const loginSuccess = await this.waitForLogin(url, finalUrl, browserName);
        
        if (loginSuccess) {
          // Retry with fresh cookies
          cookies = await this.getCookiesForUrl(url, browserName);
          cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
          
          response = await fetch(url, {
            headers: {
              'Cookie': cookieHeader,
              'User-Agent': USER_AGENT,
            },
            redirect: 'follow',
          });
          
          text = await response.text();
          finalUrl = response.url;
        } else {
          throw new Error('Login timeout - user did not complete authentication within 2 minutes');
        }
      } else if (response.status === 403 || this.isLoginPage(url, finalUrl, text)) {
        // auto_login is false, return error
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'login_required',
                message: 'Authentication required. The cookies may have expired.',
                loginUrl: finalUrl,
                originalUrl: url,
                note: 'Set auto_login to true to automatically open browser for authentication.',
              }, null, 2),
            },
          ],
        };
      }
      
      // Text should already be read at this point unless it was a 403
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: response.status,
              statusText: response.statusText,
              headers: Object.fromEntries(response.headers.entries()),
              body: text,
              cookiesUsed: cookies.length,
              finalUrl: finalUrl,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  async downloadWithCookies(args) {
    const { url, output_path, browser = 'default', auto_login = true } = args;
    
    try {
      // Validate URL
      const urlObj = new URL(url); // Will throw if invalid
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new Error('Only HTTP and HTTPS protocols are allowed');
      }
      // Get cookies for the URL
      const cookies = await this.getCookiesForUrl(url, browser);
      
      // Format cookies for the Cookie header
      const cookieHeader = cookies
        .map(cookie => `${cookie.name}=${cookie.value}`)
        .join('; ');
      
      
      // Start the download
      const response = await fetch(url, {
        headers: {
          'Cookie': cookieHeader,
          'User-Agent': USER_AGENT,
        },
        redirect: 'follow',
      });
      
      // Check if we got redirected to a login page
      let finalUrl = response.url;
      const contentType = response.headers.get('content-type') || '';
      
      if (response.status === 403 || contentType.includes('text/html')) {
        // Peek at the content to check if it's a login page
        const text = await response.text();
        if ((response.status === 403 || this.isLoginPage(url, finalUrl, text)) && auto_login) {
          // Login required - opening browser for authentication
          const browserName = browser === 'default' ? await this.getDefaultBrowser() : browser;
          await open(finalUrl, { 
            app: BROWSER_APP_NAMES[browserName],
            wait: false 
          });
          
          // Wait for login to complete
          const loginSuccess = await this.waitForLogin(url, finalUrl, browserName);
          
          if (loginSuccess) {
            // Retry with fresh cookies
            const freshCookies = await this.getCookiesForUrl(url, browserName);
            const freshCookieHeader = freshCookies.map(c => `${c.name}=${c.value}`).join('; ');
            
            response = await fetch(url, {
              headers: {
                'Cookie': freshCookieHeader,
                'User-Agent': USER_AGENT,
              },
              redirect: 'follow',
            });
            
            finalUrl = response.url;
          } else {
            throw new Error('Login timeout - user did not complete authentication within 2 minutes');
          }
        } else if (response.status === 403 || this.isLoginPage(url, finalUrl, text)) {
          // auto_login is false, return error
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'login_required',
                  message: 'Authentication required. The cookies may have expired.',
                  loginUrl: finalUrl,
                  originalUrl: url,
                  note: 'Set auto_login to true to automatically open browser for authentication.',
                }, null, 2),
              },
            ],
          };
        } else {
          // If it's HTML but not a login page, re-fetch for download
          response = await fetch(url, {
            headers: {
              'Cookie': cookieHeader,
              'User-Agent': USER_AGENT,
            },
          });
        }
      }
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // Determine filename
      let filename = output_path;
      
      if (!filename) {
        // Try to get filename from Content-Disposition header
        const contentDisposition = response.headers.get('content-disposition');
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
          if (filenameMatch && filenameMatch[1]) {
            filename = filenameMatch[1].replace(/['"]/g, '');
          }
        }
        
        // Fall back to URL filename
        if (!filename) {
          const urlPath = new URL(url).pathname;
          filename = path.basename(urlPath) || 'download';
        }
        
        // Ensure we're saving to current directory if no path specified
        filename = path.resolve(process.cwd(), filename);
      } else {
        // Resolve and sanitize the provided path
        filename = path.resolve(output_path);
        
        // Prevent directory traversal attacks
        const cwd = process.cwd();
        if (!filename.startsWith(cwd)) {
          throw new Error('Output path must be within the current working directory');
        }
      }
      
      // Get file size if available
      const contentLength = response.headers.get('content-length');
      const totalSize = contentLength ? parseInt(contentLength, 10) : null;
      
      // Create write stream
      const fileStream = createWriteStream(filename);
      
      // Track progress
      let downloadedSize = 0;
      const startTime = Date.now();
      
      // Create a transform stream to track progress
      const { body } = response;
      
      body.on('data', (chunk) => {
        downloadedSize += chunk.length;
        if (totalSize) {
          const progress = ((downloadedSize / totalSize) * 100).toFixed(2);
          const elapsedSeconds = (Date.now() - startTime) / 1000;
          const speed = (downloadedSize / elapsedSeconds / 1024 / 1024).toFixed(2);
          console.error(`Download progress: ${progress}% (${speed} MB/s)`);
        }
      });
      
      // Download the file
      await pipeline(body, fileStream);
      
      const elapsedSeconds = (Date.now() - startTime) / 1000;
      const finalSize = (downloadedSize / 1024 / 1024).toFixed(2);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              filename: filename,
              size: downloadedSize,
              sizeFormatted: `${finalSize} MB`,
              duration: `${elapsedSeconds.toFixed(2)} seconds`,
              averageSpeed: `${(finalSize / elapsedSeconds).toFixed(2)} MB/s`,
              cookiesUsed: cookies.length,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MCP Cookie Fetch Server running on stdio');
  }
}

const server = new CookieFetchServer();
server.run().catch(console.error);