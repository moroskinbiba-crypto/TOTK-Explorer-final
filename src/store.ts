import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Message = { role: "user" | "assistant"; content: string };
type State = Record<string, { history: Message[]; requests: number[] }>;

const filePath = resolve(process.env.DATA_DIR || "./data", "history.json");
const initialState: State = {};

if (!existsSync(dirname(filePath))) mkdirSync(dirname(filePath), { recursive: true });

let state: State = {};
try {
  if (existsSync(filePath)) {
    state = JSON.parse(readFileSync(filePath, "utf8")) as State;
  } else {
    writeFileSync(filePath, JSON.stringify(initialState), "utf8");
  }
} catch {
  state = {};
}

function save(): void {
  writeFileSync(filePath, JSON.stringify(state), "utf8");
}

export function getHistory(chatId: string, maxMessages: number): Message[] {
  return (state[chatId]?.history ?? []).slice(-maxMessages);
}

export function addMessage(chatId: string, message: Message, maxMessages: number): void {
  const current = state[chatId] ?? { history: [], requests: [] };
  current.history = [...current.history, message].slice(-maxMessages);
  state[chatId] = current;
  save();
}

export function resetHistory(chatId: string): void {
  if (!state[chatId]) return;
  state[chatId].history = [];
  save();
}

export function isRateLimited(chatId: string, limit: number): boolean {
  const now = Date.now();
  const current = state[chatId] ?? { history: [], requests: [] };
  current.requests = current.requests.filter((ts) => now - ts < 60_000);
  current.requests.push(now);
  state[chatId] = current;
  save();
  return current.requests.length > limit;
}
