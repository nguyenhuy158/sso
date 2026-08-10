import type { SessionClaims } from "./jwt";

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function landingPage(params: { issuer: string; claims: SessionClaims | null }): string {
  const { claims } = params;

  const body = claims
    ? `<p class="who">Signed in as <strong>${esc(claims.email ?? claims.name ?? claims.sub)}</strong></p>
       <p class="muted">Session expires ${esc(new Date(claims.exp * 1000).toISOString())}</p>
       <a class="btn secondary" href="/logout">Sign out of every app</a>`
    : `<p class="muted">Single sign-on for every app on huyab.click.</p>
       <a class="btn" href="/login">Sign in with Google</a>`;

  return `<!DOCTYPE html>
<html>
<head>
    <title>huyab.click SSO</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        body { font-family: "Be Vietnam Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: #2c3e50; color: #333; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
        .card { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); width: 360px; text-align: center; }
        h1 { margin: 0 0 8px; font-size: 1.4em; }
        .muted { color: #777; font-size: 0.9em; }
        .who { font-size: 1em; }
        .btn { display: inline-block; margin-top: 18px; padding: 12px 20px; background: #3498db; color: white; border-radius: 4px; text-decoration: none; font-weight: 600; }
        .btn.secondary { background: #e74c3c; }
        code { background: #f4f6f9; padding: 2px 5px; border-radius: 3px; font-size: 0.85em; }
        .hint { margin-top: 26px; text-align: left; font-size: 0.8em; color: #888; line-height: 1.6; }
    </style>
</head>
<body>
    <div class="card">
        <h1>huyab.click SSO</h1>
        ${body}
        <div class="hint">
            Apps start a login with<br>
            <code>${esc(params.issuer)}/login?redirect_uri=&lt;page&gt;</code><br>
            and verify the <code>huyab_sso</code> cookie against<br>
            <code>${esc(params.issuer)}/.well-known/jwks.json</code>
        </div>
    </div>
</body>
</html>`;
}
