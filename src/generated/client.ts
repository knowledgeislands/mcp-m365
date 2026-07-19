// @ts-nocheck
// Generated on 2026-07-19T00:07:56.266Z by @knowledgeislands/mcp-m365@1.0.0
// Server: hnr-mcp-m365
// Source: /Users/krisbrown/.mcporter/mcporter.json
// Transport: STDIO /Users/krisbrown/.local/share/mise/installs/node/lts/bin/node /Users/krisbrown/workspaces/kis/knowledgeislands/mcp-m365/dist/mcp-server/index.js

import { createRuntime, createServerProxy, wrapCallResult } from 'mcporter';
import type { HnrMcpM365Tools } from './types';

type RuntimeInstance = Awaited<ReturnType<typeof createRuntime>>;
export type HnrMcpM365Client = HnrMcpM365Tools & { close(): Promise<void> };

export interface CreateClientOptions {
  runtime?: RuntimeInstance;
  configPath?: string;
  rootDir?: string;
}

export async function createHnrMcpM365Client(options: CreateClientOptions = {}): Promise<HnrMcpM365Client> {
  const runtime = options.runtime ?? (await createRuntime({
    configPath: options.configPath,
    rootDir: options.rootDir,
  }));
  const ownsRuntime = !options.runtime;
  const proxy = createServerProxy(runtime, "hnr-mcp-m365");
  const client: HnrMcpM365Client = {
    async m365_about(params: Parameters<HnrMcpM365Tools["m365_about"]>[0]) {
      const tool = proxy.m365About as (args: Parameters<HnrMcpM365Tools["m365_about"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_auth_start(params: Parameters<HnrMcpM365Tools["m365_auth_start"]>[0]) {
      const tool = proxy.m365AuthStart as (args: Parameters<HnrMcpM365Tools["m365_auth_start"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_auth_status(params: Parameters<HnrMcpM365Tools["m365_auth_status"]>[0]) {
      const tool = proxy.m365AuthStatus as (args: Parameters<HnrMcpM365Tools["m365_auth_status"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_calendar_events_list(params: Parameters<HnrMcpM365Tools["m365_calendar_events_list"]>[0]) {
      const tool = proxy.m365CalendarEventsList as (args: Parameters<HnrMcpM365Tools["m365_calendar_events_list"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_calendar_event_accept(params: Parameters<HnrMcpM365Tools["m365_calendar_event_accept"]>[0]) {
      const tool = proxy.m365CalendarEventAccept as (args: Parameters<HnrMcpM365Tools["m365_calendar_event_accept"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_calendar_event_decline(params: Parameters<HnrMcpM365Tools["m365_calendar_event_decline"]>[0]) {
      const tool = proxy.m365CalendarEventDecline as (args: Parameters<HnrMcpM365Tools["m365_calendar_event_decline"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_calendar_event_create(params: Parameters<HnrMcpM365Tools["m365_calendar_event_create"]>[0]) {
      const tool = proxy.m365CalendarEventCreate as (args: Parameters<HnrMcpM365Tools["m365_calendar_event_create"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_email_messages_list(params: Parameters<HnrMcpM365Tools["m365_email_messages_list"]>[0]) {
      const tool = proxy.m365EmailMessagesList as (args: Parameters<HnrMcpM365Tools["m365_email_messages_list"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_email_messages_search(params: Parameters<HnrMcpM365Tools["m365_email_messages_search"]>[0]) {
      const tool = proxy.m365EmailMessagesSearch as (args: Parameters<HnrMcpM365Tools["m365_email_messages_search"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_email_message_get(params: Parameters<HnrMcpM365Tools["m365_email_message_get"]>[0]) {
      const tool = proxy.m365EmailMessageGet as (args: Parameters<HnrMcpM365Tools["m365_email_message_get"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_email_message_send(params: Parameters<HnrMcpM365Tools["m365_email_message_send"]>[0]) {
      const tool = proxy.m365EmailMessageSend as (args: Parameters<HnrMcpM365Tools["m365_email_message_send"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_email_draft_create(params: Parameters<HnrMcpM365Tools["m365_email_draft_create"]>[0]) {
      const tool = proxy.m365EmailDraftCreate as (args: Parameters<HnrMcpM365Tools["m365_email_draft_create"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_email_message_mark_read(params: Parameters<HnrMcpM365Tools["m365_email_message_mark_read"]>[0]) {
      const tool = proxy.m365EmailMessageMarkRead as (args: Parameters<HnrMcpM365Tools["m365_email_message_mark_read"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_email_folders_list(params: Parameters<HnrMcpM365Tools["m365_email_folders_list"]>[0]) {
      const tool = proxy.m365EmailFoldersList as (args: Parameters<HnrMcpM365Tools["m365_email_folders_list"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_email_folder_create(params: Parameters<HnrMcpM365Tools["m365_email_folder_create"]>[0]) {
      const tool = proxy.m365EmailFolderCreate as (args: Parameters<HnrMcpM365Tools["m365_email_folder_create"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_email_folder_rename(params: Parameters<HnrMcpM365Tools["m365_email_folder_rename"]>[0]) {
      const tool = proxy.m365EmailFolderRename as (args: Parameters<HnrMcpM365Tools["m365_email_folder_rename"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_email_messages_move(params: Parameters<HnrMcpM365Tools["m365_email_messages_move"]>[0]) {
      const tool = proxy.m365EmailMessagesMove as (args: Parameters<HnrMcpM365Tools["m365_email_messages_move"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_onedrive_items_list(params: Parameters<HnrMcpM365Tools["m365_onedrive_items_list"]>[0]) {
      const tool = proxy.m365OnedriveItemsList as (args: Parameters<HnrMcpM365Tools["m365_onedrive_items_list"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_onedrive_items_search(params: Parameters<HnrMcpM365Tools["m365_onedrive_items_search"]>[0]) {
      const tool = proxy.m365OnedriveItemsSearch as (args: Parameters<HnrMcpM365Tools["m365_onedrive_items_search"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_onedrive_item_download(params: Parameters<HnrMcpM365Tools["m365_onedrive_item_download"]>[0]) {
      const tool = proxy.m365OnedriveItemDownload as (args: Parameters<HnrMcpM365Tools["m365_onedrive_item_download"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_onedrive_item_upload(params: Parameters<HnrMcpM365Tools["m365_onedrive_item_upload"]>[0]) {
      const tool = proxy.m365OnedriveItemUpload as (args: Parameters<HnrMcpM365Tools["m365_onedrive_item_upload"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_onedrive_item_upload_large(params: Parameters<HnrMcpM365Tools["m365_onedrive_item_upload_large"]>[0]) {
      const tool = proxy.m365OnedriveItemUploadLarge as (args: Parameters<HnrMcpM365Tools["m365_onedrive_item_upload_large"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_onedrive_item_share(params: Parameters<HnrMcpM365Tools["m365_onedrive_item_share"]>[0]) {
      const tool = proxy.m365OnedriveItemShare as (args: Parameters<HnrMcpM365Tools["m365_onedrive_item_share"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_onedrive_folder_create(params: Parameters<HnrMcpM365Tools["m365_onedrive_folder_create"]>[0]) {
      const tool = proxy.m365OnedriveFolderCreate as (args: Parameters<HnrMcpM365Tools["m365_onedrive_folder_create"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_email_rules_list(params: Parameters<HnrMcpM365Tools["m365_email_rules_list"]>[0]) {
      const tool = proxy.m365EmailRulesList as (args: Parameters<HnrMcpM365Tools["m365_email_rules_list"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_email_rule_create(params: Parameters<HnrMcpM365Tools["m365_email_rule_create"]>[0]) {
      const tool = proxy.m365EmailRuleCreate as (args: Parameters<HnrMcpM365Tools["m365_email_rule_create"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async m365_email_rules_reorder(params: Parameters<HnrMcpM365Tools["m365_email_rules_reorder"]>[0]) {
      const tool = proxy.m365EmailRulesReorder as (args: Parameters<HnrMcpM365Tools["m365_email_rules_reorder"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async close() {
      if (ownsRuntime) {
        await runtime.close("hnr-mcp-m365").catch(() => {});
      }
    },
  };
  return client;
}

