create table if not exists public.telegram_accounts (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint unique not null,
  username text,
  display_name text,
  style_profile jsonb not null default '{}'::jsonb,
  style_sample_count integer not null default 0,
  style_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.telegram_chats (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint unique not null,
  type text not null,
  title text,
  username text,
  phone text,
  watched boolean not null default false,
  sync_enabled boolean not null default true,
  last_synced_message_id bigint not null default 0,
  last_message_at timestamptz,
  business_connection_id text,
  mode text not null default 'observe',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.telegram_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.telegram_chats(id) on delete cascade,
  telegram_message_id bigint not null,
  sender_telegram_id bigint,
  outgoing boolean not null default false,
  message_date timestamptz not null,
  text text,
  reply_to_message_id bigint,
  created_at timestamptz not null default now(),
  unique(chat_id, telegram_message_id)
);

create table if not exists public.conversation_summaries (
  chat_id uuid primary key references public.telegram_chats(id) on delete cascade,
  summary text not null default '',
  open_loops jsonb not null default '[]'::jsonb,
  decisions jsonb not null default '[]'::jsonb,
  action_items jsonb not null default '[]'::jsonb,
  last_message_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references public.telegram_chats(id) on delete cascade,
  business_connection_id text,
  source_message_id bigint,
  customer_text text,
  reply_text text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.assistant_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_telegram_messages_chat_date
  on public.telegram_messages(chat_id, message_date desc);

create index if not exists idx_telegram_messages_chat_id
  on public.telegram_messages(chat_id, telegram_message_id desc);

create index if not exists idx_telegram_chats_watched
  on public.telegram_chats(watched, sync_enabled);

create index if not exists idx_ai_suggestions_status
  on public.ai_suggestions(status, created_at desc);

alter table public.telegram_accounts enable row level security;
alter table public.telegram_chats enable row level security;
alter table public.telegram_messages enable row level security;
alter table public.conversation_summaries enable row level security;
alter table public.ai_suggestions enable row level security;
alter table public.assistant_settings enable row level security;

insert into public.assistant_settings(key, value)
values ('assistant_mode', '{"personal":"observe","business":"suggest"}'::jsonb)
on conflict(key) do nothing;
