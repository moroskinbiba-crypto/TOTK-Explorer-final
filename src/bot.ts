import { Bot, Context } from "grammy";
import pino from "pino";
import { config } from "./config.js";
import { generateReply } from "./ai.js";
import { addMessage, getHistory, isRateLimited, resetHistory } from "./store.js";

const logger = pino({ level: config.logLevel });

function isAllowed(ctx: Context): boolean {
  if (ctx.chat?.type !== "private") return false;
  if (config.adminIds.size === 0) return true;
  return ctx.from?.id !== undefined && config.adminIds.has(String(ctx.from.id));
}

function chatKey(ctx: Context): string {
  return String(ctx.chat?.id ?? ctx.from?.id ?? "unknown");
}

export function createBot(): Bot {
  const bot = new Bot(config.telegramToken);

  bot.command("start", (ctx) => ctx.reply("Привет! Я AI-автоответчик. Напиши сообщение, и я постараюсь ответить."));
  bot.command("help", (ctx) => ctx.reply(
    "/start — запустить\n/help — помощь\n/status — статус AI\n/reset — очистить контекст"
  ));
  bot.command("status", (ctx) => {
    const configured = config.providers.map((p) => `${p.name} (${p.model})`).join(", ");
    return ctx.reply(configured ? `AI-провайдеры: ${configured}` : "AI-провайдеры не настроены.");
  });
  bot.command("reset", (ctx) => {
    resetHistory(chatKey(ctx));
    return ctx.reply("Контекст этого чата очищен.");
  });

  bot.on("message:text", async (ctx) => {
    if (!isAllowed(ctx)) return;

    const text = ctx.message.text.trim();
    if (!text || text.startsWith("/")) return;

    const key = chatKey(ctx);
    if (isRateLimited(key, config.rateLimitPerMinute)) {
      await ctx.reply("Слишком много сообщений подряд. Попробуй немного позже.");
      return;
    }

    await ctx.api.sendChatAction(ctx.chat.id, "typing");
    if (config.typingDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.typingDelayMs));
    }

    const history = getHistory(key, config.maxHistoryMessages);
    try {
      const result = await generateReply(history, text);
      addMessage(key, { role: "user", content: text }, config.maxHistoryMessages);
      addMessage(key, { role: "assistant", content: result.text }, config.maxHistoryMessages);
      logger.info({ chatId: key, provider: result.provider }, "reply sent");
      await ctx.reply(result.text);
    } catch (error) {
      logger.error({ err: error, chatId: key }, "AI reply failed");
      await ctx.reply("Сейчас не получается получить ответ от нейросети. Попробуй ещё раз чуть позже.");
    }
  });

  bot.catch((error) => {
    logger.error({ err: error.error }, "telegram update failed");
  });

  return bot;
}
