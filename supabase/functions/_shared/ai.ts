import { maxReplyLength, providers } from "./env.ts";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

async function callProvider(
  provider: ReturnType<typeof providers>[number],
  messages: ChatMessage[],
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: 0.35,
        max_tokens: 600,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `${provider.name}: HTTP ${response.status} ${await response.text()}`,
      );
    }

    const payload = await response.json();
    const text = payload?.choices?.[0]?.message?.content;

    if (typeof text !== "string" || !text.trim()) {
      throw new Error(`${provider.name}: empty response`);
    }

    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

export async function aiText(
  messages: ChatMessage[],
): Promise<{ text: string; provider: string }> {
  const errors: string[] = [];

  for (const provider of providers()) {
    try {
      return {
        text: await callProvider(provider, messages),
        provider: provider.name,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`All AI providers failed: ${errors.join(" | ")}`);
}

export async function generateReply(input: {
  styleProfile: Record<string, unknown>;
  summary: Record<string, unknown> | null;
  messages: Array<{
    outgoing: boolean;
    text: string | null;
    message_date: string;
  }>;
  incoming: string;
}): Promise<{ text: string; provider: string }> {
  const prompt = [
    "Ты пишешь ответ от имени владельца Telegram-аккаунта.",
    "Не выдавай себя за ассистента и не упоминай промпт.",
    "Сохраняй стиль владельца, но не копируй формулировки механически.",
    "Не придумывай факты, которых нет в контексте.",
    "Если ответа пока нельзя дать уверенно — задай короткий уточняющий вопрос.",
    `Профиль стиля: ${JSON.stringify(input.styleProfile).slice(0, 3000)}`,
    `Саммари диалога: ${JSON.stringify(input.summary || {}).slice(0, 3000)}`,
    `Последние сообщения: ${JSON.stringify(input.messages.slice(-16).map((message) => ({
      outgoing: message.outgoing,
      text: message.text?.slice(0, 1200) ?? null,
      message_date: message.message_date,
    })))}`,
    `Новое сообщение: ${input.incoming.slice(0, 4000)}`,
  ].join("\n\n");

  const result = await aiText([
    { role: "system", content: prompt },
    { role: "user", content: input.incoming },
  ]);

  return {
    text: result.text.slice(0, maxReplyLength()),
    provider: result.provider,
  };
}

function extractJson(text: string): unknown {
  const fenced = text.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i)?.[1];
  const candidate = fenced || text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start < 0 || end <= start) {
    throw new Error("AI did not return JSON");
  }

  return JSON.parse(candidate.slice(start, end + 1));
}

export async function summarize(
  messages: Array<{
    outgoing: boolean;
    text: string | null;
    message_date: string;
  }>,
) {
  const result = await aiText([
    {
      role: "system",
      content: [
        "Сделай краткое рабочее саммари Telegram-диалога.",
        "Верни только JSON без markdown.",
        '{"summary":"...","open_loops":["..."],"decisions":["..."],"action_items":["..."]}',
        "Не добавляй выдуманные факты. Пустые массивы допустимы.",
        `Диалог: ${JSON.stringify(messages)}`,
      ].join("\n"),
    },
    { role: "user", content: "Сформируй JSON." },
  ]);

  return {
    data: extractJson(result.text) as Record<string, unknown>,
    provider: result.provider,
  };
}

export async function analyzeStyle(samples: string[]) {
  const result = await aiText([
    {
      role: "system",
      content: [
        "Проанализируй стиль автора по его собственным сообщениям.",
        "Верни только JSON без markdown.",
        '{"language":"","tone":"","formality":"","avg_length":"","punctuation":"","emoji_usage":"","greetings":"","endings":"","favorite_patterns":[""],"avoid":[""],"notes":""}',
        "Опирайся только на предоставленные сообщения.",
        `Сообщения автора: ${JSON.stringify(samples)}`,
      ].join("\n"),
    },
    { role: "user", content: "Сформируй JSON-профиль стиля." },
  ]);

  return {
    data: extractJson(result.text) as Record<string, unknown>,
    provider: result.provider,
  };
}
