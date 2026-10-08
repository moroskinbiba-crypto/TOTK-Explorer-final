type Message = { role: "user" | "assistant"; content: string };

const histories = new Map<string, Message[]>();
const requests = new Map<string, number[]>();

export function getHistory(chatId: string, maxMessages: number): Message[] {
  return (histories.get(chatId) ?? []).slice(-maxMessages);
}

export function addMessage(chatId: string, message: Message, maxMessages: number): void {
  const next = [...(histories.get(chatId) ?? []), message].slice(-maxMessages);
  histories.set(chatId, next);
}

export function resetHistory(chatId: string): void {
  histories.delete(chatId);
}

export function isRateLimited(chatId: string, limit: number): boolean {
  const now = Date.now();
  const recent = (requests.get(chatId) ?? []).filter(ts => now - ts < 60_000);
  recent.push(now);
  requests.set(chatId, recent);
  return recent.length > limit;
}
