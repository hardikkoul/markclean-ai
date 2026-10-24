#!/usr/bin/env node
/**
 * markclean-ai CLI (`npx markclean-ai <url-or-file> [options]`)
 */

import fs from 'node:fs';
import { extractFromHtml, extractFromUrl, MarkCleanError } from '../dist/index.mjs';

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
markclean-ai v1.3.0 — Web-to-LLM Markdown, Table & RAG Chunker CLI

Usage:
  npx markclean-ai <https://url-or-local-file.html> [options]

Options:
  --json             Output full JSON payload (metadata, markdown, tables, chunks, stats)
  --tables           Output extracted HTML tables as a JSON array
  --chunks           Output traceable RAG chunks with repeated table headers & citation URLs
  --max-tokens=<N>   Maximum tokens per RAG chunk (default: 500, min: 20)
  --no-links         Strip hyperlinks from Markdown output
  --version, -v      Print package version
  --help, -h         Show this help message
`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  console.log('1.3.0');
  process.exit(0);
}

const KNOWN_FLAGS = ['--json', '--tables', '--chunks', '--no-links', '--help', '-h', '--version', '-v'];
for (const arg of args) {
  if (arg.startsWith('-') && !KNOWN_FLAGS.includes(arg) && !arg.startsWith('--max-tokens=')) {
    console.error(JSON.stringify({
      success: false,
      error: {
        code: 'UNKNOWN_CLI_FLAG',
        message: `Unrecognized CLI option "${arg}". Run "npx markclean-ai --help" for valid options.`
      }
    }, null, 2));
    process.exit(1);
  }
}

const target = args.find((a) => !a.startsWith('-'));
if (!target) {
  console.error(JSON.stringify({
    success: false,
    error: {
      code: 'MISSING_TARGET',
      message: 'Missing target URL or HTML file path. Usage: npx markclean-ai <https://url-or-file.html>'
    }
  }, null, 2));
  process.exit(1);
}

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
    if (!fs.existsSync(target)) {
      throw new MarkCleanError(
        'FILE_NOT_FOUND',
        `Local HTML file not found at path "${target}". Verify the file path or pass a full http(s):// URL.`,
        404
      );
    }
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
  const code = err instanceof MarkCleanError ? err.code : 'EXECUTION_ERROR';
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({
    success: false,
    error: { code, message }
  }, null, 2));
  process.exit(1);
}
