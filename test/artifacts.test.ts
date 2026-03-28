import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stageArtifact } from '../src/artifacts.js';
import { extractNotionId, runNotionSync } from '../src/notion.js';

const tempDirs: string[] = [];
const originalFetch = global.fetch;

afterEach(async () => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe('stageArtifact', () => {
  it('writes clean.md, extracted.json, and manifest.json for text input', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sift-'));
    tempDirs.push(root);

    const artifact = await stageArtifact({
      sourceType: 'text',
      input: '# Hello\n\nWorld',
      title: 'Hello world',
      configuredRoot: root,
      metadata: { source: 'unit-test' },
    });

    expect(artifact.title).toBe('Hello world');
    expect(artifact.detectedFormat).toBe('markdown');
    expect(path.basename(artifact.cleanPath)).toBe('clean.md');
    expect(path.basename(artifact.extractedPath)).toBe('extracted.json');
    expect(await fs.readFile(artifact.cleanPath, 'utf8')).toContain('World');

    const extracted = JSON.parse(await fs.readFile(artifact.extractedPath, 'utf8'));
    expect(extracted.stats.charCount).toBeGreaterThan(0);
    expect(extracted.metadata.source).toBe('unit-test');

    const manifest = JSON.parse(await fs.readFile(artifact.manifestPath, 'utf8'));
    expect(manifest.cleanPath).toBe(artifact.cleanPath);
    expect(manifest.extractedPath).toBe(artifact.extractedPath);
    expect(manifest.rawPath).toBe(artifact.sourcePath);
  });
});

describe('extractNotionId', () => {
  it('normalizes compact ids from URLs', () => {
    expect(extractNotionId('https://www.notion.so/32f8f6b5022a8000a02edce4659483bc')).toBe(
      '32f8f6b5-022a-8000-a02e-dce4659483bc',
    );
  });
});

describe('runNotionSync', () => {
  it('reads markdown from a staged manifest when replacing content', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sift-'));
    tempDirs.push(root);

    const artifact = await stageArtifact({
      sourceType: 'text',
      input: '# Synced\n\nBody',
      configuredRoot: root,
    });

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.replace_content.new_str).toContain('# Synced');
      return new Response(
        JSON.stringify({ object: 'page_markdown', id: 'page-1', markdown: body.replace_content.new_str, truncated: false, unknown_block_ids: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await runNotionSync(
      {
        action: 'replace_content',
        pageId: '32f8f6b5-022a-8000-a02e-dce4659483bc',
        manifestPath: artifact.manifestPath,
      },
      { apiKey: 'ntn_test' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.markdown).toContain('# Synced');
  });

  it('retries after 429 responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'rate_limited', message: 'slow down' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '0' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [], has_more: false, next_cursor: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    global.fetch = fetchMock as typeof fetch;

    const result = await runNotionSync(
      { action: 'search', query: 'Sift', resultType: 'page' },
      { apiKey: 'ntn_test' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.results).toEqual([]);
  });

  it('retrieves unknown block trees and skips inaccessible blocks', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/pages/32f8f6b5-022a-8000-a02e-dce4659483bc/markdown')) {
        return new Response(
          JSON.stringify({
            object: 'page_markdown',
            id: '32f8f6b5-022a-8000-a02e-dce4659483bc',
            markdown: '# Root',
            truncated: true,
            unknown_block_ids: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/pages/11111111-1111-1111-1111-111111111111/markdown')) {
        return new Response(
          JSON.stringify({
            object: 'page_markdown',
            id: '11111111-1111-1111-1111-111111111111',
            markdown: '## Child',
            truncated: false,
            unknown_block_ids: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({ code: 'object_not_found', message: 'missing' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await runNotionSync(
      {
        action: 'retrieve_markdown',
        pageId: '32f8f6b5-022a-8000-a02e-dce4659483bc',
        resolveUnknownBlocks: true,
      },
      { apiKey: 'ntn_test' },
    );

    expect(result.markdown).toContain('# Root');
    expect(result.markdown).toContain('## Child');
    expect(result.resolvedUnknownBlocks).toEqual([
      { id: '11111111-1111-1111-1111-111111111111', status: 'resolved' },
      { id: '22222222-2222-2222-2222-222222222222', status: 'inaccessible' },
    ]);
  });
});
