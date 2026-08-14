import { describe, expect, it, vi, afterEach } from "vitest";
import { buildManifestDocumentLoader, fetchRdfWithContentNegotiation } from "@/lib/shaclAdapter";
import type { RegistryManifest } from "@/types/registry";

const manifest: RegistryManifest = {
  generatedAt: "2026-01-01T00:00:00Z",
  domains: [
    {
      slug: "rail",
      labelKey: "domain.rail",
      label: "Rail",
      artifacts: [
        {
          url: "https://gs1-epcis-reg.org/rail/rail-context.jsonld",
          source: "https://gs1-switzerland.github.io/WebOntology/current/sectors/tran/rail/ontologies/rail-context.jsonld",
          mediaType: "application/ld+json",
          kind: "context",
          label: "JSON-LD @context",
          version: "1.0.0",
          status: "current",
        },
      ],
    },
  ],
};

function okResponse(bodyText: string): Response {
  return { ok: true, status: 200, text: async () => bodyText, headers: new Headers() } as unknown as Response;
}
function failResponse(status: number): Response {
  return { ok: false, status, text: async () => "", headers: new Headers() } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildManifestDocumentLoader", () => {
  it("resolves a known manifest url by fetching its source instead", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(
        "https://gs1-switzerland.github.io/WebOntology/current/sectors/tran/rail/ontologies/rail-context.jsonld"
      );
      return okResponse(JSON.stringify({ "@context": {} }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const loader = buildManifestDocumentLoader(manifest);
    const result = await loader("https://gs1-epcis-reg.org/rail/rail-context.jsonld");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.documentUrl).toBe("https://gs1-epcis-reg.org/rail/rail-context.jsonld");
    expect(result.document).toEqual({ "@context": {} });
  });

  it("falls through to fetching the URL itself when it isn't a known manifest artifact url", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://example.org/unrelated-context.jsonld");
      return okResponse("{}");
    });
    vi.stubGlobal("fetch", fetchMock);

    const loader = buildManifestDocumentLoader(manifest);
    await loader("https://example.org/unrelated-context.jsonld");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("CORS-relay proxy fallback", () => {
  it("falls back to /api/proxy when the direct fetch fails, and succeeds via the proxy", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.startsWith("/api/proxy")) {
        expect(url).toBe(`/api/proxy?url=${encodeURIComponent("https://ref.gs1.org/standards/epcis/epcis-context.jsonld")}`);
        return okResponse(JSON.stringify({ "@context": { epcis: "https://ref.gs1.org/epcis#" } }));
      }
      // Simulate a CORS-style rejection on the direct, cross-origin fetch.
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    const loader = buildManifestDocumentLoader(manifest);
    const result = await loader("https://ref.gs1.org/standards/epcis/epcis-context.jsonld");

    expect(calls).toHaveLength(2); // direct attempt, then proxy
    expect(result.document).toEqual({ "@context": { epcis: "https://ref.gs1.org/epcis#" } });
  });

  it("throws a combined, informative error when both the direct fetch and the proxy fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.startsWith("/api/proxy") ? failResponse(502) : failResponse(503)))
    );

    const loader = buildManifestDocumentLoader(manifest);
    await expect(loader("https://gs1-epcis-reg.org/rail/rail-context.jsonld")).rejects.toThrow(/direct.*503.*proxy/is);
  });

  it("fetchRdfWithContentNegotiation also falls back to the proxy on a direct fetch failure", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/proxy")) return okResponse("@prefix ex: <http://example.org/> .");
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { text } = await fetchRdfWithContentNegotiation("https://third-party.example/vocab.ttl");
    expect(text).toContain("@prefix ex:");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
