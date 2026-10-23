import { createRemoteJWKSet, jwtVerify } from "jose";

const caches = new Map();

export async function requireAccess(request, env, adminOnly = false) {
  const team = String(env.ACCESS_TEAM_DOMAIN || "").replace(/\/$/, "");
  const audience = String(env.ACCESS_AUD || "");
  const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(team) || !audience || !adminEmail) {
    return { error: new Response("Espace privé non configuré.", { status: 503, headers: { "Cache-Control": "no-store" } }) };
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    return { error: new Response("Connexion nécessaire.", { status: 401, headers: { "Cache-Control": "no-store" } }) };
  }
  try {
    let keys = caches.get(team);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(team + "/cdn-cgi/access/certs"));
      caches.set(team, keys);
    }
    const { payload } = await jwtVerify(token, keys, { issuer: team, audience, algorithms: ["RS256"] });
    if (payload.type !== "app" || typeof payload.email !== "string" || !payload.email.includes("@")) {
      throw new Error("Identity required");
    }
    const email = payload.email.toLowerCase();
    const isAdmin = email === adminEmail;
    if (adminOnly && !isAdmin) {
      return { error: new Response("Accès réservé à l'administrateur.", { status: 403, headers: { "Cache-Control": "no-store" } }) };
    }
    return { user: { email, isAdmin } };
  } catch {
    return { error: new Response("Session invalide ou expirée.", { status: 401, headers: { "Cache-Control": "no-store" } }) };
  }
}

const SITE_SESSION_COOKIE = "voyage_site_session";
const SITE_SESSION_SECONDS = 7 * 24 * 60 * 60;
const SITE_SESSION_PREFIX = "__meta/site-access-sessions/";

export function normalizeSiteEmails(input) {
  if (!Array.isArray(input) || input.length > 100) return null;
  const emails = [];
  for (const item of input) {
    if (typeof item !== "string") return null;
    const email = item.trim().toLowerCase();
    if (!email) continue;
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    if (!emails.includes(email)) emails.push(email);
  }
  return emails;
}

function readSiteCookie(request) {
  const cookies = request.headers.get("Cookie") || "";
  for (const item of cookies.split(";")) {
    const index = item.indexOf("=");
    if (index < 0) continue;
    if (item.slice(0, index).trim() === SITE_SESSION_COOKIE) return item.slice(index + 1).trim();
  }
  return "";
}

function bytesToHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

async function siteSessionKey(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return SITE_SESSION_PREFIX + bytesToHex(new Uint8Array(digest)) + ".json";
}

function allowedSiteEmail(email, config, env) {
  const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  const allowlist = Array.isArray(config?.emails) ? config.emails : [];
  return email === adminEmail || allowlist.includes(email);
}

export async function getSiteAccessSession(request, env, config) {
  const token = readSiteCookie(request);
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token) || !env.PHOTOS_PRIVEES) return null;
  try {
    const key = await siteSessionKey(token);
    const object = await env.PHOTOS_PRIVEES.get(key);
    if (!object) return null;
    const session = await object.json();
    if (typeof session?.email !== "string" || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) {
      await env.PHOTOS_PRIVEES.delete?.(key);
      return null;
    }
    const email = session.email.trim().toLowerCase();
    return allowedSiteEmail(email, config, env) ? { email, expiresAt: session.expiresAt } : null;
  } catch {
    return null;
  }
}

export async function createSiteAccessSession(env, email) {
  if (!env.PHOTOS_PRIVEES) throw new Error("Stockage des sessions indisponible.");
  const random = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...random)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const expiresAt = Date.now() + SITE_SESSION_SECONDS * 1000;
  const key = await siteSessionKey(token);
  await env.PHOTOS_PRIVEES.put(key, JSON.stringify({
    email: email.trim().toLowerCase(),
    createdAt: new Date().toISOString(),
    expiresAt
  }), { httpMetadata: { contentType: "application/json" } });
  return { token, expiresAt };
}

export async function clearSiteAccessSession(request, env) {
  const token = readSiteCookie(request);
  if (/^[A-Za-z0-9_-]{40,50}$/.test(token) && env.PHOTOS_PRIVEES) {
    try { await env.PHOTOS_PRIVEES.delete(await siteSessionKey(token)); } catch {}
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Set-Cookie": SITE_SESSION_COOKIE + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"
    }
  });
}

export async function requireSiteAccess(request, env, config) {
  const session = await getSiteAccessSession(request, env, config);
  if (session) return { user: { email: session.email, isAdmin: false } };
  const url = new URL(request.url);
  const acceptsHtml = (request.headers.get("Accept") || "").includes("text/html");
  if (["GET", "HEAD"].includes(request.method) && acceptsHtml) {
    const next = url.pathname + url.search;
    return { error: new Response(null, {
      status: 302,
      headers: {
        "Location": new URL("/connexion/?next=" + encodeURIComponent(next), url.origin).href,
        "Cache-Control": "no-store"
      }
    }) };
  }
  return { error: new Response(JSON.stringify({ error: "Connexion nécessaire." }), {
    status: 401,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  }) };
}

export function siteSessionCookie(token) {
  return SITE_SESSION_COOKIE + "=" + token + "; Path=/; Max-Age=" + SITE_SESSION_SECONDS + "; HttpOnly; Secure; SameSite=Lax";
}
