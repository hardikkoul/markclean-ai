# markclean-ai

[![npm version](https://img.shields.io/npm/v/markclean-ai.svg)](https://www.npmjs.com/package/markclean-ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)]()
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178C6.svg)]()

**Zero-dependency HTML-to-LLM Markdown converter, HTML Table-to-JSON/CSV parser, and Table-Header-Preserving RAG Chunker with deep-linked citation URLs.**

Built for **Enterprise AI Agents, LangChain/LlamaIndex RAG pipelines, Node.js/Bun backends, and Cloudflare Workers**—reducing LLM context token usage by **65% to 90%** while guaranteeing zero orphaned table rows.

## Key Features

- **Zero Runtime Dependencies (`0 B` external bloat):** Runs natively in Node.js (`>=18`), Bun, Deno, Next.js Edge Runtime, and Cloudflare Workers V8 Isolates.
- **Table-Header-Preserving RAG Chunks (`repeatTableHeaders: true`):** Automatically repeats `| Column Header |` and `| --- |` rows across split table chunks and attaches `"tableHeaders": [...]` metadata so LLM agents never lose column context.
- **Traceable Deep-Linked Citations (`citationUrl`):** Every chunk carries `"sourceUrl"`, `"pageTitle"`, `"heading"`, `"sectionAnchor"` (`#slug`), and `"citationUrl"` (`https://example.com/doc#section-slug`).
- **Structured HTML Table-to-JSON & CSV Parser:** Converts HTML `<table>` elements into clean JSON key-value records, RFC-4180 CSV strings, and GitHub-Flavored Markdown tables.
- **Deterministic Error Handling (`MarkCleanError`):** Throws structured errors with machine-readable `code`, `status`, and `details` properties (`INVALID_URL_FORMAT`, `RESTRICTED_HOST`, `UPSTREAM_TIMEOUT`, `INVALID_MAX_TOKENS`, etc.).

## Installation

```bash
npm install markclean-ai
# or run directly via npx:
npx markclean-ai https://example.com --json
```

## Quickstart (ESM & TypeScript)

```typescript
import {
  extractFromHtml,
  extractFromUrl,
  extractTables,
  chunkMarkdown,
  MarkCleanError
} from 'markclean-ai';

try {
  const result = await extractFromUrl('https://en.wikipedia.org/wiki/Large_language_model', {
    focusMainContent: true,
    includeLinks: true,
    chunkSizeTokens: 450
  });

  console.log(`Tokens Saved: ${result.stats.tokensSaved} (-${result.stats.tokenReductionPercent}%)`);
  console.log(`Extracted Tables:`, result.tables.length);
  console.log(`First Traceable Chunk:`, result.chunks[0]);
} catch (err) {
  if (err instanceof MarkCleanError) {
    console.error(`[${err.code}] (HTTP ${err.status}): ${err.message}`);
  }
}
```

### CommonJS (`require`)

```javascript
const { extractFromHtml } = require('markclean-ai');
const res = extractFromHtml('<html><body><h1>Hello</h1></body></html>', { url: 'https://example.com' });
```

## CLI Usage

```bash
# Output clean GitHub-Flavored Markdown to stdout
npx markclean-ai https://example.com

# Output full JSON payload (metadata, markdown, tables, traceable RAG chunks, token stats)
npx markclean-ai https://example.com --json

# Extract only HTML tables as structured JSON
npx markclean-ai https://en.wikipedia.org/wiki/List_of_countries_by_GDP_(nominal) --tables

# Extract semantic RAG chunks with custom token window
npx markclean-ai ./local-report.html --chunks --max-tokens=350
```

## Error Codes (`MarkCleanError`)

| Error Code | Status | Description |
| :--- | :--- | :--- |
| `EMPTY_HTML_INPUT` | `400` | Provided HTML string is empty or whitespace-only |
| `INVALID_HTML_INPUT` | `400` | Provided HTML argument is not a string |
| `MISSING_URL` | `400` | Target URL is empty or missing |
| `INVALID_URL_FORMAT` | `400` | Target URL is malformed or missing `http://` / `https://` |
| `UNSUPPORTED_PROTOCOL` | `400` | Protocol is not `http:` or `https:` |
| `RESTRICTED_HOST` | `400` | Target hostname resolves to loopback, private network, or metadata IP (SSRF guard) |
| `INVALID_CHUNK_SIZE` / `INVALID_MAX_TOKENS` | `400` | `chunkSizeTokens` or `maxTokens` is less than `20` |
| `INVALID_OVERLAP_TOKENS` | `400` | `overlapTokens` is negative or `>= maxTokens` |
| `UNSUPPORTED_CONTENT_TYPE` | `415` | Upstream URL returned binary/non-HTML Content-Type |
| `UPSTREAM_HTTP_ERROR` | `502` | Upstream server returned non-2xx HTTP status |
| `UPSTREAM_TIMEOUT` | `504` | Upstream server timed out (`timeoutMs` exceeded) |

## Hosted REST API (RapidAPI & Cloudflare Workers)

A stateless edge deployment of `markclean-ai` is also available via REST API (`POST /v1/extract`, `GET /v1/extract`, `POST /v1/tables`, `POST /v1/chunk`) on RapidAPI Hub under **MarkClean AI - Web to LLM Markdown & Table Extractor**.

## License

MIT © [Hardik Koul](https://github.com/hardikkoul)
