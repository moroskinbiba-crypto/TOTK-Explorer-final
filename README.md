# Telegram Personal AI Assistant

Это отдельный режим проекта для личного Telegram AI-ассистента. VPS не нужен. Основная инфраструктура — Supabase Edge Functions + Supabase Postgres; Vercel для этой версии тоже не требуется.

## Что делает система

1. Telegram user-client (MTProto) читает историю выбранных личных чатов.
2. История сохраняется в Supabase.
3. Для каждого выбранного чата строится рабочее саммари: тема разговора, договорённости, открытые вопросы и задачи.
4. Из твоих исходящих сообщений строится профиль стиля: язык, тон, длина, пунктуация, эмодзи и характерные обороты.
5. Telegram Business bot получает новые Business-сообщения и может подготовить ответ с учётом истории, саммари и твоего стиля.
6. В личных чатах по умолчанию включён только режим наблюдения. Автоматическая отправка от имени обычного личного аккаунта не включается.
7. Для Business-чатов доступны режимы observe, suggest, auto, off; безопасный старт — suggest.

## Что уже сделано

- Supabase project: lzogiorclfpmibqmzugg.
- Созданы таблицы telegram_accounts, telegram_chats, telegram_messages, conversation_summaries, ai_suggestions и assistant_settings.
- Для этих таблиц включён RLS.
- Деплоены Edge Functions:
- https://lzogiorclfpmibqmzugg.supabase.co/functions/v1/telegram-business
- https://lzogiorclfpmibqmzugg.supabase.co/functions/v1/telegram-sync
- Создана ветка personal-ai-assistant.
- Telegram session игнорируется Git и хранится локально в файле .telegram-session.

## Шаг 1. Telegram API ID и API hash

Открой https://my.telegram.org → API development tools и создай приложение.
Получи TELEGRAM_API_ID и TELEGRAM_API_HASH.

## Шаг 2. Авторизовать Telegram-аккаунт

Нужен Node.js 22+.

Клонирование:

~~~bash
git clone -b personal-ai-assistant https://github.com/moroskinbiba-crypto/TOTK-Explorer-final.git
cd TOTK-Explorer-final
npm install
~~~

Linux/macOS:

~~~bash
export TELEGRAM_API_ID="ТВОЙ_API_ID"
export TELEGRAM_API_HASH="ТВОЙ_API_HASH"
npm run telegram:login
~~~

Windows PowerShell:

~~~powershell
$env:TELEGRAM_API_ID="ТВОЙ_API_ID"
$env:TELEGRAM_API_HASH="ТВОЙ_API_HASH"
npm run telegram:login
~~~

Скрипт спросит номер телефона, код Telegram и при необходимости пароль 2FA. Вводи их только в своём терминале.
После авторизации появится .telegram-session. Не отправляй его мне и никому не публикуй.

Проверка:

~~~bash
npm run telegram:check
~~~

Эта команда также покажет твой Telegram numeric ID. Он понадобится в TELEGRAM_ADMIN_IDS.

## Шаг 3. Telegram Business bot

В @BotFather создай бота или используй уже существующего и включи для него Business/connected-bot функциональность.
На аккаунте Telegram открой Settings → Telegram Business → Connected bots, подключи этого бота и выдай право отвечать на нужные Business-чаты.

## Шаг 4. Секреты Supabase

Открой Supabase → Edge Function Secrets. Supabase позволяет задавать production secrets через Dashboard или CLI; функции получают их через Deno.env.get().

Нужно добавить:

~~~text
TELEGRAM_BOT_TOKEN
TELEGRAM_ADMIN_IDS
TELEGRAM_WEBHOOK_SECRET
TELEGRAM_API_ID
TELEGRAM_API_HASH
TELEGRAM_SESSION

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

Для TELEGRAM_SESSION вставь содержимое .telegram-session.
Для TELEGRAM_ADMIN_IDS вставь numeric ID из npm run telegram:check.
Для AI достаточно одного OpenAI-compatible провайдера. Остальные используются как fallback.
Не создавай имена секретов с префиксом SUPABASE_: он зарезервирован Supabase.

## Шаг 5. Telegram webhook

Business function уже развернута:

https://lzogiorclfpmibqmzugg.supabase.co/functions/v1/telegram-business

Сгенерируй длинный случайный TELEGRAM_WEBHOOK_SECRET и сохрани тот же секрет в Supabase.
После этого локально выполни:

~~~bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://lzogiorclfpmibqmzugg.supabase.co/functions/v1/telegram-business" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  --data-urlencode 'allowed_updates=["business_connection","business_message","edited_business_message","deleted_business_messages","message","callback_query"]'
~~~

Токен и secret подставляй только локально.

## Шаг 6. Синхронизация каждую минуту

Supabase поддерживает pg_cron + pg_net для периодического вызова Edge Functions, включая интервал раз в минуту.
В Supabase SQL Editor выполни:

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
    body := '{"action":"sync","source":"cron"}'::jsonb
  );
  $cron$
);
~~~

Внутренний токен для синхронизации уже создан в базе; тебе его вводить не нужно.

## Шаг 7. Первый запуск

Напиши своему Business-боту:

~~~text
/status
~~~

Потом:

~~~text
/discover
~~~

Бот покажет найденные диалоги и numeric ID.
Нужные личные чаты добавляй вручную:

~~~text
/watch CHAT_ID
~~~

После этого:

~~~text
/sync
~~~

Система загрузит историю выбранных чатов, построит саммари и начнёт собирать профиль твоего стиля.
Личные чаты не добавляются автоматически.

## Шаг 8. Обучение стилю

Профиль стиля строится по твоим исходящим сообщениям. Для нормального первого профиля желательно иметь хотя бы несколько десятков твоих сообщений среди отслеживаемых чатов.

Учитываются язык, длина, пунктуация, эмодзи, приветствия, окончания, характерные обороты и степень формальности.

## Шаг 9. Business-режим

Безопасный режим:

~~~text
/mode suggest
~~~

Новое Business-сообщение → AI анализирует историю и стиль → тебе приходит предложенный ответ → кнопка Отправить публикует его от имени Business-аккаунта.

Только после тестирования можно включить:

~~~text
/mode auto
~~~

auto касается только Business-чатов с Business Connection.

## Личные сообщения

Эта версия намеренно не делает автоматическую отправку от имени твоего обычного личного Telegram-аккаунта.
Она умеет читать историю выбранных чатов, сохранять сообщения, делать саммари, учиться стилю и использовать этот контекст при создании Business-ответов.

## Проверка

CI проверяет TypeScript-часть проекта на GitHub. Обе Edge Functions уже развернуты в Supabase.
После добавления секретов проверь:

~~~text
/status
/discover
/watch CHAT_ID
/sync
~~~

Потом напиши тестовое сообщение в подключённый Business-чат и убедись, что в suggest появляется предложение ответа.

## Что не нужно

- VPS.
- Docker.
- Отдельный постоянно работающий сервер.
- Vercel.
- Ручное хранение истории на диске.

Supabase выполняет роль базы данных и serverless backend.

## Безопасность

Никогда не коммить Telegram Bot Token, Telegram API hash, Telegram user session или AI API keys.
Особенно критичен TELEGRAM_SESSION: это авторизованная сессия Telegram user-client.