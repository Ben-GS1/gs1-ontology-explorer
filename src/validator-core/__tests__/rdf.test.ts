import { describe, expect, it, vi } from "vitest";
import { parseJsonLd, parseRdfText } from "../rdf";

const docWithRemoteContext = {
  "@context": "https://example.org/some-context.jsonld",
  "@id": "http://example.org/thing1",
  name: "Thing One",
};

describe("parseJsonLd with a custom documentLoader", () => {
  it("uses the supplied loader instead of a real network fetch to resolve a remote @context", async () => {
    const loader = vi.fn(async (url: string) => {
      expect(url).toBe("https://example.org/some-context.jsonld");
      return {
        contextUrl: undefined,
        document: { "@context": { name: "http://example.org/name" } },
        documentUrl: url,
      };
    });

    const quads = await parseJsonLd(docWithRemoteContext, loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(quads.length).toBe(1);
    expect(quads[0].predicate.value).toBe("http://example.org/name");
    expect(quads[0].object.value).toBe("Thing One");
  });

  it("surfaces a loader failure as a normal thrown error, not silently", async () => {
    const failingLoader = async () => {
      throw new Error("simulated network failure");
    };
    await expect(parseJsonLd(docWithRemoteContext, failingLoader)).rejects.toThrow();
  });

  it("parseRdfText threads the documentLoader through for the jsonld branch", async () => {
    const loader = vi.fn(async (url: string) => ({
      contextUrl: undefined,
      document: { "@context": { name: "http://example.org/name" } },
      documentUrl: url,
    }));
    const { quads } = await parseRdfText(JSON.stringify(docWithRemoteContext), "jsonld", undefined, loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(quads.length).toBe(1);
  });
});
