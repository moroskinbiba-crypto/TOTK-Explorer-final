import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { BusinessConnection } from "grammy/types";

type Message = { role: "user" | "assistant"; content: string };

export type BusinessConnectionState = {
  id: string;
  userId: string;
  userChatId: string;
  isEnabled: boolean;
  canReply: boolean;
  updatedAt: number;
};

export type PendingSuggestion = {
  id: string;
  connectionId: string;
  chatId: string;
  customerText: string;
  replyText: string;
  createdAt: number;
};

type State = {
  conversations: Record<string, { history: Message[]; requests: number[] }>;
  connections: Record<string, BusinessConnectionState>;
  pendingSuggestions: Record<string, PendingSuggestion>;
  blockedChats: Record<string, true>;
};

const filePath = resolve(process.env.DATA_DIR || "./data", "history.json");

if (!existsSync(dirname(filePath))) mkdirSync(dirname(filePath), { recursive: true });

let state: State = {
  conversations: {},
  connections: {},
  pendingSuggestions: {},
  blockedChats: {},
};

try {
  if (existsSync(filePath)) {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<State>;
    state = {
      conversations: parsed.conversations ?? {},
      connections: parsed.connections ?? {},
      pendingSuggestions: parsed.pendingSuggestions ?? {},
      blockedChats: parsed.blockedChats ?? {},
    };
  }
} catch {
  state = { conversations: {}, connections: {}, pendingSuggestions: {}, blockedChats: {} };
}

function save(): void {
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(state), "utf8");
  renameSync(temporaryPath, filePath);
}

export function businessConversationKey(connectionId: string, chatId: string): string {
  return `business:${connectionId}:${chatId}`;
}

export function privateConversationKey(chatId: string): string {
  return `private:${chatId}`;
}

export function getHistory(conversationId: string, maxMessages: number): Message[] {
  return (state.conversations[conversationId]?.history ?? []).slice(-maxMessages);
}

export function addMessage(conversationId: string, message: Message, maxMessages: number): void {
  const current = state.conversations[conversationId] ?? { history: [], requests: [] };
  current.history = [...current.history, message].slice(-maxMessages);
  state.conversations[conversationId] = current;
  save();
}

export function resetHistory(conversationId: string): void {
  const current = state.conversations[conversationId];
  if (!current) return;
  current.history = [];
  save();
}

export function resetConversationsForChat(chatId: string): number {
  let changed = 0;
  const suffix = `:${chatId}`;
  for (const [key, value] of Object.entries(state.conversations)) {
    if (key.startsWith("business:") && key.endsWith(suffix) && value.history.length > 0) {
      value.history = [];
      changed += 1;
    }
  }
  if (changed > 0) save();
  return changed;
}

export function isRateLimited(conversationId: string, limit: number): boolean {
  const now = Date.now();
  const current = state.conversations[conversationId] ?? { history: [], requests: [] };
  current.requests = current.requests.filter((timestamp) => now - timestamp < 60_000);
  current.requests.push(now);
  state.conversations[conversationId] = current;
  save();
  return current.requests.length > limit;
}

export function saveBusinessConnection(connection: BusinessConnection): void {
  state.connections[connection.id] = {
    id: connection.id,
    userId: String(connection.user.id),
    userChatId: String(connection.user_chat_id),
    isEnabled: connection.is_enabled,
    canReply: connection.rights?.can_reply === true,
    updatedAt: Date.now(),
  };
  save();
}

export function getBusinessConnection(id: string): BusinessConnectionState | undefined {
  return state.connections[id];
}

export function getBusinessConnections(): BusinessConnectionState[] {
  return Object.values(state.connections);
}

export function setBlockedChat(chatId: string, blocked: boolean): void {
  if (blocked) state.blockedChats[chatId] = true;
  else delete state.blockedChats[chatId];
  save();
}

export function isChatBlocked(chatId: string): boolean {
  return state.blockedChats[chatId] === true;
}

export function createSuggestion(input: Omit<PendingSuggestion, "id">): PendingSuggestion {
  const suggestion: PendingSuggestion = { id: randomUUID(), ...input };
  state.pendingSuggestions[suggestion.id] = suggestion;
  save();
  return suggestion;
}

export function getSuggestion(id: string): PendingSuggestion | undefined {
  return state.pendingSuggestions[id];
}

export function deleteSuggestion(id: string): void {
  if (!state.pendingSuggestions[id]) return;
  delete state.pendingSuggestions[id];
  save();
}
