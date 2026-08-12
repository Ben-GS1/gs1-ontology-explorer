const { app } = require("@azure/functions");
const { loadManifest, findDomain, pickArtifact, findArtifactByPublicPath } = require("../lib/manifest");
const { preferredRdfType } = require("../lib/negotiate");
const { fetchAppShell } = require("../lib/shell");

// Maps a negotiated RDF media type to the artifact "kind" we prefer to
// redirect to. Vocabulary is the default; a context negotiation could be
// added as its own Accept profile if/when the manifest publishes one.
const MEDIA_TYPE_TO_KIND = {
  "application/ld+json": "vocabulary",
  "text/turtle": "vocabulary",
  "application/rdf+xml": "vocabulary",
};

/**
 * Single entry point for every public path under the resolver host. Two
 * distinct request shapes are handled here, both driven entirely by the
 * manifest — nothing is hard-coded:
 *
 *  1. A direct artifact identifier, e.g.
 *     /rail/voc/data/gs1RailVoc.jsonld — this is one of the manifest's
 *     own `artifact.url` values. Always 303-redirects to that artifact's
 *     `source` (the physical GitHub Pages bytes), regardless of Accept —
 *     an explicit file reference isn't negotiable, it names one
 *     representation directly.
 *
 *  2. A term/domain resolver path, e.g. /rail or /rail/geo — negotiated
 *     by Accept header:
 *       - RDF media types -> 303 to the domain's vocabulary artifact's
 *         `source`, with a #localName fragment for term requests.
 *       - text/html (browsers, default) -> 200 with the SPA app shell.
 *     A path with more than one extra segment under the domain (e.g.
 *     /rail/voc/data — a "hash URI" vocabulary's own namespace base, whose
 *     real per-term addresses are .../data#term) is treated the same way
 *     minus the fragment guess, since fragments never reach the server at
 *     all — see the comment further down for how the term actually gets
 *     resolved in that case.
 *
 * staticwebapp.config.json rewrites every otherwise-unmatched path to
 * /api/resolve while preserving the original request path in the
 * "x-ms-original-url" header (Azure Static Web Apps sets this
 * automatically on rewritten requests) — that's how this single Function
 * route can serve an unbounded number of resolver/artifact paths.
 */
async function resolve(request, context) {
  const originalUrl = request.headers.get("x-ms-original-url") || request.url;
  const path = safePathname(originalUrl);

  const acceptHeader = request.headers.get("accept");
  const rdfType = preferredRdfType(acceptHeader);
  const host = request.headers.get("host");

  let manifest;
  try {
    manifest = await loadManifest();
  } catch (err) {
    context.error("manifest load failed", err);
    return rdfType
      ? { status: 502, jsonBody: { error: "registry manifest unavailable" } }
      : await htmlShellResponse(host, 502);
  }

  // Case 1: does this path match a known artifact's own public URL?
  const directArtifact = findArtifactByPublicPath(manifest, path);
  if (directArtifact) {
    return { status: 303, headers: { Location: directArtifact.source, Vary: "Accept" } };
  }

  // Case 2: resolver shapes under a known domain.
  //   /{domainSlug}                    -> domain overview
  //   /{domainSlug}/{term}             -> a single term (the "slash URI" style)
  //   /{domainSlug}/anything/deeper    -> typically a "hash URI" vocabulary's
  //     own namespace base (e.g. /rail/voc/data, whose real terms are
  //     addressed as /rail/voc/data#term — a fragment, which browsers never
  //     send to the server at all). We can't know which term was meant
  //     server-side in that case, so: HTML clients still get the app shell
  //     (client-side JS then reads the fragment and redirects — see
  //     HashFragmentRedirect in src/App.tsx); RDF clients get redirected to
  //     the domain's whole vocabulary document instead of a guessed,
  //     likely-wrong #fragment, and resolve the term themselves client-side.
  const segments = path.split("/").filter(Boolean);
  const [domainSlug, termName] = segments;
  const domain = domainSlug ? findDomain(manifest, domainSlug) : undefined;

  if (!domain) {
    return rdfType
      ? { status: 404, jsonBody: { error: `unknown path '${path}'` } }
      : await htmlShellResponse(host, 404);
  }

  if (rdfType) {
    const kind = MEDIA_TYPE_TO_KIND[rdfType] || "vocabulary";
    const artifact = pickArtifact(domain, kind);
    if (!artifact) {
      return { status: 404, jsonBody: { error: `no ${kind} artifact published for domain '${domainSlug}'` } };
    }
    // NOTE: per-term fragment addressing assumes the vocabulary publishes
    // term nodes at "<artifact.source>#<localName>". If your repository
    // instead publishes one file per term, replace this with a
    // manifest-driven per-term URL lookup instead of a fragment.
    const hasExactlyOneExtraSegment = segments.length === 2;
    const location = hasExactlyOneExtraSegment ? `${artifact.source}#${encodeURIComponent(termName)}` : artifact.source;
    return {
      status: 303,
      headers: { Location: location, Vary: "Accept" },
    };
  }

  return await htmlShellResponse(host, 200);
}

async function htmlShellResponse(host, status) {
  try {
    const html = await fetchAppShell(host);
    return {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8", Vary: "Accept" },
      body: html,
    };
  } catch {
    // Fall back to a plain redirect to the SPA root if the shell can't be
    // fetched (e.g. cold-start race on first deploy).
    return { status: 302, headers: { Location: "/" } };
  }
}

function safePathname(url) {
  try {
    return new URL(url, "https://placeholder.invalid").pathname;
  } catch {
    return "/";
  }
}

app.http("resolve", {
  route: "resolve",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: resolve,
});
