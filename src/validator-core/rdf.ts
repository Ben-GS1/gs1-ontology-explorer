import { Parser as N3Parser } from "n3";
import jsonld from "jsonld";
import type { Quad } from "n3";
import type { ParsedGraph, RdfInputFormat } from "./types";

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
 * Any @context entries that reference remote URLs are resolved by
 * jsonld.js's default fetch-based document loader, so this can fail for
 * documents whose context isn't reachable/CORS-enabled from the browser
 * — that failure is surfaced as a normal thrown error for the caller to
 * display, not swallowed.
 */
export async function parseJsonLd(doc: unknown): Promise<Quad[]> {
  const nquads = (await jsonld.toRDF(doc as jsonld.JsonLdDocument, { format: "application/n-quads" })) as unknown as string;
  return new N3Parser({ format: "N-Quads" }).parse(nquads);
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

/** Parses arbitrary RDF text (JSON-LD or Turtle, explicit or sniffed) into quads. */
export async function parseRdfText(text: string, format?: RdfInputFormat, contentType?: string): Promise<ParsedGraph> {
  const resolved = format ?? sniffFormat(text, contentType);
  if (resolved === "jsonld") {
    const doc = JSON.parse(text);
    return { quads: await parseJsonLd(doc), format: "jsonld" };
  }
  return { quads: parseTurtle(text), format: "turtle" };
}
