import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildArtifactPaths,
  ensureDir,
  resolveArtifactRoot,
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
  rawPath: string;
  normalizedPath: string;
  sourceType: StageArtifactInput['sourceType'];
  detectedFormat: string;
  contentType: string | null;
  bytes: number;
  sha256: string;
  preview: string;
};

async function loadSource(input: StageArtifactInput): Promise<{
  raw: string;
  normalized: string;
  contentType: string | null;
  detectedFormat: string;
}> {
  if (input.sourceType === 'text') {
    const format = input.format && input.format !== 'auto' ? input.format : 'markdown';
    return {
      raw: input.input,
      normalized: input.input,
      contentType: 'text/plain',
      detectedFormat: format,
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
    const normalized = detectedFormat === 'html' ? stripHtmlToText(raw) : raw;
    return {
      raw,
      normalized,
      contentType: ext === '.json' ? 'application/json' : 'text/plain',
      detectedFormat,
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
  const normalized = detectedFormat === 'html' ? stripHtmlToText(raw) : raw;
  return {
    raw,
    normalized,
    contentType,
    detectedFormat,
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
  const rawExt = loaded.detectedFormat === 'json' ? '.json' : loaded.detectedFormat === 'html' ? '.html' : '.txt';
  const normalizedExt = loaded.detectedFormat === 'json' ? '.json' : '.md';
  const rawPath = paths.rawPath.replace(/\.txt$/, rawExt);
  const normalizedPath = paths.normalizedPath.replace(/\.md$/, normalizedExt);

  await writeUtf8(rawPath, loaded.raw);
  await writeUtf8(normalizedPath, loaded.normalized);

  const summary: StagedArtifact = {
    title,
    slug,
    artifactDir: paths.baseDir,
    manifestPath: paths.manifestPath,
    rawPath,
    normalizedPath,
    sourceType: input.sourceType,
    detectedFormat: loaded.detectedFormat,
    contentType: loaded.contentType,
    bytes: Buffer.byteLength(loaded.raw, 'utf8'),
    sha256: sha256(loaded.raw),
    preview: loaded.normalized.slice(0, 500),
  };

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
