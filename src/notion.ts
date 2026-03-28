import fs from 'node:fs/promises';

const DEFAULT_NOTION_VERSION = '2026-03-11';

type NotionConfig = {
  apiKey?: string;
  apiVersion?: string;
};

export type NotionSyncAction =
  | {
      action: 'create_page';
      parentPageId: string;
      title?: string;
      markdown?: string;
      markdownPath?: string;
    }
  | {
      action: 'replace_content';
      pageId: string;
      markdown?: string;
      markdownPath?: string;
      allowDeletingContent?: boolean;
    }
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
    };

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
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Notion API ${init.method || 'GET'} ${apiPath} failed: ${response.status} ${data?.code || ''} ${data?.message || ''}`.trim());
  }
  return data;
}

async function resolveMarkdown(markdown?: string, markdownPath?: string): Promise<string> {
  if (markdown && markdownPath) {
    throw new Error('provide only one of markdown or markdownPath');
  }
  if (markdownPath) {
    return fs.readFile(markdownPath, 'utf8');
  }
  if (markdown !== undefined) return markdown;
  throw new Error('markdown or markdownPath is required');
}

export async function runNotionSync(action: NotionSyncAction, config: NotionConfig = {}): Promise<any> {
  switch (action.action) {
    case 'create_page': {
      const markdown = await resolveMarkdown(action.markdown, action.markdownPath);
      const body: Record<string, unknown> = {
        parent: { page_id: extractNotionId(action.parentPageId) },
        markdown,
      };
      if (action.title) {
        body.properties = {
          title: {
            title: [{ type: 'text', text: { content: action.title } }],
          },
        };
      }
      return notionRequest('/pages', { method: 'POST', body: JSON.stringify(body) }, config);
    }
    case 'replace_content': {
      const markdown = await resolveMarkdown(action.markdown, action.markdownPath);
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
      const query = action.includeTranscript ? '?include_transcript=true' : '';
      return notionRequest(`/pages/${extractNotionId(action.pageId)}/markdown${query}`, { method: 'GET' }, config);
    }
  }
}
