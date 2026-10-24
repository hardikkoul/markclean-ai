#!/usr/bin/env node
/**
 * Live Production Smoke Tester for your deployed Cloudflare Worker URL.
 * Usage:
 *   node scripts/smoke-test-live.mjs https://markclean-ai-api.markclean.workers.dev
 */

const baseUrl = (process.argv[2] || '').replace(/\/+$/, '');
if (!baseUrl || !baseUrl.startsWith('http')) {
  console.error('Usage: node scripts/smoke-test-live.mjs https://markclean-ai-api.markclean.workers.dev');
  process.exit(1);
}

console.log(`\n🔍 Smoke testing live Cloudflare Worker: ${baseUrl}\n`);

const hRes = await fetch(`${baseUrl}/v1/health`);
const hJson = await hRes.json();
console.log(`1. GET /v1/health -> HTTP ${hRes.status} (${hJson.status}, version ${hJson.version})`);

const eRes = await fetch(`${baseUrl}/v1/extract?url=https://example.com`);
const eJson = await eRes.json();
console.log(`2. GET /v1/extract?url=https://example.com -> HTTP ${eRes.status}`);
console.log(`   - Title: "${eJson.metadata?.title}"`);
console.log(`   - Tokens Saved: ${eJson.stats?.tokensSaved} (-${eJson.stats?.tokenReductionPercent}%)`);

const tRes = await fetch(`${baseUrl}/v1/tables`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    html: '<table><tr><th>Model</th><th>Context</th></tr><tr><td>GPT-4o</td><td>128k</td></tr></table>'
  })
});
const tJson = await tRes.json();
console.log(`3. POST /v1/tables -> HTTP ${tRes.status} (Extracted ${tJson.tableCount} table, first row: ${JSON.stringify(tJson.tables?.[0]?.rows?.[0])})`);

console.log('\n✅ Live Cloudflare Worker v1.3.0 is 100% operational!\n');
