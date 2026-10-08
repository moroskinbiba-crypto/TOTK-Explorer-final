import { createBot } from "./bot.js";

const bot = createBot();

await bot.api.setMyCommands([
  { command: "start", description: "Запустить бота" },
  { command: "help", description: "Помощь" },
  { command: "status", description: "Статус AI-провайдеров" },
  { command: "reset", description: "Очистить контекст" }
]);

await bot.start({
  onStart: info => {
    console.log(`Telegram bot @${info.username} started in long-polling mode`);
  }
});
