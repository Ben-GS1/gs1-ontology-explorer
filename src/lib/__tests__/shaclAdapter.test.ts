import { describe, expect, it, vi, afterEach } from "vitest";
import { buildManifestDocumentLoader, detectDomainsForData, fetchRdfWithContentNegotiation } from "@/lib/shaclAdapter";
import { parseJsonLd } from "@/validator-core";
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
          url: "https://ref.gs1.ch/voc/rail/rail-context.jsonld",
          source: "https://gs1-switzerland.github.io/WebOntology/current/sectors/tran/rail/ontologies/rail-context.jsonld",
          mediaType: "application/ld+json",
          kind: "context",
          label: "JSON-LD @context",
          version: "1.0.0",
          status: "current",
        },
        {
          url: "https://ref.gs1.ch/voc/rail/gs1RailVoc.jsonld",
          source: "https://gs1-switzerland.github.io/WebOntology/current/sectors/tran/rail/vocabularies/gs1RailVoc.jsonld",
          mediaType: "application/ld+json",
          kind: "vocabulary",
          label: "Rail vocabulary",
          version: "1.0.0",
          status: "current",
        },
      ],
    },
    {
      slug: "disco",
      labelKey: "domain.disco",
      label: "Disco",
      artifacts: [
        {
          url: "https://ref.gs1.ch/voc/disco/gs1DiscoVoc.jsonld",
          source: "https://gs1-switzerland.github.io/WebOntology/current/shared/disco/vocabularies/gs1DiscoVoc.jsonld",
          mediaType: "application/ld+json",
          kind: "vocabulary",
          label: "Disco vocabulary",
          version: "1.0.0",
          status: "current",
        },
      ],
    },
    {
      slug: "bearing",
      labelKey: "domain.bearing",
      label: "Bearing",
      artifacts: [
        {
          url: "https://ref.gs1.ch/voc/bearing/gs1BearingVoc.jsonld",
          source: "https://gs1-switzerland.github.io/WebOntology/current/sectors/manu/bearing/vocabularies/gs1BearingVoc.jsonld",
          mediaType: "application/ld+json",
          kind: "vocabulary",
          label: "Bearing vocabulary",
          version: "1.0.0",
          status: "current",
        },
      ],
    },
  ],
};

function okResponse(bodyText: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => bodyText,
    json: async () => JSON.parse(bodyText),
    headers: new Headers(),
  } as unknown as Response;
}
function failResponse(status: number): Response {
  return {
    ok: false,
    status,
    text: async () => "",
    json: async () => {
      throw new Error("no body");
    },
    headers: new Headers(),
  } as unknown as Response;
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
    const result = await loader("https://ref.gs1.ch/voc/rail/rail-context.jsonld");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.documentUrl).toBe("https://ref.gs1.ch/voc/rail/rail-context.jsonld");
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
    await expect(loader("https://ref.gs1.ch/voc/rail/rail-context.jsonld")).rejects.toThrow(/direct.*503.*proxy/is);
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

describe("detectDomainsForData", () => {
  const railVocDoc = {
    "@context": [{ rail: "https://gs1-epcis-reg.org/rail/voc/data#" }],
    "@graph": [
      {
        "@id": "rail:",
        "@type": ["voaf:Vocabulary", "owl:Ontology"],
      },
      { "@id": "rail:sideIndicator", "@type": ["owl:DatatypeProperty"] },
    ],
  };
  const discoVocDoc = {
    "@context": [{ disco: "https://gs1-epcis-reg.org/disco/voc/data#" }],
    "@graph": [
      { "@id": "disco:", "@type": ["voaf:Vocabulary", "owl:Ontology"] },
      { "@id": "disco:SectorType", "@type": ["owl:Class"] },
    ],
  };
  const bearingVocDoc = { "@graph": [{ "@id": "https://ref.gs1.ch/voc/bearing#material", "@type": ["owl:DatatypeProperty"] }] };

  function stubVocabFetches() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("gs1RailVoc")) return okResponse(JSON.stringify(railVocDoc));
        if (url.includes("gs1DiscoVoc")) return okResponse(JSON.stringify(discoVocDoc));
        if (url.includes("gs1BearingVoc")) return okResponse(JSON.stringify(bearingVocDoc));
        return okResponse("{}");
      })
    );
  }

  it("detects a domain from a matching @context URL alone, even before any term overlap is checked", async () => {
    stubVocabFetches();
    const rawDoc = { "@context": ["https://ref.gs1.ch/voc/rail/rail-context.jsonld"] };
    const dataQuads = await parseJsonLd({
      "@context": { rail: "https://gs1-epcis-reg.org/rail/voc/data#", sideIndicator: "rail:sideIndicator" },
      "@id": "rail:x",
      sideIndicator: 1,
    });

    const matches = await detectDomainsForData(rawDoc, dataQuads, manifest);
    const rail = matches.find((m) => m.domainSlug === "rail");
    expect(rail).toBeDefined();
    expect(rail!.via).toBe("context");
  });

  it("detects multiple domains at once when the document mixes terms from several vocabularies (e.g. disco + rail)", async () => {
    stubVocabFetches();
    const dataQuads = await parseJsonLd({
      "@context": {
        rail: "https://gs1-epcis-reg.org/rail/voc/data#",
        disco: "https://gs1-epcis-reg.org/disco/voc/data#",
        sideIndicator: "rail:sideIndicator",
        sectorType: { "@id": "disco:SectorType", "@type": "@id" },
      },
      "@id": "http://example.org/event1",
      sideIndicator: 1,
      sectorType: "http://example.org/some-sector",
    });

    const matches = await detectDomainsForData(undefined, dataQuads, manifest);
    const slugs = matches.map((m) => m.domainSlug).sort();
    expect(slugs).toEqual(["disco", "rail"]);
    // bearing's term (material) is never used, so it must not appear.
    expect(slugs).not.toContain("bearing");
  });

  it("ranks @context-detected domains ahead of term-overlap-only detected domains", async () => {
    stubVocabFetches();
    const rawDocMatchingRail = { "@context": ["https://ref.gs1.ch/voc/rail/rail-context.jsonld"] };
    const dataQuads = await parseJsonLd({
      "@context": {
        rail: "https://gs1-epcis-reg.org/rail/voc/data#",
        disco: "https://gs1-epcis-reg.org/disco/voc/data#",
        sideIndicator: "rail:sideIndicator",
        sectorType: { "@id": "disco:SectorType", "@type": "@id" },
      },
      "@id": "http://example.org/event1",
      sideIndicator: 1,
      sectorType: "http://example.org/some-sector",
    });

    const matches = await detectDomainsForData(rawDocMatchingRail, dataQuads, manifest);
    expect(matches[0].domainSlug).toBe("rail");
    expect(matches[0].via).toBe("context");
  });
});
