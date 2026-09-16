-- =============================================================================
-- VEO — Row Level Security
-- =============================================================================
-- Principle: the client is never trusted. Every table has RLS enabled, and the
-- default is deny — a table with RLS on and no matching policy returns nothing.
--
-- Three access shapes:
--   1. OWNED     rows belong to one user; only that user may read or write.
--   2. CATALOGUE published reference content; readable by everyone, writable
--                only by the service role (which bypasses RLS entirely).
--   3. AUTHORED  user-created content that may also be published.
--
-- The service-role key bypasses all of this by design. It is server-only and
-- must never reach a browser bundle — see src/lib/supabase/admin.ts.
-- =============================================================================

alter table public.profiles            enable row level security;
alter table public.subjects            enable row level security;
alter table public.spatial_models      enable row level security;
alter table public.spatial_objects     enable row level security;
alter table public.relationships       enable row level security;
alter table public.courses             enable row level security;
alter table public.learning_materials  enable row level security;
alter table public.questions           enable row level security;
alter table public.flashcards          enable row level security;
alter table public.learning_sessions   enable row level security;
alter table public.recall_attempts     enable row level security;
alter table public.memory_states       enable row level security;
alter table public.notes               enable row level security;
alter table public.subscriptions       enable row level security;


-- --- 1. OWNED ----------------------------------------------------------------

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Insert is normally handled by the on_auth_user_created trigger; this covers
-- recovery without allowing a user to create a profile for someone else.
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (user_id = (select auth.uid()));


do $$
declare
  spec record;
begin
  -- table name, owner column
  for spec in
    select * from (values
      ('learning_materials', 'owner_id'),
      ('flashcards',         'owner_id'),
      ('notes',              'owner_id'),
      ('learning_sessions',  'user_id'),
      ('recall_attempts',    'user_id'),
      ('memory_states',      'user_id')
    ) as t(table_name, owner_column)
  loop
    execute format('drop policy if exists %I on public.%I',
                   spec.table_name || '_select_own', spec.table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (%I = (select auth.uid()))',
      spec.table_name || '_select_own', spec.table_name, spec.owner_column);

    execute format('drop policy if exists %I on public.%I',
                   spec.table_name || '_insert_own', spec.table_name);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (%I = (select auth.uid()))',
      spec.table_name || '_insert_own', spec.table_name, spec.owner_column);

    execute format('drop policy if exists %I on public.%I',
                   spec.table_name || '_update_own', spec.table_name);
    execute format(
      'create policy %I on public.%I for update to authenticated using (%I = (select auth.uid())) with check (%I = (select auth.uid()))',
      spec.table_name || '_update_own', spec.table_name, spec.owner_column, spec.owner_column);

    execute format('drop policy if exists %I on public.%I',
                   spec.table_name || '_delete_own', spec.table_name);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (%I = (select auth.uid()))',
      spec.table_name || '_delete_own', spec.table_name, spec.owner_column);
  end loop;
end;
$$;


-- --- 2. CATALOGUE ------------------------------------------------------------
-- Readable by anonymous visitors too: the marketing surface and the explore
-- page must be able to list what VEO covers before sign-up. No write policies
-- exist, so only the service role can modify catalogue content.

drop policy if exists "subjects_select_published" on public.subjects;
create policy "subjects_select_published" on public.subjects
  for select to anon, authenticated using (status = 'published');

drop policy if exists "spatial_models_select_all" on public.spatial_models;
create policy "spatial_models_select_all" on public.spatial_models
  for select to anon, authenticated using (true);

drop policy if exists "spatial_objects_select_all" on public.spatial_objects;
create policy "spatial_objects_select_all" on public.spatial_objects
  for select to anon, authenticated using (true);

drop policy if exists "relationships_select_all" on public.relationships;
create policy "relationships_select_all" on public.relationships
  for select to anon, authenticated using (true);


-- --- 3. AUTHORED -------------------------------------------------------------
-- Published content is visible to everyone; drafts only to their owner.

drop policy if exists "courses_select_visible" on public.courses;
create policy "courses_select_visible" on public.courses
  for select to anon, authenticated
  using (status = 'published' or owner_id = (select auth.uid()));

drop policy if exists "courses_insert_own" on public.courses;
create policy "courses_insert_own" on public.courses
  for insert to authenticated with check (owner_id = (select auth.uid()));

drop policy if exists "courses_update_own" on public.courses;
create policy "courses_update_own" on public.courses
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "courses_delete_own" on public.courses;
create policy "courses_delete_own" on public.courses
  for delete to authenticated using (owner_id = (select auth.uid()));


drop policy if exists "questions_select_visible" on public.questions;
create policy "questions_select_visible" on public.questions
  for select to authenticated
  using (status = 'published' or owner_id = (select auth.uid()));

drop policy if exists "questions_insert_own" on public.questions;
create policy "questions_insert_own" on public.questions
  for insert to authenticated with check (owner_id = (select auth.uid()));

drop policy if exists "questions_update_own" on public.questions;
create policy "questions_update_own" on public.questions
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "questions_delete_own" on public.questions;
create policy "questions_delete_own" on public.questions
  for delete to authenticated using (owner_id = (select auth.uid()));


-- --- SUBSCRIPTIONS -----------------------------------------------------------
-- Readable by the owner so the UI can show their plan. Deliberately NOT
-- writable by them: entitlement changes come only from verified Stripe
-- webhooks running with the service role. A client that could write here could
-- grant itself a paid plan.

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions
  for select to authenticated using (user_id = (select auth.uid()));


-- --- STORAGE -----------------------------------------------------------------
-- Uploaded learning material is private and namespaced by user id, so a user
-- can only ever reach objects under their own folder.

insert into storage.buckets (id, name, public)
values ('learning-materials', 'learning-materials', false)
on conflict (id) do nothing;

drop policy if exists "learning_materials_read_own" on storage.objects;
create policy "learning_materials_read_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'learning-materials'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "learning_materials_write_own" on storage.objects;
create policy "learning_materials_write_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'learning-materials'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "learning_materials_delete_own" on storage.objects;
create policy "learning_materials_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'learning-materials'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
