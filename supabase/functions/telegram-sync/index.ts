import { TelegramClient } from "npm:teleproto@1.229.1";
import { StringSession } from "npm:teleproto@1.229.1/sessions";
import {
  db,
  insertMessages,
  recentMessages,
  upsertChat,
  upsertSummary,
  outgoingStyleSamples,
} from "./_shared/db.ts";
import { analyzeStyle, summarize } from "./_shared/ai.ts";
import {
  initialHistoryLimit,
  maxContextMessages,
  styleRefreshHours,
  syncBatchSize,
  telegramApiHash,
  telegramApiId,
  telegramSession,
} from "./_shared/env.ts";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function assertSyncSecret(
  req: Request,
  client: ReturnType<typeof db>,
): Promise<void> {
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

function asStringId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return typeof value === "bigint" ? value.toString() : String(value);
  } catch {
    return null;
  }
}

async function syncDialog(
  client: ReturnType<typeof db>,
  telegram: TelegramClient,
  chat: any,
) {
  const chatId = asStringId(chat.telegram_chat_id);
  if (!chatId) return { inserted: 0, chatId: null };

  const entity = await telegram.getEntity(Number(chatId));
  const lastSynced = Number(chat.last_synced_message_id || 0);
  const limit = lastSynced > 0 ? syncBatchSize() : initialHistoryLimit();

  const messages = await telegram.getMessages(entity, {
    limit,
    minId: lastSynced > 0 ? lastSynced : undefined,
  });

  const rows: Array<Record<string, unknown>> = [];
  let maxMessageId = lastSynced;
  let latestDate: string | null = chat.last_message_at;

  for (const message of messages) {
    const id = Number(asStringId(message.id) || 0);
    if (!id) continue;

    if (id > maxMessageId) maxMessageId = id;

    const date =
      message.date instanceof Date
        ? message.date.toISOString()
        : new Date(message.date || Date.now()).toISOString();

    if (!latestDate || date > latestDate) latestDate = date;

    const text = typeof message.message === "string"
      ? message.message.trim()
      : "";

    if (!text) continue;

    rows.push({
      chat_id: chat.id,
      telegram_message_id: id,
      sender_telegram_id: asStringId(message.senderId),
      outgoing: message.out === true,
      message_date: date,
      text,
      reply_to_message_id: asStringId(message.replyToMsgId),
    });
  }

  await insertMessages(client, rows);

  if (maxMessageId > lastSynced) {
    await client
      .from("telegram_chats")
      .update({
        last_synced_message_id: maxMessageId,
        last_message_at: latestDate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", chat.id);
  }

  if (rows.length) {
    const recent = await recentMessages(
      client,
      chat.id,
      maxContextMessages(),
    );
    const result = await summarize(recent);

    await upsertSummary(client, chat.id, {
      summary: result.data.summary || "",
      open_loops: result.data.open_loops || [],
      decisions: result.data.decisions || [],
      action_items: result.data.action_items || [],
      last_message_at: latestDate,
    });
  }

  return {
    inserted: rows.length,
    chatId,
    lastMessageId: maxMessageId,
  };
}

async function refreshStyle(
  client: ReturnType<typeof db>,
  me: any,
) {
  const telegramUserId = Number(asStringId(me.id));
  const { data: account, error } = await client
    .from("telegram_accounts")
    .select("*")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (error) throw error;

  const stale =
    !account?.style_updated_at ||
    Date.now() - new Date(account.style_updated_at).getTime() >
      styleRefreshHours() * 3600_000;

  if (!stale) return { refreshed: false };

  const samples = await outgoingStyleSamples(client, 600);

  if (samples.length < 20) {
    return {
      refreshed: false,
      reason: "not_enough_outgoing_messages",
    };
  }

  const result = await analyzeStyle(
    samples
      .map((row) => String(row.text || ""))
      .filter(Boolean),
  );

  await client
    .from("telegram_accounts")
    .upsert(
      {
        telegram_user_id: telegramUserId,
        username: me.username || null,
        display_name:
          [me.firstName, me.lastName].filter(Boolean).join(" ") || null,
        style_profile: result.data,
        style_sample_count: samples.length,
        style_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "telegram_user_id" },
    );

  return {
    refreshed: true,
    samples: samples.length,
  };
}

async function discoverDialogs(telegram: TelegramClient) {
  const dialogs = await telegram.getDialogs({ limit: 200 });

  return dialogs.map((dialog: any) => ({
    id: asStringId(dialog.id),
    title: dialog.title || null,
    username: dialog.entity?.username || null,
    type: dialog.isUser
      ? "user"
      : dialog.isGroup
        ? "group"
        : dialog.isChannel
          ? "channel"
          : "unknown",
  }));
}

async function runSync(action: "sync" | "discover") {
  const client = db();
  const telegram = new TelegramClient(
    new StringSession(telegramSession()),
    telegramApiId(),
    telegramApiHash(),
    { connectionRetries: 3 },
  );

  await telegram.connect();

  try {
    if (!(await telegram.isUserAuthorized())) {
      throw new Error("Telegram session is not authorized");
    }

    const me = await telegram.getMe();

    if (action === "discover") {
      return {
        ok: true,
        action,
        user: {
          id: asStringId(me.id),
          username: me.username,
        },
        dialogs: await discoverDialogs(telegram),
      };
    }

    await client
      .from("telegram_accounts")
      .upsert(
        {
          telegram_user_id: Number(asStringId(me.id)),
          username: me.username || null,
          display_name:
            [me.firstName, me.lastName].filter(Boolean).join(" ") || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "telegram_user_id" },
      );

    const { data: chats, error } = await client
      .from("telegram_chats")
      .select("*")
      .eq("watched", true)
      .eq("sync_enabled", true)
      .limit(50);

    if (error) throw error;

    const results = [];

    for (const chat of chats || []) {
      try {
        results.push(await syncDialog(client, telegram, chat));
      } catch (error) {
        results.push({
          chatId: String(chat.telegram_chat_id),
          error: error instanceof Error
            ? error.message
            : String(error),
        });
      }
    }

    const style = await refreshStyle(client, me);

    return {
      ok: true,
      action,
      synced: results,
      style,
    };
  } finally {
    await telegram.disconnect();
  }
}

Deno.serve(async (req) => {
  try {
    const client = db();
    await assertSyncSecret(req, client);

    const body = req.method === "POST"
      ? await req.json().catch(() => ({}))
      : {};

    const url = new URL(req.url);
    const action = String(
      body.action || url.searchParams.get("action") || "sync",
    );

    if (action !== "sync" && action !== "discover") {
      return new Response(
        JSON.stringify({ ok: false, error: "Unknown action" }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    const result = await runSync(action);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: JSON_HEADERS,
    });
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
