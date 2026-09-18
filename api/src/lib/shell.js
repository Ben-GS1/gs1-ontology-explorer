// The SPA's built index.html is turned into this sibling app-shell.js
// module at build/deploy time by scripts/generate-app-shell.mjs (see the
// "Copy SPA shell into API" step in the GitHub Actions workflow) — a
// plain CommonJS module exporting the HTML as a string, required here
// exactly like any other source file. See that script's own comment for
// why it's a .js module and not a loose .html file.
//
// This used to fetch `https://{host}/index.html` back over the network at
// request time, using the incoming request's own Host header to reach the
// static content side of the same Static Web App. That's fragile: Azure's
// proxying to a *managed* Function backend does not guarantee the Host
// header the function receives is the public custom domain rather than
// the Function App's own internal hostname, which serves no static
// content at all — so that fetch could 404 and this whole 200 response
// would silently fall back to the caller's redirect-on-failure path.
// require()-ing it as part of the deployed code has no such dependency.
function getAppShell() {
  return require("../app-shell.js");
}

module.exports = { getAppShell };
