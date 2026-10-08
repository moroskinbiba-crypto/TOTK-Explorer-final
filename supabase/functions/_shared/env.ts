export type AiProvider = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function optional(name: string): string | undefined {
  const value = Deno.env.get(name)?.trim();
  return value || undefined;
}

function intEnv(name: string, fallback: number): number {
  const value = optional(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

export function supabaseUrl(): string {
  return required("SUPABASE_URL");
}

export function supabaseAdminKey(): string {
  const keyMap = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const key = keyMap.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("No Supabase secret/admin key is available");
  return key;
}

export function telegramBotToken(): string {
  return required("TELEGRAM_BOT_TOKEN");
}

export function telegramWebhookSecret(): string | undefined {
  return optional("TELEGRAM_WEBHOOK_SECRET");
}

export function telegramApiId(): number {
  const value = intEnv("TELEGRAM_API_ID", 0);
  if (value <= 0) throw new Error("TELEGRAM_API_ID is not configured");
  return value;
}

export function telegramApiHash(): string {
  return required("TELEGRAM_API_HASH");
}

export function telegramSession(): string {
  return required("TELEGRAM_SESSION");
}

export function adminTelegramIds(): Set<string> {
  return new Set(
    (Deno.env.get("TELEGRAM_ADMIN_IDS") || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );
}

export function maxReplyLength(): number {
  return intEnv("MAX_REPLY_LENGTH", 3500);
}

export function maxContextMessages(): number {
  return Math.max(10, Math.min(100, intEnv("MAX_CONTEXT_MESSAGES", 40)));
}

export function syncBatchSize(): number {
  return Math.max(50, Math.min(500, intEnv("SYNC_BATCH_SIZE", 200)));
}

export function initialHistoryLimit(): number {
  return Math.max(100, Math.min(2000, intEnv("INITIAL_HISTORY_LIMIT", 500)));
}

export function styleRefreshHours(): number {
  return Math.max(1, Math.min(168, intEnv("STYLE_REFRESH_HOURS", 24)));
}

export function providers(): AiProvider[] {
  const out: AiProvider[] = [];
  for (let i = 1; i <= 3; i++) {
    const enabled = ["1", "true", "yes", "on"].includes(
      (Deno.env.get(`AI_PROVIDER_${i}_ENABLED`) || "").toLowerCase(),
    );
    const baseUrl = optional(`AI_PROVIDER_${i}_BASE_URL`);
    const apiKey = optional(`AI_PROVIDER_${i}_API_KEY`);
    const model = optional(`AI_PROVIDER_${i}_MODEL`);

    if (enabled && baseUrl && apiKey && model) {
      out.push({
        name: optional(`AI_PROVIDER_${i}_NAME`) || `provider${i}`,
        baseUrl: baseUrl.replace(/\/$/, ""),
        apiKey,
        model,
      });
    }
  }

  if (out.length === 0) throw new Error("No AI provider is configured");
  return out;
}
