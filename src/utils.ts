import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type SiftPaths = {
  baseDir: string;
  manifestPath: string;
  sourcePath: string;
  cleanPath: string;
  extractedPath: string;
  rawPath: string;
  normalizedPath: string;
};

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'artifact'
  );
}

export function timestampId(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readUtf8(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf8');
}

export async function writeUtf8(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf8');
}

export function sha256(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function resolveArtifactRoot(params: {
  configuredRoot?: string;
  agentDir?: string;
  workspaceDir?: string;
}): string {
  if (params.configuredRoot) return path.resolve(params.configuredRoot);
  if (params.agentDir) return path.join(params.agentDir, '.sift', 'artifacts');
  if (params.workspaceDir) return path.join(params.workspaceDir, '.sift', 'artifacts');
  return path.resolve('.sift', 'artifacts');
}

export function buildArtifactPaths(root: string, slug: string, stamp: string): SiftPaths {
  const baseDir = path.join(root, `${stamp}-${slug}`);
  const sourcePath = path.join(baseDir, 'source.txt');
  const cleanPath = path.join(baseDir, 'clean.md');
  return {
    baseDir,
    manifestPath: path.join(baseDir, 'manifest.json'),
    sourcePath,
    cleanPath,
    extractedPath: path.join(baseDir, 'extracted.json'),
    // Keep the earlier field names as aliases so existing callers do not break.
    rawPath: sourcePath,
    normalizedPath: cleanPath,
  };
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function safeJsonParse<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}
