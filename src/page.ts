import { DEFAULT_KEY_DAYS, MAX_KEY_DAYS, MAX_LABEL_LENGTH } from "./auth-keys";
import type { SessionClaims } from "./jwt";

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Plain browser script for the admin panel. Values from the API are only ever
// set with textContent, never innerHTML, so a key label cannot inject markup.
const adminScript = `
const $ = (id) => document.getElementById(id);
const status = $("key-status");
const api = async (path, init) => {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "HTTP " + response.status);
  return body;
};
const copy = async (text, button) => {
  try {
    await navigator.clipboard.writeText(text);
    const label = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = label; }, 1200);
  } catch {
    status.textContent = "Copy failed: select the key and copy it by hand.";
  }
};
const isActive = (key) => !key.revokedAt && Date.parse(key.expiresAt) > Date.now();
const button = (text, onClick) => {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  element.addEventListener("click", onClick);
  return element;
};
const render = (keys) => {
  const list = $("key-list");
  list.replaceChildren();
  if (keys.length === 0) status.textContent = "No keys yet.";
  for (const key of keys) {
    const active = isActive(key);
    const row = document.createElement("div");
    row.className = active ? "row" : "row off";
    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("strong");
    name.textContent = key.label + " (" + key.id + ")";
    const meta = document.createElement("span");
    meta.className = "muted";
    meta.textContent = (key.revokedAt ? "revoked " + key.revokedAt.slice(0, 10) : (active ? "expires " : "expired ") + key.expiresAt.slice(0, 10)) +
      " · last used " + (key.lastUsedAt ? key.lastUsedAt.slice(0, 10) : "never");
    info.append(name, meta);
    row.append(info);
    if (active && key.revealable) {
      const copyButton = button("Copy", async () => {
        try {
          copy((await api("/keys/" + key.id + "/secret")).key, copyButton);
        } catch (error) {
          status.textContent = "Cannot show key: " + error.message;
        }
      });
      row.append(copyButton);
    }
    if (active) {
      row.append(button("Revoke", async () => {
        if (!confirm("Revoke " + key.label + "? CLIs using it stop working.")) return;
        try {
          await api("/keys/" + key.id, { method: "DELETE" });
          await load();
        } catch (error) {
          status.textContent = "Revoke failed: " + error.message;
        }
      }));
    }
    list.append(row);
  }
};
const load = async () => {
  try {
    status.textContent = "";
    render((await api("/keys")).keys);
  } catch (error) {
    status.textContent = "Cannot load keys: " + error.message;
  }
};
$("key-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const key = await api("/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: $("key-label").value, days: Number($("key-days").value) }),
    });
    $("key-new").hidden = false;
    $("key-new-value").value = key.key;
    $("key-label").value = "";
    await load();
    status.textContent = key.revealable ? "Created. You can copy it again later." : "Created. Copy it now: it is not stored.";
  } catch (error) {
    status.textContent = "Create failed: " + error.message;
  }
});
$("key-new-copy").addEventListener("click", (event) => copy($("key-new-value").value, event.target));
load();
`;

export function landingPage(params: {
  issuer: string;
  claims: SessionClaims | null;
  isAdmin: boolean;
}): string {
  const { claims, isAdmin } = params;

  const body = claims
    ? `<p class="who">Signed in as <strong>${esc(claims.email ?? claims.name ?? claims.sub)}</strong></p>
       <p class="muted">Session expires ${esc(new Date(claims.exp * 1000).toISOString())}</p>
       <a class="btn secondary" href="/logout">Sign out of every app</a>`
    : `<p class="muted">Single sign-on for every app on huyab.cfd.</p>
       <a class="btn" href="/login">Sign in with Google</a>`;

  const adminPanel = isAdmin
    ? `<section class="keys">
        <h2>Auth keys</h2>
        <form id="key-form">
          <input id="key-label" placeholder="Name, e.g. mac cli" maxlength="${MAX_LABEL_LENGTH}" required>
          <input id="key-days" type="number" min="1" max="${MAX_KEY_DAYS}" value="${DEFAULT_KEY_DAYS}" title="Days until it expires">
          <button class="btn small" type="submit">Create</button>
        </form>
        <div id="key-new" class="newkey" hidden>
          <input id="key-new-value" readonly>
          <button class="btn small" id="key-new-copy" type="button">Copy</button>
        </div>
        <p id="key-status" class="muted" role="status"></p>
        <div id="key-list" class="list"></div>
      </section>
      <script>${adminScript}</script>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
    <title>huyab.cfd SSO</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        body { font-family: "Be Vietnam Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: #2c3e50; color: #333; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
        .card { background: white; padding: 32px 40px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); width: ${isAdmin ? 460 : 360}px; max-width: 100%; box-sizing: border-box; text-align: center; }
        .keys { margin-top: 18px; padding-top: 14px; border-top: 1px solid #eee; text-align: left; }
        .keys h2 { margin: 0 0 8px; font-size: 1em; }
        .keys form, .newkey { display: flex; gap: 6px; margin-bottom: 8px; }
        .keys input { font: inherit; font-size: 16px; padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px; min-width: 0; }
        #key-label, #key-new-value { flex: 1; }
        #key-days { width: 64px; }
        .btn.small { margin: 0; padding: 6px 12px; border: 0; cursor: pointer; font: inherit; font-weight: 600; }
        .list { max-height: 150px; overflow-y: auto; }
        .row { display: flex; align-items: center; gap: 6px; padding: 6px 0; border-top: 1px solid #f0f0f0; font-size: 0.85em; }
        .row .info { flex: 1; min-width: 0; }
        .row .info strong, .row .info span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .row.off { opacity: 0.5; }
        .row button { font: inherit; font-size: 0.85em; padding: 4px 8px; border: 1px solid #ccc; background: #fff; border-radius: 4px; cursor: pointer; }
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
        <h1>huyab.cfd SSO</h1>
        ${body}
        ${adminPanel}
        ${
          isAdmin
            ? ""
            : `<div class="hint">
            Apps start a login with<br>
            <code>${esc(params.issuer)}/login?redirect_uri=&lt;page&gt;</code><br>
            and verify the <code>huyab_sso</code> cookie against<br>
            <code>${esc(params.issuer)}/.well-known/jwks.json</code>
        </div>`
        }
    </div>
</body>
</html>`;
}
