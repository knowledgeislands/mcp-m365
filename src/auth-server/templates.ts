// HTML response templates for the auth server.
// Keep markup here so the request handler stays focused on flow control.

const escapeHtml = (str: string | null | undefined): string => {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export const invalidState = (): string => {
  return `
    <html><head><title>Invalid State</title></head>
    <body><h1>Authentication Error</h1>
    <p>Invalid or expired OAuth state parameter. Please try authenticating again.</p></body></html>
  `
}

export const authError = (error: string, errorDescription?: string): string => {
  return `
    <html>
      <head>
        <title>Authentication Error</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
          h1 { color: #d9534f; }
          .error-box { background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <h1>Authentication Error</h1>
        <div class="error-box">
          <p><strong>Error:</strong> ${escapeHtml(error)}</p>
          <p><strong>Description:</strong> ${escapeHtml(errorDescription || 'No description provided')}</p>
        </div>
        <p>Please close this window and try again.</p>
      </body>
    </html>
  `
}

export const authSuccess = (): string => {
  return `
    <html>
      <head>
        <title>Authentication Successful</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
          h1 { color: #5cb85c; }
          .success-box { background-color: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <h1>Authentication Successful!</h1>
        <div class="success-box">
          <p>You have successfully authenticated with Microsoft Graph API.</p>
          <p>The access token has been saved securely.</p>
        </div>
        <p>You can now close this window and return to Claude.</p>
      </body>
    </html>
  `
}

export const tokenExchangeError = (errorMessage: string): string => {
  return `
    <html>
      <head>
        <title>Token Exchange Error</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
          h1 { color: #d9534f; }
          .error-box { background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <h1>Token Exchange Error</h1>
        <div class="error-box">
          <p>${escapeHtml(errorMessage)}</p>
        </div>
        <p>Please close this window and try again.</p>
      </body>
    </html>
  `
}

export const missingCode = (): string => {
  return `
    <html>
      <head>
        <title>Missing Authorization Code</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
          h1 { color: #d9534f; }
          .error-box { background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <h1>Missing Authorization Code</h1>
        <div class="error-box">
          <p>No authorization code was provided in the callback.</p>
        </div>
        <p>Please close this window and try again.</p>
      </body>
    </html>
  `
}

export const configError = (): string => {
  return `
    <html>
      <head>
        <title>Configuration Error</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
          h1 { color: #d9534f; }
          .error-box { background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 4px; }
          code { background: #f4f4f4; padding: 2px 4px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <h1>Configuration Error</h1>
        <div class="error-box">
          <p>Microsoft Graph API credentials are not set. Please set the following environment variables:</p>
          <ul>
            <li><code>MCP_M365_CLIENT_ID</code></li>
            <li><code>MCP_M365_CLIENT_SECRET</code></li>
          </ul>
        </div>
      </body>
    </html>
  `
}

export const rootInfo = (authServerUrl: string): string => {
  return `
    <html>
      <head>
        <title>m365 Authentication Server</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          h1 { color: #0078d4; }
          .info-box { background-color: #e7f6fd; border: 1px solid #b3e0ff; padding: 15px; border-radius: 4px; }
          code { background: #f4f4f4; padding: 2px 4px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <h1>m365 Authentication Server</h1>
        <div class="info-box">
          <p>This server is running to handle Microsoft Graph API authentication callbacks.</p>
          <p>Don't navigate here directly. Instead, use the <code>authenticate</code> tool in Claude to start the authentication process.</p>
          <p>Make sure you've set the <code>MCP_M365_CLIENT_ID</code> and <code>MCP_M365_CLIENT_SECRET</code> environment variables.</p>
        </div>
        <p>Server is running at ${authServerUrl}</p>
      </body>
    </html>
  `
}
