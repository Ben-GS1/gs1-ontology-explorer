const fs = require("node:fs");
const path = require("node:path");

// The SPA's built index.html is copied here at deploy time (see the
// "Copy SPA shell into API" step in the GitHub Actions workflow) so it
// ships as part of the API's own deployment package.
const SHELL_PATH = path.join(__dirname, "..", "app-shell.html");

let cachedHtml = null;

/**
 * Returns the built SPA shell (index.html), read once from disk and kept
 * in memory for the lifetime of the warm Function instance.
 *
 * This used to fetch `https://{host}/index.html` back over the network,
 * using the incoming request's own Host header to reach the static
 * content side of the same Static Web App. That's fragile: Azure's
 * proxying to a *managed* Function backend does not guarantee the Host
 * header the function receives is the public custom domain rather than
 * the Function App's own internal hostname, which serves no static
 * content at all — so that fetch could 404 and this whole 200 response
 * would silently fall back to the caller's redirect-on-failure path.
 * Reading the shell straight off disk has no such dependency.
 */
function getAppShell() {
  if (cachedHtml !== null) return cachedHtml;
  cachedHtml = fs.readFileSync(SHELL_PATH, "utf-8");
  return cachedHtml;
}

module.exports = { getAppShell };
