import { z } from "zod";

const boolFromEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid boolean environment value: ${value}`);
};

const env = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_ADMIN_IDS: z.string().default(""),
  BOT_SYSTEM_PROMPT: z.string().default("You are a helpful Telegram assistant."),
  MAX_HISTORY_MESSAGES: z.coerce.number().int().min(2).max(50).default(12),
  MAX_REPLY_LENGTH: z.coerce.number().int().min(200).max(4000).default(3500),
  TYPING_DELAY_MS: z.coerce.number().int().min(0).max(5000).default(700),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(120).default(20),
  LOG_LEVEL: z.string().default("info")
}).parse(process.env);

type Provider = {
  enabled: boolean;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

function makeProvider(
  enabledValue: string | undefined,
  nameValue: string | undefined,
  baseUrlValue: string | undefined,
  apiKeyValue: string | undefined,
  modelValue: string | undefined,
  fallbackName: string
): Provider {
  return {
    enabled: boolFromEnv(enabledValue, false),
    name: nameValue?.trim() || fallbackName,
    baseUrl: (baseUrlValue ?? "").trim().replace(/\/$/, ""),
    apiKey: (apiKeyValue ?? "").trim(),
    model: (modelValue ?? "").trim()
  };
}

const providers = [
  makeProvider(process.env.AI_PROVIDER_1_ENABLED, process.env.AI_PROVIDER_1_NAME, process.env.AI_PROVIDER_1_BASE_URL, process.env.AI_PROVIDER_1_API_KEY, process.env.AI_PROVIDER_1_MODEL, "provider1"),
  makeProvider(process.env.AI_PROVIDER_2_ENABLED, process.env.AI_PROVIDER_2_NAME, process.env.AI_PROVIDER_2_BASE_URL, process.env.AI_PROVIDER_2_API_KEY, process.env.AI_PROVIDER_2_MODEL, "provider2"),
  makeProvider(process.env.AI_PROVIDER_3_ENABLED, process.env.AI_PROVIDER_3_NAME, process.env.AI_PROVIDER_3_BASE_URL, process.env.AI_PROVIDER_3_API_KEY, process.env.AI_PROVIDER_3_MODEL, "provider3")
].filter((p) => p.enabled && p.baseUrl && p.apiKey && p.model);

export const config = {
  telegramToken: env.TELEGRAM_BOT_TOKEN,
  adminIds: new Set(env.TELEGRAM_ADMIN_IDS.split(",").map((v) => v.trim()).filter(Boolean)),
  systemPrompt: env.BOT_SYSTEM_PROMPT,
  maxHistoryMessages: env.MAX_HISTORY_MESSAGES,
  maxReplyLength: env.MAX_REPLY_LENGTH,
  typingDelayMs: env.TYPING_DELAY_MS,
  rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
  providers,
  logLevel: env.LOG_LEVEL
} as const;
