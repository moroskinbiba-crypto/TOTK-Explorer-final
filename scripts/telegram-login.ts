import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, writeFileSync } from "node:process";

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH?.trim();

if (!Number.isInteger(apiId) || apiId <= 0) {
  throw new Error("TELEGRAM_API_ID is missing or invalid");
}
if (!apiHash) throw new Error("TELEGRAM_API_HASH is missing");

const rl = createInterface({ input, output });
const session = new StringSession("");
const client = new TelegramClient(session, apiId, apiHash, {
  connectionRetries: 5,
});

try {
  await client.start({
    phoneNumber: () => rl.question("Telegram phone number: "),
    password: () => rl.question("Telegram 2FA password (blank if none): "),
    phoneCode: () => rl.question("Telegram login code: "),
    onError: (error) => console.error("Telegram auth error:", error),
  });

  const me = await client.getMe();
  const saved = client.session.save();
  writeFileSync(".telegram-session", saved, { encoding: "utf8", mode: 0o600 });

  console.log(
    "\nAuthorized as:",
    me?.username ? `@${me.username}` : `${me?.firstName ?? "Telegram user"}`,
  );
  console.log("Session saved locally to .telegram-session");
  console.log(
    "Copy its contents into the TELEGRAM_SESSION secret in Supabase. Never send this value to anyone.",
  );
} finally {
  rl.close();
  await client.disconnect();
}
