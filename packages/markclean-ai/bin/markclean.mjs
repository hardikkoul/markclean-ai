#!/usr/bin/env node
/**
 * MarkClean AI CLI (`npx markclean-ai <url-or-html-file> [options]`)
 * Options:
 *   --json           Output full structured JSON (metadata, markdown, tables, traceable RAG chunks, stats)
 *   --tables         Output extracted HTML tables as JSON
 *   --chunks         Output semantic, table-header-preserving RAG chunks as JSON
 *   --max-tokens=N   Set target max tokens per RAG chunk (default: 500)
 */

import fs from 'node:fs';
import { extractFromHtml, extractFromUrl } from '../dist/index.mjs';

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
MarkClean AI v1.2.0 — Open-Source Web-to-LLM Markdown, Table & RAG Chunker
Usage:
  npx markclean-ai <https://url-or-local-file.html> [options]

Options:
  --json            Output full JSON payload (metadata, markdown, tables, chunks, stats)
  --tables          Output extracted HTML tables as JSON array
  --chunks          Output traceable RAG chunks with repeated table headers & citation URLs
  --max-tokens=500  Maximum tokens per RAG chunk (default: 500)
  --no-links        Strip hyperlinks from Markdown output

Need a Managed Global Edge API with SLA & Zero Infrastructure?
  Subscribe via RapidAPI or visit: https://markclean-ai-api.markclean.workers.dev/v1/health
`);
  process.exit(0);
}

const target = args.find((a) => !a.startsWith('--'));
const outJson = args.includes('--json');
const outTables = args.includes('--tables');
const outChunks = args.includes('--chunks');
const includeLinks = !args.includes('--no-links');
const maxTokensArg = args.find((a) => a.startsWith('--max-tokens='));
const chunkSizeTokens = maxTokensArg ? parseInt(maxTokensArg.split('=')[1], 10) : 500;

try {
  let result;
  if (/^https?:\/\//i.test(target)) {
    result = await extractFromUrl(target, { includeLinks, chunkSizeTokens });
  } else {
    const html = fs.readFileSync(target, 'utf8');
    result = extractFromHtml(html, { includeLinks, chunkSizeTokens });
  }

  if (outJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (outTables) {
    console.log(JSON.stringify(result.tables, null, 2));
  } else if (outChunks) {
    console.log(JSON.stringify(result.chunks, null, 2));
  } else {
    console.log(result.markdown);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
