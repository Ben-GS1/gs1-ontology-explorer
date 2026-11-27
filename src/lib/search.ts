import Fuse from "fuse.js";
import type { VocabTerm } from "@/types/registry";

/** Every text a term's label can be found under: all translations, plus the default-language label. */
export function termLabelTexts(term: Pick<VocabTerm, "label" | "labels">): string[] {
  return Array.from(new Set([term.label, ...Object.values(term.labels ?? {})]));
}

/** Every text a term's description can be found under: all translations, plus the default-language description. */
export function termDescriptionTexts(term: Pick<VocabTerm, "description" | "descriptions">): string[] {
  return Array.from(new Set([...(term.description ? [term.description] : []), ...Object.values(term.descriptions ?? {})]));
}

/** Case-insensitive substring match of an already-lower-cased query against a term's name, labels and descriptions in *every* language. */
export function termMatchesQuery(term: VocabTerm, lowerCaseQuery: string): boolean {
  return (
    term.localName.toLowerCase().includes(lowerCaseQuery) ||
    termLabelTexts(term).some((text) => text.toLowerCase().includes(lowerCaseQuery)) ||
    termDescriptionTexts(term).some((text) => text.toLowerCase().includes(lowerCaseQuery))
  );
}

export function buildSearchIndex(terms: VocabTerm[]) {
  // Label and description are searched in every available language, so a
  // German reader can find a term by its German name even if the default
  // (English) label is different — and vice versa.
  return new Fuse(terms, {
    keys: [
      { name: "label", weight: 0.4, getFn: (term: VocabTerm) => termLabelTexts(term) },
      { name: "localName", weight: 0.3 },
      { name: "description", weight: 0.2, getFn: (term: VocabTerm) => termDescriptionTexts(term) },
      { name: "types", weight: 0.1 },
    ],
    threshold: 0.32,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });
}

export function flattenTermMap(termsByDomain: Map<string, VocabTerm[]>): VocabTerm[] {
  return Array.from(termsByDomain.values()).flat();
}
