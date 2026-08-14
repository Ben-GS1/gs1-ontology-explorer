const { app } = require("@azure/functions");

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
// Generous cap for a vocabulary/context/SHACL document — this exists to
// bound worst-case memory/bandwidth use, not to support arbitrary file
// proxying.
const MAX_CHARS = 10 * 1024 * 1024; // ~10MB of text

/**
 * A narrow, read-only fetch proxy used solely by the SHACL validator's
 * browser-side RDF parser (src/validator-core/rdf.ts via
 * src/lib/shaclAdapter.ts) as a fallback when a document it needs to
 * dereference — typically a remote @context referenced by uploaded/
 * pasted data, e.g. https://ref.gs1.org/standards/epcis/epcis-context.jsonld
 * — is on a third-party host that may not set
 * Access-Control-Allow-Origin for this site. A server-side fetch (here)
 * is never subject to browser CORS, so relaying the response with that
 * header added lets the browser read it.
 *
 * Deliberately minimal to limit abuse as an open relay:
 *  - GET only, http(s) URLs only.
 *  - Response body capped at MAX_CHARS.
 *  - No request headers/cookies/auth are forwarded from the caller, and
 *    none from the upstream response are relayed back beyond
 *    Content-Type — this must never become a general-purpose CORS proxy
 *    for arbitrary sites/credentials.
 *  - Every response gets a short Cache-Control, so repeated validation
 *    runs against the same context don't keep hammering the upstream host.
 */
async function proxyFetch(request, context) {
  const target = request.query.get("url");
  if (!target) {
    return { status: 400, jsonBody: { error: "missing required 'url' query parameter" } };
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return { status: 400, jsonBody: { error: "'url' is not a valid absolute URL" } };
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { status: 400, jsonBody: { error: "only http:// and https:// URLs are allowed" } };
  }

  try {
    const upstream = await fetch(target, {
      headers: { Accept: "application/ld+json, application/json;q=0.9, text/turtle;q=0.8" },
      redirect: "follow",
    });
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const text = await upstream.text();
    if (text.length > MAX_CHARS) {
      return { status: 502, jsonBody: { error: "upstream response exceeded the size limit for this proxy" } };
    }

    return {
      status: upstream.status,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
      body: text,
    };
  } catch (err) {
    context.error("proxy fetch failed", err);
    return { status: 502, jsonBody: { error: `could not reach ${target}: ${err.message}` } };
  }
}

app.http("proxyFetch", {
  route: "proxy",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: proxyFetch,
});
