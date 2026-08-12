# validator-core

A self-contained SHACL validation engine: parse JSON-LD/Turtle into RDF,
validate against SHACL shapes (real ones, or ones heuristically inferred
from a plain OWL/RDFS ontology when none exist), and produce a clean,
JSON-serializable report.

## Zero dependency on the rest of this app

Every file in this folder only imports from npm packages (`n3`, `jsonld`,
`rdf-validate-shacl`) — never from `@/config`, `@/lib`, `@/hooks`, or
React. That's enforced by convention, not tooling, so keep it that way if
you extend this folder.

## Extracting this into its own project

```bash
mkdir my-shacl-validator && cd my-shacl-validator
npm init -y
npm install n3 jsonld rdf-validate-shacl
mkdir src
cp -r <this-folder>/*.ts src/
```

Then use it directly:

```ts
import { parseRdfText, validate, inferShapesFromOntology } from "./src";

const { quads: dataQuads } = await parseRdfText(dataText, "jsonld");
const { quads: shapeQuads } = await parseRdfText(shapesText, "turtle");

const report = await validate(shapeQuads, dataQuads);
console.log(report.conforms, report.counts, report.results);
```

No build step, no React, no bundler-specific configuration required
beyond whatever your project already uses for TypeScript + npm packages.

## What's here

| File | Purpose |
|---|---|
| `types.ts` | Shared types — `ValidationReport`, `ValidationResultItem`, etc. |
| `rdf.ts` | `parseJsonLd`, `parseTurtle`, `parseRdfText` (format-sniffing wrapper) |
| `shaclEngine.ts` | `validate(shapeQuads, dataQuads)` — wraps `rdf-validate-shacl`, returns a plain report |
| `inferShapes.ts` | `inferShapesFromOntology(terms)` — heuristic SHACL shapes from OWL/RDFS classes+properties, for when no real SHACL file exists. **Always present shapes from this function to end users as estimated, not authoritative** — see the doc comment on the function for why. |
| `detectDomain.ts` | `detectLikelyDomains(dataQuads, candidates)` — ranks known vocabularies by how many of their term IRIs appear in a data graph, for auto-detecting which shapes apply to arbitrary data |

## What's NOT here (lives in the main app instead)

- Resolving *which* shapes to use from the GS1 manifest/registry
  (`src/lib/shaclAdapter.ts`) — that needs the manifest/domain model,
  which is app-specific.
- The React UI (`src/pages/ValidatePage.tsx`,
  `src/components/validator/*`) — upload/drag-and-drop/URL input, the
  report view with drill-down, etc.

If you're extracting this for reuse elsewhere, those two are the parts
you'd rewrite for your own host app; this folder is the part you keep.
