import {
  db,
  recentMessages,
  upsertSummary,
} from "./_shared/db.ts";
import { analyzeStyle, summarize } from "./_shared/ai.ts";
import { maxContextMessages, styleRefreshHours } from "./_shared/env.ts";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function assertSyncSecret(req: Request, client: ReturnType<typeof db>) {
  const token = req.headers.get("X-Assistant-Sync-Secret")?.trim();
  if (!token) throw new Response("Unauthorized", { status: 401 });

  const { data, error } = await client
    .from("assistant_settings")
    .select("value")
    .eq("key", "sync_token_hash")
    .maybeSingle();

  if (error) throw error;
  const expected = (data?.value as { hash?: string } | null)?.hash;

  if (!expected || (await sha256(token)) !== expected) {
    throw new Response("Unauthorized", { status: 401 });
  }
}

async function refreshSummaries(client: ReturnType<typeof db>) {
  const { data: chats, error } = await client
    .from("telegram_chats")
    .select("id,telegram_chat_id,title,last_message_at")
    .not("business_connection_id", "is", null)
    .eq("watched", true)
    .eq("sync_enabled", true)
    .order("last_message_at", { ascending: false })
    .limit(100);

  if (error) throw error;

  const results: Array<Record<string, unknown>> = [];

  for (const chat of chats || []) {
    try {
      const { data: currentSummary, error: summaryError } = await client
        .from("conversation_summaries")
        .select("last_message_at,updated_at")
        .eq("chat_id", chat.id)
        .maybeSingle();

      if (summaryError) throw summaryError;

      if (
        chat.last_message_at &&
        currentSummary?.last_message_at &&
        new Date(currentSummary.last_message_at).getTime() >=
          new Date(chat.last_message_at).getTime()
      ) {
        results.push({ chatId: String(chat.telegram_chat_id), skipped: true });
        continue;
      }

      const messages = await recentMessages(
        client,
        chat.id,
        maxContextMessages(),
      );

      if (!messages.length) {
        results.push({ chatId: String(chat.telegram_chat_id), empty: true });
        continue;
      }

      const generated = await summarize(
        messages.map((message) => ({
          outgoing: message.outgoing === true,
          text: message.text,
          message_date: message.message_date,
        })),
      );

      await upsertSummary(client, chat.id, {
        summary: generated.data.summary || "",
        open_loops: generated.data.open_loops || [],
        decisions: generated.data.decisions || [],
        action_items: generated.data.action_items || [],
        last_message_at: chat.last_message_at || messages.at(-1)?.message_date,
      });

      results.push({
        chatId: String(chat.telegram_chat_id),
        summarizedMessages: messages.length,
      });
    } catch (error) {
      results.push({
        chatId: String(chat.telegram_chat_id),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

async function refreshStyle(client: ReturnType<typeof db>) {
  const { data: account, error: accountError } = await client
    .from("telegram_accounts")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (accountError) throw accountError;
  if (!account) {
    return {
      refreshed: false,
      reason: "connect_the_secretary_bot_to_a_telegram_business_account_first",
    };
  }

  const lastUpdated = account.style_updated_at
    ? new Date(account.style_updated_at).getTime()
    : 0;

  if (lastUpdated && Date.now() - lastUpdated < styleRefreshHours() * 3600_000) {
    return { refreshed: false, reason: "profile_is_fresh" };
  }

  const { data: savedExamples, error: examplesError } = await client
    .from("assistant_settings")
    .select("value")
    .eq("key", "style_examples")
    .maybeSingle();

  if (examplesError) throw examplesError;

  const explicitSamples = Array.isArray(
    (savedExamples?.value as { samples?: unknown[] } | null)?.samples,
  )
    ? ((savedExamples?.value as { samples: unknown[] }).samples)
        .filter((sample): sample is string => typeof sample === "string")
    : [];

  // Telegram Secretary bots can only learn from updates they are actually sent.
  // They cannot fetch a user's arbitrary historical chat list or old messages.
  const { data: ownerMessages, error: messagesError } = await client
    .from("telegram_messages")
    .select("text")
    .eq("source", "owner_message")
    .eq("outgoing", true)
    .not("text", "is", null)
    .order("message_date", { ascending: false })
    .limit(300);

  if (messagesError) throw messagesError;

  const samples = [
    ...new Set([
      ...explicitSamples,
      ...(ownerMessages || [])
        .map((row) => String(row.text || "").trim())
        .filter(Boolean),
    ]),
  ].slice(0, 600);

  if (samples.length < 3) {
    return {
      refreshed: false,
      reason: "add_at_least_three_style_examples_with_the_style_command",
      samples: samples.length,
    };
  }

  const generated = await analyzeStyle(samples);

  const { error: updateError } = await client
    .from("telegram_accounts")
    .update({
      style_profile: generated.data,
      style_sample_count: samples.length,
      style_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);

  if (updateError) throw updateError;

  return { refreshed: true, samples: samples.length };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const client = db();
    await assertSyncSecret(req, client);

    const summaries = await refreshSummaries(client);
    const style = await refreshStyle(client);

    return new Response(
      JSON.stringify({
        ok: true,
        mode: "secretary_bot_only",
        summaries,
        style,
      }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);

    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
});
