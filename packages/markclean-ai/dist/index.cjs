/**
 * @markclean/core v1.1.0 - Zero-Dependency Web-to-LLM Markdown & Structured Data Engine
 * Runs natively in Cloudflare Workers (V8 Isolate), Node.js, and Chrome Extension MV3.
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

function decodeEntities(str = '') {
  if (!str) return '';
  return str
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp|ndash|mdash|copy|reg|trade|hellip|bull);/gi, (m) => ENTITIES[m.toLowerCase()] || m)
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function estimateTokens(text = '') {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const words = trimmed.split(/\s+/).length;
  const chars = trimmed.length;
  return Math.max(1, Math.ceil((chars / 4 + words * 1.33) / 2));
}

function extractMetadata(html = '', baseUrl = '') {
  const meta = {
    title: '',
    description: '',
    canonicalUrl: baseUrl || '',
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

  const canonMatch = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i)
    || html.match(/<link[^>]+href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']canonical["']/i);
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
    } catch (_) {}
  }

  return meta;
}

function stripTags(htmlFragment = '') {
  return decodeEntities(
    htmlFragment
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function extractTables(html = '') {
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

function cleanHtml(html = '', options = {}) {
  const { focusMainContent = true } = options;
  let cleaned = html;

  cleaned = cleaned
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|canvas|iframe|object|embed|audio|video)[^>]*>[\s\S]*?<\/\1>/gi, '');

  if (focusMainContent) {
    cleaned = cleaned.replace(/<(nav|footer|aside|dialog)[^>]*>[\s\S]*?<\/\1>/gi, '');
    cleaned = cleaned.replace(
      /<(div|section|aside|header|footer)[^>]+(?:id|class)\s*=\s*["'][^"']*(?:cookie|consent|gdpr|banner|popup|modal|newsletter|advert|ad-slot|sidebar|social-share|related-posts|comments)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi,
      ''
    );

    const mainMatch = cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
      || cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (mainMatch && stripTags(mainMatch[1]).length > 160) {
      cleaned = mainMatch[1];
    } else {
      const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch) cleaned = bodyMatch[1];
    }
  }

  return cleaned;
}

function resolveUrl(href = '', baseUrl = '') {
  if (!href) return '';
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

function htmlToMarkdown(html = '', options = {}) {
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

  work = decodeEntities(work)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return work;
}

/**
 * Generates a URL-safe GitHub-style anchor slug from a heading string.
 */
function slugifyHeading(heading = '') {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Splits a large GFM Markdown table into smaller sub-tables that each fit within `maxTokens`,
 * repeating the `| Header |` and `| --- |` rows at the top of every split chunk!
 */
function splitMarkdownTableWithHeaders(tableBlock = '', maxTokens = 500) {
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
  const prefixTokens = estimateTokens(headerPrefix);
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
function chunkMarkdown(markdown = '', options = {}) {
  const {
    maxTokens = 500,
    overlapTokens = 50,
    sourceUrl = '',
    pageTitle = '',
    repeatTableHeaders = true
  } = options;

  if (!markdown || !markdown.trim()) return [];

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

    // Expand any oversized Markdown table blocks into header-preserving sub-tables
    const blocks = [];
    for (const b of rawBlocks) {
      const isTable = /^\|.*\|\s*\n\|[\s:| -]+\|/m.test(b.trim());
      if (isTable && repeatTableHeaders) {
        const splitTables = splitMarkdownTableWithHeaders(b, maxTokens);
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

      if (estimateTokens(candidate) > maxTokens && currentText) {
        pushChunk(currentText, currentHeading, currentTableHeaders);
        currentTableHeaders = new Set();

        // Only carry prose overlap (never corrupt a table header with broken prose overlap)
        if (overlapTokens > 0 && !blk.isTable) {
          const words = currentText.split(/\s+/);
          const tailWordCount = Math.min(words.length, Math.floor(overlapTokens * 0.75));
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

function extractFromHtml(html = '', options = {}) {
  const {
    url = '',
    includeLinks = true,
    includeImages = false,
    focusMainContent = true,
    chunkSizeTokens = 500,
    includeFrontmatter = true
  } = options;

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
  const savingsPct = rawHtmlTokens > 0
    ? Math.max(0, Number((((rawHtmlTokens - cleanTokens) / rawHtmlTokens) * 100).toFixed(1)))
    : 0;

  const resolvedUrl = metadata.canonicalUrl || url;
  const chunks = chunkMarkdown(bodyMarkdown, {
    maxTokens: chunkSizeTokens,
    sourceUrl: resolvedUrl,
    pageTitle: metadata.title,
    repeatTableHeaders: true
  });

  return {
    success: true,
    url: metadata.canonicalUrl || url,
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
 * Fetches a public URL and runs the full MarkClean AI extraction pipeline (Node 18+, Bun, Deno, Cloudflare Workers).
 */
async function extractFromUrl(url, options = {}) {
  const { timeoutMs = 10000, headers = {}, ...extractOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarkCleanAI-SDK/1.2; +https://github.com/hardikkoul/markclean-ai)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...headers
      },
      redirect: 'follow'
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
    }
    const html = await res.text();
    return extractFromHtml(html, { ...extractOptions, url });
  } finally {
    clearTimeout(timer);
  }
}


module.exports = {
  decodeEntities,
  estimateTokens,
  extractMetadata,
  stripTags,
  extractTables,
  cleanHtml,
  resolveUrl,
  htmlToMarkdown,
  slugifyHeading,
  splitMarkdownTableWithHeaders,
  chunkMarkdown,
  extractFromHtml,
  extractFromUrl
};
