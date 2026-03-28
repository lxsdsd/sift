import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stageArtifact } from '../src/artifacts.js';
import { extractNotionId } from '../src/notion.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe('stageArtifact', () => {
  it('writes text artifacts and a manifest', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sift-'));
    tempDirs.push(root);

    const artifact = await stageArtifact({
      sourceType: 'text',
      input: '# Hello\n\nWorld',
      title: 'Hello world',
      configuredRoot: root,
    });

    expect(artifact.title).toBe('Hello world');
    expect(artifact.detectedFormat).toBe('markdown');
    expect(await fs.readFile(artifact.normalizedPath, 'utf8')).toContain('World');
    expect(await fs.readFile(artifact.manifestPath, 'utf8')).toContain('Hello world');
  });
});

describe('extractNotionId', () => {
  it('normalizes compact ids from URLs', () => {
    expect(extractNotionId('https://www.notion.so/32f8f6b5022a8000a02edce4659483bc')).toBe(
      '32f8f6b5-022a-8000-a02e-dce4659483bc',
    );
  });
});
