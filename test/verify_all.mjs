import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MarkCleanError,
  validatePublicUrl,
  extractFromHtml,
  chunkMarkdown
} from '../dist/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const cjsPkg = require('../dist/index.cjs');

console.log('=== Running MarkClean AI v1.3.0 Enterprise Verification Suite ===\n');

const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Enterprise AI Benchmark Report 2026</title>
  <meta name="description" content="API latency and token efficiency benchmarks." />
  <meta name="author" content="Engineering Systems Team" />
  <link rel="canonical" href="https://example.com/ai-benchmark-2026" />
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"TechArticle","headline":"Enterprise AI Benchmark Report 2026"}
  </script>
  <script>console.log("analytics tracker noise");</script>
  <style>.cookie-banner { display: block; }</style>
</head>
<body>
  <nav><a href="/home">Home</a> | <a href="/login">Login</a></nav>
  <div class="cookie-banner">Accept all cookies now!</div>
  <main>
    <h1>Enterprise AI Benchmark Report 2026</h1>
    <p>Modern AI pipelines waste <strong>70% to 85% of context tokens</strong> on raw HTML boilerplate. Read <a href="/docs">the docs</a>.</p>
    <h2>Throughput Comparison</h2>
    <table>
      <thead>
        <tr><th>Engine</th><th>Latency</th><th>Token Savings</th></tr>
      </thead>
      <tbody>
        <tr><td>Raw DOM</td><td>120ms</td><td>0%</td></tr>
        <tr><td>MarkClean AI</td><td>4ms</td><td>82%</td></tr>
      </tbody>
    </table>
    <h2>Code Example</h2>
    <pre><code class="language-typescript">import { extractFromUrl } from "markclean-ai";</code></pre>
  </main>
  <footer>Copyright 2026 Example Corp.</footer>
</body>
</html>`;

// 1. Core Extraction & Noise Stripping
const result = extractFromHtml(SAMPLE_HTML, { url: 'https://example.com/ai-benchmark-2026' });
assert.equal(result.success, true);
assert.equal(result.tables.length, 1);
assert.equal(result.tables[0].rows[1]['Engine'], 'MarkClean AI');
assert.equal(result.markdown.includes('Accept all cookies now'), false);
assert.equal(result.markdown.includes('[the docs](https://example.com/docs)'), true);
console.log('✅ 1. Core Extraction, GFM Tables & Noise Stripping passed!');

// 2. Structured Error Handling in Core Library (`MarkCleanError`)
assert.throws(
  () => extractFromHtml('   '),
  (err) => err instanceof MarkCleanError && err.code === 'EMPTY_HTML_INPUT' && err.status === 400
);
assert.throws(
  () => extractFromHtml(SAMPLE_HTML, { chunkSizeTokens: 5 }),
  (err) => err instanceof MarkCleanError && err.code === 'INVALID_CHUNK_SIZE' && err.status === 400
);
assert.throws(
  () => chunkMarkdown('# Heading\nBody', { maxTokens: 100, overlapTokens: 120 }),
  (err) => err instanceof MarkCleanError && err.code === 'INVALID_OVERLAP_TOKENS' && err.status === 400
);
assert.equal(validatePublicUrl('ftp://example.com/file').code, 'UNSUPPORTED_PROTOCOL');
assert.equal(validatePublicUrl('http://127.0.0.1:8080/internal').code, 'RESTRICTED_HOST');
assert.equal(validatePublicUrl('not-a-url').code, 'INVALID_URL_FORMAT');
console.log('✅ 2. Structured MarkCleanError Validation & SSRF Guards passed!');

// 3. Table-Header Preservation & Citation URLs in RAG Chunks
const multiRowTableHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Q4 Cloud GPU Pricing Index</title>
  <link rel="canonical" href="https://example.com/gpu-pricing" />
</head>
<body>
  <main>
    <h2>Enterprise GPU Instances</h2>
    <table>
      <thead>
        <tr><th>GPU Model</th><th>VRAM</th><th>Hourly Rate</th></tr>
      </thead>
      <tbody>
        <tr><td>NVIDIA H100 SXM</td><td>80 GB HBM3</td><td>$2.99/hr</td></tr>
        <tr><td>NVIDIA H200 SXM</td><td>141 GB HBM3e</td><td>$3.89/hr</td></tr>
        <tr><td>NVIDIA A100 PCIe</td><td>80 GB HBM2e</td><td>$1.49/hr</td></tr>
        <tr><td>AMD MI300X</td><td>192 GB HBM3</td><td>$2.49/hr</td></tr>
      </tbody>
    </table>
  </main>
</body>
</html>`;

const ragRes = extractFromHtml(multiRowTableHtml, {
  url: 'https://example.com/gpu-pricing',
  chunkSizeTokens: 35
});
assert.ok(ragRes.chunks.length >= 2);
for (const c of ragRes.chunks) {
  assert.equal(c.citationUrl, 'https://example.com/gpu-pricing#enterprise-gpu-instances');
  if (c.containsTable) {
    assert.ok(c.content.includes('| GPU Model | VRAM | Hourly Rate |'));
    assert.deepEqual(c.tableHeaders, ['GPU Model', 'VRAM', 'Hourly Rate']);
  }
}
console.log('✅ 4. Table-Header Preservation & Citation URL Traceability passed!');

// 5. CommonJS & CLI Verification
const cjsRes = cjsPkg.extractFromHtml(SAMPLE_HTML);
assert.equal(cjsRes.success, true);
assert.ok(cjsPkg.MarkCleanError);

const cliOut = execFileSync('node', [path.join(__dirname, '../bin/markclean.mjs'), '--version'], {
  encoding: 'utf8'
}).trim();
assert.equal(cliOut, '1.3.0');
console.log('✅ 5. Dual ESM/CommonJS Exports & CLI Binary (v1.3.0) passed!\n');
console.log('ALL v1.3.0 ENTERPRISE TESTS PASSED SUCCESSFULLY!');
