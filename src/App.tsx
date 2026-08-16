import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { HomePage } from "@/pages/HomePage";
import { SectorPage } from "@/pages/SectorPage";
import { DomainPage } from "@/pages/DomainPage";
import { TermPage } from "@/pages/TermPage";
import { SearchPage } from "@/pages/SearchPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { LoadingBlock } from "@/components/StateBlocks";

// Lazy-loaded: pulls in the SHACL validation engine (n3, jsonld,
// rdf-validate-shacl) — a substantial dependency tree that most visitors
// browsing ontologies never need, so it's kept out of the main bundle
// until someone actually opens /validate.
const ValidatePage = lazy(() => import("@/pages/ValidatePage").then((m) => ({ default: m.ValidatePage })));

/**
 * Term IRIs in this app's own vocabularies commonly use the "hash URI"
 * pattern (e.g. rail:railRunDistance = "<the vocabulary's own base URI>#railRunDistance",
 * per that file's own @context — a URI baked into the published vocabulary
 * content itself, independent of this app's own resolver routes)
 * rather than the SPA's own "slash" resolver routes (/rail/railRunDistance).
 * Fragments are never sent to the server, so a link like
 * ".../rail/voc/data#railRunDistance" can only be resolved client-side:
 * once the app shell has loaded for *any* path, if a hash is present we
 * treat it as "the local name of a term in the domain named by the first
 * path segment" and redirect to the app's own clean term route. Silent
 * no-op if that guess doesn't pan out — TermPage's own "not found" state
 * handles that the same as any other invalid term URL.
 */
function HashFragmentRedirect() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!location.hash) return;
    const domainSlug = location.pathname.split("/").filter(Boolean)[0];
    const term = decodeURIComponent(location.hash.slice(1));
    if (!domainSlug || !term) return;
    navigate(`/${domainSlug}/${term}${location.search}`, { replace: true });
    // Only ever run this once per initial hash-bearing load, not on every
    // subsequent in-app navigation (which never sets a hash itself).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

/**
 * Route shape mirrors the public resolver paths described in the brief:
 *   /rail/my_term  -> domain "rail", term "my_term"
 *   /rail          -> domain overview
 *   /sector/tran   -> sector overview
 * The SPA itself is generally served from a documentation host; the public
 * resolver host (ref.gs1.ch) proxies /{domain}/{term} requests here
 * for the HTML case and to the raw JSON-LD for the machine-readable case —
 * see api/resolve and staticwebapp.config.json for that split.
 */
export function App() {
  return (
    <div className="min-h-screen bg-ink-50">
      <HashFragmentRedirect />
      <Header />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route
            path="/validate"
            element={
              <Suspense fallback={<LoadingBlock />}>
                <ValidatePage />
              </Suspense>
            }
          />
          <Route path="/sector/:sectorCode" element={<SectorPage />} />
          <Route path="/:domainSlug" element={<DomainPage />} />
          <Route path="/:domainSlug/:termName" element={<TermPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <footer className="border-t border-ink-100 py-8 text-center text-xs text-ink-400">
        GS1 Switzerland — definitions maintained and versioned on GitHub.
      </footer>
    </div>
  );
}
