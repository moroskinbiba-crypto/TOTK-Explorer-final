import {
  Bot,
  Context,
  InlineKeyboard,
  webhookCallback,
} from "npm:grammy@1.46.0";
import { db, getAssistantSecret, upsertChat } from "./_shared/db.ts";
import {
  adminTelegramIds,
  maxContextMessages,
  maxReplyLength,
  supabaseUrl,
  telegramBotToken,
  telegramWebhookSecret,
} from "./_shared/env.ts";
import { generateReply, summarize } from "./_shared/ai.ts";

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

async function callSync() {
  const secret = await getSyncSecret();
  const response = await fetch(
    `${supabaseUrl()}/functions/v1/telegram-sync`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Assistant-Sync-Secret": secret,
      },
      body: JSON.stringify({ action: "sync" }),
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


async function storeBusinessConnection(connection: any) {
  const owner = connection.user;
  const { error: accountError } = await client
    .from("telegram_accounts")
    .upsert(
      {
        telegram_user_id: owner.id,
        username: owner.username || null,
        display_name:
          [owner.first_name, owner.last_name].filter(Boolean).join(" ") || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "telegram_user_id" },
    );
  if (accountError) throw accountError;

  const { data: currentMode } = await client
    .from("assistant_settings")
    .select("value")
    .eq("key", "assistant_mode")
    .maybeSingle();
  const existing = (currentMode?.value || {}) as Record<string, unknown>;

  const { error: saveConnectionError } = await client
    .from("assistant_settings")
    .upsert(
      {
        key: `business_connection:${connection.id}`,
        value: {
          owner_user_id: String(owner.id),
          user_chat_id: String(connection.user_chat_id),
          is_enabled: connection.is_enabled,
          can_reply: connection.rights?.can_reply === true,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  if (saveConnectionError) throw saveConnectionError;

  if (!existing.business) {
    const { error } = await client
      .from("assistant_settings")
      .upsert(
        {
          key: "assistant_mode",
          value: { ...existing, business: "suggest" },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
    if (error) throw error;
  }
}

async function ensureBusinessChat(ctx: Context): Promise<any | null> {
  const message = ctx.businessMessage;
  if (!message) return null;

  const { data: existing, error: existingError } = await client
    .from("telegram_chats")
    .select("*")
    .eq("telegram_chat_id", message.chat.id)
    .maybeSingle();

  if (existingError) throw existingError;

  const { data: modeRow } = await client
    .from("assistant_settings")
    .select("value")
    .eq("key", "assistant_mode")
    .maybeSingle();

  const defaults = (modeRow?.value || {}) as { business?: string };
  const mode = existing?.mode || defaults.business || "observe";

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
    mode,
    watched: existing ? existing.watched : true,
    sync_enabled: existing ? existing.sync_enabled : true,
    last_message_at: new Date(message.date * 1000).toISOString(),
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
  if (!message?.text || message.sender_business_bot || !message.business_connection_id) return;

  const chat = await ensureBusinessChat(ctx);
  if (!chat) return;

  const text = message.text.trim();
  if (!text) return;

  let { data: connectionRow, error: connectionLookupError } = await client
    .from("assistant_settings")
    .select("value")
    .eq("key", `business_connection:${message.business_connection_id}`)
    .maybeSingle();
  if (connectionLookupError) throw connectionLookupError;

  let connectionInfo = (connectionRow?.value || {}) as {
    owner_user_id?: string;
    is_enabled?: boolean;
  };

  // Telegram may start delivering selected chat updates without this deployment
  // having received the earlier business_connection event. Recover it from Bot API.
  if (!connectionInfo.owner_user_id) {
    const connection = await ctx.api.getBusinessConnection(message.business_connection_id);
    await storeBusinessConnection(connection);
    connectionInfo = {
      owner_user_id: String(connection.user.id),
      is_enabled: connection.is_enabled,
    };
  }

  if (connectionInfo.is_enabled === false) return;

  const isOwnerMessage =
    Boolean(connectionInfo.owner_user_id) &&
    String(message.from?.id || "") === connectionInfo.owner_user_id;

  const { error: insertError } = await client
    .from("telegram_messages")
    .upsert(
      {
        chat_id: chat.id,
        telegram_message_id: message.message_id,
        sender_telegram_id: message.from?.id || null,
        outgoing: isOwnerMessage,
        source: isOwnerMessage ? "owner_message" : "business_update",
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

  await client
    .from("telegram_chats")
    .update({
      last_message_at: new Date(message.date * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", chat.id);

  // Secretary Mode only delivers Business updates for managed chats. It cannot
  // fetch arbitrary past dialogs/messages; any author samples come from new
  // owner-authored Business updates or explicit /style examples.
  if (isOwnerMessage) return;

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
          source: "ai_reply",
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
      "Secretary Bot подключён.",
      "",
      "/status — статус",
      "/chats — чаты, которые уже прислали Business-сообщения",
      "/summary CHAT_ID — саммари чата",
      "/sync — обновить саммари",
      "/style ТЕКСТ — добавить пример твоего стиля",
      "/style reset — удалить примеры стиля",
      "/mode observe|suggest|auto|off — режим ответов",
      "",
      "Список разрешённых чатов настраивается в Telegram → Settings → Telegram Business → Connected Bots.",
    ].join("\n"),
  );
});

bot.command("help", async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply(
    [
      "/status",
      "/chats",
      "/summary CHAT_ID",
      "/sync",
      "/style ТЕКСТ",
      "/style reset",
      "/mode observe|suggest|auto|off",
      "",
      "Secretary Bot не входит в твой личный аккаунт и не может выгрузить историю до подключения. Он видит только обновления из выбранных Business-чатов.",
    ].join("\n"),
  );
});

bot.command("status", async (ctx) => {
  if (!isAdmin(ctx)) return;

  const [{ count: chats }, { count: watched }, { count: messages }] =
    await Promise.all([
      client
        .from("telegram_chats")
        .select("id", { count: "exact", head: true })
        .not("business_connection_id", "is", null),
      client
        .from("telegram_chats")
        .select("id", { count: "exact", head: true })
        .not("business_connection_id", "is", null)
        .eq("watched", true)
        .eq("sync_enabled", true),
      client
        .from("telegram_messages")
        .select("id", { count: "exact", head: true }),
    ]);

  const { data: modeRow } = await client
    .from("assistant_settings")
    .select("value")
    .eq("key", "assistant_mode")
    .maybeSingle();

  const mode = ((modeRow?.value || {}) as { business?: string }).business || "observe";

  await ctx.reply(
    [
      "Режим Business: " + mode,
      `Чатов получено через Secretary Bot: ${chats || 0}`,
      `В саммари включены: ${watched || 0}`,
      `Сохранено сообщений: ${messages || 0}`,
    ].join("\n"),
  );
});

bot.command("chats", async (ctx) => {
  if (!isAdmin(ctx)) return;

  const { data, error } = await client
    .from("telegram_chats")
    .select("telegram_chat_id,title,username,watched,mode,last_message_at")
    .not("business_connection_id", "is", null)
    .eq("watched", true)
    .order("last_message_at", { ascending: false })
    .limit(50);

  if (error) throw error;

  if (!data?.length) {
    await ctx.reply(
      "Пока нет сообщений от Business-чатов. Сначала подключи Secretary Bot в настройках Telegram Business и выбери чаты.",
    );
    return;
  }

  await ctx.reply(
    data
      .map(
        (chat: any) =>
          `${chat.telegram_chat_id} — ${chat.title || (chat.username ? `@${chat.username}` : "без названия")} — ${chat.mode} — ${chat.last_message_at || "нет даты"}`,
      )
      .join("\n"),
  );
});

bot.command("summary", async (ctx) => {
  if (!isAdmin(ctx)) return;
  const id = ctx.match.trim();

  if (!/^-?\d+$/.test(id)) {
    await ctx.reply("Использование: /summary CHAT_ID");
    return;
  }

  const { data: chat } = await client
    .from("telegram_chats")
    .select("id,title,telegram_chat_id")
    .eq("telegram_chat_id", id)
    .maybeSingle();

  if (!chat) {
    await ctx.reply("Этот чат пока не присылал обновлений через Secretary Bot.");
    return;
  }

  const { data: summary, error } = await client
    .from("conversation_summaries")
    .select("summary,open_loops,decisions,action_items,updated_at")
    .eq("chat_id", chat.id)
    .maybeSingle();

  if (error) throw error;

  if (!summary) {
    await ctx.reply("Саммари пока не готово. Выполни /sync и попробуй ещё раз.");
    return;
  }

  const text = [
    `Саммари: ${chat.title || chat.telegram_chat_id}`,
    "",
    summary.summary || "Пока нет текста саммари.",
    "",
    "Открытые вопросы: " + JSON.stringify(summary.open_loops || []),
    "Договорённости: " + JSON.stringify(summary.decisions || []),
    "Задачи: " + JSON.stringify(summary.action_items || []),
    "",
    "Обновлено: " + (summary.updated_at || "неизвестно"),
  ].join("\n");

  await ctx.reply(text.slice(0, 3900));
});

bot.command("sync", async (ctx) => {
  if (!isAdmin(ctx)) return;

  try {
    const result = await callSync();
    const summaries = Array.isArray(result.summaries) ? result.summaries : [];
    const refreshed = summaries.filter((item: any) => item.summarizedMessages).length;
    const errors = summaries.filter((item: any) => item.error).length;
    const style = result.style || {};

    await ctx.reply(
      [
        `Саммари обновлены: ${refreshed}`,
        `Ошибок: ${errors}`,
        style.refreshed
          ? `Профиль стиля обновлён по ${style.samples} образцам.`
          : style.reason === "add_at_least_three_style_examples_with_the_style_command"
            ? `Для профиля стиля пока мало примеров: ${style.samples}. Используй /style ТЕКСТ не менее трёх раз.`
            : "Профиль стиля: " + (style.reason || "без изменений"),
      ].join("\n"),
    );
  } catch (error) {
    await ctx.reply(
      `Синхронизация не выполнена: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
});

bot.command("style", async (ctx) => {
  if (!isAdmin(ctx)) return;
  const value = ctx.match.trim();

  if (!value) {
    await ctx.reply("Использование: /style ТЕКСТ твоего обычного сообщения или /style reset");
    return;
  }

  if (value.toLowerCase() === "reset") {
    const { error } = await client
      .from("assistant_settings")
      .upsert(
        { key: "style_examples", value: { samples: [] }, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    if (error) throw error;
    await ctx.reply("Ручные примеры стиля очищены.");
    return;
  }

  if (value.length < 12) {
    await ctx.reply("Добавь более длинный образец — хотя бы одно обычное сообщение целиком.");
    return;
  }

  const { data: existing, error: readError } = await client
    .from("assistant_settings")
    .select("value")
    .eq("key", "style_examples")
    .maybeSingle();
  if (readError) throw readError;

  const oldSamples = Array.isArray((existing?.value as { samples?: unknown[] } | null)?.samples)
    ? ((existing?.value as { samples: unknown[] }).samples)
        .filter((sample): sample is string => typeof sample === "string")
    : [];
  const samples = [...oldSamples, value].slice(-100);

  const { error } = await client
    .from("assistant_settings")
    .upsert(
      { key: "style_examples", value: { samples }, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw error;

  await client
    .from("telegram_accounts")
    .update({ style_updated_at: null, updated_at: new Date().toISOString() })
    .not("telegram_user_id", "is", null);

  await ctx.reply(`Образец добавлен. Сейчас примеров: ${samples.length}. После /sync стиль будет обновлён.`);
});

bot.command("mode", async (ctx) => {
  if (!isAdmin(ctx)) return;
  const value = ctx.match.trim().toLowerCase();

  if (!["observe", "suggest", "auto", "off"].includes(value)) {
    await ctx.reply("Использование: /mode observe|suggest|auto|off");
    return;
  }

  const { data: currentMode, error: currentError } = await client
    .from("assistant_settings")
    .select("value")
    .eq("key", "assistant_mode")
    .maybeSingle();
  if (currentError) throw currentError;

  const current = (currentMode?.value || {}) as Record<string, unknown>;
  const { error: settingError } = await client
    .from("assistant_settings")
    .upsert(
      { key: "assistant_mode", value: { ...current, business: value }, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (settingError) throw settingError;

  const { error } = await client
    .from("telegram_chats")
    .update({ mode: value, updated_at: new Date().toISOString() })
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
          source: "ai_reply",
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
    await storeBusinessConnection(connection);
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
