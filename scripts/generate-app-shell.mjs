#!/usr/bin/env node
// Splices the already-built dist/index.html into api/src/lib/shell.js,
// replacing its APP_SHELL_HTML placeholder in place — for resolve.js to
// serve as the SPA shell on text/html requests.
//
// Run this LOCALLY whenever dist/index.html changes (i.e. essentially
// only when index.html's own template changes, since it has no
// per-domain/per-term content), then COMMIT the resulting
// api/src/lib/shell.js. See README's "Maintaining the API's SPA shell"
// section, and shell.js's own comment, for why this is committed rather
// than generated fresh by CI on every deploy: two CI-time approaches
// (a copied .html file, then a separate .js module) both deployed every
// *other* code change in this repo correctly but never delivered the
// newly-generated file itself into production — something in Azure's
// build/packaging pipeline consistently dropped it. Committing the
// result directly sidesteps that entirely, since it's then no different
// from any other source file, which we have repeated concrete proof
// deploys correctly.
//
// This mutates api/src/lib/shell.js on disk — review the diff, then
// commit it. Running it twice against an already-substituted file fails
// loudly below rather than silently double-embedding anything; re-run
// against a clean checkout (e.g. `git checkout api/src/lib/shell.js`
// first) if you need to regenerate.
import { readFileSync, writeFileSync } from "node:fs";

const SHELL_JS_PATH = "api/src/lib/shell.js";
const PLACEHOLDER = '"__APP_SHELL_HTML_PLACEHOLDER__"';

const html = readFileSync("dist/index.html", "utf-8");
const shellJs = readFileSync(SHELL_JS_PATH, "utf-8");

if (!shellJs.includes(PLACEHOLDER)) {
  console.error(
    `${SHELL_JS_PATH} does not contain the expected placeholder (${PLACEHOLDER}). ` +
      "Either it's already been substituted (re-run this against a clean " +
      "checkout) or api/src/lib/shell.js was edited without keeping the " +
      "placeholder — see that file's comment.",
  );
  process.exit(1);
}

const updated = shellJs.replace(PLACEHOLDER, () => JSON.stringify(html));
writeFileSync(SHELL_JS_PATH, updated);
console.log(`Spliced dist/index.html (${html.length} chars) into ${SHELL_JS_PATH}`);
