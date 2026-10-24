export declare class MarkCleanError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;
  constructor(code: string, message: string, status?: number, details?: Record<string, unknown>);
}

export interface MarkCleanUrlValidation {
  valid: boolean;
  url?: string;
  code?: string;
  reason?: string;
}

export interface MarkCleanMetadata {
  title: string;
  description: string;
  canonicalUrl: string;
  author: string;
  publishedTime: string;
  siteName: string;
  ogImage: string;
  jsonLd: Record<string, unknown>[];
}

export interface MarkCleanTable {
  index: number;
  headers: string[];
  rowCount: number;
  rows: Record<string, string>[];
  csv: string;
  markdown: string;
}

export interface MarkCleanChunk {
  index: number;
  heading: string;
  sectionAnchor: string;
  sourceUrl: string;
  citationUrl: string;
  pageTitle: string;
  containsTable: boolean;
  tableHeaders: string[];
  content: string;
  tokens: number;
  charCount: number;
}

export interface MarkCleanOptions {
  url?: string;
  includeLinks?: boolean;
  includeImages?: boolean;
  focusMainContent?: boolean;
  chunkSizeTokens?: number;
  includeFrontmatter?: boolean;
}

export interface MarkCleanUrlOptions extends MarkCleanOptions {
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
}

export interface MarkCleanChunkOptions {
  maxTokens?: number;
  overlapTokens?: number;
  sourceUrl?: string;
  pageTitle?: string;
  repeatTableHeaders?: boolean;
}

export interface MarkCleanResult {
  success: boolean;
  url: string;
  metadata: MarkCleanMetadata;
  markdown: string;
  bodyMarkdown: string;
  tables: MarkCleanTable[];
  chunks: MarkCleanChunk[];
  stats: {
    rawHtmlChars: number;
    cleanMarkdownChars: number;
    rawHtmlTokens: number;
    cleanMarkdownTokens: number;
    tokensSaved: number;
    tokenReductionPercent: number;
    tableCount: number;
    chunkCount: number;
  };
}

export declare function decodeEntities(str?: string): string;
export declare function estimateTokens(text?: string): number;
export declare function validatePublicUrl(rawUrl: string): MarkCleanUrlValidation;
export declare function extractMetadata(html?: string, baseUrl?: string): MarkCleanMetadata;
export declare function stripTags(htmlFragment?: string): string;
export declare function extractTables(html?: string): MarkCleanTable[];
export declare function cleanHtml(html?: string, options?: { focusMainContent?: boolean }): string;
export declare function resolveUrl(href?: string, baseUrl?: string): string;
export declare function htmlToMarkdown(
  html?: string,
  options?: { baseUrl?: string; includeLinks?: boolean; includeImages?: boolean; focusMainContent?: boolean }
): string;
export declare function slugifyHeading(heading?: string): string;
export declare function splitMarkdownTableWithHeaders(
  tableBlock?: string,
  maxTokens?: number
): Array<{ text: string; headers: string[] }>;
export declare function chunkMarkdown(markdown?: string, options?: MarkCleanChunkOptions): MarkCleanChunk[];
export declare function extractFromHtml(html?: string, options?: MarkCleanOptions): MarkCleanResult;
export declare function extractFromUrl(url: string, options?: MarkCleanUrlOptions): Promise<MarkCleanResult>;
