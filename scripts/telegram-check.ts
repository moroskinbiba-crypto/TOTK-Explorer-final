import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { readFileSync } from "node:fs";

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH?.trim();
const session =
  process.env.TELEGRAM_SESSION?.trim() ||
  readFileSync(".telegram-session", "utf8").trim();

if (!Number.isInteger(apiId) || apiId <= 0) {
  throw new Error("TELEGRAM_API_ID is missing or invalid");
}
if (!apiHash) throw new Error("TELEGRAM_API_HASH is missing");
if (!session) throw new Error("TELEGRAM_SESSION is missing");

const client = new TelegramClient(
  new StringSession(session),
  apiId,
  apiHash,
  { connectionRetries: 3 },
);

try {
  await client.connect();
  if (!(await client.isUserAuthorized())) {
    throw new Error("The saved Telegram session is not authorized");
  }

  const me = await client.getMe();
  const dialogs = await client.getDialogs({ limit: 5 });

  console.log(
    JSON.stringify(
      {
        ok: true,
        user: {
          id: me?.id?.toString?.(),
          username: me?.username,
          firstName: me?.firstName,
        },
        sampleDialogs: dialogs.map((dialog) => ({
          id: dialog.id?.toString?.(),
          title: dialog.title,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await client.disconnect();
}
