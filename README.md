# markclean-ai

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)]()
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178C6.svg)]()

**Zero-dependency HTML-to-LLM Markdown converter, HTML Table-to-JSON/CSV parser, and Table-Header-Preserving RAG Chunker with deep-linked citation URLs.**

Built for **Enterprise AI Agents, LangChain/LlamaIndex RAG pipelines, Node.js/Bun backends, and Cloudflare Workers**—reducing LLM context token usage by **65% to 90%** while guaranteeing zero orphaned table rows.

---

## Why Enterprises & AI Engineers Choose `markclean-ai`

1. **Zero Runtime Dependencies (`0 B` external bloat):** Runs identically in Node.js (`>=18`), Bun, Deno, Next.js Edge Runtime, and Cloudflare Workers V8 Isolates with zero native C++ bindings or DOM security vulnerabilities.
2. **Table-Header-Preserving RAG Chunks (`repeatTableHeaders: true`):** When a large pricing or financial table spans multiple chunks, `markclean-ai` automatically repeats the `| Column Header |` and `| --- |` rows at the top of every continuation chunk and attaches `"tableHeaders": [...]` metadata so your LLM never receives orphaned table rows.
3. **Traceable Deep-Linked Citations (`citationUrl`):** Every chunk carries `"sourceUrl"`, `"pageTitle"`, `"heading"`, `"sectionAnchor"` (`#slug`), and a ready-to-cite `"citationUrl"` (`https://example.com/report#section-slug`).
4. **Structured HTML Table-to-JSON & CSV Parser:** Converts every `<table>` into clean JSON key-value records, RFC-4180 CSV strings, and GitHub-Flavored Markdown tables.

---

## Installation

```bash
npm install markclean-ai
# or run directly from the CLI without installing:
npx markclean-ai https://example.com --json
```

---

## Quickstart (ESM & TypeScript)

```typescript
import { extractFromHtml, extractFromUrl, extractTables, chunkMarkdown } from 'markclean-ai';

// 1. Extract directly from a live URL
const result = await extractFromUrl('https://en.wikipedia.org/wiki/Large_language_model', {
  focusMainContent: true,
  includeLinks: true,
  chunkSizeTokens: 450
});

console.log(`Tokens Saved: ${result.stats.tokensSaved} (-${result.stats.tokenReductionPercent}%)`);
console.log(`Clean Markdown:\n`, result.markdown);
console.log(`Extracted JSON Tables:`, result.tables);
console.log(`First Traceable RAG Chunk:`, result.chunks[0]);
```

### CommonJS (`require`)

```javascript
const { extractFromHtml } = require('markclean-ai');
const res = extractFromHtml('<html><body><h1>Hello</h1></body></html>', { url: 'https://example.com' });
```

---

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

---

## Need a Managed Global Edge API (Zero Scraping Infrastructure)?

If you are running serverless AI agents, n8n/Make automations, or enterprise RAG pipelines and want **managed global edge fetching, SSRF protection, and zero infrastructure maintenance**, use our hosted **MarkClean AI Cloud API**:

- **Live Edge API Health:** `https://markclean-ai-api.markclean.workers.dev/v1/health`
- **Endpoints:** `POST /v1/extract`, `GET /v1/extract?url=...`, `POST /v1/tables`, `POST /v1/chunk`
- **Subscribe on RapidAPI:** Search **"MarkClean AI - Web to LLM Markdown & Table Extractor"** on RapidAPI Hub (Free developer tier available).

---

## License

MIT © [Hardik Koul](https://github.com/hardikkoul)
