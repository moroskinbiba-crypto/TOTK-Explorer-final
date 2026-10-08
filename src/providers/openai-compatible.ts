export type ProviderConfig = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function generateOpenAICompatible(
  provider: ProviderConfig,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: 0.7
    })
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${provider.name}: HTTP ${response.status} ${body.slice(0, 300)}`);
  }

  const data = JSON.parse(body) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = data.choices?.[0]?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`${provider.name}: empty model response`);
  }

  return content.trim();
}
