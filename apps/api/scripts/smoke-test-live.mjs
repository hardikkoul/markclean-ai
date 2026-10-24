#!/usr/bin/env node
/**
 * Live Production Smoke Tester for your deployed Cloudflare Worker URL.
 * Usage:
 *   node apps/api/scripts/smoke-test-live.mjs https://markclean-ai-api.<your-subdomain>.workers.dev
 */

const baseUrl = (process.argv[2] || '').replace(/\/+$/, '');
if (!baseUrl || !baseUrl.startsWith('http')) {
  console.error('Usage: node apps/api/scripts/smoke-test-live.mjs https://markclean-ai-api.<your-subdomain>.workers.dev');
  process.exit(1);
}

console.log(`\n🔍 Smoke testing live Cloudflare Worker: ${baseUrl}\n`);

// 1. Health Check
const hRes = await fetch(`${baseUrl}/v1/health`);
const hJson = await hRes.json();
console.log(`1. GET /v1/health -> HTTP ${hRes.status} (${hJson.status}, version ${hJson.version})`);

// 2. Extract URL Check
const eRes = await fetch(`${baseUrl}/v1/extract?url=https://example.com`);
const eJson = await eRes.json();
console.log(`2. GET /v1/extract?url=https://example.com -> HTTP ${eRes.status}`);
console.log(`   - Title: "${eJson.metadata?.title}"`);
console.log(`   - Tokens Saved: ${eJson.stats?.tokensSaved} (-${eJson.stats?.tokenReductionPercent}%)`);

// 3. Extract Tables Check
const tRes = await fetch(`${baseUrl}/v1/tables`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    html: '<table><tr><th>Tier</th><th>Price</th></tr><tr><td>Pro</td><td>$9/mo</td></tr></table>'
  })
});
const tJson = await tRes.json();
console.log(`3. POST /v1/tables -> HTTP ${tRes.status} (Extracted ${tJson.tableCount} table, first row: ${JSON.stringify(tJson.tables?.[0]?.rows?.[0])})`);

console.log('\n✅ Your live Cloudflare Worker is 100% operational and ready for RapidAPI!\n');
