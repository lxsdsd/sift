import { Type } from '@sinclair/typebox';
import { definePluginEntry, type AnyAgentTool } from 'openclaw/plugin-sdk/plugin-entry';
import { stageArtifact } from './src/artifacts.js';
import { runNotionSync } from './src/notion.js';

const StageArtifactSchema = Type.Object({
  sourceType: Type.Union([Type.Literal('text'), Type.Literal('file'), Type.Literal('url')]),
  input: Type.String({ description: 'Inline text, a local file path, or a URL depending on sourceType.' }),
  title: Type.Optional(Type.String()),
  slug: Type.Optional(Type.String()),
  format: Type.Optional(
    Type.Union([
      Type.Literal('auto'),
      Type.Literal('markdown'),
      Type.Literal('text'),
      Type.Literal('json'),
      Type.Literal('html'),
    ]),
  ),
  metadataJson: Type.Optional(Type.String({ description: 'Optional JSON object encoded as a string.' })),
});

const NotionSyncSchema = Type.Union([
  Type.Object({
    action: Type.Literal('create_page'),
    parentPageId: Type.String(),
    title: Type.Optional(Type.String()),
    markdown: Type.Optional(Type.String()),
    markdownPath: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal('replace_content'),
    pageId: Type.String(),
    markdown: Type.Optional(Type.String()),
    markdownPath: Type.Optional(Type.String()),
    allowDeletingContent: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    action: Type.Literal('update_content'),
    pageId: Type.String(),
    updatesJson: Type.String({
      description:
        'JSON array of {oldStr,newStr,replaceAllMatches?}. Use exact oldStr matches from the current markdown content.',
    }),
    allowDeletingContent: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    action: Type.Literal('retrieve_markdown'),
    pageId: Type.String(),
    includeTranscript: Type.Optional(Type.Boolean()),
  }),
]);

function parseMetadata(raw?: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  const parsed = JSON.parse(raw);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('metadataJson must decode to a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function toolJson(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}

export default definePluginEntry({
  id: 'sift',
  name: 'Sift',
  description: 'Token-efficient capture, stage, and Notion sync tools for long-form research workflows.',
  register(api) {
    api.registerTool(
      ((ctx: any) => ({
        name: 'sift_stage_artifact',
        label: 'Sift Stage Artifact',
        description:
          'Stage long text, files, or fetched URLs into local artifacts so future steps can pass file paths instead of raw content.',
        parameters: StageArtifactSchema,
        async execute(_id: string, params: any) {
          const artifact = await stageArtifact({
            sourceType: params.sourceType,
            input: params.input,
            title: params.title,
            slug: params.slug,
            format: params.format,
            metadata: parseMetadata(params.metadataJson),
            agentDir: ctx.agentDir,
            workspaceDir: ctx.workspaceDir,
            configuredRoot:
              (ctx.config as { plugins?: { entries?: { sift?: { config?: { artifactRoot?: string } } } } })?.plugins?.entries?.sift
                ?.config?.artifactRoot,
          });
          return toolJson(artifact);
        },
      })) as unknown as AnyAgentTool,
      { optional: true, name: 'sift_stage_artifact' },
    );

    api.registerTool(
      ((ctx: any) => ({
        name: 'sift_notion_sync',
        label: 'Sift Notion Sync',
        description:
          'Create, retrieve, or update Notion markdown content from inline markdown or staged files to avoid replaying long content in chat.',
        parameters: NotionSyncSchema,
        async execute(_id: string, params: any) {
          const notionConfig =
            (ctx.config as {
              plugins?: { entries?: { sift?: { config?: { notion?: { apiKey?: string; apiVersion?: string } } } } };
            })?.plugins?.entries?.sift?.config?.notion || {};

          const result =
            params.action === 'update_content'
              ? await runNotionSync(
                  {
                    action: 'update_content',
                    pageId: params.pageId,
                    updates: JSON.parse(params.updatesJson) as Array<{
                      oldStr: string;
                      newStr: string;
                      replaceAllMatches?: boolean;
                    }>,
                    allowDeletingContent: params.allowDeletingContent,
                  },
                  notionConfig,
                )
              : await runNotionSync(params as any, notionConfig);

          return toolJson(result);
        },
      })) as unknown as AnyAgentTool,
      { optional: true, name: 'sift_notion_sync' },
    );
  },
});
