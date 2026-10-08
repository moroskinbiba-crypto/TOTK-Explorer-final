# Telegram Business AI Auto-Replier

AI-автоответчик для Telegram Business connected bot / Secretary Mode. Бот получает сообщения клиентов через Business Connection и отвечает от имени вашего Telegram Business аккаунта.

## Возможности

- Telegram Business / connected bot.
- Business Connection, business_message, edited_business_message и deleted_business_messages.
- Ответ клиенту от имени бизнес-аккаунта через business_connection_id.
- Отдельный AI-контекст для каждого клиента и Business Connection.
- До трёх OpenAI-compatible AI-провайдеров с автоматическим fallback.
- Режимы auto, suggest и off.
- Rate limit, защита от циклов и блокировка отдельных клиентов.
- Whitelist/blacklist клиентов через .env.
- Сохранение состояния на VPS в data/history.json.
- Docker Compose и обычный Node.js запуск.
- Секреты не хранятся в Git.

## Подключение Telegram Business

### 1. Включить режим Business у бота

В @BotFather открой настройки бота и включи Business Mode / Secretary Mode. Токен хранится только на сервере в .env.

### 2. Подключить бота к бизнес-аккаунту

На аккаунте, который будет обслуживаться, открой Telegram Settings → Telegram Business → раздел подключаемых ботов.

Выбери своего бота, выдай ему право Reply to messages и укажи, какие чаты он может обслуживать и какие чаты нужно исключить.

После подключения Telegram создаёт Business Connection. Входящие сообщения клиентов приходят как business_message. Для ответа используется соответствующий business_connection_id, поэтому клиент видит сообщение как отправленное бизнес-аккаунтом, а не отдельным ботом.

### 3. Запуск на VPS

Требуется Node.js 22+.

~~~bash
git clone <repository-url>
cd TOTK-Explorer-final
cp .env.example .env
nano .env
npm install
npm run check
npm run build
npm start
~~~

Docker:

~~~bash
cp .env.example .env
nano .env
docker compose up -d --build
docker compose logs -f bot
~~~

Long polling уже подходит для Business updates, поэтому для первого запуска не нужны домен и HTTPS.

## AI-провайдеры

Для каждого провайдера доступны:

- AI_PROVIDER_N_ENABLED
- AI_PROVIDER_N_NAME
- AI_PROVIDER_N_BASE_URL
- AI_PROVIDER_N_API_KEY
- AI_PROVIDER_N_MODEL

API должен поддерживать POST {BASE_URL}/chat/completions. Если один провайдер недоступен, бот пробует следующий.

## Управление

Укажи свой Telegram numeric ID в TELEGRAM_ADMIN_IDS и напиши самому боту:

- /status — статус Business и AI.
- /auto on или /auto off — глобально включить или выключить автоответы до следующего рестарта.
- /mode auto — отвечать автоматически.
- /mode suggest — генерировать ответ и ждать подтверждения владельца.
- /mode off — не отвечать автоматически.
- /block CHAT_ID — исключить клиента.
- /unblock CHAT_ID — вернуть клиента.
- /reset CHAT_ID — очистить AI-контекст клиента.
- /help — справка.

## Режим suggest

В режиме suggest клиент не получает ответ сразу. AI-ответ приходит в личный чат владельца с ботом вместе с кнопками Отправить и Отклонить.

После подтверждения бот вызывает sendMessage с business_connection_id и отправляет текст клиенту от имени Business-аккаунта.

## Первый тест

1. Запусти сервис и выполни /status.
2. Убедись, что Business Connection сохранён и имеет право отвечать.
3. Напиши бизнес-аккаунту с другого Telegram-аккаунта.
4. В режиме auto клиент должен получить ответ от имени бизнес-аккаунта.
5. В режиме suggest сначала появится предложение в личном чате владельца.

## Безопасность

Никогда не коммить Telegram token или AI API keys. Используй .env, секреты VPS или другой secret manager.

При переносе на новый VPS перенеси репозиторий, .env и каталог data, затем запусти Docker Compose или npm start.

CI smoke verification: TypeScript check and production build are run on pull requests and main pushes.
