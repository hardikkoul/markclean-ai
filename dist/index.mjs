/**
 * markclean-ai v1.3.0
 * Zero-dependency HTML-to-LLM Markdown converter, HTML Table-to-JSON/CSV parser,
 * and Table-Header-Preserving RAG Chunker with deep-linked citation URLs.
 *
 * License: MIT
 * Repository: https://github.com/hardikkoul/markclean-ai
 */

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&ndash;': '–',
  '&mdash;': '—',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
  '&hellip;': '…',
  '&bull;': '•'
};

/**
 * Structured error class for deterministic error handling in enterprise pipelines.
 */
export class MarkCleanError extends Error {
  /**
   * @param {string} code - Machine-readable error code (e.g. 'INVALID_HTML_INPUT', 'INVALID_URL', 'UPSTREAM_TIMEOUT')
   * @param {string} message - Clear, actionable developer message
   * @param {number} [status=400] - Recommended HTTP status code
   * @param {Record<string, unknown>} [details={}] - Additional diagnostic context
   */
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'MarkCleanError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Decodes HTML entities into standard UTF-8 characters.
 */
export function decodeEntities(str = '') {
  if (typeof str !== 'string' || !str) return '';
  return str
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp|ndash|mdash|copy|reg|trade|hellip|bull);/gi, (m) => ENTITIES[m.toLowerCase()] || m)
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Estimates LLM token count using a hybrid character/word heuristic (~cl100k_base).
 */
export function estimateTokens(text = '') {
  if (typeof text !== 'string' || !text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const words = trimmed.split(/\s+/).length;
  const chars = trimmed.length;
  return Math.max(1, Math.ceil((chars / 4 + words * 1.33) / 2));
}

/**
 * Validates that a URL is a well-formed public HTTP/HTTPS address and blocks private/loopback SSRF targets.
 */
export function validatePublicUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return {
      valid: false,
      code: 'MISSING_URL',
      reason: 'URL must be a non-empty string starting with http:// or https://.'
    };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (_) {
    return {
      valid: false,
      code: 'INVALID_URL_FORMAT',
      reason: `Malformed URL "${rawUrl}". Provide a valid absolute URL including http:// or https://.`
    };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return {
      valid: false,
      code: 'UNSUPPORTED_PROTOCOL',
      reason: `Unsupported URL protocol "${parsed.protocol}". Only http: and https: are allowed.`
    };
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
    return {
      valid: false,
      code: 'RESTRICTED_HOST',
      reason: `Hostname "${host}" resolves to a restricted loopback, private network, or metadata address.`
    };
  }

  return { valid: true, url: parsed.href };
}

/**
 * Extracts page metadata (Title, Description, Canonical URL, Author, Published Date, OpenGraph, JSON-LD).
 */
export function extractMetadata(html = '', baseUrl = '') {
  if (typeof html !== 'string') {
    throw new MarkCleanError('INVALID_HTML_INPUT', 'Expected "html" parameter to be a string.', 400);
  }

  const meta = {
    title: '',
    description: '',
    canonicalUrl: typeof baseUrl === 'string' ? baseUrl.trim() : '',
    author: '',
    publishedTime: '',
    siteName: '',
    ogImage: '',
    jsonLd: []
  };

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    meta.title = decodeEntities(titleMatch[1].replace(/\s+/g, ' ').trim());
  }

  const metaRegex = /<meta\s+([^>]+)>/gi;
  let m;
  while ((m = metaRegex.exec(html)) !== null) {
    const attrs = m[1];
    const nameMatch = attrs.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i);
    const contentMatch = attrs.match(/content\s*=\s*["']([^"']*)["']/i);
    if (nameMatch && contentMatch) {
      const key = nameMatch[1].toLowerCase().trim();
      const val = decodeEntities(contentMatch[1].trim());
      if (key === 'description' || (key === 'og:description' && !meta.description)) meta.description = val;
      if (key === 'og:title' && !meta.title) meta.title = val;
      if (key === 'author' || key === 'article:author') meta.author = val;
      if (key === 'article:published_time' || key === 'date' || key === 'pubdate') meta.publishedTime = val;
      if (key === 'og:site_name') meta.siteName = val;
      if (key === 'og:image') meta.ogImage = val;
    }
  }

  const canonMatch =
    html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i) ||
    html.match(/<link[^>]+href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']canonical["']/i);
  if (canonMatch) {
    meta.canonicalUrl = canonMatch[1].trim();
  }

  const jsonLdRegex = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jm;
  while ((jm = jsonLdRegex.exec(html)) !== null) {
    try {
      const raw = jm[1].trim();
      if (raw) {
        meta.jsonLd.push(JSON.parse(raw));
      }
    } catch (_) {
      // Ignore malformed JSON-LD blocks in upstream HTML
    }
  }

  return meta;
}

/**
 * Strips all HTML tags inside a fragment and normalizes whitespace.
 */
export function stripTags(htmlFragment = '') {
  if (typeof htmlFragment !== 'string') return '';
  return decodeEntities(
    htmlFragment
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Extracts all HTML <table> elements into structured JSON records, RFC-4180 CSV strings, and GFM Markdown tables.
 */
export function extractTables(html = '') {
  if (typeof html !== 'string') {
    throw new MarkCleanError('INVALID_HTML_INPUT', 'Expected "html" parameter to be a string.', 400);
  }

  const tables = [];
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tm;
  let tableIndex = 0;

  while ((tm = tableRegex.exec(html)) !== null) {
    const tableHtml = tm[1];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const rawRows = [];
    let rm;

    while ((rm = rowRegex.exec(tableHtml)) !== null) {
      const rowHtml = rm[1];
      const cellRegex = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi;
      const cells = [];
      let cm;
      while ((cm = cellRegex.exec(rowHtml)) !== null) {
        cells.push(stripTags(cm[2]));
      }
      if (cells.length > 0 && cells.some((c) => c.length > 0)) {
        rawRows.push(cells);
      }
    }

    if (rawRows.length >= 2) {
      tableIndex++;
      const colCount = Math.max(...rawRows.map((r) => r.length));
      const normalizedRows = rawRows.map((r) => {
        const copy = [...r];
        while (copy.length < colCount) copy.push('');
        return copy;
      });

      const headers = normalizedRows[0].map((h, i) => h || `Column_${i + 1}`);
      const dataRows = normalizedRows.slice(1);

      const jsonRecords = dataRows.map((row) => {
        const obj = {};
        headers.forEach((h, i) => {
          obj[h] = row[i] ?? '';
        });
        return obj;
      });

      const escapeCsv = (val) => {
        const s = String(val ?? '');
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };

      const csvLines = [
        headers.map(escapeCsv).join(','),
        ...dataRows.map((r) => r.map(escapeCsv).join(','))
      ];

      const escapeMd = (val) => String(val ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
      const mdLines = [
        `| ${headers.map(escapeMd).join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        ...dataRows.map((r) => `| ${r.map(escapeMd).join(' | ')} |`)
      ];

      tables.push({
        index: tableIndex,
        headers,
        rowCount: dataRows.length,
        rows: jsonRecords,
        csv: csvLines.join('\n'),
        markdown: mdLines.join('\n')
      });
    }
  }

  return tables;
}

/**
 * Strips non-content DOM clutter (scripts, styles, SVGs, cookie banners, nav, footers)
 * and isolates the primary <main> or <article> body when present.
 */
export function cleanHtml(html = '', options = {}) {
  if (typeof html !== 'string') {
    throw new MarkCleanError('INVALID_HTML_INPUT', 'Expected "html" parameter to be a string.', 400);
  }

  const { focusMainContent = true } = options;
  let cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|canvas|iframe|object|embed|audio|video)[^>]*>[\s\S]*?<\/\1>/gi, '');

  if (focusMainContent) {
    cleaned = cleaned.replace(/<(nav|footer|aside|dialog)[^>]*>[\s\S]*?<\/\1>/gi, '');
    cleaned = cleaned.replace(
      /<(div|section|aside|header|footer)[^>]+(?:id|class)\s*=\s*["'][^"']*(?:cookie|consent|gdpr|banner|popup|modal|newsletter|advert|ad-slot|sidebar|social-share|related-posts|comments)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi,
      ''
    );

    const mainMatch =
      cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
      cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (mainMatch && stripTags(mainMatch[1]).length > 160) {
      cleaned = mainMatch[1];
    } else {
      const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch) cleaned = bodyMatch[1];
    }
  }

  return cleaned;
}

/**
 * Resolves relative links against a base URL safely.
 */
export function resolveUrl(href = '', baseUrl = '') {
  if (typeof href !== 'string' || !href) return '';
  const trimmed = href.trim();
  if (/^(javascript:|mailto:|tel:|data:|#)/i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!baseUrl) return trimmed;
  try {
    return new URL(trimmed, baseUrl).href;
  } catch (_) {
    return trimmed;
  }
}

/**
 * Converts HTML into clean, token-optimized GitHub-Flavored Markdown (GFM).
 */
export function htmlToMarkdown(html = '', options = {}) {
  if (typeof html !== 'string') {
    throw new MarkCleanError('INVALID_HTML_INPUT', 'Expected "html" parameter to be a string.', 400);
  }

  const {
    baseUrl = '',
    includeLinks = true,
    includeImages = false,
    focusMainContent = true
  } = options;

  let work = cleanHtml(html, { focusMainContent });

  const codeBlocks = [];
  work = work.replace(/<pre[^>]*>\s*(?:<code([^>]*)>)?([\s\S]*?)(?:<\/code>)?\s*<\/pre>/gi, (_, codeAttrs = '', codeBody = '') => {
    const langMatch = (codeAttrs || '').match(/language-([a-z0-9_+-]+)/i);
    const lang = langMatch ? langMatch[1] : '';
    const rawCode = decodeEntities(codeBody.replace(/<[^>]+>/g, '')).trim();
    const token = `__MARKCLEAN_CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(`\n\`\`\`${lang}\n${rawCode}\n\`\`\`\n`);
    return token;
  });

  const extractedTables = extractTables(work);
  let tableCursor = 0;
  work = work.replace(/<table[^>]*>[\s\S]*?<\/table>/gi, () => {
    const tbl = extractedTables[tableCursor++];
    if (!tbl) return '';
    return `\n\n${tbl.markdown}\n\n`;
  });

  work = work.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, inner) => `\`${stripTags(inner)}\``);

  for (let level = 1; level <= 6; level++) {
    const hashes = '#'.repeat(level);
    const regex = new RegExp(`<h${level}[^>]*>([\\s\\S]*?)<\\/h${level}>`, 'gi');
    work = work.replace(regex, (_, inner) => `\n\n${hashes} ${stripTags(inner)}\n\n`);
  }

  work = work.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) => {
    const text = stripTags(inner);
    return text ? `\n\n> ${text}\n\n` : '';
  });

  work = work.replace(/<(strong|b)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_, _tag, inner) => {
    const t = stripTags(inner);
    return t ? `**${t}**` : '';
  });
  work = work.replace(/<(em|i)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_, _tag, inner) => {
    const t = stripTags(inner);
    return t ? `*${t}*` : '';
  });

  if (includeImages) {
    work = work.replace(/<img[^>]+>/gi, (imgTag) => {
      const srcMatch = imgTag.match(/src\s*=\s*["']([^"']+)["']/i);
      const altMatch = imgTag.match(/alt\s*=\s*["']([^"']*)["']/i);
      if (!srcMatch) return '';
      const src = resolveUrl(srcMatch[1], baseUrl);
      if (src.startsWith('data:')) return '';
      const alt = altMatch ? decodeEntities(altMatch[1].trim()) : 'image';
      return `![${alt}](${src})`;
    });
  } else {
    work = work.replace(/<img[^>]+>/gi, '');
  }

  work = work.replace(/<a\s+([^>]+)>([\s\S]*?)<\/a>/gi, (_, attrs, inner) => {
    const text = stripTags(inner);
    if (!text) return '';
    if (!includeLinks) return text;
    const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) return text;
    const url = resolveUrl(hrefMatch[1], baseUrl);
    if (!url || url.startsWith('javascript:') || url.startsWith('#')) return text;
    return `[${text}](${url})`;
  });

  work = work.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, listInner) => {
    let idx = 0;
    const items = listInner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (__, liContent) => {
      idx++;
      const cleanItem = liContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return cleanItem ? `\n${idx}. ${decodeEntities(cleanItem)}` : '';
    });
    return `\n${items}\n`;
  });

  work = work.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, listInner) => {
    const items = listInner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (__, liContent) => {
      const cleanItem = liContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return cleanItem ? `\n- ${decodeEntities(cleanItem)}` : '';
    });
    return `\n${items}\n`;
  });

  work = work
    .replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|tr|header)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');

  codeBlocks.forEach((block, idx) => {
    work = work.replace(`__MARKCLEAN_CODE_BLOCK_${idx}__`, block);
  });

  return decodeEntities(work)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Generates a URL-safe GitHub-style anchor slug from a heading string.
 */
export function slugifyHeading(heading = '') {
  if (typeof heading !== 'string') return '';
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Splits a large GFM Markdown table into smaller sub-tables that each fit within `maxTokens`,
 * repeating the `| Header |` and `| --- |` rows at the top of every split chunk.
 */
export function splitMarkdownTableWithHeaders(tableBlock = '', maxTokens = 500) {
  const lines = tableBlock.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) {
    return [{ text: tableBlock.trim(), headers: [] }];
  }

  const headerLine = lines[0];
  const separatorLine = lines[1];
  const dataLines = lines.slice(2);

  const parsedHeaders = headerLine
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((h) => h.trim())
    .filter(Boolean);

  if (estimateTokens(tableBlock) <= maxTokens) {
    return [{ text: tableBlock.trim(), headers: parsedHeaders }];
  }

  const headerPrefix = `${headerLine}\n${separatorLine}`;
  const subTables = [];
  let currentRows = [];

  for (const row of dataLines) {
    const candidate = `${headerPrefix}\n${[...currentRows, row].join('\n')}`;
    if (estimateTokens(candidate) > maxTokens && currentRows.length > 0) {
      subTables.push({
        text: `${headerPrefix}\n${currentRows.join('\n')}`,
        headers: parsedHeaders
      });
      currentRows = [row];
    } else {
      currentRows.push(row);
    }
  }

  if (currentRows.length > 0) {
    subTables.push({
      text: `${headerPrefix}\n${currentRows.join('\n')}`,
      headers: parsedHeaders
    });
  }

  return subTables.length > 0 ? subTables : [{ text: tableBlock.trim(), headers: parsedHeaders }];
}

/**
 * Splits Markdown into semantic, heading-aware, table-header-preserving chunks
 * with full source URL and section-anchor traceability for RAG & AI Agent pipelines.
 */
export function chunkMarkdown(markdown = '', options = {}) {
  if (typeof markdown !== 'string') {
    throw new MarkCleanError('INVALID_MARKDOWN_INPUT', 'Expected "markdown" parameter to be a string.', 400);
  }

  const {
    maxTokens = 500,
    overlapTokens = Math.min(50, Math.floor(Number(maxTokens || 500) * 0.2)),
    sourceUrl = '',
    pageTitle = '',
    repeatTableHeaders = true
  } = options;

  const numMaxTokens = Number(maxTokens);
  const numOverlap = Number(overlapTokens);

  if (!Number.isFinite(numMaxTokens) || numMaxTokens < 20) {
    throw new MarkCleanError(
      'INVALID_MAX_TOKENS',
      `Invalid "maxTokens" (${maxTokens}). Provide a number >= 20.`,
      400
    );
  }
  if (!Number.isFinite(numOverlap) || numOverlap < 0 || numOverlap >= numMaxTokens) {
    throw new MarkCleanError(
      'INVALID_OVERLAP_TOKENS',
      `Invalid "overlapTokens" (${overlapTokens}). Must be >= 0 and less than maxTokens (${numMaxTokens}).`,
      400
    );
  }

  if (!markdown.trim()) return [];

  const sections = markdown.split(/(?=\n#{1,3}\s+)/g).map((s) => s.trim()).filter(Boolean);
  const chunks = [];
  let currentText = '';
  let currentHeading = 'Introduction';
  let currentTableHeaders = new Set();

  const pushChunk = (text, heading, tblHeadersSet) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const slug = slugifyHeading(heading);
    const baseClean = (sourceUrl || '').replace(/#.*$/, '');
    const citationUrl = baseClean ? (slug ? `${baseClean}#${slug}` : baseClean) : '';
    const tableHeaders = Array.from(tblHeadersSet || []);
    const containsTable = tableHeaders.length > 0 || /\|.*\|\n\|[\s:-]+\|/.test(trimmed);

    chunks.push({
      index: chunks.length,
      heading,
      sectionAnchor: slug ? `#${slug}` : '',
      sourceUrl: baseClean,
      citationUrl,
      pageTitle: pageTitle || '',
      containsTable,
      tableHeaders,
      content: trimmed,
      tokens: estimateTokens(trimmed),
      charCount: trimmed.length
    });
  };

  for (const sec of sections) {
    const headingMatch = sec.match(/^(#{1,3}\s+[^\n]+)/);
    const secHeading = headingMatch ? headingMatch[1].replace(/^#+\s+/, '').trim() : currentHeading;
    const rawBlocks = sec.split(/\n\n+/);

    const blocks = [];
    for (const b of rawBlocks) {
      const isTable = /^\|.*\|\s*\n\|[\s:| -]+\|/m.test(b.trim());
      if (isTable && repeatTableHeaders) {
        const splitTables = splitMarkdownTableWithHeaders(b, numMaxTokens);
        for (const st of splitTables) {
          blocks.push({ text: st.text, isTable: true, headers: st.headers });
        }
      } else {
        blocks.push({ text: b, isTable: false, headers: [] });
      }
    }

    for (const blk of blocks) {
      const para = blk.text;
      const candidate = currentText ? `${currentText}\n\n${para}` : para;

      if (estimateTokens(candidate) > numMaxTokens && currentText) {
        pushChunk(currentText, currentHeading, currentTableHeaders);
        currentTableHeaders = new Set();

        if (numOverlap > 0 && !blk.isTable) {
          const words = currentText.split(/\s+/);
          const tailWordCount = Math.min(words.length, Math.floor(numOverlap * 0.75));
          const overlapText = tailWordCount > 0 ? words.slice(-tailWordCount).join(' ') : '';
          currentText = overlapText ? `${overlapText}\n\n${para}` : para;
        } else {
          currentText = para;
        }
        currentHeading = secHeading;
        if (blk.isTable) blk.headers.forEach((h) => currentTableHeaders.add(h));
      } else {
        currentText = candidate;
        currentHeading = secHeading;
        if (blk.isTable) blk.headers.forEach((h) => currentTableHeaders.add(h));
      }
    }
  }

  if (currentText) {
    pushChunk(currentText, currentHeading, currentTableHeaders);
  }

  return chunks;
}

/**
 * Primary synchronous extraction pipeline from an HTML string.
 */
export function extractFromHtml(html = '', options = {}) {
  if (typeof html !== 'string' || !html.trim()) {
    throw new MarkCleanError(
      'EMPTY_HTML_INPUT',
      'Provided "html" string is empty. Pass a non-empty HTML document or fragment.',
      400
    );
  }

  const {
    url = '',
    includeLinks = true,
    includeImages = false,
    focusMainContent = true,
    chunkSizeTokens = 500,
    includeFrontmatter = true
  } = options;

  const numChunkSize = Number(chunkSizeTokens);
  if (!Number.isFinite(numChunkSize) || numChunkSize < 20) {
    throw new MarkCleanError(
      'INVALID_CHUNK_SIZE',
      `Invalid "chunkSizeTokens" (${chunkSizeTokens}). Must be a number >= 20.`,
      400
    );
  }

  const rawHtmlChars = html.length;
  const rawHtmlTokens = estimateTokens(html);

  const metadata = extractMetadata(html, url);
  const tables = extractTables(html);
  const bodyMarkdown = htmlToMarkdown(html, {
    baseUrl: url,
    includeLinks,
    includeImages,
    focusMainContent
  });

  let finalMarkdown = bodyMarkdown;
  if (includeFrontmatter && (metadata.title || metadata.canonicalUrl || metadata.description)) {
    const fmLines = ['---'];
    if (metadata.title) fmLines.push(`title: "${metadata.title.replace(/"/g, '\\"')}"`);
    if (metadata.canonicalUrl) fmLines.push(`source: "${metadata.canonicalUrl}"`);
    if (metadata.author) fmLines.push(`author: "${metadata.author.replace(/"/g, '\\"')}"`);
    if (metadata.publishedTime) fmLines.push(`published: "${metadata.publishedTime}"`);
    if (metadata.description) fmLines.push(`description: "${metadata.description.replace(/"/g, '\\"')}"`);
    fmLines.push('---\n');
    finalMarkdown = `${fmLines.join('\n')}\n${bodyMarkdown}`;
  }

  const cleanTokens = estimateTokens(finalMarkdown);
  const savingsPct =
    rawHtmlTokens > 0
      ? Math.max(0, Number((((rawHtmlTokens - cleanTokens) / rawHtmlTokens) * 100).toFixed(1)))
      : 0;

  const resolvedUrl = metadata.canonicalUrl || url;
  const chunks = chunkMarkdown(bodyMarkdown, {
    maxTokens: numChunkSize,
    sourceUrl: resolvedUrl,
    pageTitle: metadata.title,
    repeatTableHeaders: true
  });

  return {
    success: true,
    url: resolvedUrl,
    metadata,
    markdown: finalMarkdown,
    bodyMarkdown,
    tables,
    chunks,
    stats: {
      rawHtmlChars,
      cleanMarkdownChars: finalMarkdown.length,
      rawHtmlTokens,
      cleanMarkdownTokens: cleanTokens,
      tokensSaved: Math.max(0, rawHtmlTokens - cleanTokens),
      tokenReductionPercent: savingsPct,
      tableCount: tables.length,
      chunkCount: chunks.length
    }
  };
}

/**
 * Fetches a public HTTP/HTTPS URL with timeout, content-type validation, and SSRF protection,
 * then executes `extractFromHtml`.
 */
export async function extractFromUrl(url, options = {}) {
  const { timeoutMs = 8000, maxBytes = 5 * 1024 * 1024, headers = {}, ...extractOptions } = options;

  const check = validatePublicUrl(url);
  if (!check.valid) {
    throw new MarkCleanError(check.code, check.reason, 400, { url });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let html;
  try {
    const res = await fetch(check.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarkCleanAI/1.3; +https://github.com/hardikkoul/markclean-ai)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...headers
      },
      redirect: 'follow'
    });

    if (!res.ok) {
      throw new MarkCleanError(
        'UPSTREAM_HTTP_ERROR',
        `Upstream server at "${check.url}" returned HTTP ${res.status} (${res.statusText || 'Error'}).`,
        502,
        { url: check.url, upstreamStatus: res.status }
      );
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (
      contentType &&
      !contentType.includes('text/html') &&
      !contentType.includes('application/xhtml+xml') &&
      !contentType.includes('text/plain') &&
      !contentType.includes('application/xml') &&
      !contentType.includes('text/xml')
    ) {
      throw new MarkCleanError(
        'UNSUPPORTED_CONTENT_TYPE',
        `Upstream URL returned unsupported Content-Type "${contentType}". Expected HTML or text document.`,
        415,
        { url: check.url, contentType }
      );
    }

    html = await res.text();
    if (html.length > maxBytes) {
      html = html.slice(0, maxBytes);
    }
  } catch (err) {
    if (err instanceof MarkCleanError) throw err;
    if (err && err.name === 'AbortError') {
      throw new MarkCleanError(
        'UPSTREAM_TIMEOUT',
        `Fetching "${check.url}" timed out after ${timeoutMs}ms.`,
        504,
        { url: check.url, timeoutMs }
      );
    }
    throw new MarkCleanError(
      'UPSTREAM_FETCH_FAILED',
      `Failed to fetch "${check.url}": ${err instanceof Error ? err.message : String(err)}`,
      502,
      { url: check.url }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!html || !html.trim()) {
    throw new MarkCleanError(
      'EMPTY_UPSTREAM_RESPONSE',
      `Upstream URL "${check.url}" returned an empty response body.`,
      502,
      { url: check.url }
    );
  }

  return extractFromHtml(html, { ...extractOptions, url: check.url });
}
