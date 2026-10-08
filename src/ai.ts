import { config } from "./config.js";
import { generateOpenAICompatible } from "./providers/openai-compatible.js";

type HistoryMessage = { role: "user" | "assistant"; content: string };

export async function generateReply(history: HistoryMessage[], userText: string): Promise<{ text: string; provider: string }> {
  const messages = [
    { role: "system" as const, content: config.systemPrompt },
    ...history,
    { role: "user" as const, content: userText }
  ];

  if (config.providers.length === 0) {
    throw new Error("No AI providers are configured");
  }

  const errors: string[] = [];
  for (const provider of config.providers) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45_000);

      try {
        const raw = await generateOpenAICompatible(provider, messages, controller.signal);
        const text = raw.slice(0, config.maxReplyLength);
        return { text, provider: provider.name };
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`All AI providers failed: ${errors.join(" | ")}`);
}
