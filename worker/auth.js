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
