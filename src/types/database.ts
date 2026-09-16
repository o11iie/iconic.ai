/**
 * Supabase database types.
 *
 * Hand-authored to match supabase/migrations. Once a Supabase project is linked
 * this file should be regenerated so it can never drift from the real schema:
 *
 *   npx supabase gen types typescript --linked > src/types/database.ts
 *
 * Until then this gives the client full type safety against the declared schema.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

interface TableShape<Row, Insert, Update> {
  Row: Row;
  Insert: Insert;
  Update: Update;
}

export interface ProfileRow {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  locale: string;
  timezone: string;
  onboarded_at: string | null;
  level: 'foundation' | 'intermediate' | 'advanced' | 'professional';
  interests: string[];
  preferences: Json;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface SubjectRow {
  id: string;
  domain: string;
  slug: string;
  name: string;
  description: string | null;
  icon_token: string | null;
  accent_token: string | null;
  status: 'draft' | 'published' | 'archived';
  available: boolean;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface SpatialModelRow {
  id: string;
  domain: string;
  subject_id: string | null;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  provider: string;
  provider_ref: string;
  root_object_id: string;
  asset_profile: Json;
  licence: Json;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface SpatialObjectRow {
  id: string;
  model_id: string;
  semantic_id: string;
  name: string;
  kind: string;
  parent_semantic_id: string | null;
  system: string | null;
  region: string | null;
  layer_ids: string[];
  provider_mesh_names: string[];
  bounding_box: Json | null;
  description: string | null;
  synonyms: string[];
  metadata: Json;
}

export interface RelationshipRow {
  id: string;
  model_id: string | null;
  source_id: string;
  target_id: string;
  kind: string;
  label: string | null;
  bidirectional: boolean;
  confidence: number;
  metadata: Json;
  created_at: string;
}

export interface CourseRow {
  id: string;
  subject_id: string;
  owner_id: string | null;
  slug: string;
  title: string;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  estimated_minutes: number | null;
  modules: Json;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface LearningMaterialRow {
  id: string;
  owner_id: string;
  subject_id: string | null;
  title: string;
  kind: 'pdf' | 'text' | 'markdown' | 'image' | 'audio' | 'video' | 'link' | 'lecture_notes';
  storage_path: string | null;
  source_url: string | null;
  size_bytes: number | null;
  ingestion: Json;
  concept_ids: string[];
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface QuestionRow {
  id: string;
  owner_id: string | null;
  subject_id: string | null;
  material_id: string | null;
  kind: string;
  prompt: string;
  choices: Json;
  answer: Json;
  explanation: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  concept_ids: string[];
  spatial_target_id: string | null;
  generated_by: 'authored' | 'ai' | 'imported';
  status: 'draft' | 'published' | 'archived';
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface FlashcardRow {
  id: string;
  owner_id: string;
  subject_id: string | null;
  material_id: string | null;
  front: string;
  back: string;
  concept_ids: string[];
  spatial_object_id: string | null;
  generated_by: 'authored' | 'ai' | 'imported';
  tags: string[];
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface LearningSessionRow {
  id: string;
  user_id: string;
  subject_id: string | null;
  course_id: string | null;
  spatial_model_id: string | null;
  mode: 'explore' | 'learn' | 'recall' | 'review' | 'apply';
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  concepts_studied: string[];
  metadata: Json;
}

export interface RecallAttemptRow {
  id: string;
  user_id: string;
  session_id: string | null;
  question_id: string | null;
  flashcard_id: string | null;
  concept_id: string | null;
  grade: 'forgot' | 'hard' | 'good' | 'easy';
  correct: boolean | null;
  response_ms: number;
  answered_at: string;
  response: Json;
}

export interface MemoryStateRow {
  id: string;
  user_id: string;
  concept_id: string;
  repetitions: number;
  stability: number;
  difficulty: number;
  interval_days: number;
  lapses: number;
  last_reviewed_at: string | null;
  due_at: string;
  retrievability: number | null;
}

export interface NoteRow {
  id: string;
  owner_id: string;
  subject_id: string | null;
  material_id: string | null;
  spatial_object_id: string | null;
  title: string | null;
  body: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  tier: 'free' | 'plus' | 'pro' | 'institution';
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'paused';
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

/** Columns the database fills in for you. */
type Generated = 'id' | 'created_at' | 'updated_at';

type InsertOf<Row> = Omit<Row, Generated> & Partial<Pick<Row, Extract<Generated, keyof Row>>>;
type UpdateOf<Row> = Partial<Row>;

export interface Database {
  public: {
    Tables: {
      profiles: TableShape<ProfileRow, InsertOf<ProfileRow>, UpdateOf<ProfileRow>>;
      subjects: TableShape<SubjectRow, InsertOf<SubjectRow>, UpdateOf<SubjectRow>>;
      spatial_models: TableShape<SpatialModelRow, InsertOf<SpatialModelRow>, UpdateOf<SpatialModelRow>>;
      spatial_objects: TableShape<SpatialObjectRow, InsertOf<SpatialObjectRow>, UpdateOf<SpatialObjectRow>>;
      relationships: TableShape<RelationshipRow, InsertOf<RelationshipRow>, UpdateOf<RelationshipRow>>;
      courses: TableShape<CourseRow, InsertOf<CourseRow>, UpdateOf<CourseRow>>;
      learning_materials: TableShape<LearningMaterialRow, InsertOf<LearningMaterialRow>, UpdateOf<LearningMaterialRow>>;
      questions: TableShape<QuestionRow, InsertOf<QuestionRow>, UpdateOf<QuestionRow>>;
      flashcards: TableShape<FlashcardRow, InsertOf<FlashcardRow>, UpdateOf<FlashcardRow>>;
      learning_sessions: TableShape<LearningSessionRow, InsertOf<LearningSessionRow>, UpdateOf<LearningSessionRow>>;
      recall_attempts: TableShape<RecallAttemptRow, InsertOf<RecallAttemptRow>, UpdateOf<RecallAttemptRow>>;
      memory_states: TableShape<MemoryStateRow, InsertOf<MemoryStateRow>, UpdateOf<MemoryStateRow>>;
      notes: TableShape<NoteRow, InsertOf<NoteRow>, UpdateOf<NoteRow>>;
      subscriptions: TableShape<SubscriptionRow, InsertOf<SubscriptionRow>, UpdateOf<SubscriptionRow>>;
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
