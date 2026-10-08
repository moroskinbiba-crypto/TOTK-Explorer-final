import { Bot, Context, InlineKeyboard } from "grammy";
import pino from "pino";
import { config, type ReplyMode } from "./config.js";
import { generateReply } from "./ai.js";
import {
  addMessage,
  businessConversationKey,
  createSuggestion,
  deleteSuggestion,
  getBusinessConnection,
  getBusinessConnections,
  getHistory,
  getSuggestion,
  isChatBlocked,
  isRateLimited,
  privateConversationKey,
  resetConversationsForChat,
  resetHistory,
  saveBusinessConnection,
  setBlockedChat,
} from "./store.js";

const logger = pino({ level: config.logLevel });

const runtime = {
  enabled: config.autoReplyEnabled,
  mode: config.autoReplyMode as ReplyMode,
};

const chatQueues = new Map<string, Promise<unknown>>();

function isAdmin(ctx: Context): boolean {
  return (
    ctx.chat?.type === "private" &&
    ctx.from?.id !== undefined &&
    config.adminIds.has(String(ctx.from.id))
  );
}

function isBusinessChatAllowed(chatId: string): boolean {
  if (isChatBlocked(chatId)) return false;
  if (config.businessChatBlocklist.has(chatId)) return false;
  if (config.businessChatAllowlist.size > 0 && !config.businessChatAllowlist.has(chatId)) {
    return false;
  }
  return true;
}

function currentMode(): ReplyMode {
  if (!runtime.enabled) return "off";
  return runtime.mode;
}

function enqueue(key: string, task: () => Promise<void>): Promise<void> {
  const previous = chatQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  chatQueues.set(key, current.catch(() => undefined));
  return current;
}

async function getLiveBusinessConnection(ctx: Context, id: string) {
  const cached = getBusinessConnection(id);
  if (cached) return cached;

  const connection = await ctx.getBusinessConnection();
  saveBusinessConnection(connection);
  return getBusinessConnection(connection.id);
}

async function processBusinessText(ctx: Context): Promise<void> {
  const message = ctx.businessMessage;
  if (!message?.text) return;

  const connectionId = message.business_connection_id ?? ctx.businessConnectionId;
  if (!connectionId) return;

  const connection = await getLiveBusinessConnection(ctx, connectionId);
  if (!connection) {
    logger.warn({ connectionId }, "business connection is not available");
    return;
  }

  if (!connection.isEnabled || !connection.canReply) {
    logger.info(
      { connectionId, isEnabled: connection.isEnabled, canReply: connection.canReply },
      "business connection cannot reply",
    );
    return;
  }

  if (message.sender_business_bot || String(message.from?.id ?? "") === connection.userId) {
    return;
  }

  const chatId = String(message.chat.id);
  if (!isBusinessChatAllowed(chatId)) {
    logger.info({ connectionId, chatId }, "business chat is blocked");
    return;
  }

  const text = message.text.trim();
  if (!text) return;

  const conversationId = businessConversationKey(connection.id, chatId);
  if (isRateLimited(conversationId, config.rateLimitPerMinute)) {
    await ctx.reply("Слишком много сообщений подряд. Пожалуйста, подождите немного.");
    return;
  }

  const mode = currentMode();
  if (mode === "off") return;

  await enqueue(conversationId, async () => {
    await ctx.replyWithChatAction("typing");

    if (config.typingDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.typingDelayMs));
    }

    const history = getHistory(conversationId, config.maxHistoryMessages);

    try {
      const result = await generateReply(history, text);
      addMessage(conversationId, { role: "user", content: text }, config.maxHistoryMessages);

      if (currentMode() === "suggest") {
        const suggestion = createSuggestion({
          connectionId: connection.id,
          chatId,
          customerText: text,
          replyText: result.text,
          createdAt: Date.now(),
        });

        const customerPreview = text.length > 180 ? text.slice(0, 177) + "..." : text;
        await ctx.api.sendMessage(
          connection.userChatId,
          [
            "🤖 Предлагаемый ответ клиенту",
            "Чат: " + chatId,
            "Клиент: " + customerPreview,
            "",
            result.text,
          ].join("\n"),
          {
            reply_markup: new InlineKeyboard()
              .text("✅ Отправить", "suggest:approve:" + suggestion.id)
              .text("❌ Отклонить", "suggest:reject:" + suggestion.id),
          },
        );

        logger.info(
          {
            connectionId: connection.id,
            chatId,
            provider: result.provider,
            suggestionId: suggestion.id,
          },
          "reply suggestion created",
        );
        return;
      }

      await ctx.reply(result.text);
      addMessage(
        conversationId,
        { role: "assistant", content: result.text },
        config.maxHistoryMessages,
      );

      logger.info(
        { connectionId: connection.id, chatId, provider: result.provider },
        "business reply sent",
      );
    } catch (error) {
      logger.error(
        { err: error, connectionId: connection.id, chatId },
        "business AI reply failed",
      );
      await ctx.reply(
        "Сейчас не получается получить ответ от нейросети. Пожалуйста, повторите сообщение чуть позже.",
      );
    }
  });
}

export function createBot(): Bot {
  const bot = new Bot(config.telegramToken);

  bot.command("start", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const payload = ctx.match.trim();

    if (payload.startsWith("bizChat")) {
      const chatId = payload.slice("bizChat".length);
      if (chatId) {
        await ctx.reply(
          "Бизнес-чат " +
            chatId +
            " можно контролировать этим ботом. Доступны /status, /auto, /mode, /block, /unblock, /reset.",
        );
        return;
      }
    }

    await ctx.reply(
      "AI-автоответчик подключён. Команды: /help, /status, /auto, /mode, /block, /unblock, /reset.",
    );
  });

  bot.command("help", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.reply(
      [
        "/status — статус Business и AI",
        "/auto on|off — включить/выключить автоответы",
        "/mode auto|suggest|off — режим работы",
        "/block CHAT_ID — исключить клиента",
        "/unblock CHAT_ID — вернуть клиента",
        "/reset CHAT_ID — очистить контекст клиента",
        "/reset — очистить локальный контекст админ-чата",
      ].join("\n"),
    );
  });

  bot.command("status", async (ctx) => {
    if (!isAdmin(ctx)) return;

    const connections = getBusinessConnections();
    const ready = connections.filter(
      (connection) => connection.isEnabled && connection.canReply,
    ).length;
    const configured = config.providers
      .map((provider) => provider.name + " (" + provider.model + ")")
      .join(", ");

    await ctx.reply(
      [
        "Режим: " + currentMode(),
        "Бизнес-подключений в памяти: " + connections.length,
        "Готовы отвечать: " + ready,
        configured ? "AI: " + configured : "AI: провайдеры не настроены",
      ].join("\n"),
    );
  });

  bot.command("auto", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const value = ctx.match.trim().toLowerCase();

    if (value !== "on" && value !== "off") {
      await ctx.reply("Использование: /auto on или /auto off");
      return;
    }

    runtime.enabled = value === "on";
    await ctx.reply("Автоответы " + (runtime.enabled ? "включены." : "выключены."));
  });

  bot.command("mode", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const value = ctx.match.trim().toLowerCase();

    if (!["auto", "suggest", "off"].includes(value)) {
      await ctx.reply("Использование: /mode auto, /mode suggest или /mode off");
      return;
    }

    runtime.mode = value as ReplyMode;
    await ctx.reply("Режим изменён: " + runtime.mode);
  });

  bot.command("block", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const chatId = ctx.match.trim();

    if (!chatId) {
      await ctx.reply("Использование: /block CHAT_ID");
      return;
    }

    setBlockedChat(chatId, true);
    await ctx.reply("Клиент " + chatId + " исключён из автоответов.");
  });

  bot.command("unblock", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const chatId = ctx.match.trim();

    if (!chatId) {
      await ctx.reply("Использование: /unblock CHAT_ID");
      return;
    }

    setBlockedChat(chatId, false);
    await ctx.reply("Клиент " + chatId + " снова доступен автоответчику.");
  });

  bot.command("reset", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const target = ctx.match.trim();

    if (!target) {
      resetHistory(privateConversationKey(String(ctx.chat.id)));
      await ctx.reply("Локальный контекст этого админ-чата очищен.");
      return;
    }

    const chatId = target.startsWith("bizChat")
      ? target.slice("bizChat".length)
      : target;
    const count = resetConversationsForChat(chatId);
    await ctx.reply(
      "Контекст очищен в " +
        count +
        " бизнес-подключении(ях) для чата " +
        chatId +
        ".",
    );
  });

  bot.on("business_connection", (ctx) => {
    const connection = ctx.businessConnection;
    if (!connection) return;

    saveBusinessConnection(connection);
    logger.info(
      {
        connectionId: connection.id,
        userId: connection.user.id,
        isEnabled: connection.is_enabled,
        canReply: connection.rights?.can_reply === true,
      },
      "business connection updated",
    );
  });

  bot.on("business_message", async (ctx) => {
    try {
      await processBusinessText(ctx);
    } catch (error) {
      logger.error({ err: error }, "business message handler failed");
    }
  });

  bot.on("edited_business_message", (ctx) => {
    const message = ctx.editedBusinessMessage;
    if (!message) return;

    logger.info(
      {
        connectionId: message.business_connection_id,
        chatId: message.chat.id,
        messageId: message.message_id,
      },
      "business message edited; no duplicate AI reply generated",
    );
  });

  bot.on("deleted_business_messages", (ctx) => {
    const deleted = ctx.deletedBusinessMessages;
    if (!deleted) return;

    logger.info(
      {
        connectionId: deleted.business_connection_id,
        chatId: deleted.chat.id,
        messageIds: deleted.message_ids,
      },
      "business messages deleted",
    );
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith("suggest:")) return;

    if (!isAdmin(ctx)) {
      await ctx.answerCallbackQuery({ text: "Недоступно" });
      return;
    }

    const [, action, suggestionId] = data.split(":");
    if (!suggestionId || (action !== "approve" && action !== "reject")) {
      await ctx.answerCallbackQuery({ text: "Некорректное действие" });
      return;
    }

    const suggestion = getSuggestion(suggestionId);
    if (!suggestion) {
      await ctx.answerCallbackQuery({ text: "Предложение уже обработано" });
      return;
    }

    if (Date.now() - suggestion.createdAt > config.suggestionTtlMs) {
      deleteSuggestion(suggestion.id);
      await ctx.answerCallbackQuery({ text: "Предложение устарело" });
      return;
    }

    if (action === "reject") {
      deleteSuggestion(suggestion.id);
      await ctx.answerCallbackQuery({ text: "Отклонено" });
      return;
    }

    try {
      const live = await ctx.api.getBusinessConnection(suggestion.connectionId);
      saveBusinessConnection(live);

      if (!live.is_enabled || live.rights?.can_reply !== true) {
        deleteSuggestion(suggestion.id);
        await ctx.answerCallbackQuery({
          text: "Подключение больше не разрешает ответы",
        });
        return;
      }

      if (!isBusinessChatAllowed(suggestion.chatId)) {
        deleteSuggestion(suggestion.id);
        await ctx.answerCallbackQuery({
          text: "Чат сейчас исключён из автоответов",
        });
        return;
      }

      await ctx.api.sendMessage(
        suggestion.chatId,
        suggestion.replyText,
        { business_connection_id: suggestion.connectionId },
      );

      const conversationId = businessConversationKey(
        suggestion.connectionId,
        suggestion.chatId,
      );
      addMessage(
        conversationId,
        { role: "assistant", content: suggestion.replyText },
        config.maxHistoryMessages,
      );

      deleteSuggestion(suggestion.id);
      await ctx.answerCallbackQuery({ text: "Ответ отправлен" });

      logger.info(
        {
          connectionId: suggestion.connectionId,
          chatId: suggestion.chatId,
          suggestionId: suggestion.id,
        },
        "suggested business reply sent",
      );
    } catch (error) {
      logger.error(
        { err: error, suggestionId },
        "failed to send suggested reply",
      );
      await ctx.answerCallbackQuery({ text: "Не удалось отправить ответ" });
    }
  });

  if (config.enablePrivateChatAi) {
    bot.on("message:text", async (ctx) => {
      if (!isAdmin(ctx)) return;

      const text = ctx.message.text.trim();
      if (!text || text.startsWith("/")) return;

      const conversationId = privateConversationKey(String(ctx.chat.id));
      if (isRateLimited(conversationId, config.rateLimitPerMinute)) {
        await ctx.reply("Слишком много сообщений подряд. Попробуй немного позже.");
        return;
      }

      try {
        const history = getHistory(conversationId, config.maxHistoryMessages);
        const result = await generateReply(history, text);
        addMessage(conversationId, { role: "user", content: text }, config.maxHistoryMessages);
        await ctx.reply(result.text);
        addMessage(
          conversationId,
          { role: "assistant", content: result.text },
          config.maxHistoryMessages,
        );
      } catch (error) {
        logger.error({ err: error }, "private AI reply failed");
        await ctx.reply("Сейчас не получается получить ответ от нейросети.");
      }
    });
  }

  bot.catch((error) => {
    logger.error({ err: error.error }, "telegram update failed");
  });

  return bot;
}
