# Telegram AI Auto-Replier

Telegram-бот автоответчик на базе нескольких нейросетей с автоматическим fallback.

## Возможности

- Telegram через grammY.
- До трёх AI-провайдеров одновременно.
- OpenAI-compatible API для каждого провайдера.
- Если один провайдер недоступен, бот автоматически пробует следующий.
- История сообщений отдельно для каждого чата.
- Ограничение длины ответа.
- Rate limit.
- Опциональный whitelist пользователей.
- Без ключей и токенов в Git.
- Docker и запуск напрямую на VPS.

## 1. Локальный запуск

Требуется Node.js 22+.

```bash
cp .env.example .env
npm install
npm run check
npm run build
npm start
```

Заполни `TELEGRAM_BOT_TOKEN` и хотя бы одного AI-провайдера.

## 2. VPS через Docker

```bash
git clone <repository-url>
cd telegram-ai-auto-replier
cp .env.example .env
nano .env
docker compose up -d --build
docker compose logs -f bot
```

По умолчанию бот использует long polling, поэтому отдельный домен и HTTPS для первого запуска не нужны.

## 3. Ключи

Секреты хранятся только в `.env` или в секретах среды VPS. Файл `.env` добавлен в `.gitignore`.

## 4. Много провайдеров

Каждый провайдер задаётся четырьмя переменными:

- `AI_PROVIDER_N_ENABLED`
- `AI_PROVIDER_N_BASE_URL`
- `AI_PROVIDER_N_API_KEY`
- `AI_PROVIDER_N_MODEL`

Формат API должен быть совместим с `POST /chat/completions`.

Позже для конкретной бесплатной нейросети можно добавить отдельный адаптер, если её API не совместим с OpenAI.

## Команды

- `/start` — запуск.
- `/help` — помощь.
- `/status` — статус конфигурации.
- `/reset` — очистка контекста текущего чата.

## Безопасность

Никогда не коммить Telegram bot token, API keys или реальные значения `.env`.
