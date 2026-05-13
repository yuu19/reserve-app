CREATE TABLE `ai_knowledge_document` (
  `id` text PRIMARY KEY NOT NULL,
  `source_kind` text NOT NULL,
  `source_path` text NOT NULL,
  `title` text NOT NULL,
  `locale` text DEFAULT 'ja' NOT NULL,
  `visibility` text DEFAULT 'authenticated' NOT NULL,
  `internal_only` integer DEFAULT false NOT NULL,
  `organization_id` text REFERENCES `organization`(`id`) ON DELETE cascade,
  `classroom_id` text REFERENCES `classroom`(`id`) ON DELETE cascade,
  `feature` text,
  `checksum` text NOT NULL,
  `index_status` text DEFAULT 'pending' NOT NULL,
  `indexed_at` integer,
  `last_error` text,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);

CREATE INDEX `ai_knowledge_document_source_idx` ON `ai_knowledge_document` (`source_kind`, `source_path`);
CREATE INDEX `ai_knowledge_document_status_idx` ON `ai_knowledge_document` (`index_status`, `indexed_at`);
CREATE INDEX `ai_knowledge_document_scope_idx` ON `ai_knowledge_document` (`organization_id`, `classroom_id`, `visibility`);
CREATE UNIQUE INDEX `ai_knowledge_document_source_uidx` ON `ai_knowledge_document` (`source_kind`, `source_path`, `organization_id`, `classroom_id`);

CREATE TABLE `ai_knowledge_chunk` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL REFERENCES `ai_knowledge_document`(`id`) ON DELETE cascade,
  `chunk_index` integer NOT NULL,
  `content` text NOT NULL,
  `content_hash` text NOT NULL,
  `title` text NOT NULL,
  `source_kind` text NOT NULL,
  `source_path` text NOT NULL,
  `locale` text DEFAULT 'ja' NOT NULL,
  `visibility` text DEFAULT 'authenticated' NOT NULL,
  `internal_only` integer DEFAULT false NOT NULL,
  `organization_id` text REFERENCES `organization`(`id`) ON DELETE cascade,
  `classroom_id` text REFERENCES `classroom`(`id`) ON DELETE cascade,
  `feature` text,
  `tags_json` text,
  `indexed_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `vector_status` text DEFAULT 'pending' NOT NULL
);

CREATE INDEX `ai_knowledge_chunk_document_idx` ON `ai_knowledge_chunk` (`document_id`, `chunk_index`);
CREATE INDEX `ai_knowledge_chunk_lookup_idx` ON `ai_knowledge_chunk` (`locale`, `visibility`, `organization_id`, `classroom_id`);
CREATE INDEX `ai_knowledge_chunk_vector_status_idx` ON `ai_knowledge_chunk` (`vector_status`, `indexed_at`);
CREATE UNIQUE INDEX `ai_knowledge_chunk_document_hash_uidx` ON `ai_knowledge_chunk` (`document_id`, `content_hash`);

CREATE TABLE `ai_knowledge_index_run` (
  `id` text PRIMARY KEY NOT NULL,
  `source_root` text NOT NULL,
  `status` text DEFAULT 'running' NOT NULL,
  `started_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `finished_at` integer,
  `documents_seen` integer DEFAULT 0 NOT NULL,
  `documents_indexed` integer DEFAULT 0 NOT NULL,
  `chunks_upserted` integer DEFAULT 0 NOT NULL,
  `chunks_failed` integer DEFAULT 0 NOT NULL,
  `embedding_model` text NOT NULL,
  `embedding_shape_json` text,
  `vector_index_name` text NOT NULL,
  `error_summary` text
);

CREATE INDEX `ai_knowledge_index_run_source_status_idx` ON `ai_knowledge_index_run` (`source_root`, `status`, `started_at`);

CREATE TABLE `ai_conversation` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE cascade,
  `organization_id` text REFERENCES `organization`(`id`) ON DELETE cascade,
  `classroom_id` text REFERENCES `classroom`(`id`) ON DELETE cascade,
  `title` text,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `retention_expires_at` integer NOT NULL,
  `anonymized_at` integer
);

CREATE INDEX `ai_conversation_user_scope_idx` ON `ai_conversation` (`user_id`, `organization_id`, `classroom_id`, `updated_at`);
CREATE INDEX `ai_conversation_retention_idx` ON `ai_conversation` (`retention_expires_at`, `anonymized_at`);

CREATE TABLE `ai_message` (
  `id` text PRIMARY KEY NOT NULL,
  `conversation_id` text NOT NULL REFERENCES `ai_conversation`(`id`) ON DELETE cascade,
  `role` text NOT NULL,
  `content` text NOT NULL,
  `sources_json` text,
  `retrieved_context_json` text,
  `confidence` integer,
  `needs_human_support` integer DEFAULT false NOT NULL,
  `ai_gateway_log_id` text,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `retention_expires_at` integer NOT NULL,
  `anonymized_at` integer
);

CREATE INDEX `ai_message_conversation_created_idx` ON `ai_message` (`conversation_id`, `created_at`);
CREATE INDEX `ai_message_retention_idx` ON `ai_message` (`retention_expires_at`, `anonymized_at`);

CREATE TABLE `ai_feedback` (
  `id` text PRIMARY KEY NOT NULL,
  `message_id` text NOT NULL REFERENCES `ai_message`(`id`) ON DELETE cascade,
  `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE cascade,
  `rating` text NOT NULL,
  `comment` text,
  `resolved` integer DEFAULT false NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `aggregate_retention_expires_at` integer NOT NULL
);

CREATE INDEX `ai_feedback_message_idx` ON `ai_feedback` (`message_id`);
CREATE INDEX `ai_feedback_rating_created_idx` ON `ai_feedback` (`rating`, `created_at`);
CREATE INDEX `ai_feedback_retention_idx` ON `ai_feedback` (`aggregate_retention_expires_at`);
CREATE UNIQUE INDEX `ai_feedback_message_user_uidx` ON `ai_feedback` (`message_id`, `user_id`);

CREATE TABLE `ai_usage_counter` (
  `id` text PRIMARY KEY NOT NULL,
  `scope_kind` text NOT NULL,
  `scope_id` text NOT NULL,
  `window_kind` text NOT NULL,
  `window_start_at` integer NOT NULL,
  `count` integer DEFAULT 0 NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);

CREATE UNIQUE INDEX `ai_usage_counter_window_uidx` ON `ai_usage_counter` (`scope_kind`, `scope_id`, `window_kind`, `window_start_at`);
CREATE INDEX `ai_usage_counter_expiry_idx` ON `ai_usage_counter` (`window_kind`, `window_start_at`);
