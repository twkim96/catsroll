# Diagnostic MCP Apps SDK bundle

Only `/mcp/probe/sdk` and `/gpt/probe/sdk` use this artifact. Normal connectors and
the manual `/mcp/probe` control retain their existing transport.

`probe.js` imports the real `App` from `@modelcontextprotocol/ext-apps` **2.0.3**,
as in the official [quickstart](https://apps.extensions.modelcontextprotocol.io/api/documents/quickstart.html)
and [App API](https://apps.extensions.modelcontextprotocol.io/api/classes/app.App.html).
Version and MIT license were checked against the npm registry on 2026-10-18.
Package provenance: https://www.npmjs.com/package/@modelcontextprotocol/ext-apps
and https://github.com/modelcontextprotocol/ext-apps.

The exact dependency graph, npm tarball URLs and integrity hashes live in
`package-lock.json`. `LICENSES.txt` preserves upstream runtime dependency licenses.
`probe.bundle.js` is the checked-in browser artifact, embedded inline in the HTML;
the deployed Ruby app needs neither npm nor a runtime CDN. Dependency source is
retrievable from the pinned integrity-checked registry packages; the local entry
source and build helper are kept alongside the artifact.

Rebuild with Node 20+ and npm (run from the repo root):

```sh
node lib/battle-cats-rolls/vendor/probe-sdk/build.mjs
bundle exec ruby -EUTF-8 -Ilib:test test/test_gpt_probe.rb
node test/test_gpt_sdk_probe.cjs
```

The helper installs with `npm ci --ignore-scripts` in a temporary directory,
bundles with pinned esbuild, copies licenses, then removes the temporary tree.
No repo `node_modules` is created. Browser test uses Playwright from `NODE_PATH` or `PLAYWRIGHT_MODULE`, as with the
other project browser checks. Override `GPT_BROWSER_CHANNEL` when needed.
It routes synthetic parent/widget pages and needs no running server or account.

Both diagnostic resource responses (including direct HTML previews) get a random
`data-catsroll-resource-id`. Only successful HTML generation writes one structured
stderr line containing `resourceId`, `probeVariant`, `build`, `time`. This is a
generation record, not proof of browser delivery. A cached HTML copy keeps that ID;
the independent browser `diagnosticId` changes on each execution. The diagnostics
contain stage classifications only, never host payloads or exception text. No
telemetry endpoint or server record store is added. Real host/account acceptance
requires separate testing.
