/**
 * MarkClean AI — Stateless Cloudflare Worker API (v1.3.0)
 * Powered by the open-source `markclean-ai` engine.
 */

import {
  MarkCleanError,
  validatePublicUrl,
  extractFromHtml,
  extractFromUrl,
  extractTables,
  extractMetadata,
  chunkMarkdown,
  estimateTokens
} from '../dist/index.mjs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-RapidAPI-Key, X-RapidAPI-Host, X-RapidAPI-Proxy-Secret, X-API-Key'
};

const MAX_HTML_CHARS = 5 * 1024 * 1024; // 5 MB payload cap
const FETCH_TIMEOUT_MS = 8000;          // 8s upstream timeout

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

function errorResponse(code, message, status = 400, details = {}) {
  return jsonResponse(
    {
      success: false,
      error: {
        code,
        message,
        status,
        ...(Object.keys(details).length > 0 ? { details } : {})
      }
    },
    status
  );
}

/**
 * Verifies RapidAPI Proxy Secret when configured in Cloudflare Worker secrets.
 */
function verifyRapidApiAuth(request, env) {
  if (!env || !env.RAPIDAPI_PROXY_SECRET) {
    return { authorized: true };
  }
  const proxySecret = request.headers.get('X-RapidAPI-Proxy-Secret');
  const directKey = request.headers.get('X-API-Key');

  if (proxySecret && proxySecret === env.RAPIDAPI_PROXY_SECRET) {
    return { authorized: true };
  }
  if (env.DIRECT_API_KEY && directKey === env.DIRECT_API_KEY) {
    return { authorized: true };
  }
  return { authorized: false };
}

/**
 * Parses and validates JSON request body with clear error reporting.
 */
async function parseJsonBody(request) {
  const rawText = await request.text();
  if (!rawText || !rawText.trim()) {
    throw new MarkCleanError(
      'EMPTY_REQUEST_BODY',
      'Request body is empty. Provide a valid JSON object (Content-Type: application/json).',
      400
    );
  }
  try {
    const parsed = JSON.parse(rawText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new MarkCleanError(
        'INVALID_JSON_OBJECT',
        'Request body must be a JSON object (e.g., {"url": "https://example.com"}).',
        400
      );
    }
    return parsed;
  } catch (err) {
    if (err instanceof MarkCleanError) throw err;
    throw new MarkCleanError(
      'MALFORMED_JSON_BODY',
      `Malformed JSON in request body: ${err instanceof Error ? err.message : 'Syntax error'}.`,
      400
    );
  }
}

export { validatePublicUrl };

export default {
  async fetch(request, env) {
    const startTime = Date.now();

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const urlObj = new URL(request.url);
    const path = urlObj.pathname;

    // 1. Public Health & OpenAPI Spec Routes
    if (path === '/' || path === '/v1/health') {
      if (request.method !== 'GET') {
        return errorResponse('METHOD_NOT_ALLOWED', `Method ${request.method} is not allowed on ${path}. Use GET.`, 405);
      }
      return jsonResponse({
        success: true,
        service: 'MarkClean AI — Web-to-LLM Markdown, Table & RAG Chunking API',
        package: 'markclean-ai',
        version: '1.3.0',
        status: 'operational',
        endpoints: [
          'POST /v1/extract',
          'GET  /v1/extract?url=https://example.com',
          'POST /v1/tables',
          'POST /v1/chunk',
          'GET  /v1/openapi.json'
        ]
      });
    }

    if (path === '/v1/openapi.json') {
      if (request.method !== 'GET') {
        return errorResponse('METHOD_NOT_ALLOWED', 'Use GET to retrieve /v1/openapi.json.', 405);
      }
      return jsonResponse(OPENAPI_SPEC);
    }

    // 2. Verify RapidAPI Proxy Authentication
    const auth = verifyRapidApiAuth(request, env);
    if (!auth.authorized) {
      return errorResponse(
        'UNAUTHORIZED',
        'Missing or invalid authentication credentials. Access this API through RapidAPI or provide a valid X-API-Key header.',
        401
      );
    }

    try {
      // 3. Route: /v1/extract (GET or POST)
      if (path === '/v1/extract') {
        if (request.method !== 'GET' && request.method !== 'POST') {
          return errorResponse(
            'METHOD_NOT_ALLOWED',
            `Method ${request.method} is not supported on /v1/extract. Use GET or POST.`,
            405
          );
        }

        let targetUrl = urlObj.searchParams.get('url') || '';
        let rawHtml = '';
        let includeLinks = urlObj.searchParams.get('includeLinks') !== 'false';
        let includeImages = urlObj.searchParams.get('includeImages') === 'true';
        let focusMainContent = urlObj.searchParams.get('focusMainContent') !== 'false';
        let chunkSizeTokens = urlObj.searchParams.has('chunkSizeTokens')
          ? Number(urlObj.searchParams.get('chunkSizeTokens'))
          : 500;

        if (request.method === 'POST') {
          const body = await parseJsonBody(request);
          if (body.url !== undefined) {
            if (typeof body.url !== 'string') {
              throw new MarkCleanError('INVALID_PARAMETER_TYPE', 'Parameter "url" must be a string.', 400);
            }
            targetUrl = body.url.trim();
          }
          if (body.html !== undefined) {
            if (typeof body.html !== 'string') {
              throw new MarkCleanError('INVALID_PARAMETER_TYPE', 'Parameter "html" must be a string.', 400);
            }
            rawHtml = body.html;
          }
          if (typeof body.includeLinks === 'boolean') includeLinks = body.includeLinks;
          if (typeof body.includeImages === 'boolean') includeImages = body.includeImages;
          if (typeof body.focusMainContent === 'boolean') focusMainContent = body.focusMainContent;
          if (body.chunkSizeTokens !== undefined) chunkSizeTokens = Number(body.chunkSizeTokens);
        }

        if (!rawHtml.trim() && !targetUrl.trim()) {
          throw new MarkCleanError(
            'MISSING_INPUT',
            'Missing required input: provide either a non-empty "url" (https://...) or raw "html" string.',
            400
          );
        }

        let result;
        if (!rawHtml.trim() && targetUrl) {
          result = await extractFromUrl(targetUrl, {
            timeoutMs: FETCH_TIMEOUT_MS,
            maxBytes: MAX_HTML_CHARS,
            includeLinks,
            includeImages,
            focusMainContent,
            chunkSizeTokens
          });
        } else {
          if (rawHtml.length > MAX_HTML_CHARS) {
            rawHtml = rawHtml.slice(0, MAX_HTML_CHARS);
          }
          result = extractFromHtml(rawHtml, {
            url: targetUrl,
            includeLinks,
            includeImages,
            focusMainContent,
            chunkSizeTokens
          });
        }

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

      // 4. Route: /v1/tables (GET or POST)
      if (path === '/v1/tables') {
        if (request.method !== 'GET' && request.method !== 'POST') {
          return errorResponse(
            'METHOD_NOT_ALLOWED',
            `Method ${request.method} is not supported on /v1/tables. Use GET or POST.`,
            405
          );
        }

        let targetUrl = urlObj.searchParams.get('url') || '';
        let rawHtml = '';

        if (request.method === 'POST') {
          const body = await parseJsonBody(request);
          if (body.url !== undefined) {
            if (typeof body.url !== 'string') {
              throw new MarkCleanError('INVALID_PARAMETER_TYPE', 'Parameter "url" must be a string.', 400);
            }
            targetUrl = body.url.trim();
          }
          if (body.html !== undefined) {
            if (typeof body.html !== 'string') {
              throw new MarkCleanError('INVALID_PARAMETER_TYPE', 'Parameter "html" must be a string.', 400);
            }
            rawHtml = body.html;
          }
        }

        if (!rawHtml.trim() && !targetUrl.trim()) {
          throw new MarkCleanError(
            'MISSING_INPUT',
            'Missing required input: provide either a non-empty "url" (https://...) or raw "html" string.',
            400
          );
        }

        if (!rawHtml.trim() && targetUrl) {
          const extracted = await extractFromUrl(targetUrl, {
            timeoutMs: FETCH_TIMEOUT_MS,
            maxBytes: MAX_HTML_CHARS
          });
          const latencyMs = Date.now() - startTime;
          return jsonResponse({
            success: true,
            url: extracted.url,
            title: extracted.metadata.title,
            tableCount: extracted.tables.length,
            tables: extracted.tables,
            latencyMs
          });
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

      // 5. Route: /v1/chunk (POST)
      if (path === '/v1/chunk') {
        if (request.method !== 'POST') {
          return errorResponse(
            'METHOD_NOT_ALLOWED',
            `Method ${request.method} is not supported on /v1/chunk. Use POST with a JSON body.`,
            405
          );
        }

        const body = await parseJsonBody(request);
        if (typeof body.markdown !== 'string' || !body.markdown.trim()) {
          throw new MarkCleanError(
            'MISSING_MARKDOWN',
            'Missing or empty "markdown" string in request body.',
            400
          );
        }

        const maxTokens = body.maxTokens !== undefined ? Number(body.maxTokens) : 500;
        const overlapTokens = body.overlapTokens !== undefined ? Number(body.overlapTokens) : 50;

        const chunks = chunkMarkdown(body.markdown, {
          maxTokens,
          overlapTokens,
          sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : (typeof body.url === 'string' ? body.url : ''),
          pageTitle: typeof body.pageTitle === 'string' ? body.pageTitle : (typeof body.title === 'string' ? body.title : ''),
          repeatTableHeaders: body.repeatTableHeaders !== false
        });

        return jsonResponse({
          success: true,
          totalTokens: estimateTokens(body.markdown),
          chunkCount: chunks.length,
          chunks,
          latencyMs: Date.now() - startTime
        });
      }

      return errorResponse(
        'ROUTE_NOT_FOUND',
        `Endpoint "${request.method} ${path}" does not exist. Valid endpoints: POST /v1/extract, GET /v1/extract, POST /v1/tables, POST /v1/chunk, GET /v1/health.`,
        404
      );
    } catch (err) {
      if (err instanceof MarkCleanError) {
        return errorResponse(err.code, err.message, err.status, err.details);
      }
      return errorResponse(
        'INTERNAL_ERROR',
        err instanceof Error ? err.message : 'An unexpected internal error occurred during extraction.',
        500
      );
    }
  }
};

const OPENAPI_SPEC = {
  "openapi": "3.0.3",
  "info": {
    "title": "MarkClean AI \u2014 Web-to-LLM Markdown, Table & RAG Chunking API",
    "version": "1.3.0",
    "description": "Convert any URL or raw HTML into clean GitHub-Flavored Markdown, structured JSON/CSV tables, OpenGraph/JSON-LD metadata, and table-header-preserving RAG chunks with deep-linked citation URLs."
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
        "summary": "Extract clean LLM Markdown, JSON tables & traceable RAG chunks from URL or HTML",
        "description": "Fetches a public URL (or accepts raw HTML) and strips DOM clutter, scripts, and cookie banners. Returns clean Markdown with YAML frontmatter, structured JSON/CSV tables, and table-header-preserving RAG chunks.",
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
                    "minimum": 20,
                    "description": "Target maximum token count per semantic RAG chunk (>= 20)"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Clean Markdown, metadata, extracted tables, RAG chunks, and token savings telemetry"
          },
          "400": {
            "description": "Structured validation error (INVALID_JSON_BODY, MISSING_INPUT, INVALID_URL_FORMAT, etc.)"
          },
          "401": {
            "description": "Unauthorized (Missing or invalid RapidAPI proxy header)"
          },
          "415": {
            "description": "Unsupported upstream Content-Type"
          },
          "502": {
            "description": "Upstream server error"
          },
          "504": {
            "description": "Upstream fetch timed out"
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
          },
          {
            "name": "chunkSizeTokens",
            "in": "query",
            "required": false,
            "schema": {
              "type": "integer",
              "default": 500,
              "minimum": 20
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Successful extraction response"
          },
          "400": {
            "description": "Validation error"
          }
        }
      }
    },
    "/v1/tables": {
      "post": {
        "operationId": "extractTablesPost",
        "summary": "Extract all HTML tables from a URL or HTML into JSON, CSV & Markdown",
        "description": "Extracts every HTML <table> on a page into clean JSON key-value arrays, RFC-4180 CSV strings, and GFM pipe tables.",
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
          },
          "400": {
            "description": "Validation error"
          }
        }
      }
    },
    "/v1/chunk": {
      "post": {
        "operationId": "chunkMarkdownPost",
        "summary": "Split Markdown into heading-aware, table-header-preserving RAG chunks",
        "description": "Splits Markdown documents along H1\u2013H3 semantic boundaries while repeating table headers across split chunks and attaching deep-linked citation URLs.",
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
                    "example": "# Enterprise Overview\nMarkClean AI converts HTML into clean Markdown.\n\n## Benchmark Table\n| Model | Tokens |\n| --- | --- |\n| GPT-4o | 128k |"
                  },
                  "maxTokens": {
                    "type": "integer",
                    "default": 500,
                    "minimum": 20
                  },
                  "overlapTokens": {
                    "type": "integer",
                    "default": 50,
                    "minimum": 0
                  },
                  "sourceUrl": {
                    "type": "string",
                    "description": "Optional canonical source URL attached to every returned chunk for traceable citations",
                    "example": "https://example.com/benchmarks"
                  },
                  "pageTitle": {
                    "type": "string",
                    "description": "Optional document title attached to every returned chunk"
                  },
                  "repeatTableHeaders": {
                    "type": "boolean",
                    "default": true,
                    "description": "Automatically repeat Markdown table headers across split chunks"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Array of semantic RAG chunks with token counts and citation metadata"
          },
          "400": {
            "description": "Validation error"
          }
        }
      }
    },
    "/v1/health": {
      "get": {
        "operationId": "healthCheck",
        "summary": "Health & version check endpoint",
        "responses": {
          "200": {
            "description": "Service operational status"
          }
        }
      }
    }
  }
};
