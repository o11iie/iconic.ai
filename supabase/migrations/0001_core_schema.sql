-- =============================================================================
-- VEO — Core schema
-- =============================================================================
-- Design notes
--   * UUID primary keys (gen_random_uuid) everywhere: stable, non-enumerable,
--     and safe to mint client-side for optimistic writes.
--   * Semantic ids are TEXT, not foreign keys to spatial_objects. They are a
--     stable vocabulary that must survive an asset vendor change, so learning
--     content references the id itself, not a row that could be re-imported.
--   * jsonb metadata columns give each knowledge domain room to carry its own
--     attributes without schema churn. They are never used for authorization.
-- =============================================================================

create extension if not exists "pgcrypto";

-- --- shared helpers -----------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Format guard for VEO semantic ids, e.g. veo.anatomy.heart.left_ventricle
create or replace function public.is_semantic_id(value text)
returns boolean
language sql
immutable
as $$
  select value ~ '^veo\.[a-z0-9]+(_[a-z0-9]+)*(\.[a-z0-9]+(_[a-z0-9]+)*)+$';
$$;


-- --- profiles -----------------------------------------------------------------

create table if not exists public.profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique references auth.users (id) on delete cascade,
  display_name  text,
  avatar_url    text,
  locale        text not null default 'en',
  timezone      text not null default 'UTC',
  onboarded_at  timestamptz,
  level         text not null default 'foundation'
                  check (level in ('foundation', 'intermediate', 'advanced', 'professional')),
  interests     text[] not null default '{}',
  preferences   jsonb  not null default '{"reducedMotion":false,"showLabels":true,"dailyRecallGoal":20}'::jsonb,
  metadata      jsonb  not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists profiles_user_id_idx on public.profiles (user_id);

-- Every auth user gets a profile row automatically; the app never has to
-- special-case "signed in but no profile".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- --- subjects -----------------------------------------------------------------

create table if not exists public.subjects (
  id            uuid primary key default gen_random_uuid(),
  domain        text not null,
  slug          text not null unique,
  name          text not null,
  description   text,
  icon_token    text,
  accent_token  text,
  status        text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  -- False until licensed spatial content and curriculum exist for it.
  available     boolean not null default false,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists subjects_domain_idx on public.subjects (domain);
create index if not exists subjects_status_idx on public.subjects (status);


-- --- spatial models -----------------------------------------------------------

create table if not exists public.spatial_models (
  id             uuid primary key default gen_random_uuid(),
  domain         text not null,
  subject_id     uuid references public.subjects (id) on delete set null,
  name           text not null,
  description    text,
  thumbnail_url  text,
  provider       text not null,
  provider_ref   text not null,
  root_object_id text not null check (public.is_semantic_id(root_object_id)),
  asset_profile  jsonb not null default '{}'::jsonb,
  licence        jsonb not null,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (provider, provider_ref)
);

create index if not exists spatial_models_domain_idx on public.spatial_models (domain);
create index if not exists spatial_models_subject_idx on public.spatial_models (subject_id);

create table if not exists public.spatial_objects (
  id                  uuid primary key default gen_random_uuid(),
  model_id            uuid not null references public.spatial_models (id) on delete cascade,
  semantic_id         text not null check (public.is_semantic_id(semantic_id)),
  name                text not null,
  kind                text not null default 'structure',
  parent_semantic_id  text check (parent_semantic_id is null or public.is_semantic_id(parent_semantic_id)),
  system              text,
  region              text,
  layer_ids           text[] not null default '{}',
  -- Vendor mesh names. Mutable by design: they change when an asset is
  -- re-exported, while semantic_id must not.
  provider_mesh_names text[] not null default '{}',
  bounding_box        jsonb,
  description         text,
  synonyms            text[] not null default '{}',
  metadata            jsonb not null default '{}'::jsonb,
  unique (model_id, semantic_id)
);

create index if not exists spatial_objects_model_idx on public.spatial_objects (model_id);
create index if not exists spatial_objects_semantic_idx on public.spatial_objects (semantic_id);
create index if not exists spatial_objects_parent_idx on public.spatial_objects (parent_semantic_id);


-- --- relationships ------------------------------------------------------------

create table if not exists public.relationships (
  id            uuid primary key default gen_random_uuid(),
  model_id      uuid references public.spatial_models (id) on delete cascade,
  source_id     text not null check (public.is_semantic_id(source_id)),
  target_id     text not null check (public.is_semantic_id(target_id)),
  kind          text not null,
  label         text,
  bidirectional boolean not null default false,
  confidence    real not null default 1 check (confidence >= 0 and confidence <= 1),
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists relationships_source_idx on public.relationships (source_id);
create index if not exists relationships_target_idx on public.relationships (target_id);
create index if not exists relationships_kind_idx on public.relationships (kind);


-- --- courses ------------------------------------------------------------------

create table if not exists public.courses (
  id                uuid primary key default gen_random_uuid(),
  subject_id        uuid not null references public.subjects (id) on delete cascade,
  owner_id          uuid references auth.users (id) on delete set null,
  slug              text not null,
  title             text not null,
  description       text,
  status            text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  estimated_minutes integer,
  modules           jsonb not null default '[]'::jsonb,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (subject_id, slug)
);

create index if not exists courses_subject_idx on public.courses (subject_id);
create index if not exists courses_owner_idx on public.courses (owner_id);


-- --- learning materials -------------------------------------------------------

create table if not exists public.learning_materials (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  subject_id   uuid references public.subjects (id) on delete set null,
  title        text not null,
  kind         text not null
                 check (kind in ('pdf','text','markdown','image','audio','video','link','lecture_notes')),
  -- Storage object path, never a public URL: access is brokered by signed URLs.
  storage_path text,
  source_url   text,
  size_bytes   bigint,
  ingestion    jsonb not null default '{"status":"pending","startedAt":null,"completedAt":null,"error":null,"progress":null}'::jsonb,
  concept_ids  text[] not null default '{}',
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists learning_materials_owner_idx on public.learning_materials (owner_id);
create index if not exists learning_materials_subject_idx on public.learning_materials (subject_id);


-- --- questions ----------------------------------------------------------------

create table if not exists public.questions (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid references auth.users (id) on delete cascade,
  subject_id        uuid references public.subjects (id) on delete set null,
  material_id       uuid references public.learning_materials (id) on delete cascade,
  kind              text not null
                      check (kind in ('multiple_choice','free_recall','true_false',
                                      'identify_structure','order_sequence','label_diagram')),
  prompt            text not null,
  choices           jsonb not null default '[]'::jsonb,
  answer            jsonb not null,
  explanation       text,
  difficulty        text not null default 'medium' check (difficulty in ('easy','medium','hard')),
  concept_ids       text[] not null default '{}',
  spatial_target_id text check (spatial_target_id is null or public.is_semantic_id(spatial_target_id)),
  generated_by      text not null default 'authored' check (generated_by in ('authored','ai','imported')),
  status            text not null default 'draft' check (status in ('draft','published','archived')),
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists questions_owner_idx on public.questions (owner_id);
create index if not exists questions_material_idx on public.questions (material_id);


-- --- flashcards ---------------------------------------------------------------

create table if not exists public.flashcards (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users (id) on delete cascade,
  subject_id        uuid references public.subjects (id) on delete set null,
  material_id       uuid references public.learning_materials (id) on delete cascade,
  front             text not null,
  back              text not null,
  concept_ids       text[] not null default '{}',
  spatial_object_id text check (spatial_object_id is null or public.is_semantic_id(spatial_object_id)),
  generated_by      text not null default 'authored' check (generated_by in ('authored','ai','imported')),
  tags              text[] not null default '{}',
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists flashcards_owner_idx on public.flashcards (owner_id);


-- --- learning sessions --------------------------------------------------------

create table if not exists public.learning_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  subject_id       uuid references public.subjects (id) on delete set null,
  course_id        uuid references public.courses (id) on delete set null,
  spatial_model_id uuid references public.spatial_models (id) on delete set null,
  mode             text not null default 'explore'
                     check (mode in ('explore','learn','recall','review','apply')),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  duration_seconds integer,
  concepts_studied text[] not null default '{}',
  metadata         jsonb not null default '{}'::jsonb
);

create index if not exists learning_sessions_user_idx on public.learning_sessions (user_id, started_at desc);


-- --- recall attempts ----------------------------------------------------------

create table if not exists public.recall_attempts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  session_id   uuid references public.learning_sessions (id) on delete set null,
  question_id  uuid references public.questions (id) on delete set null,
  flashcard_id uuid references public.flashcards (id) on delete set null,
  concept_id   text check (concept_id is null or public.is_semantic_id(concept_id)),
  grade        text not null check (grade in ('forgot','hard','good','easy')),
  correct      boolean,
  response_ms  integer not null default 0,
  answered_at  timestamptz not null default now(),
  response     jsonb not null default '{}'::jsonb,
  -- An attempt must be about something.
  constraint recall_attempts_target_present
    check (question_id is not null or flashcard_id is not null or concept_id is not null)
);

create index if not exists recall_attempts_user_idx on public.recall_attempts (user_id, answered_at desc);
create index if not exists recall_attempts_concept_idx on public.recall_attempts (concept_id);


-- --- memory states ------------------------------------------------------------

create table if not exists public.memory_states (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  concept_id       text not null check (public.is_semantic_id(concept_id)),
  repetitions      integer not null default 0,
  -- Scheduler inputs are stored, not just a due date, so the algorithm can be
  -- improved later without discarding a learner's history.
  stability        real not null default 1,
  difficulty       real not null default 0.3 check (difficulty >= 0 and difficulty <= 1),
  interval_days    real not null default 0,
  lapses           integer not null default 0,
  last_reviewed_at timestamptz,
  due_at           timestamptz not null default now(),
  retrievability   real check (retrievability is null or (retrievability >= 0 and retrievability <= 1)),
  unique (user_id, concept_id)
);

create index if not exists memory_states_due_idx on public.memory_states (user_id, due_at);


-- --- notes --------------------------------------------------------------------

create table if not exists public.notes (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users (id) on delete cascade,
  subject_id        uuid references public.subjects (id) on delete set null,
  material_id       uuid references public.learning_materials (id) on delete cascade,
  spatial_object_id text check (spatial_object_id is null or public.is_semantic_id(spatial_object_id)),
  title             text,
  body              text not null default '',
  tags              text[] not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists notes_owner_idx on public.notes (owner_id);
create index if not exists notes_spatial_idx on public.notes (spatial_object_id);


-- --- subscriptions ------------------------------------------------------------

create table if not exists public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null unique references auth.users (id) on delete cascade,
  tier                   text not null default 'free' check (tier in ('free','plus','pro','institution')),
  status                 text not null default 'active'
                           check (status in ('active','trialing','past_due','canceled','incomplete','paused')),
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  stripe_price_id        text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists subscriptions_user_idx on public.subscriptions (user_id);


-- --- updated_at triggers ------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles','subjects','spatial_models','courses','learning_materials',
    'questions','flashcards','notes','subscriptions'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;
