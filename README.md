# Telegram Secretary AI

Telegram Business Secretary Bot: AI-ответы, саммари и ручные примеры твоего стиля. **Никакой авторизации личного Telegram-аккаунта нет.** Проект использует только Bot API / Secretary Mode и Supabase Edge Functions.

## Что делает

- Получает новые Business-сообщения только в тех чатах, которые ты разрешил в Telegram Business → Connected Bots.
- Сохраняет полученные сообщения в Supabase и обновляет саммари, договорённости, открытые вопросы и задачи.
- Подготавливает AI-ответ с учётом контекста, саммари и примеров твоего стиля.
- Поддерживает режимы `observe`, `suggest`, `auto`, `off`; безопасный режим по умолчанию — `suggest`.
- Позволяет добавлять примеры твоего стиля командой `/style ТЕКСТ`.

## Ограничение Telegram

Secretary Bot **не может войти в личный аккаунт или выгрузить произвольную старую историю переписок**. Он получает только updates, которые Telegram отправляет подключённому Business-боту по выбранным чатам. Поэтому саммари автоматически собирается с момента подключения; прежние сообщения можно использовать как примеры стиля, вручную добавляя их через `/style`. Код входа Telegram, API ID, API hash и пользовательская сессия не нужны.

## Что уже настроено

- Supabase project: `lzogiorclfpmibqmzugg` (состояние ACTIVE_HEALTHY при последней проверке).
- Таблицы для Business-чатов, сообщений, саммари, AI-предложений и настроек.
- RLS включён на таблицах ассистента.
- Edge Functions:
- `https://lzogiorclfpmibqmzugg.supabase.co/functions/v1/telegram-business`
- `https://lzogiorclfpmibqmzugg.supabase.co/functions/v1/telegram-sync`
- Секрет синхронизации создан внутри `assistant_settings`; он не нужен для ручного ввода.

## Настройка — только необходимые действия

### 1. Включи Secretary Mode

В `@BotFather` создай бота или выбери существующего. В настройках бота включи **Business Mode / Secretary Mode**.

На своём аккаунте Telegram открой **Settings → Telegram Business → Connected Bots**. Подключи бота, выбери существующие/новые чаты, которые разрешаешь ему обрабатывать, и выдай право `Reply to messages` / `can_reply`.

Параметры получателей в Telegram Business — это основной список разрешённых чатов. `/watch` не способен дать боту доступ к чату, который ты не разрешил на стороне Telegram.

### 2. Добавь секреты в Supabase

В Supabase Dashboard открой проект → **Edge Functions → Secrets** и добавь:

~~~text
TELEGRAM_BOT_TOKEN
TELEGRAM_ADMIN_IDS
TELEGRAM_WEBHOOK_SECRET

AI_PROVIDER_1_ENABLED=true
AI_PROVIDER_1_NAME=...
AI_PROVIDER_1_BASE_URL=...
AI_PROVIDER_1_API_KEY=...
AI_PROVIDER_1_MODEL=...

AI_PROVIDER_2_ENABLED=false
AI_PROVIDER_2_NAME=...
AI_PROVIDER_2_BASE_URL=...
AI_PROVIDER_2_API_KEY=...
AI_PROVIDER_2_MODEL=...

AI_PROVIDER_3_ENABLED=false
AI_PROVIDER_3_NAME=...
AI_PROVIDER_3_BASE_URL=...
AI_PROVIDER_3_API_KEY=...
AI_PROVIDER_3_MODEL=...
~~~

Где взять значения:

- `TELEGRAM_BOT_TOKEN` — в `@BotFather`.
- `TELEGRAM_ADMIN_IDS` — твой числовой Telegram ID; его можно узнать у бота вроде `@userinfobot`.
- `TELEGRAM_WEBHOOK_SECRET` — сгенерируй длинную случайную строку и сохрани её только в Supabase и локально на время установки webhook.
- AI provider — любой совместимый с OpenAI Chat Completions API. Достаточно одного, остальные необязательны.

Не добавляй `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` или `TELEGRAM_SESSION`: эта архитектура их не использует.

### 3. Установи webhook

Функция уже развёрнута:

`https://lzogiorclfpmibqmzugg.supabase.co/functions/v1/telegram-business`

В своей командной строке выполни, подставив значения из своих секретов:

~~~bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://lzogiorclfpmibqmzugg.supabase.co/functions/v1/telegram-business" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  --data-urlencode 'allowed_updates=["business_connection","business_message","edited_business_message","deleted_business_messages","message","callback_query"]'
~~~

Никогда не публикуй токен или webhook secret в репозитории.

### 4. Включи регулярное обновление саммари

В Supabase **SQL Editor** выполни один раз:

~~~sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'telegram-assistant-sync') then
    perform cron.unschedule('telegram-assistant-sync');
  end if;
end
$$;

select cron.schedule(
  'telegram-assistant-sync',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://lzogiorclfpmibqmzugg.supabase.co/functions/v1/telegram-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Assistant-Sync-Secret',
      (select value->>'secret' from public.assistant_settings where key='sync_token')
    ),
    body := '{"action":"sync"}'::jsonb
  );
  $cron$
);
~~~

### 5. Первый запуск

Открой чат со своим ботом и выполни:

~~~text
/start
/status
~~~

Убедись, что бот уже подключён в Telegram Business. Напиши тестовое сообщение со второго аккаунта в один из разрешённых чатов — после этого диалог появится в `/chats`.

## Команды

- `/status` — состояние и счётчики.
- `/chats` — Business-чаты, по которым Telegram уже передал сообщения.
- `/summary CHAT_ID` — показать саммари конкретного чата.
- `/sync` — обновить саммари вручную.
- `/style ТЕКСТ` — добавить пример того, как ты обычно пишешь.
- `/style reset` — очистить ручные примеры.
- `/mode observe` — только наблюдать, не отвечать.
- `/mode suggest` — предлагать ответ тебе на подтверждение.
- `/mode auto` — отвечать автоматически в разрешённых Business-чатах.
- `/mode off` — отключить ответы.

Для первого теста оставь `/mode suggest`. Когда приходит новое сообщение, бот предлагает ответ с кнопками «Отправить» и «Отклонить».

## Обучение стилю

Поскольку Secretary Bot не получает старую историю задним числом, добавь несколько обычных сообщений, написанных тобой, например:

~~~text
/style Да, давай, мне такой вариант подходит
/style Привет! Я посмотрю сегодня и напишу тебе вечером
/style Не уверен, что это получится сделать к этому сроку. Давай обсудим другой вариант
~~~

Используй реальные примеры своего стиля, а не обязательно эти тексты. После трёх или более образцов выполни `/sync`. Новые сообщения, если Telegram доставляет их как owner-authored Business updates, тоже могут использоваться как примеры; AI-ответы помечаются отдельно и не считаются образцами твоего стиля.

## Что не нужно

- VPS;
- Vercel;
- Docker;
- логин в твой личный Telegram;
- код SMS/Telegram, API ID, API hash или `.telegram-session`.

Основная инфраструктура — Telegram Secretary Bot + Supabase Edge Functions/Postgres.
