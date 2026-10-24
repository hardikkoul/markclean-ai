# markclean-ai

**Version:** `1.5.0` | **License:** MIT | **Dependencies:** `0` | **Runtime:** Node.js `>=18`, Bun, Deno & Edge | **TypeScript:** Built-in `.d.ts`

**Zero-dependency HTML-to-LLM Markdown converter, HTML Table-to-JSON/CSV parser, and Table-Header-Preserving RAG Chunker with deep-linked citation URLs.**

Built for **AI Agents, LangChain/LlamaIndex RAG pipelines, Node.js/Bun/Deno backends, and V8 Edge runtimes**—reducing LLM context token consumption by **65% to 90%** while guaranteeing zero orphaned table rows.

## Why `markclean-ai`?

| Common RAG / Agent Bottleneck | Standard HTML Scrapers & Text Splitters | `markclean-ai` (v1.5.0) |
| :--- | :--- | :--- |
| **Token Bloat** | Wastes 65–90% of the LLM context window on `<script>`, `<style>`, SVGs, nav menus, and cookie banners | Strips non-content DOM clutter and outputs clean GitHub-Flavored Markdown (GFM) with YAML frontmatter |
| **Orphaned Table Rows** | Naive text splitters slice HTML tables mid-way, dropping column headers on chunk #2+ | **Automatic Table-Header Repetition (`repeatTableHeaders: true`)** prepends `\| Header \|` & `\| --- \|` to every split table chunk |
| **Lost Source Citations** | Chunks lose their canonical URL and section anchor after splitting | Every chunk includes `sourceUrl`, `pageTitle`, `heading`, `sectionAnchor` (`#slug`), and `citationUrl` (`https://...#slug`) |
| **Supply-Chain & Security Risks** | Pulls in 30+ transitive DOM/parser dependencies and follows blind redirects to internal IPs | **0 external dependencies**, multi-hop redirect SSRF protection (IPv4/IPv6/CGNAT/metadata guard), XSS scheme stripping, and structured `MarkCleanError` codes |

## Installation

```bash
npm install markclean-ai
# or run directly from the CLI without installing:
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
  // 1. Fetch & extract directly from a live URL (with multi-hop SSRF & timeout guards)
  const result = await extractFromUrl('https://en.wikipedia.org/wiki/Large_language_model', {
    focusMainContent: true,
    includeLinks: true,
    chunkSizeTokens: 450,
    timeoutMs: 8000,
    maxRedirects: 5
  });

  console.log(`Title: ${result.metadata.title}`);
  console.log(`Tokens Saved: ${result.stats.tokensSaved} (-${result.stats.tokenReductionPercent}%)`);
  console.log(`Extracted Tables: ${result.stats.tableCount}`);
  console.log(`RAG Chunks Generated: ${result.stats.chunkCount}`);

  // 2. Inspect the first traceable RAG chunk
  const firstChunk = result.chunks[0];
  console.log('Citation URL:', firstChunk.citationUrl);
  console.log('Contains Table:', firstChunk.containsTable);
  console.log('Table Headers:', firstChunk.tableHeaders);
} catch (err) {
  if (err instanceof MarkCleanError) {
    console.error(`[${err.code}] (Status ${err.status}): ${err.message}`);
  }
}
```

### CommonJS (`require`)

```javascript
const { extractFromHtml, extractTables } = require('markclean-ai');

const result = extractFromHtml('<html><body><h1>Hello World</h1></body></html>', {
  url: 'https://example.com/hello'
});
console.log(result.markdown);
```

## CLI Usage (`npx markclean-ai`)

```bash
# Output clean GitHub-Flavored Markdown to stdout
npx markclean-ai https://example.com

# Output full JSON payload (metadata, markdown, tables, traceable RAG chunks, token stats)
npx markclean-ai https://example.com --json

# Extract only HTML tables as a structured JSON array
npx markclean-ai https://en.wikipedia.org/wiki/List_of_countries_by_GDP_(nominal) --tables

# Extract semantic RAG chunks from a local HTML file with a custom token limit
npx markclean-ai ./report.html --chunks --max-tokens=350

# Strip hyperlinks from Markdown output
npx markclean-ai https://example.com --no-links

# Print package version
npx markclean-ai --version
```

## API Reference

### 1. `extractFromHtml(html, options?)`
Synchronously converts a raw HTML string into clean Markdown, structured tables, metadata, and traceable RAG chunks.

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `url` | `string` | `""` | Base/source URL used to resolve relative links and populate `citationUrl` |
| `focusMainContent` | `boolean` | `true` | Strips `<nav>`, `<footer>`, `<aside>`, cookie banners, and isolates `<main>` / `<article>` |
| `includeLinks` | `boolean` | `true` | Preserves hyperlinks in Markdown output |
| `includeImages` | `boolean` | `false` | Preserves `![alt](src)` image tags in Markdown output |
| `includeFrontmatter` | `boolean` | `true` | Prepends YAML frontmatter (`title`, `source`, `author`, `published`, `description`) |
| `chunkSizeTokens` | `number` | `500` | Target maximum token count per semantic RAG chunk (`>= 20`) |
| `maxInputChars` | `number` | `5242880` | Maximum allowed input HTML length (default 5 MB) |

### 2. `await extractFromUrl(url, options?)`
Fetches a public HTTP/HTTPS URL with SSRF validation on every redirect hop, enforces `Content-Type` and timeout guards, and runs `extractFromHtml`. Accepts all `extractFromHtml` options plus:

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `timeoutMs` | `number` | `8000` | Request timeout in milliseconds |
| `maxBytes` | `number` | `5242880` | Maximum response payload size in characters (default 5 MB) |
| `maxRedirects` | `number` | `5` | Maximum HTTP 3xx redirect hops (each hop validated by `validatePublicUrl`) |
| `headers` | `Record<string, string>` | `{}` | Custom HTTP request headers |

### 3. `extractTables(html)`
Extracts all HTML `<table>` elements into an array of structured objects:
```json
{
  "index": 1,
  "headers": ["Plan Name", "Monthly Price", "Quota"],
  "rowCount": 2,
  "rows": [
    { "Plan Name": "Starter", "Monthly Price": "$0", "Quota": "1,000 / mo" },
    { "Plan Name": "Enterprise", "Monthly Price": "$99", "Quota": "500,000 / mo" }
  ],
  "csv": "Plan Name,Monthly Price,Quota\nStarter,$0,1,000 / mo\nEnterprise,$99,500,000 / mo",
  "markdown": "| Plan Name | Monthly Price | Quota |\n| --- | --- | --- |\n| Starter | $0 | 1,000 / mo |\n| Enterprise | $99 | 500,000 / mo |"
}
```

### 4. `chunkMarkdown(markdown, options?)`
Splits Markdown along semantic `H1–H3` boundaries while repeating table headers across split chunks.

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `maxTokens` | `number` | `500` | Maximum tokens per chunk (`>= 20`) |
| `overlapTokens` | `number` | `min(50, 20% of maxTokens)` | Token overlap carried between prose paragraphs |
| `sourceUrl` | `string` | `""` | Canonical source URL attached to every chunk |
| `pageTitle` | `string` | `""` | Document title attached to every chunk |
| `repeatTableHeaders` | `boolean` | `true` | Repeats `\| Header \|` and `\| --- \|` rows on split tables |

**Sample Chunk Output:**
```json
{
  "index": 1,
  "heading": "Enterprise GPU Instances",
  "sectionAnchor": "#enterprise-gpu-instances",
  "sourceUrl": "https://example.com/gpu-pricing",
  "citationUrl": "https://example.com/gpu-pricing#enterprise-gpu-instances",
  "pageTitle": "Q4 Cloud GPU Pricing Index",
  "containsTable": true,
  "tableHeaders": ["GPU Model", "VRAM", "Hourly Rate"],
  "content": "| GPU Model | VRAM | Hourly Rate |\n| --- | --- | --- |\n| NVIDIA H200 SXM | 141 GB HBM3e | $3.89/hr |",
  "tokens": 31,
  "charCount": 105
}
```

### 5. Additional Utilities
- `htmlToMarkdown(html, options?)` — Converts HTML directly to clean GFM string.
- `cleanHtml(html, { focusMainContent })` — Strips scripts, styles, SVGs, ads, and cookie banners.
- `extractMetadata(html, baseUrl?)` — Extracts `title`, `description`, `canonicalUrl`, `author`, `publishedTime`, `siteName`, `ogImage`, and `jsonLd`.
- `validatePublicUrl(url)` — Validates HTTP/HTTPS URLs and blocks private/loopback/metadata SSRF hosts.
- `estimateTokens(text)` — Fast token count estimator (`~cl100k_base`).

## Structured Error Codes (`MarkCleanError`)

| Error Code | `err.status` | Trigger Condition |
| :--- | :--- | :--- |
| `EMPTY_HTML_INPUT` | `400` | Provided HTML string is empty or whitespace-only |
| `INVALID_HTML_INPUT` | `400` | Provided `html` argument is not a string |
| `INVALID_MARKDOWN_INPUT` | `400` | Provided `markdown` argument is not a string |
| `INPUT_TOO_LARGE` | `413` | Input HTML exceeds `maxInputChars` (default 5 MB) |
| `MISSING_URL` / `INVALID_URL_FORMAT` | `400` | Target URL is empty or malformed |
| `UNSUPPORTED_PROTOCOL` | `400` | Protocol is not `http:` or `https:` |
| `RESTRICTED_URL_CREDENTIALS` | `400` | URL contains embedded `user:pass@` credentials |
| `RESTRICTED_HOST` | `400` | Target or redirect hop resolves to loopback, private IPv4/IPv6, CGNAT, or cloud metadata IP |
| `INVALID_CHUNK_SIZE` / `INVALID_MAX_TOKENS` | `400` | `chunkSizeTokens` or `maxTokens` is less than `20` |
| `INVALID_OVERLAP_TOKENS` | `400` | `overlapTokens` is negative or `>= maxTokens` |
| `UNSUPPORTED_CONTENT_TYPE` | `415` | Upstream URL returned binary/non-HTML `Content-Type` |
| `TOO_MANY_REDIRECTS` | `502` | Upstream URL exceeded `maxRedirects` (default 5 hops) |
| `EMPTY_UPSTREAM_RESPONSE` | `502` | Upstream URL returned an empty body |
| `UPSTREAM_HTTP_ERROR` / `UPSTREAM_FETCH_FAILED` | `502` | Upstream server returned non-2xx HTTP status or network failure |
| `UPSTREAM_TIMEOUT` | `504` | Upstream server timed out (`timeoutMs` exceeded) |

## Running Tests

```bash
npm test
```

## License

MIT © [Hardik Koul](https://github.com/hardikkoul)