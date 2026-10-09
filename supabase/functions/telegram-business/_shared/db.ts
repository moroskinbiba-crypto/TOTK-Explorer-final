import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { supabaseAdminKey, supabaseUrl } from "./env.ts";

export type ChatRow = {
  id: string;
  telegram_chat_id: number | string;
  type: string;
  title: string | null;
  username: string | null;
  phone: string | null;
  watched: boolean;
  sync_enabled: boolean;
  last_synced_message_id: number | string;
  last_message_at: string | null;
  updated_at?: string | null;
  business_connection_id: string | null;
  mode: "observe" | "suggest" | "auto" | "off";
};

export function db(): SupabaseClient {
  return createClient(supabaseUrl(), supabaseAdminKey(), {
    auth: { persistSession: false },
  });
}

export async function upsertChat(
  client: SupabaseClient,
  input: Partial<ChatRow> & {
    telegram_chat_id: number | string;
    type: string;
  },
): Promise<ChatRow> {
  const { data, error } = await client
    .from("telegram_chats")
    .upsert(input, { onConflict: "telegram_chat_id" })
    .select("*")
    .single();

  if (error) throw error;
  return data as ChatRow;
}

export async function insertMessages(
  client: SupabaseClient,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  if (!rows.length) return;

  const { error } = await client.from("telegram_messages").upsert(rows, {
    onConflict: "chat_id,telegram_message_id",
    ignoreDuplicates: true,
  });

  if (error) throw error;
}

export async function recentMessages(
  client: SupabaseClient,
  chatId: string,
  limit: number,
) {
  const { data, error } = await client
    .from("telegram_messages")
    .select(
      "telegram_message_id,sender_telegram_id,outgoing,message_date,text,reply_to_message_id",
    )
    .eq("chat_id", chatId)
    .not("text", "is", null)
    .order("telegram_message_id", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return [...(data || [])].reverse();
}

export async function outgoingStyleSamples(
  client: SupabaseClient,
  limit: number,
) {
  const { data, error } = await client
    .from("telegram_messages")
    .select("text,message_date")
    .eq("outgoing", true)
    .not("text", "is", null)
    .order("message_date", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function upsertSummary(
  client: SupabaseClient,
  chatId: string,
  summary: Record<string, unknown>,
) {
  const { error } = await client
    .from("conversation_summaries")
    .upsert(
      {
        chat_id: chatId,
        ...summary,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "chat_id" },
    );

  if (error) throw error;
}

export async function getAssistantSecret(
  client: SupabaseClient,
  key: string,
  field: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("assistant_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error) throw error;
  const value = data?.value as Record<string, unknown> | null;
  const secret = value?.[field];
  return typeof secret === "string" && secret.length > 0 ? secret : null;
}
