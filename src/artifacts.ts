import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildArtifactPaths,
  ensureDir,
  resolveArtifactRoot,
  safeJsonParse,
  sha256,
  slugify,
  stripHtmlToText,
  timestampId,
  writeUtf8,
} from './utils.js';

export type StageArtifactInput = {
  title?: string;
  slug?: string;
  sourceType: 'text' | 'file' | 'url';
  input: string;
  format?: 'auto' | 'markdown' | 'text' | 'json' | 'html';
  metadata?: Record<string, unknown>;
  configuredRoot?: string;
  agentDir?: string;
  workspaceDir?: string;
};

export type StagedArtifact = {
  title: string;
  slug: string;
  artifactDir: string;
  manifestPath: string;
  sourcePath: string;
  cleanPath: string;
  extractedPath: string;
  rawPath: string;
  normalizedPath: string;
  sourceType: StageArtifactInput['sourceType'];
  detectedFormat: string;
  contentType: string | null;
  bytes: number;
  sha256: string;
  preview: string;
};

type LoadedSource = {
  raw: string;
  cleanMarkdown: string;
  contentType: string | null;
  detectedFormat: string;
  sourceExt: string;
  extracted: Record<string, unknown>;
};

function renderCleanMarkdown(raw: string, detectedFormat: string): string {
  if (detectedFormat === 'markdown') return raw;
  if (detectedFormat === 'html') return stripHtmlToText(raw);
  if (detectedFormat === 'json') {
    const parsed = safeJsonParse<unknown>(raw, null);
    if (parsed === null) {
      return ['```json', raw, '```'].join('\n');
    }
    return ['```json', JSON.stringify(parsed, null, 2), '```'].join('\n');
  }
  return raw;
}

function inferSourceExt(detectedFormat: string): string {
  switch (detectedFormat) {
    case 'json':
      return '.json';
    case 'html':
      return '.html';
    case 'markdown':
      return '.md';
    default:
      return '.txt';
  }
}

function buildExtractedPayload(input: StageArtifactInput, loaded: LoadedSource) {
  const charCount = loaded.cleanMarkdown.length;
  const lineCount = loaded.cleanMarkdown === '' ? 0 : loaded.cleanMarkdown.split(/\r?\n/).length;
  return {
    source: {
      type: input.sourceType,
      input: input.input,
      detectedFormat: loaded.detectedFormat,
      contentType: loaded.contentType,
    },
    stats: {
      charCount,
      lineCount,
      rawBytes: Buffer.byteLength(loaded.raw, 'utf8'),
    },
    preview: loaded.cleanMarkdown.slice(0, 500),
    metadata: input.metadata || {},
    extractedAt: new Date().toISOString(),
    ...loaded.extracted,
  };
}

async function loadSource(input: StageArtifactInput): Promise<LoadedSource> {
  if (input.sourceType === 'text') {
    const detectedFormat = input.format && input.format !== 'auto' ? input.format : 'markdown';
    return {
      raw: input.input,
      cleanMarkdown: renderCleanMarkdown(input.input, detectedFormat),
      contentType: 'text/plain',
      detectedFormat,
      sourceExt: inferSourceExt(detectedFormat),
      extracted: {},
    };
  }

  if (input.sourceType === 'file') {
    const resolved = path.resolve(input.input);
    const raw = await fs.readFile(resolved, 'utf8');
    const ext = path.extname(resolved).toLowerCase();
    const detectedFormat =
      input.format && input.format !== 'auto'
        ? input.format
        : ext === '.md'
          ? 'markdown'
          : ext === '.json'
            ? 'json'
            : ext === '.html' || ext === '.htm'
              ? 'html'
              : 'text';
    return {
      raw,
      cleanMarkdown: renderCleanMarkdown(raw, detectedFormat),
      contentType: ext === '.json' ? 'application/json' : 'text/plain',
      detectedFormat,
      sourceExt: ext || inferSourceExt(detectedFormat),
      extracted: {
        file: {
          path: resolved,
          ext: ext || null,
        },
      },
    };
  }

  const response = await fetch(input.input, {
    headers: {
      'User-Agent': 'sift/0.1 (+https://github.com/lxsdsd/sift)',
      Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8',
    },
  });
  if (!response.ok) {
    throw new Error(`fetch failed with HTTP ${response.status} for ${input.input}`);
  }
  const raw = await response.text();
  const contentType = response.headers.get('content-type');
  const detectedFormat =
    input.format && input.format !== 'auto'
      ? input.format
      : contentType?.includes('application/json')
        ? 'json'
        : contentType?.includes('text/html')
          ? 'html'
          : 'text';
  return {
    raw,
    cleanMarkdown: renderCleanMarkdown(raw, detectedFormat),
    contentType,
    detectedFormat,
    sourceExt: inferSourceExt(detectedFormat),
    extracted: {
      fetch: {
        url: input.input,
        contentType,
      },
    },
  };
}

export async function stageArtifact(input: StageArtifactInput): Promise<StagedArtifact> {
  const title = input.title || input.input.slice(0, 80) || 'artifact';
  const slug = slugify(input.slug || title);
  const stamp = timestampId();
  const root = resolveArtifactRoot({
    configuredRoot: input.configuredRoot,
    agentDir: input.agentDir,
    workspaceDir: input.workspaceDir,
  });
  const paths = buildArtifactPaths(root, slug, stamp);
  await ensureDir(paths.baseDir);

  const loaded = await loadSource(input);
  const sourcePath = paths.sourcePath.replace(/\.txt$/, loaded.sourceExt);
  const cleanPath = paths.cleanPath;
  const extractedPath = paths.extractedPath;
  const rawSha = sha256(loaded.raw);

  await writeUtf8(sourcePath, loaded.raw);
  await writeUtf8(cleanPath, loaded.cleanMarkdown);

  const summary: StagedArtifact = {
    title,
    slug,
    artifactDir: paths.baseDir,
    manifestPath: paths.manifestPath,
    sourcePath,
    cleanPath,
    extractedPath,
    rawPath: sourcePath,
    normalizedPath: cleanPath,
    sourceType: input.sourceType,
    detectedFormat: loaded.detectedFormat,
    contentType: loaded.contentType,
    bytes: Buffer.byteLength(loaded.raw, 'utf8'),
    sha256: rawSha,
    preview: loaded.cleanMarkdown.slice(0, 500),
  };

  const extracted = buildExtractedPayload(input, loaded);
  await writeUtf8(extractedPath, JSON.stringify(extracted, null, 2));
  await writeUtf8(
    paths.manifestPath,
    JSON.stringify(
      {
        ...summary,
        metadata: input.metadata || {},
        createdAt: new Date().toISOString(),
        source: input.input,
      },
      null,
      2,
    ),
  );

  return summary;
}
