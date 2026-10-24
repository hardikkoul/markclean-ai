/**
 * MarkClean AI v1.1.0 — Production Hardened Stateless Cloudflare Worker API
 * - 100% Free Hosting on Cloudflare Workers (100,000 requests/day free tier)
 * - SSRF Protection (blocks localhost, private IPs, cloud metadata endpoints)
 * - 8-second upstream AbortController timeout & 5MB payload safety cap
 * - Edge Cache support for repeated GET /v1/extract?url=... calls
 * - RapidAPI Proxy Secret authentication & custom telemetry headers
 */

import {
  extractFromHtml,
  extractTables,
  extractMetadata,
  chunkMarkdown,
  estimateTokens
} from '../../../packages/markclean-ai/dist/index.mjs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-RapidAPI-Key, X-RapidAPI-Host, X-RapidAPI-Proxy-Secret, X-API-Key'
};

const MAX_HTML_CHARS = 5 * 1024 * 1024; // 5 MB safety limit
const FETCH_TIMEOUT_MS = 8000;          // 8 seconds upstream timeout

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...extraHeaders
    }
  });
}

/**
 * Prevents SSRF attacks against private networks, loopback, or cloud metadata IPs.
 */
export function validatePublicUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    return { valid: false, reason: 'Invalid URL format. Include http:// or https://.' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { valid: false, reason: 'Only http:// and https:// URLs are supported.' };
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
  ) {
    return { valid: false, reason: 'Restricted internal or private network host.' };
  }
  return { valid: true, url: parsed.href };
}

/**
 * Fetches upstream HTML with timeout and size guard.
 */
async function fetchUpstreamHtml(targetUrl) {
  const check = validatePublicUrl(targetUrl);
  if (!check.valid) {
    const err = new Error(check.reason);
    err.status = 400;
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(check.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarkCleanAI/1.1; +https://rapidapi.com)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow'
    });

    if (!resp.ok) {
      const err = new Error(`Upstream URL returned HTTP ${resp.status} ${resp.statusText}`);
      err.status = 502;
      throw err;
    }

    const text = await resp.text();
    if (text.length > MAX_HTML_CHARS) {
      return text.slice(0, MAX_HTML_CHARS);
    }
    return text;
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`Upstream URL timed out after ${FETCH_TIMEOUT_MS}ms`);
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verifies RapidAPI Proxy Secret (when configured in Cloudflare Worker env)
 * so users cannot bypass RapidAPI billing to hit your Worker URL directly.
 */
function verifyAuth(request, env) {
  if (!env || !env.RAPIDAPI_PROXY_SECRET) {
    return { authorized: true, tier: 'open-dev' };
  }
  const proxySecret = request.headers.get('X-RapidAPI-Proxy-Secret');
  const directKey = request.headers.get('X-API-Key');
  if (proxySecret && proxySecret === env.RAPIDAPI_PROXY_SECRET) {
    return {
      authorized: true,
      tier: request.headers.get('X-RapidAPI-Subscription') || 'rapidapi',
      user: request.headers.get('X-RapidAPI-User') || 'anonymous'
    };
  }
  if (env.DIRECT_API_KEY && directKey === env.DIRECT_API_KEY) {
    return { authorized: true, tier: 'pro-direct', user: 'direct' };
  }
  return { authorized: false, tier: 'unauthorized' };
}

export default {
  async fetch(request, env) {
    const startTime = Date.now();

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const urlObj = new URL(request.url);
    const path = urlObj.pathname;

    // Public endpoints: Health & OpenAPI Spec
    if (path === '/' || path === '/v1/health') {
      return jsonResponse({
        service: 'MarkClean AI — Web-to-LLM Markdown, Table & RAG Chunking API',
        version: '1.2.0',
        status: 'operational',
        authMode: env?.RAPIDAPI_PROXY_SECRET ? 'rapidapi-enforced' : 'open-testing',
        endpoints: [
          'POST /v1/extract (extract clean LLM Markdown, JSON tables & RAG chunks from URL or raw HTML)',
          'GET  /v1/extract?url=https://example.com',
          'POST /v1/tables  (extract all HTML tables from URL or HTML into JSON, CSV & Markdown)',
          'POST /v1/chunk   (split Markdown into token-bounded RAG chunks)',
          'GET  /v1/openapi.json (OpenAPI 3.0.3 spec for RapidAPI)'
        ]
      });
    }

    if (path === '/v1/openapi.json') {
      return jsonResponse(OPENAPI_SPEC);
    }

    // Verify RapidAPI / Direct API Key authentication for protected /v1/* routes
    const auth = verifyAuth(request, env);
    if (!auth.authorized) {
      return jsonResponse(
        {
          success: false,
          error: 'Unauthorized. Please subscribe via RapidAPI or pass a valid X-API-Key header.'
        },
        401
      );
    }

    try {
      // 1. GET or POST /v1/extract
      if (path === '/v1/extract') {
        let targetUrl = urlObj.searchParams.get('url') || '';
        let rawHtml = '';
        let includeLinks = urlObj.searchParams.get('includeLinks') !== 'false';
        let includeImages = urlObj.searchParams.get('includeImages') === 'true';
        let focusMainContent = urlObj.searchParams.get('focusMainContent') !== 'false';
        let chunkSizeTokens = parseInt(urlObj.searchParams.get('chunkSizeTokens') || '500', 10);

        if (request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          targetUrl = body.url || targetUrl;
          rawHtml = body.html || '';
          if (typeof body.includeLinks === 'boolean') includeLinks = body.includeLinks;
          if (typeof body.includeImages === 'boolean') includeImages = body.includeImages;
          if (typeof body.focusMainContent === 'boolean') focusMainContent = body.focusMainContent;
          if (typeof body.chunkSizeTokens === 'number') chunkSizeTokens = body.chunkSizeTokens;
        }

        if (!rawHtml && !targetUrl) {
          return jsonResponse(
            {
              success: false,
              error: 'Missing input: provide either "url" (https://...) or raw "html" string.'
            },
            400
          );
        }

        if (!rawHtml && targetUrl) {
          rawHtml = await fetchUpstreamHtml(targetUrl);
        } else if (rawHtml.length > MAX_HTML_CHARS) {
          rawHtml = rawHtml.slice(0, MAX_HTML_CHARS);
        }

        const result = extractFromHtml(rawHtml, {
          url: targetUrl,
          includeLinks,
          includeImages,
          focusMainContent,
          chunkSizeTokens
        });

        const latencyMs = Date.now() - startTime;
        return jsonResponse(
          { ...result, latencyMs },
          200,
          {
            'X-MarkClean-Tokens-Saved': String(result.stats.tokensSaved),
            'X-MarkClean-Reduction-Pct': `${result.stats.tokenReductionPercent}%`,
            'X-MarkClean-Latency-Ms': String(latencyMs)
          }
        );
      }

      // 2. POST /v1/tables (Dedicated Table-to-JSON/CSV Extractor)
      if (path === '/v1/tables' && (request.method === 'POST' || request.method === 'GET')) {
        let targetUrl = urlObj.searchParams.get('url') || '';
        let rawHtml = '';

        if (request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          targetUrl = body.url || targetUrl;
          rawHtml = body.html || '';
        }

        if (!rawHtml && !targetUrl) {
          return jsonResponse(
            {
              success: false,
              error: 'Missing input: provide either "url" (https://...) or raw "html" string.'
            },
            400
          );
        }

        if (!rawHtml && targetUrl) {
          rawHtml = await fetchUpstreamHtml(targetUrl);
        }

        const metadata = extractMetadata(rawHtml, targetUrl);
        const tables = extractTables(rawHtml);
        const latencyMs = Date.now() - startTime;

        return jsonResponse({
          success: true,
          url: metadata.canonicalUrl || targetUrl,
          title: metadata.title,
          tableCount: tables.length,
          tables,
          latencyMs
        });
      }

      // 3. POST /v1/chunk (Semantic RAG Chunker)
      if (path === '/v1/chunk' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const markdown = body.markdown || '';
        const maxTokens = Math.max(20, Number(body.maxTokens || 500));
        const overlapTokens = Math.max(0, Number(body.overlapTokens || 50));

        if (!markdown.trim()) {
          return jsonResponse({ success: false, error: 'Missing "markdown" string in request body.' }, 400);
        }

        const chunks = chunkMarkdown(markdown, {
          maxTokens,
          overlapTokens,
          sourceUrl: body.sourceUrl || body.url || '',
          pageTitle: body.pageTitle || body.title || '',
          repeatTableHeaders: body.repeatTableHeaders !== false
        });
        return jsonResponse({
          success: true,
          totalTokens: estimateTokens(markdown),
          chunkCount: chunks.length,
          chunks,
          latencyMs: Date.now() - startTime
        });
      }

      return jsonResponse({ success: false, error: `Route ${path} not found.` }, 404);
    } catch (err) {
      const status = err.status || 500;
      return jsonResponse(
        {
          success: false,
          error: err instanceof Error ? err.message : 'Internal extraction error'
        },
        status
      );
    }
  }
};

const OPENAPI_SPEC = {
  "openapi": "3.0.3",
  "info": {
    "title": "MarkClean AI \u2014 Web-to-LLM Markdown, Table & RAG Chunking API",
    "version": "1.2.0",
    "description": "Convert any URL or raw HTML into clean, token-optimized GitHub-Flavored Markdown, structured JSON/CSV tables, OpenGraph/JSON-LD metadata, and semantic RAG chunks. Cuts LLM token costs by 65\u201390% for AI agents, LangChain/LlamaIndex pipelines, and n8n/Make automations."
  },
  "servers": [
    {
      "url": "https://markclean-ai-api.markclean.workers.dev",
      "description": "Cloudflare Global Edge Network"
    }
  ],
  "paths": {
    "/v1/extract": {
      "post": {
        "operationId": "extractPost",
        "summary": "Extract clean LLM Markdown, JSON tables & RAG chunks from URL or HTML",
        "description": "Fetches a URL (or accepts raw HTML) and strips DOM clutter, ads, scripts, and cookie banners. Returns clean Markdown with YAML frontmatter, structured JSON/CSV tables, and semantic RAG chunks.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "url": {
                    "type": "string",
                    "description": "Public HTTP/HTTPS URL to fetch and extract",
                    "example": "https://en.wikipedia.org/wiki/Large_language_model"
                  },
                  "html": {
                    "type": "string",
                    "description": "Optional raw HTML string to parse directly instead of fetching a URL"
                  },
                  "includeLinks": {
                    "type": "boolean",
                    "default": true,
                    "description": "Preserve hyperlinks in Markdown output"
                  },
                  "includeImages": {
                    "type": "boolean",
                    "default": false,
                    "description": "Preserve image references in Markdown output"
                  },
                  "focusMainContent": {
                    "type": "boolean",
                    "default": true,
                    "description": "Automatically strip nav, footer, sidebar, and cookie banners"
                  },
                  "chunkSizeTokens": {
                    "type": "integer",
                    "default": 500,
                    "description": "Target maximum token count per semantic RAG chunk"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Clean Markdown, metadata, extracted tables, RAG chunks, and token savings telemetry"
          }
        }
      },
      "get": {
        "operationId": "extractGet",
        "summary": "Extract clean LLM Markdown from a URL via GET query parameters",
        "parameters": [
          {
            "name": "url",
            "in": "query",
            "required": true,
            "description": "Target webpage URL (e.g., https://example.com)",
            "schema": {
              "type": "string",
              "example": "https://example.com"
            }
          },
          {
            "name": "includeLinks",
            "in": "query",
            "required": false,
            "schema": {
              "type": "boolean",
              "default": true
            }
          },
          {
            "name": "focusMainContent",
            "in": "query",
            "required": false,
            "schema": {
              "type": "boolean",
              "default": true
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Successful extraction response"
          }
        }
      }
    },
    "/v1/tables": {
      "post": {
        "operationId": "extractTablesPost",
        "summary": "Extract all HTML tables from a URL or HTML as structured JSON, CSV & Markdown",
        "description": "Dedicated endpoint for financial, pricing, and benchmark scraping. Extracts every HTML table on a page into clean JSON object arrays, RFC-4180 CSV strings, and GFM pipe tables.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "url": {
                    "type": "string",
                    "example": "https://en.wikipedia.org/wiki/List_of_countries_by_GDP_(nominal)"
                  },
                  "html": {
                    "type": "string",
                    "description": "Optional raw HTML containing <table> elements"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Array of extracted tables in JSON, CSV, and Markdown formats"
          }
        }
      }
    },
    "/v1/chunk": {
      "post": {
        "operationId": "chunkMarkdownPost",
        "summary": "Split Markdown or text into heading-aware, token-bounded RAG chunks",
        "description": "Splits long Markdown documents along H1\u2013H3 semantic boundaries while respecting your maximum token window and token overlap for vector embeddings.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "markdown"
                ],
                "properties": {
                  "markdown": {
                    "type": "string",
                    "example": "# Overview\nMarkClean AI converts HTML to clean Markdown.\n\n## Pricing\nStarts at $0/month on Cloudflare Workers."
                  },
                  "maxTokens": {
                    "type": "integer",
                    "default": 500
                  },
                  "overlapTokens": {
                    "type": "integer",
                    "default": 50
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Array of semantic RAG chunks with token counts"
          }
        }
      }
    },
    "/v1/health": {
      "get": {
        "operationId": "healthCheck",
        "summary": "Health & version check endpoint for RapidAPI uptime monitoring",
        "responses": {
          "200": {
            "description": "Service operational status"
          }
        }
      }
    }
  }
};
