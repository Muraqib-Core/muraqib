---
title: Documentation web view
type: reference
created: 2026-11-04
updated: 2026-11-04
sources:
  - code: src/webview/index.ts
verified_at: f39b88d
---

# Documentation web view

> Part of the [Muraqib documentation](../README.md).

## 🖥️ Documentation Web View
`npm run build` also writes a self-contained documentation page (Details, Features, Installation, Configuration, Requirements, Changelog tabs) to `dist/webview/index.html`. It has no server and no network access: open the file directly in a browser.

```bash
npm run webview   # rebuild and print the path of the page
```

To show the same page inside a VS Code webview panel, pass the nonce from your extension's CSP:

```typescript
import { getWebviewHtml } from "@muraqib/core";

panel.webview.html = getWebviewHtml(nonce);
```

A ready-made VS Code extension built on `runAuditForAgent` and `getWebviewHtml` lives in [`extension/`](../extension/README.md).

The page text lives in `src/webview/content/` as typed data, so adding a tab or translating it never touches the markup. The version and the dependency list are read from `package.json` at build time.
