import {
  Bot,
  Context,
  InlineKeyboard,
  webhookCallback,
} from "npm:grammy@1.46.0";
import { db, getAssistantSecret, upsertChat } from "../_shared/db.ts";
import {
  adminTelegramIds,
  maxContextMessages,
  maxReplyLength,
  supabaseUrl,
  telegramBotToken,
  telegramWebhookSecret,
} from "../_shared/env.ts";
import { generateReply, summarize } from "../_shared/ai.ts";

const client = db();
const admins = adminTelegramIds();
const bot = new Bot(telegramBotToken());

function isAdmin(ctx: Context): boolean {
  return (
    ctx.chat?.type === "private" &&
    ctx.from?.id !== undefined &&
    admins.has(String(ctx.from.id))
  );
}

async function getSyncSecret(): Promise<string> {
  const secret = await getAssistantSecret(
    client,
    "sync_token",
    "secret",
  );
  if (!secret) throw new Error("Internal sync token is not configured");
  return secret;
}

async function callSync(action: "discover" | "sync") {
  const secret = await getSyncSecret();
  const response = await fetch(
    `${supabaseUrl()}/functions/v1/telegram-sync?action=${action}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Assistant-Sync-Secret": secret,
      },
      body: JSON.stringify({ action }),
    },
  );

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : `telegram-sync returned HTTP ${response.status}`,
    );
  }

  return payload;
}

async function ensureBusinessChat(ctx: Context): Promise<any | null> {
  const message = ctx.businessMessage;
  if (!message) return null;

  const { data: existing } = await client
    .from("telegram_chats")
    .select("*")
    .eq("telegram_chat_id", message.chat.id)
    .maybeSingle();

  return upsertChat(client, {
    telegram_chat_id: message.chat.id,
    type: message.chat.type,
    title:
      message.chat.title ||
      [message.chat.first_name, message.chat.last_name]
        .filter(Boolean)
        .join(" ") ||
      null,
    username: message.chat.username || null,
    business_connection_id: message.business_connection_id,
    mode: existing?.mode || "observe",
    watched: existing?.watched || false,
    sync_enabled: existing?.sync_enabled ?? true,
    updated_at: new Date().toISOString(),
  });
}

async function refreshSummary(chatId: string) {
  const { data: messages, error } = await client
    .from("telegram_messages")
    .select(
      "outgoing,text,message_date,telegram_message_id",
    )
    .eq("chat_id", chatId)
    .not("text", "is", null)
    .order("telegram_message_id", { ascending: false })
    .limit(maxContextMessages());

  if (error) throw error;
  if (!messages?.length) return;

  const recent = [...messages].reverse();
  const result = await summarize(recent);

  const { error: upsertError } = await client
    .from("conversation_summaries")
    .upsert(
      {
        chat_id: chatId,
        summary: result.data.summary || "",
        open_loops: result.data.open_loops || [],
        decisions: result.data.decisions || [],
        action_items: result.data.action_items || [],
        last_message_at: recent.at(-1)?.message_date || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "chat_id" },
    );

  if (upsertError) throw upsertError;
}

async function generateBusinessDraft(
  chatId: string,
  incoming: string,
) {
  const { data: account } = await client
    .from("telegram_accounts")
    .select("style_profile")
    .limit(1)
    .maybeSingle();

  const { data: summary } = await client
    .from("conversation_summaries")
    .select("*")
    .eq("chat_id", chatId)
    .maybeSingle();

  const { data: messages, error } = await client
    .from("telegram_messages")
    .select("outgoing,text,message_date")
    .eq("chat_id", chatId)
    .not("text", "is", null)
    .order("telegram_message_id", { ascending: false })
    .limit(maxContextMessages());

  if (error) throw error;

  return generateReply({
    styleProfile: (account?.style_profile || {}) as Record<string, unknown>,
    summary: (summary || null) as Record<string, unknown> | null,
    messages: [...(messages || [])].reverse(),
    incoming,
  });
}

async function processBusinessMessage(ctx: Context) {
  const message = ctx.businessMessage;
  if (!message?.text || message.sender_business_bot) return;

  const chat = await ensureBusinessChat(ctx);
  if (!chat) return;

  const text = message.text.trim();
  if (!text) return;

  const { error: insertError } = await client
    .from("telegram_messages")
    .upsert(
      {
        chat_id: chat.id,
        telegram_message_id: message.message_id,
        sender_telegram_id: message.from?.id || null,
        outgoing: false,
        message_date: new Date(message.date * 1000).toISOString(),
        text,
        reply_to_message_id:
          message.reply_to_message?.message_id || null,
      },
      {
        onConflict: "chat_id,telegram_message_id",
        ignoreDuplicates: true,
      },
    );

  if (insertError) throw insertError;

  await refreshSummary(chat.id);

  const mode = chat.mode || "observe";
  if (mode === "off" || mode === "observe") return;

  const draft = await generateBusinessDraft(chat.id, text);

  if (mode === "suggest") {
    const { data: suggestion, error } = await client
      .from("ai_suggestions")
      .insert({
        chat_id: chat.id,
        business_connection_id: chat.business_connection_id,
        source_message_id: message.message_id,
        customer_text: text,
        reply_text: draft.text.slice(0, maxReplyLength()),
        status: "pending",
        expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      })
      .select("*")
      .single();

    if (error) throw error;

    for (const adminId of admins) {
      await ctx.api.sendMessage(
        Number(adminId),
        [
          "🤖 Предлагаемый ответ",
          `Чат: ${chat.title || chat.username || chat.telegram_chat_id}`,
          "",
          draft.text,
        ].join("\n"),
        {
          reply_markup: new InlineKeyboard()
            .text("✅ Отправить", `suggest:approve:${suggestion.id}`)
            .text("❌ Отклонить", `suggest:reject:${suggestion.id}`),
        },
      );
    }

    return;
  }

  if (mode === "auto" && chat.business_connection_id) {
    const sent = await ctx.api.sendMessage(
      Number(chat.telegram_chat_id),
      draft.text,
      { business_connection_id: chat.business_connection_id },
    );

    const { error: sentInsertError } = await client
      .from("telegram_messages")
      .upsert(
        {
          chat_id: chat.id,
          telegram_message_id: sent.message_id,
          sender_telegram_id: null,
          outgoing: true,
          message_date: new Date(sent.date * 1000).toISOString(),
          text: draft.text,
        },
        {
          onConflict: "chat_id,telegram_message_id",
          ignoreDuplicates: true,
        },
      );

    if (sentInsertError) throw sentInsertError;
  }
}

bot.command("start", async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply(
    [
      "Личный AI-ассистент подключён.",
      "",
      "/status — статус базы и синхронизации",
      "/discover — показать твои Telegram-диалоги",
      "/watch CHAT_ID — начать читать чат",
      "/unwatch CHAT_ID — перестать читать",
      "/chats — список отслеживаемых чатов",
      "/sync — синхронизировать историю сейчас",
      "/mode observe|suggest|auto|off — режим Business-чатов",
      "/help — справка",
    ].join("\n"),
  );
});

bot.command("help", async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply(
    "/status\n" +
      "/discover\n" +
      "/watch CHAT_ID\n" +
      "/unwatch CHAT_ID\n" +
      "/chats\n" +
      "/sync\n" +
      "/mode observe|suggest|auto|off",
  );
});

bot.command("status", async (ctx) => {
  if (!isAdmin(ctx)) return;

  const [{ count: chats }, { count: watched }, { count: messages }] =
    await Promise.all([
      client.from("telegram_chats").select("id", { count: "exact", head: true }),
      client
        .from("telegram_chats")
        .select("id", { count: "exact", head: true })
        .eq("watched", true)
        .eq("sync_enabled", true),
      client
        .from("telegram_messages")
        .select("id", { count: "exact", head: true }),
    ]);

  await ctx.reply(
    [
      `Чатов в базе: ${chats || 0}`,
      `Отслеживаются: ${watched || 0}`,
      `Сохранено сообщений: ${messages || 0}`,
    ].join("\n"),
  );
});

bot.command("discover", async (ctx) => {
  if (!isAdmin(ctx)) return;

  try {
    const result = await callSync("discover");
    const dialogs = Array.isArray(result.dialogs) ? result.dialogs : [];

    if (!dialogs.length) {
      await ctx.reply("Telegram не вернул диалоги.");
      return;
    }

    const lines = dialogs.slice(0, 50).map(
      (dialog: any) =>
        `${dialog.id} — ${dialog.title || "без названия"}` +
        (dialog.username ? ` (@${dialog.username})` : "") +
        ` — ${dialog.type}`,
    );

    await ctx.reply(
      [
        "Твои последние диалоги:",
        "",
        ...lines,
        "",
        "Чтобы начать чтение конкретного чата: /watch CHAT_ID",
      ].join("\n"),
    );
  } catch (error) {
    await ctx.reply(
      `Не удалось получить список диалогов: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
});

bot.command("watch", async (ctx) => {
  if (!isAdmin(ctx)) return;

  const id = ctx.match.trim();

  if (!/^-?\d+$/.test(id)) {
    await ctx.reply("Нужен числовой Telegram chat ID.");
    return;
  }

  const { data: existing } = await client
    .from("telegram_chats")
    .select("id")
    .eq("telegram_chat_id", id)
    .maybeSingle();

  if (existing) {
    await client
      .from("telegram_chats")
      .update({
        watched: true,
        sync_enabled: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await upsertChat(client, {
      telegram_chat_id: id,
      type: "unknown",
      watched: true,
      sync_enabled: true,
      mode: "observe",
      updated_at: new Date().toISOString(),
    });
  }

  await ctx.reply(
    `Чат ${id} добавлен. Он будет синхронизироваться, а личные чаты остаются только в режиме наблюдения.`,
  );
});

bot.command("unwatch", async (ctx) => {
  if (!isAdmin(ctx)) return;

  const id = ctx.match.trim();

  if (!/^-?\d+$/.test(id)) {
    await ctx.reply("Нужен числовой Telegram chat ID.");
    return;
  }

  await client
    .from("telegram_chats")
    .update({
      watched: false,
      updated_at: new Date().toISOString(),
    })
    .eq("telegram_chat_id", id);

  await ctx.reply(`Чат ${id} убран из наблюдения.`);
});

bot.command("chats", async (ctx) => {
  if (!isAdmin(ctx)) return;

  const { data, error } = await client
    .from("telegram_chats")
    .select(
      "telegram_chat_id,title,username,watched,mode,last_message_at,business_connection_id",
    )
    .eq("watched", true)
    .order("last_message_at", { ascending: false })
    .limit(50);

  if (error) throw error;

  if (!data?.length) {
    await ctx.reply("Пока нет отслеживаемых чатов.");
    return;
  }

  await ctx.reply(
    data
      .map(
        (chat: any) =>
          `${chat.telegram_chat_id} — ${chat.title || (chat.username ? `@${chat.username}` : "без названия")} — ${chat.business_connection_id ? "Business" : "личный"} — ${chat.mode}`,
      )
      .join("\n"),
  );
});

bot.command("sync", async (ctx) => {
  if (!isAdmin(ctx)) return;

  try {
    const result = await callSync("sync");
    const synced = Array.isArray(result.synced) ? result.synced : [];
    const inserted = synced.reduce(
      (sum: number, item: any) => sum + Number(item.inserted || 0),
      0,
    );

    await ctx.reply(
      `Готово. Загружено новых текстовых сообщений: ${inserted}.`,
    );
  } catch (error) {
    await ctx.reply(
      `Синхронизация не выполнена: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
});

bot.command("mode", async (ctx) => {
  if (!isAdmin(ctx)) return;

  const value = ctx.match.trim().toLowerCase();

  if (!["observe", "suggest", "auto", "off"].includes(value)) {
    await ctx.reply("Использование: /mode observe|suggest|auto|off");
    return;
  }

  const { error } = await client
    .from("telegram_chats")
    .update({
      mode: value,
      updated_at: new Date().toISOString(),
    })
    .not("business_connection_id", "is", null);

  if (error) throw error;

  await ctx.reply(`Режим Business-чатов: ${value}`);
});

bot.callbackQuery(/^suggest:(approve|reject):(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery({ text: "Недоступно" });
    return;
  }

  const [, action, suggestionId] = ctx.callbackQuery.data.split(":");

  const { data: suggestion } = await client
    .from("ai_suggestions")
    .select("*")
    .eq("id", suggestionId)
    .eq("status", "pending")
    .maybeSingle();

  if (!suggestion) {
    await ctx.answerCallbackQuery({ text: "Устарело или уже обработано" });
    return;
  }

  if (new Date(suggestion.expires_at).getTime() < Date.now()) {
    await client
      .from("ai_suggestions")
      .update({ status: "expired" })
      .eq("id", suggestionId);
    await ctx.answerCallbackQuery({ text: "Предложение устарело" });
    return;
  }

  if (action === "reject") {
    await client
      .from("ai_suggestions")
      .update({ status: "rejected" })
      .eq("id", suggestionId);
    await ctx.answerCallbackQuery({ text: "Отклонено" });
    return;
  }

  if (!suggestion.business_connection_id || !suggestion.chat_id) {
    await ctx.answerCallbackQuery({ text: "Нет Business Connection" });
    return;
  }

  const { data: chat } = await client
    .from("telegram_chats")
    .select("*")
    .eq("id", suggestion.chat_id)
    .single();

  if (!chat) {
    await ctx.answerCallbackQuery({ text: "Чат не найден" });
    return;
  }

  try {
    const connection = await ctx.api.getBusinessConnection(
      suggestion.business_connection_id,
    );

    if (!connection.is_enabled || connection.rights?.can_reply !== true) {
      await ctx.answerCallbackQuery({
        text: "Business-подключение больше не разрешает ответы",
      });
      return;
    }

    const sent = await ctx.api.sendMessage(
      Number(chat.telegram_chat_id),
      suggestion.reply_text,
      {
        business_connection_id: suggestion.business_connection_id,
      },
    );

    await client
      .from("ai_suggestions")
      .update({ status: "sent" })
      .eq("id", suggestionId);

    const { error: insertError } = await client
      .from("telegram_messages")
      .upsert(
        {
          chat_id: chat.id,
          telegram_message_id: sent.message_id,
          sender_telegram_id: null,
          outgoing: true,
          message_date: new Date(sent.date * 1000).toISOString(),
          text: suggestion.reply_text,
        },
        {
          onConflict: "chat_id,telegram_message_id",
          ignoreDuplicates: true,
        },
      );

    if (insertError) throw insertError;

    await ctx.answerCallbackQuery({ text: "Отправлено" });
  } catch (error) {
    console.error(error);
    await ctx.answerCallbackQuery({
      text: "Telegram не разрешил отправку",
    });
  }
});

bot.on("business_message", async (ctx) => {
  try {
    await processBusinessMessage(ctx);
  } catch (error) {
    console.error("business_message handler failed", error);
  }
});

bot.on("business_connection", async (ctx) => {
  try {
    const connection = ctx.businessConnection;
    if (!connection) return;

    await upsertChat(client, {
      telegram_chat_id: connection.user_chat_id,
      type: "business_connection",
      title:
        [connection.user.first_name, connection.user.last_name]
          .filter(Boolean)
          .join(" ") || connection.user.username || null,
      username: connection.user.username || null,
      business_connection_id: connection.id,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("business_connection handler failed", error);
  }
});

bot.catch((error) => console.error("Telegram update error", error));

const handler = webhookCallback(bot, "std/http", {
  secretToken: telegramWebhookSecret(),
  timeoutMilliseconds: 50_000,
});

Deno.serve((req) => handler(req));
