# Telegram AI Auto-Replier

Telegram-бот автоответчик на базе нескольких нейросетей с автоматическим fallback.

## Возможности

- Telegram через grammY.
- До трёх AI-провайдеров одновременно.
- OpenAI-compatible API для каждого провайдера.
- Если один провайдер недоступен, бот автоматически пробует следующий.
- История сообщений сохраняется в `data/history.json`.
- Ограничение длины ответа и rate limit.
- По умолчанию ответы только в личных чатах.
- Без ключей и токенов в Git.
- Docker и запуск напрямую на VPS.

## Запуск

Требуется Node.js 22+.

```bash
cp .env.example .env
npm install
npm run check
npm run build
npm start
```

Заполни `TELEGRAM_BOT_TOKEN` и хотя бы одного AI-провайдера.

## VPS через Docker

```bash
git clone <repository-url>
cd telegram-ai-auto-replier
cp .env.example .env
nano .env
docker compose up -d --build
docker compose logs -f bot
```

По умолчанию используется long polling, поэтому для первого запуска не нужны домен и HTTPS.

## AI-провайдеры

Для каждого провайдера доступны:

`AI_PROVIDER_N_ENABLED`
`AI_PROVIDER_N_NAME`
`AI_PROVIDER_N_BASE_URL`
`AI_PROVIDER_N_API_KEY`
`AI_PROVIDER_N_MODEL`

API должен поддерживать `POST /chat/completions`.

Если конкретная бесплатная нейросеть использует другой API, добавим отдельный адаптер после того, как ты пришлёшь её документацию или ключ.

## Режим групп

Сейчас бот сознательно отвечает только в личных чатах. Перед включением групп добавим отдельные правила: упоминание бота, whitelist чатов и защиту от бесконечных цепочек.

## Команды

`/start`, `/help`, `/status`, `/reset`

## Безопасность

Никогда не коммить Telegram bot token или API keys. Используй только `.env` или переменные окружения VPS.
