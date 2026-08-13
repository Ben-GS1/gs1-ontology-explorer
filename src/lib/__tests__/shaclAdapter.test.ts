import { describe, expect, it, vi, afterEach } from "vitest";
import { buildManifestDocumentLoader } from "@/lib/shaclAdapter";
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildManifestDocumentLoader", () => {
  it("resolves a known manifest url by fetching its source instead", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(
        "https://gs1-switzerland.github.io/WebOntology/current/sectors/tran/rail/ontologies/rail-context.jsonld"
      );
      return { ok: true, json: async () => ({ "@context": {} }) } as Response;
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
      return { ok: true, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const loader = buildManifestDocumentLoader(manifest);
    await loader("https://example.org/unrelated-context.jsonld");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error when the resolved source itself fails to load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 }) as Response)
    );
    const loader = buildManifestDocumentLoader(manifest);
    await expect(loader("https://gs1-epcis-reg.org/rail/rail-context.jsonld")).rejects.toThrow(/503/);
  });
});
