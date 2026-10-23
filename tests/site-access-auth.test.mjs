import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSiteEmails,
  createSiteAccessSession,
  getSiteAccessSession,
  clearSiteAccessSession,
  requireSiteAccess
} from "../worker/auth.js";

function bucket() {
  const items = new Map();
  return {
    get: async key => items.has(key) ? { json: async () => JSON.parse(items.get(key)) } : null,
    put: async (key, value) => items.set(key, value),
    delete: async key => items.delete(key)
  };
}

test("la liste d'accès normalise les adresses et élimine les doublons", () => {
  assert.deepEqual(normalizeSiteEmails([" Ami@Example.com ", "ami@example.com", "", "FAMILLE@example.org"]), [
    "ami@example.com", "famille@example.org"
  ]);
  assert.equal(normalizeSiteEmails(["pas-une-adresse"]), null);
  assert.equal(normalizeSiteEmails(Array.from({ length: 101 }, (_, i) => `a${i}@example.com`)), null);
});

test("une session e-mail autorisée est valide, puis révocable par la liste blanche", async () => {
  const env = { PHOTOS_PRIVEES: bucket(), ADMIN_EMAIL: "admin@example.com" };
  const config = { mode: "restricted", emails: ["invite@example.com"] };
  const created = await createSiteAccessSession(env, "Invite@Example.com");
  const request = new Request("https://voyage.test/", {
    headers: { Cookie: `voyage_site_session=${created.token}` }
  });
  const session = await getSiteAccessSession(request, env, config);
  assert.equal(session.email, "invite@example.com");
  assert.ok(session.expiresAt > Date.now());
  assert.equal(await getSiteAccessSession(request, env, { emails: [] }), null);

  const response = await clearSiteAccessSession(request, env);
  assert.match(response.headers.get("Set-Cookie"), /Max-Age=0/);
  assert.equal(await getSiteAccessSession(request, env, config), null);
});

test("une page non connectée est redirigée vers la connexion avec son chemin de retour", async () => {
  const env = { PHOTOS_PRIVEES: bucket(), ADMIN_EMAIL: "admin@example.com" };
  const response = await requireSiteAccess(
    new Request("https://voyage.test/galerie/?etape=marseille", { headers: { Accept: "text/html" } }),
    env,
    { mode: "restricted", emails: [] }
  );
  assert.equal(response.error.status, 302);
  assert.equal(response.error.headers.get("Location"), "https://voyage.test/connexion/?next=%2Fgalerie%2F%3Fetape%3Dmarseille");
});
