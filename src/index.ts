import { createBot } from "./bot.js";

const bot = createBot();

await bot.api.setMyCommands([
  { command: "start", description: "Запустить управление" },
  { command: "help", description: "Помощь" },
  { command: "status", description: "Статус Business + AI" },
  { command: "auto", description: "Включить/выключить автоответы" },
  { command: "mode", description: "Режим auto/suggest/off" },
  { command: "block", description: "Исключить чат" },
  { command: "unblock", description: "Вернуть чат" },
  { command: "reset", description: "Сбросить контекст" },
]);

await bot.api.deleteWebhook({ drop_pending_updates: false });

const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  await bot.start({
    signal: controller.signal,
    onStart: (info) => {
      console.log(`Telegram Business bot @${info.username} started in long-polling mode`);
    },
  });
} finally {
  bot.stop();
}
