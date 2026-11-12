-- DOUALA AI — initial schema
-- Apply with the Supabase SQL editor or: psql "$DATABASE_URL" -f supabase/migrations/0001_initial.sql
-- The backend uses the SERVICE ROLE key, which bypasses RLS. RLS below denies all
-- access to anon/authenticated roles so that nothing is readable through the public API
-- without going through the backend. Adjust policies when you add Supabase Auth.

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
-- pgvector is optional; enable it when adding embeddings (see 0002_embeddings.sql).

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
do $$ begin
  create type knowledge_category as enum ('vocabulary','expression','grammar_rule','conjugation_rule','sentence_example','translation_pair','contextual_meaning','language_variant');
exception when duplicate_object then null; end $$;
do $$ begin
  create type knowledge_origin as enum ('verified_source','extracted_unverified','ai_suggestion','user_correction');
exception when duplicate_object then null; end $$;
do $$ begin
  create type validation_status as enum ('pending','verified','rejected');
exception when duplicate_object then null; end $$;
do $$ begin
  create type source_reliability as enum ('academic','institutional','established','community','unknown');
exception when duplicate_object then null; end $$;
do $$ begin
  create type correction_status as enum ('pending','approved','rejected');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- languages
-- ---------------------------------------------------------------------------
create table if not exists languages (
  code        text primary key,                 -- 'en', 'fr', 'dua'
  iso6393     text not null,
  name        text not null,
  native_name text not null,
  is_source   boolean not null default false,
  is_target   boolean not null default false,
  glottocode  text,
  region      text,
  created_at  timestamptz not null default now()
);
insert into languages (code, iso6393, name, native_name, is_source, is_target, glottocode, region) values
  ('en','eng','English','English',true,false,null,null),
  ('fr','fra','French','Français',true,false,null,null),
  ('dua','dua','Douala','Duálá',false,true,'dual1243','Littoral Region, Cameroon')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- linguistic_sources
-- ---------------------------------------------------------------------------
create table if not exists linguistic_sources (
  id               text primary key,
  name             text not null,
  url              text,
  type             text not null check (type in ('online_dictionary','bilingual_dictionary','grammar','translation_platform','academic_publication','corpus','vocabulary_database','educational','manual_entry','community','other')),
  reliability      source_reliability not null default 'unknown',
  languages        text[] not null default '{}',
  accessibility    text not null default 'unknown' check (accessibility in ('public','restricted','offline','unknown','blocked_in_build_environment')),
  license          text,
  notes            text,
  ingestion_status text not null default 'not_ingested' check (ingestion_status in ('not_ingested','ingested','partial','failed')),
  last_ingested_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- linguistic_knowledge: unified table for vocabulary, expressions, grammar rules,
-- examples and translation pairs (discriminated by `category`). Views below expose
-- the familiar per-entity names.
-- ---------------------------------------------------------------------------
create table if not exists linguistic_knowledge (
  id                     uuid primary key default gen_random_uuid(),
  source_language        text not null references languages(code),
  target_language        text not null references languages(code),
  source_text            text not null check (char_length(source_text) between 1 and 2000),
  source_text_normalized text not null,
  target_text            text check (target_text is null or char_length(target_text) <= 2000),
  category               knowledge_category not null default 'vocabulary',
  context                text,
  example                text,
  note                   text,
  source_id              text references linguistic_sources(id) on delete set null,
  source_name            text not null,
  source_url             text,
  reference              text,
  origin                 knowledge_origin not null default 'extracted_unverified',
  validation_status      validation_status not null default 'pending',
  reliability            source_reliability not null default 'unknown',
  tags                   text[] not null default '{}',
  extracted_at           timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint verified_requires_target check (validation_status <> 'verified' or target_text is not null)
);
create index if not exists idx_knowledge_lookup on linguistic_knowledge (target_language, source_language, source_text_normalized);
create index if not exists idx_knowledge_fts on linguistic_knowledge using gin (to_tsvector('simple', source_text_normalized));
create index if not exists idx_knowledge_trgm on linguistic_knowledge using gin (source_text_normalized gin_trgm_ops);
create index if not exists idx_knowledge_status on linguistic_knowledge (validation_status, origin);
create index if not exists idx_knowledge_source on linguistic_knowledge (source_id);

create or replace view vocabulary as select * from linguistic_knowledge where category = 'vocabulary';
create or replace view expressions as select * from linguistic_knowledge where category = 'expression';
create or replace view grammar_rules as select * from linguistic_knowledge where category in ('grammar_rule','conjugation_rule');
create or replace view translation_pairs as select * from linguistic_knowledge where category in ('translation_pair','sentence_example');

-- ---------------------------------------------------------------------------
-- corrections (community) + reviews
-- ---------------------------------------------------------------------------
create table if not exists corrections (
  id                   uuid primary key default gen_random_uuid(),
  client_id            text not null check (char_length(client_id) between 8 and 64),
  source_language      text not null references languages(code),
  target_language      text not null references languages(code),
  source_text          text not null check (char_length(source_text) between 1 and 2000),
  ai_translation       text,
  proposed_translation text not null check (char_length(proposed_translation) between 1 and 2000),
  explanation          text check (explanation is null or char_length(explanation) <= 1000),
  context              text not null default 'other',
  domain               text,
  status               correction_status not null default 'pending',
  review_note          text,
  knowledge_entry_id   uuid references linguistic_knowledge(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_corrections_client on corrections (client_id, created_at desc);
create index if not exists idx_corrections_status on corrections (status, created_at desc);

create table if not exists correction_reviews (
  id            uuid primary key default gen_random_uuid(),
  correction_id uuid not null references corrections(id) on delete cascade,
  reviewer      text not null,
  decision      correction_status not null check (decision in ('approved','rejected')),
  note          text,
  created_at    timestamptz not null default now()
);

create table if not exists correction_votes (
  correction_id uuid not null references corrections(id) on delete cascade,
  client_id     text not null,
  vote          smallint not null check (vote in (-1, 1)),
  created_at    timestamptz not null default now(),
  primary key (correction_id, client_id)
);

-- ---------------------------------------------------------------------------
-- translation_history (no page content, only aggregate metadata)
-- ---------------------------------------------------------------------------
create table if not exists translation_history (
  id               uuid primary key default gen_random_uuid(),
  client_id        text not null,
  domain           text not null,
  source_language  text not null references languages(code),
  target_language  text not null references languages(code),
  translated_count integer not null default 0 check (translated_count >= 0),
  uncertain_count  integer not null default 0 check (uncertain_count >= 0),
  status           text not null check (status in ('completed','partial','failed')),
  created_at       timestamptz not null default now()
);
create index if not exists idx_history_client on translation_history (client_id, created_at desc);

-- ---------------------------------------------------------------------------
-- user_settings (optional server-side sync; the extension stores settings locally by default)
-- ---------------------------------------------------------------------------
create table if not exists user_settings (
  client_id                 text primary key,
  source_language           text not null default 'auto',
  target_language           text not null default 'dua' references languages(code),
  auto_detect               boolean not null default true,
  translate_dynamic_content boolean not null default true,
  corrections_enabled       boolean not null default true,
  keep_history              boolean not null default true,
  updated_at                timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- api_usage (monitoring, cost control)
-- ---------------------------------------------------------------------------
create table if not exists api_usage (
  id            bigserial primary key,
  client_id     text,
  provider      text not null,
  model         text not null,
  tier          text not null,
  items         integer not null default 0,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  duration_ms   integer not null default 0,
  ok            boolean not null default true,
  error         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_api_usage_created on api_usage (created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['linguistic_sources','linguistic_knowledge','corrections','user_settings'] loop
    execute format('drop trigger if exists trg_%s_updated on %s', t, t);
    execute format('create trigger trg_%s_updated before update on %s for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- Keep source_text_normalized in sync when rows are written directly in SQL.
create or replace function normalize_source_text() returns trigger language plpgsql as $$
begin
  new.source_text_normalized = regexp_replace(lower(unaccent_safe(new.source_text)), '[^a-z0-9'' ]+', ' ', 'g');
  new.source_text_normalized = btrim(regexp_replace(new.source_text_normalized, '\s+', ' ', 'g'));
  return new;
end $$;
create or replace function unaccent_safe(t text) returns text language plpgsql immutable as $$
begin
  return translate(t, 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ', 'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY');
end $$;
drop trigger if exists trg_knowledge_normalize on linguistic_knowledge;
create trigger trg_knowledge_normalize before insert or update of source_text on linguistic_knowledge for each row execute function normalize_source_text();

-- ---------------------------------------------------------------------------
-- Row Level Security: deny-by-default for anon/authenticated. The backend's
-- service role bypasses RLS. Public read of VERIFIED knowledge is exposed through
-- a dedicated policy so a future public dictionary page can use the anon key.
-- ---------------------------------------------------------------------------
alter table languages             enable row level security;
alter table linguistic_sources    enable row level security;
alter table linguistic_knowledge  enable row level security;
alter table corrections           enable row level security;
alter table correction_reviews    enable row level security;
alter table correction_votes      enable row level security;
alter table translation_history   enable row level security;
alter table user_settings         enable row level security;
alter table api_usage             enable row level security;

drop policy if exists languages_public_read on languages;
create policy languages_public_read on languages for select to anon, authenticated using (true);

drop policy if exists sources_public_read on linguistic_sources;
create policy sources_public_read on linguistic_sources for select to anon, authenticated using (true);

drop policy if exists knowledge_verified_public_read on linguistic_knowledge;
create policy knowledge_verified_public_read on linguistic_knowledge for select to anon, authenticated using (validation_status = 'verified');

-- No policies on corrections / reviews / votes / history / settings / usage:
-- with RLS enabled and no policy, anon and authenticated roles get no access.
