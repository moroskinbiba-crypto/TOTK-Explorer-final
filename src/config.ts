import { z } from "zod";

const env = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_ADMIN_IDS: z.string().default(""),
  ENABLE_WHITELIST: z.coerce.boolean().default(false),
  BOT_SYSTEM_PROMPT: z.string().default("You are a helpful Telegram assistant."),
  MAX_HISTORY_MESSAGES: z.coerce.number().int().min(2).max(50).default(12),
  MAX_REPLY_LENGTH: z.coerce.number().int().min(200).max(4000).default(3500),
  TYPING_DELAY_MS: z.coerce.number().int().min(0).max(5000).default(700),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(120).default(20),
  AI_PROVIDER_1_ENABLED: z.coerce.boolean().default(false),
  AI_PROVIDER_1_NAME: z.string().default("provider1"),
  AI_PROVIDER_1_BASE_URL: z.string().default(""),
  AI_PROVIDER_1_API_KEY: z.string().default(""),
  AI_PROVIDER_1_MODEL: z.string().default(""),
  AI_PROVIDER_2_ENABLED: z.coerce.boolean().default(false),
  AI_PROVIDER_2_NAME: z.string().default("provider2"),
  AI_PROVIDER_2_BASE_URL: z.string().default(""),
  AI_PROVIDER_2_API_KEY: z.string().default(""),
  AI_PROVIDER_2_MODEL: z.string().default(""),
  AI_PROVIDER_3_ENABLED: z.coerce.boolean().default(false),
  AI_PROVIDER_3_NAME: z.string().default("provider3"),
  AI_PROVIDER_3_BASE_URL: z.string().default(""),
  AI_PROVIDER_3_API_KEY: z.string().default(""),
  AI_PROVIDER_3_MODEL: z.string().default(""),
  LOG_LEVEL: z.string().default("info")
}).parse(process.env);

const provider = (index: 1 | 2 | 3) => ({
  enabled: env[`AI_PROVIDER_${index}_ENABLED`],
  name: env[`AI_PROVIDER_${index}_NAME`],
  baseUrl: env[`AI_PROVIDER_${index}_BASE_URL`].replace(/\\/$/, ""),
  apiKey: env[`AI_PROVIDER_${index}_API_KEY`],
  model: env[`AI_PROVIDER_${index}_MODEL`]
});

export const config = {
  telegramToken: env.TELEGRAM_BOT_TOKEN,
  adminIds: new Set(env.TELEGRAM_ADMIN_IDS.split(",").map(v => v.trim()).filter(Boolean)),
  whitelistEnabled: env.ENABLE_WHITELIST,
  systemPrompt: env.BOT_SYSTEM_PROMPT,
  maxHistoryMessages: env.MAX_HISTORY_MESSAGES,
  maxReplyLength: env.MAX_REPLY_LENGTH,
  typingDelayMs: env.TYPING_DELAY_MS,
  rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
  providers: [provider(1), provider(2), provider(3)].filter(p => p.enabled && p.baseUrl && p.apiKey && p.model),
  logLevel: env.LOG_LEVEL
} as const;
