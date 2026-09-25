// The SPA's built index.html is spliced into the string literal below by
// scripts/generate-app-shell.mjs, run LOCALLY and committed here whenever
// dist/index.html changes — see README's "Maintaining the API's SPA
// shell" section. This is deliberately committed rather than generated
// fresh by CI on every deploy.
//
// Two CI-time approaches were tried first and both failed in production
// despite every *other* code change in this file deploying correctly on
// every attempt: first a plain copied dist/index.html file, then a
// separate app-shell.js module require()'d from here. Both were files
// created fresh during the GitHub Actions run, after checkout, never
// committed to git — and something in Azure's build/packaging pipeline
// consistently dropped them, regardless of file format or .gitignore
// status. Committing the actual content directly, so there's no
// generation step left for anything to fail to package, sidesteps the
// problem entirely.
//
// If you see the literal placeholder text below instead of real HTML,
// this hasn't been generated yet — see scripts/generate-app-shell.mjs.
const APP_SHELL_HTML = "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n    <meta name=\"theme-color\" content=\"#12181F\" />\n    <meta name=\"description\" content=\"GS1 Web Ontology & Vocabulary Explorer — browse, search and resolve sector and domain vocabularies published as Linked Data.\" />\n    <!-- Content-Security-Policy is enforced at the edge via staticwebapp.config.json;\n         this meta tag is a defence-in-depth fallback for direct file previews. -->\n    <meta http-equiv=\"Content-Security-Policy\"\n      content=\"default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://gs1-switzerland.github.io https://*.github.io; base-uri 'none'; frame-ancestors 'none'; object-src 'none'\" />\n    <title>GS1 Web Ontology &amp; Vocabulary Explorer</title>\n    <link rel=\"icon\" type=\"image/svg+xml\" href=\"/favicon.svg\" />\n    <script type=\"module\" crossorigin src=\"/assets/index-CoZr3Fm4.js\"></script>\n    <link rel=\"modulepreload\" crossorigin href=\"/assets/vendor-Bu1St3ZL.js\">\n    <link rel=\"modulepreload\" crossorigin href=\"/assets/i18n-H5CiqhYF.js\">\n    <link rel=\"stylesheet\" crossorigin href=\"/assets/index-C6A0TAwf.css\">\n  </head>\n  <body>\n    <div id=\"root\"></div>\n  </body>\n</html>\n";

function getAppShell() {
  return APP_SHELL_HTML;
}

module.exports = { getAppShell };
