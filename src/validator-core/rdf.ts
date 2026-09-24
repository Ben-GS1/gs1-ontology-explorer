import { Parser as N3Parser } from "n3";
import jsonld from "jsonld";
import type { Quad } from "n3";
import type { ParsedGraph, RdfInputFormat } from "./types";
import { SHACL_JSONLD_CONTEXT } from "./shaclContext";

/**
 * Matches jsonld.js's own documentLoader function signature: given a URL,
 * return the parsed document (and, per the JSON-LD API, the URL it was
 * ultimately loaded from / any Link-header-derived context URL — we never
 * use either of those two beyond satisfying the shape jsonld.js expects).
 */
export type JsonLdDocumentLoader = (url: string) => Promise<{
  contextUrl?: string;
  document: unknown;
  documentUrl: string;
}>;

/** Parses a Turtle document into rdfjs quads. Throws on malformed Turtle. */
export function parseTurtle(text: string): Quad[] {
  return new N3Parser({ format: "text/turtle" }).parse(text);
}

/**
 * Parses a JSON-LD document into rdfjs quads by expanding it to N-Quads
 * (via jsonld.js) and re-parsing that with N3 — N3's parser produces
 * proper RDF/JS-conformant Term/Quad objects, which jsonld.js's own
 * internal quad representation does not guarantee.
 *
 * Any @context entries that reference remote URLs are resolved via
 * `documentLoader` if one is supplied, otherwise jsonld.js's own default
 * fetch-based loader. A caller-supplied loader is how the host app can
 * make known URLs resolve reliably (e.g. redirecting a public resolver
 * URL that isn't live yet, or is cross-origin without CORS, to the real
 * file location it already knows from its own manifest) without this
 * module needing to know anything about that app-specific mapping — see
 * src/lib/shaclAdapter.ts::buildManifestDocumentLoader() for that piece.
 * Loader/network failures are surfaced as a normal thrown error for the
 * caller to display, not swallowed.
 *
 * `extraContext`, when given, is passed to jsonld.js as `expandContext` —
 * an additional context applied before the document's own @context. Used
 * by parseShaclShapesJsonLd() below; ordinary data-document parsing never
 * passes one.
 */
export async function parseJsonLd(
  doc: unknown,
  documentLoader?: JsonLdDocumentLoader,
  extraContext?: Record<string, unknown>
): Promise<Quad[]> {
  const options: Record<string, unknown> = { format: "application/n-quads" };
  if (documentLoader) options.documentLoader = documentLoader;
  if (extraContext) options.expandContext = extraContext;
  const nquads = (await jsonld.toRDF(doc as jsonld.JsonLdDocument, options as jsonld.Options.ToRdf)) as unknown as string;
  return new N3Parser({ format: "N-Quads" }).parse(nquads);
}

/**
 * Parses a JSON-LD *SHACL shapes* document specifically — identical to
 * parseJsonLd() except it also supplies SHACL_JSONLD_CONTEXT (see that
 * module's own doc comment for why this matters: without it, a shapes
 * document whose own @context doesn't separately declare @id-typing for
 * sh:targetClass/sh:path/etc. silently parses into a shapes graph that
 * matches nothing, and SHACL validation against zero targets trivially
 * "conforms" — a validator that looks like it ran but didn't). Never use
 * this for ordinary data documents.
 */
export async function parseShaclShapesJsonLd(doc: unknown, documentLoader?: JsonLdDocumentLoader): Promise<Quad[]> {
  return parseJsonLd(doc, documentLoader, SHACL_JSONLD_CONTEXT);
}

/** Sniffs whether a text payload looks like JSON (JSON-LD) or Turtle, for when no explicit format is known. */
export function sniffFormat(text: string, contentType?: string): RdfInputFormat {
  if (contentType) {
    if (contentType.includes("json")) return "jsonld";
    if (contentType.includes("turtle")) return "turtle";
  }
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[") ? "jsonld" : "turtle";
}

/**
 * Parses arbitrary RDF text (JSON-LD or Turtle, explicit or sniffed) into
 * quads. `role` picks which JSON-LD parse path is used: "shapes" applies
 * SHACL_JSONLD_CONTEXT (see parseShaclShapesJsonLd()), "data" (the
 * default) does not. Turtle is unaffected either way — Turtle has no
 * @context/@type:@id ambiguity to begin with, since prefixes there always
 * produce IRIs.
 */
export async function parseRdfText(
  text: string,
  format?: RdfInputFormat,
  contentType?: string,
  documentLoader?: JsonLdDocumentLoader,
  role: "data" | "shapes" = "data"
): Promise<ParsedGraph> {
  const resolved = format ?? sniffFormat(text, contentType);
  if (resolved === "jsonld") {
    const doc = JSON.parse(text);
    const quads =
      role === "shapes" ? await parseShaclShapesJsonLd(doc, documentLoader) : await parseJsonLd(doc, documentLoader);
    return { quads, format: "jsonld" };
  }
  return { quads: parseTurtle(text), format: "turtle" };
}
