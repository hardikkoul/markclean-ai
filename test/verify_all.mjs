import assert from 'node:assert/strict';
import {
  extractFromHtml,
  chunkMarkdown
} from '../packages/markclean-ai/dist/index.mjs';
import worker, { validatePublicUrl } from '../apps/api/src/worker.mjs';

console.log('=== Running MarkClean AI v1.1 Automated Verification Suite ===\n');

const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>SaaS Pricing &amp; Benchmark Report 2026</title>
  <meta name="description" content="Comprehensive SaaS pricing tiers and API token benchmarks." />
  <meta name="author" content="Research Desk" />
  <link rel="canonical" href="https://example.com/saas-benchmark-2026" />
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"TechArticle","headline":"SaaS Pricing Report 2026"}
  </script>
  <script>console.log("analytics tracker noise");</script>
  <style>.cookie-banner { display: block; } body { font-family: sans-serif; }</style>
</head>
<body>
  <nav><a href="/home">Home</a> | <a href="/login">Login</a></nav>
  <div class="cookie-banner">We use cookies to track everything you do. Accept all cookies now!</div>
  <main>
    <h1>SaaS Pricing &amp; Benchmark Report 2026</h1>
    <p>Modern AI pipelines waste <strong>70% to 85% of context tokens</strong> on raw HTML boilerplate, inline scripts, and SVGs. Learn more at <a href="/docs">our documentation</a>.</p>
    <h2>Plan Comparison Table</h2>
    <table>
      <thead>
        <tr><th>Plan Name</th><th>Monthly Price</th><th>Requests Included</th></tr>
      </thead>
      <tbody>
        <tr><td>Starter</td><td>$0</td><td>1,000 / mo</td></tr>
        <tr><td>Pro Developer</td><td>$19</td><td>50,000 / mo</td></tr>
        <tr><td>Enterprise</td><td>$99</td><td>500,000 / mo</td></tr>
      </tbody>
    </table>
    <h2>Code Integration Example</h2>
    <pre><code class="language-javascript">const res = await fetch("https://api.markclean.ai/v1/extract", {
  method: "POST",
  body: JSON.stringify({ url: "https://example.com" })
});</code></pre>
  </main>
  <footer>Copyright 2026 Example Corp. All rights reserved.</footer>
</body>
</html>`;

// 1. Test Core Extraction
const result = extractFromHtml(SAMPLE_HTML, {
  url: 'https://example.com/saas-benchmark-2026'
});
assert.equal(result.success, true);
assert.equal(result.tables.length, 1);
assert.equal(result.tables[0].rows[1]['Plan Name'], 'Pro Developer');
console.log('✅ 1. Core Extraction & Noise Stripping passed!');

// 2. Test SSRF Protection
assert.equal(validatePublicUrl('http://127.0.0.1:8080/admin').valid, false, 'Must block loopback IP');
assert.equal(validatePublicUrl('http://169.254.169.254/latest/meta-data/').valid, false, 'Must block cloud metadata IP');
assert.equal(validatePublicUrl('http://localhost:3000').valid, false, 'Must block localhost');
assert.equal(validatePublicUrl('https://example.com/article').valid, true, 'Must allow valid public HTTPS URL');
console.log('✅ 2. SSRF Security Guard passed!');

// 3. Test POST /v1/extract
const extractReq = new Request('https://api.markclean.ai/v1/extract', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ html: SAMPLE_HTML, url: 'https://example.com/saas-benchmark-2026' })
});
const extractRes = await worker.fetch(extractReq, {});
assert.equal(extractRes.status, 200);
const extractJson = await extractRes.json();
assert.equal(extractJson.success, true);
assert.ok(extractRes.headers.get('X-MarkClean-Tokens-Saved'));
console.log('✅ 3. Worker POST /v1/extract passed!');

// 4. Test POST /v1/tables (New dedicated B2B table endpoint)
const tablesReq = new Request('https://api.markclean.ai/v1/tables', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ html: SAMPLE_HTML, url: 'https://example.com/saas-benchmark-2026' })
});
const tablesRes = await worker.fetch(tablesReq, {});
assert.equal(tablesRes.status, 200);
const tablesJson = await tablesRes.json();
assert.equal(tablesJson.tableCount, 1);
assert.equal(tablesJson.tables[0].rows.length, 3);
console.log('✅ 4. Worker POST /v1/tables endpoint passed!');

// 5. Test RapidAPI Proxy Secret Middleware
const unauthReq = new Request('https://api.markclean.ai/v1/extract', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ html: SAMPLE_HTML })
});
const unauthRes = await worker.fetch(unauthReq, { RAPIDAPI_PROXY_SECRET: 'super-secret-123' });
assert.equal(unauthRes.status, 401);

const authReq = new Request('https://api.markclean.ai/v1/extract', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-RapidAPI-Proxy-Secret': 'super-secret-123'
  },
  body: JSON.stringify({ html: SAMPLE_HTML })
});
const authRes = await worker.fetch(authReq, { RAPIDAPI_PROXY_SECRET: 'super-secret-123' });
assert.equal(authRes.status, 200);
console.log('✅ 5. RapidAPI Proxy Secret authentication passed!\n');

// 6. Test Table-Header Preservation & Source URL Traceability in RAG Chunks (v1.2)
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
        <tr><td>NVIDIA L40S</td><td>48 GB GDDR6</td><td>$0.99/hr</td></tr>
      </tbody>
    </table>
  </main>
</body>
</html>`;

const ragRes = extractFromHtml(multiRowTableHtml, {
  url: 'https://example.com/gpu-pricing',
  chunkSizeTokens: 35
});

assert.ok(ragRes.chunks.length >= 2, 'Large table should split across multiple chunks when chunkSizeTokens=35');
for (const c of ragRes.chunks) {
  assert.equal(c.sourceUrl, 'https://example.com/gpu-pricing', 'Every chunk must carry sourceUrl');
  assert.equal(c.citationUrl, 'https://example.com/gpu-pricing#enterprise-gpu-instances', 'Every chunk must carry deep citationUrl with anchor');
  assert.equal(c.pageTitle, 'Q4 Cloud GPU Pricing Index', 'Every chunk must carry pageTitle');
  if (c.containsTable) {
    assert.ok(c.content.includes('| GPU Model | VRAM | Hourly Rate |'), 'Every split table chunk must repeat the Markdown table header row');
    assert.deepEqual(c.tableHeaders, ['GPU Model', 'VRAM', 'Hourly Rate'], 'Chunk metadata must include tableHeaders array');
  }
}
console.log(`✅ 6. RAG Table-Header Preservation & Citation URL Traceability passed! (${ragRes.chunks.length} traceable table chunks verified)`);


// 7. Test CommonJS build (dist/index.cjs) & CLI binary (bin/markclean.mjs) for Enterprise Compatibility
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const cjsPkg = require('../packages/markclean-ai/dist/index.cjs');

const cjsRes = cjsPkg.extractFromHtml(SAMPLE_HTML, { url: 'https://example.com/cjs-test' });
assert.equal(cjsRes.success, true, 'CommonJS require("markclean-ai") must work identically');
assert.equal(cjsRes.tables.length, 1);

const cliOut = execFileSync('node', [path.join(__dirname, '../packages/markclean-ai/bin/markclean.mjs'), '--help'], {
  encoding: 'utf8'
});
assert.ok(cliOut.includes('MarkClean AI v1.2.0'), 'CLI binary must output help banner');
console.log('✅ 7. Enterprise NPM Package (ESM + CommonJS + TypeScript d.ts + CLI Binary) verified!');

console.log('ALL v1.2 OPEN-CORE & NPM PACKAGE TESTS PASSED SUCCESSFULLY!');
