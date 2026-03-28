import fs from 'node:fs/promises';

const DEFAULT_NOTION_VERSION = '2026-03-11';
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_UNKNOWN_BLOCK_FETCHES = 16;

type NotionConfig = {
  apiKey?: string;
  apiVersion?: string;
};

type SearchResultType = 'page' | 'data_source';

type MarkdownInput = {
  markdown?: string;
  markdownPath?: string;
  manifestPath?: string;
};

export type NotionSyncAction =
  | ({
      action: 'create_page';
      parentPageId: string;
      title?: string;
      properties?: Record<string, unknown>;
    } & MarkdownInput)
  | ({
      action: 'replace_content';
      pageId: string;
      allowDeletingContent?: boolean;
    } & MarkdownInput)
  | {
      action: 'update_content';
      pageId: string;
      updates: Array<{ oldStr: string; newStr: string; replaceAllMatches?: boolean }>;
      allowDeletingContent?: boolean;
    }
  | {
      action: 'retrieve_markdown';
      pageId: string;
      includeTranscript?: boolean;
      resolveUnknownBlocks?: boolean;
      maxUnknownFetches?: number;
    }
  | {
      action: 'search';
      query: string;
      resultType?: SearchResultType;
      pageSize?: number;
      cursor?: string;
    };

type NotionApiError = Error & { notionCode?: string; status?: number };

type PageMarkdownResponse = {
  object: 'page_markdown';
  id: string;
  markdown: string;
  truncated: boolean;
  unknown_block_ids: string[];
};

function buildNotionError(message: string, extras: { notionCode?: string; status?: number } = {}): NotionApiError {
  const error = new Error(message) as NotionApiError;
  error.notionCode = extras.notionCode;
  error.status = extras.status;
  return error;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonBody(text: string): any {
  if (!text) return {};
  return JSON.parse(text);
}

function coerceRetryAfterSeconds(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 1;
  return parsed;
}

export function extractNotionId(input: string): string {
  const uuidMatch = input.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (uuidMatch) return uuidMatch[0].toLowerCase();
  const compactMatch = input.match(/[0-9a-fA-F]{32}/);
  if (!compactMatch) {
    throw new Error(`cannot extract Notion id from: ${input}`);
  }
  const raw = compactMatch[0].toLowerCase();
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

async function notionRequest(apiPath: string, init: RequestInit, config: NotionConfig): Promise<any> {
  const apiKey = config.apiKey || process.env.NOTION_API_KEY;
  if (!apiKey) {
    throw new Error('NOTION_API_KEY is missing');
  }

  for (let attempt = 0; attempt <= DEFAULT_MAX_RETRIES; attempt += 1) {
    const response = await fetch(`https://api.notion.com/v1${apiPath}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': config.apiVersion || DEFAULT_NOTION_VERSION,
        ...(init.headers || {}),
      },
    });

    const text = await response.text();
    const data = parseJsonBody(text);

    if (response.status === 429 && attempt < DEFAULT_MAX_RETRIES) {
      const waitSeconds = coerceRetryAfterSeconds(response.headers.get('Retry-After'));
      await sleep(waitSeconds * 1000);
      continue;
    }

    if (!response.ok) {
      throw buildNotionError(
        `Notion API ${init.method || 'GET'} ${apiPath} failed: ${response.status} ${data?.code || ''} ${data?.message || ''}`.trim(),
        {
          notionCode: data?.code,
          status: response.status,
        },
      );
    }

    return data;
  }

  throw new Error(`Notion API ${init.method || 'GET'} ${apiPath} exceeded retry budget`);
}

async function resolveMarkdownInput(input: MarkdownInput): Promise<string> {
  const sources = [input.markdown, input.markdownPath, input.manifestPath].filter((value) => value !== undefined);
  if (sources.length !== 1) {
    throw new Error('provide exactly one of markdown, markdownPath, or manifestPath');
  }

  if (input.markdown !== undefined) return input.markdown;
  if (input.markdownPath) {
    return fs.readFile(input.markdownPath, 'utf8');
  }

  const manifestRaw = await fs.readFile(input.manifestPath!, 'utf8');
  const manifest = JSON.parse(manifestRaw) as {
    cleanPath?: string;
    normalizedPath?: string;
  };
  const cleanPath = manifest.cleanPath || manifest.normalizedPath;
  if (!cleanPath) {
    throw new Error(`manifest ${input.manifestPath} does not contain cleanPath or normalizedPath`);
  }
  return fs.readFile(cleanPath, 'utf8');
}

async function retrieveMarkdownTree(
  pageId: string,
  options: { includeTranscript?: boolean; resolveUnknownBlocks?: boolean; maxUnknownFetches?: number },
  config: NotionConfig,
): Promise<PageMarkdownResponse & { resolvedUnknownBlocks?: Array<{ id: string; status: 'resolved' | 'inaccessible' }> }> {
  const includeTranscript = options.includeTranscript ? '?include_transcript=true' : '';
  const root = (await notionRequest(
    `/pages/${extractNotionId(pageId)}/markdown${includeTranscript}`,
    { method: 'GET' },
    config,
  )) as PageMarkdownResponse;

  if (!options.resolveUnknownBlocks || !root.unknown_block_ids?.length) {
    return root;
  }

  const queue = [...root.unknown_block_ids];
  const visited = new Set<string>();
  const resolvedUnknownBlocks: Array<{ id: string; status: 'resolved' | 'inaccessible' }> = [];
  const appendedMarkdown: string[] = [];
  const maxUnknownFetches = options.maxUnknownFetches ?? DEFAULT_UNKNOWN_BLOCK_FETCHES;

  while (queue.length > 0 && resolvedUnknownBlocks.length < maxUnknownFetches) {
    const blockId = extractNotionId(queue.shift()!);
    if (visited.has(blockId)) continue;
    visited.add(blockId);

    try {
      const blockResp = (await notionRequest(`/pages/${blockId}/markdown`, { method: 'GET' }, config)) as PageMarkdownResponse;
      appendedMarkdown.push(blockResp.markdown);
      resolvedUnknownBlocks.push({ id: blockId, status: 'resolved' });
      for (const childId of blockResp.unknown_block_ids || []) {
        if (!visited.has(childId)) queue.push(childId);
      }
    } catch (error) {
      const notionError = error as NotionApiError;
      if (notionError.notionCode === 'object_not_found') {
        resolvedUnknownBlocks.push({ id: blockId, status: 'inaccessible' });
        continue;
      }
      throw error;
    }
  }

  return {
    ...root,
    markdown: [root.markdown, ...appendedMarkdown].filter(Boolean).join('\n\n'),
    resolvedUnknownBlocks,
  };
}

async function searchNotion(
  params: Extract<NotionSyncAction, { action: 'search' }>,
  config: NotionConfig,
): Promise<any> {
  const body: Record<string, unknown> = {
    query: params.query,
    page_size: params.pageSize ?? 10,
  };
  if (params.cursor) body.start_cursor = params.cursor;
  if (params.resultType) {
    body.filter = {
      property: 'object',
      value: params.resultType,
    };
  }
  return notionRequest('/search', { method: 'POST', body: JSON.stringify(body) }, config);
}

export async function runNotionSync(action: NotionSyncAction, config: NotionConfig = {}): Promise<any> {
  switch (action.action) {
    case 'create_page': {
      const markdown = await resolveMarkdownInput(action);
      const body: Record<string, unknown> = {
        parent: { page_id: extractNotionId(action.parentPageId) },
        markdown,
      };
      if (action.title) {
        body.properties = {
          ...(action.properties || {}),
          title: {
            title: [{ type: 'text', text: { content: action.title } }],
          },
        };
      } else if (action.properties) {
        body.properties = action.properties;
      }
      return notionRequest('/pages', { method: 'POST', body: JSON.stringify(body) }, config);
    }
    case 'replace_content': {
      const markdown = await resolveMarkdownInput(action);
      return notionRequest(
        `/pages/${extractNotionId(action.pageId)}/markdown`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            type: 'replace_content',
            replace_content: {
              new_str: markdown,
              allow_deleting_content: action.allowDeletingContent ?? false,
            },
          }),
        },
        config,
      );
    }
    case 'update_content': {
      return notionRequest(
        `/pages/${extractNotionId(action.pageId)}/markdown`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            type: 'update_content',
            update_content: {
              content_updates: action.updates.map((item) => ({
                old_str: item.oldStr,
                new_str: item.newStr,
                replace_all_matches: item.replaceAllMatches ?? false,
              })),
              allow_deleting_content: action.allowDeletingContent ?? false,
            },
          }),
        },
        config,
      );
    }
    case 'retrieve_markdown': {
      return retrieveMarkdownTree(action.pageId, action, config);
    }
    case 'search': {
      return searchNotion(action, config);
    }
  }
}
