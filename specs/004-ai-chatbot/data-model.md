# Data Model: AI Chatbot

## Overview

AI Chatbot V1 adds an AI support slice without changing existing organization/classroom ownership models.
D1 remains the source of truth for knowledge content, metadata, conversations, feedback, rate limits, and retention.
Vectorize stores only searchable vectors and metadata keyed by `ai_knowledge_chunk.id`.

## New Entity: `ai_knowledge_document`

**Purpose**: Source-level record for approved AI knowledge.

**Fields**:

- `id`: document id.
- `source_kind`: `docs`, `specs`, `faq`, or `db_summary`.
- `source_path`: repository path, logical FAQ id, or safe DB summary key.
- `title`: user/operator-readable source title.
- `locale`: `ja` by default; `en` allowed for future docs.
- `visibility`: `public`, `authenticated`, `participant`, `staff`, `manager`, `admin`, `owner`.
- `internal_only`: boolean; true for internal specs/operator-only sources.
- `organization_id`: optional tenant scope for organization-specific summaries.
- `classroom_id`: optional classroom scope for classroom-specific summaries.
- `feature`: optional domain tag: `booking`, `billing`, `ticket`, `invitation`, `service`, `participant`, `general`.
- `checksum`: content checksum used to detect reindex need.
- `index_status`: `pending`, `indexed`, `failed`, `stale`, `deleted`.
- `indexed_at`: latest successful indexing timestamp.
- `last_error`: sanitized failure reason, nullable.
- `created_at`, `updated_at`.

**Validation rules**:

- `source_kind = specs` requires `internal_only = true` unless explicitly approved in a future spec update.
- `internal_only = true` sources are never returned to organization users.
- Deleted or stale documents cannot be used for answer grounding until reindexed.
- `organization_id` and `classroom_id` must match resolved user scope before a scoped source can be used.

## New Entity: `ai_knowledge_chunk`

**Purpose**: Searchable, citable text unit for RAG.

**Fields**:

- `id`: chunk id; also the Vectorize vector id.
- `document_id`: parent `ai_knowledge_document.id`.
- `chunk_index`: stable order within document.
- `content`: chunk text stored in D1.
- `content_hash`: chunk-level hash for duplicate detection.
- `title`, `source_kind`, `source_path`, `locale`, `visibility`, `internal_only`.
- `organization_id`, `classroom_id`, `feature`, `tags_json`.
- `indexed_at`: timestamp used to validate Vectorize freshness.
- `vector_status`: `pending`, `upserted`, `failed`, `deleted`.

**Validation rules**:

- Duplicate chunks with the same `document_id` and `content_hash` should not create duplicate source citations.
- Chunk content should target 500-900 Japanese characters with 80-120 character overlap unless source structure requires a shorter chunk.
- Chunk body is fetched from D1 after Vectorize candidate retrieval; Vectorize metadata is not treated as source text.

## New Entity: `ai_knowledge_index_run`

**Purpose**: Operational record for indexing attempts and freshness inspection.

**Fields**:

- `id`: index run id.
- `source_root`: `apps/docs`, `specs`, `faq`, `db_summary`, or another approved source root.
- `status`: `running`, `succeeded`, `failed`, `partial`.
- `started_at`, `finished_at`.
- `documents_seen`, `documents_indexed`, `chunks_upserted`, `chunks_failed`.
- `embedding_model`: model id used for the run.
- `embedding_shape_json`: captured shape from the embedding provider.
- `vector_index_name`: expected Vectorize index name.
- `error_summary`: sanitized failure reason, nullable.

**Validation rules**:

- Each run records the embedding model and observed shape before using or creating a Vectorize index.
- Failed runs are internal-operator visible only.
- A failed run must not mark previously indexed documents as current unless their checksum and vector status are still valid.

## New Entity: `ai_conversation`

**Purpose**: Scoped chat thread for a user in an organization/classroom context.

**Fields**:

- `id`: conversation id.
- `user_id`: authenticated user id.
- `organization_id`: nullable only when no active organization is resolved.
- `classroom_id`: nullable only when no classroom context is resolved.
- `title`: optional short title.
- `created_at`, `updated_at`.
- `retention_expires_at`: normally `created_at + 180 days`.
- `anonymized_at`: timestamp when content was deleted or anonymized, nullable.

**Validation rules**:

- A conversation can continue only for the same user and permitted organization/classroom scope.
- Cross-organization or cross-classroom continuation is rejected or starts a new conversation.
- Conversation content is deleted or anonymized after 180 days.

## New Entity: `ai_message`

**Purpose**: User and assistant messages plus safe quality-review metadata.

**Fields**:

- `id`: message id.
- `conversation_id`: parent conversation.
- `role`: `user` or `assistant`.
- `content`: message body until retention cleanup.
- `sources_json`: assistant source references, nullable.
- `retrieved_context_json`: sanitized retrieved chunk ids, scores, visibility, and business fact keys, nullable.
- `confidence`: integer 0-100, nullable for user messages.
- `needs_human_support`: boolean.
- `ai_gateway_log_id`: nullable provider log id, if available.
- `created_at`.
- `retention_expires_at`.
- `anonymized_at`: nullable.

**Validation rules**:

- `role = assistant` messages must include `confidence` and `needs_human_support`.
- `retrieved_context_json` must not include secrets, full payment details, raw provider payloads, or private audit records.
- Source references must be role-safe for the user who receives the answer.

## New Entity: `ai_feedback`

**Purpose**: User feedback on assistant answer quality.

**Fields**:

- `id`: feedback id.
- `message_id`: assistant message id.
- `user_id`: submitting user id.
- `rating`: `helpful` or `unhelpful`.
- `comment`: optional user comment.
- `resolved`: boolean for internal operator workflow.
- `created_at`.
- `aggregate_retention_expires_at`: normally `created_at + 1 year`.

**Validation rules**:

- Feedback can be submitted only by a user who can access the conversation message.
- Comments follow the same privacy restrictions as conversation content.
- Organization users cannot browse feedback themes or conversation context; review is internal-operator only.

## New Entity: `ai_usage_counter`

**Purpose**: Deterministic product usage limits before model calls.

**Fields**:

- `id`: counter id.
- `scope_kind`: `user` or `organization`.
- `scope_id`: user id or organization id.
- `window_kind`: `hour` or `day`.
- `window_start_at`: normalized start timestamp.
- `count`: accepted message count.
- `created_at`, `updated_at`.

**Validation rules**:

- User scope allows at most 20 accepted chat messages per hour.
- Organization scope allows at most 200 accepted chat messages per day.
- A blocked request does not increment counters.
- Counters can be compacted after their windows expire.

## Derived Entity: `BusinessFactSummary`

**Purpose**: Answer-time, role-safe context for current organization/classroom state.

**Fields**:

- `organization_id`, `classroom_id`, `user_id`.
- `capabilities`: relevant effective capabilities such as `canManageBookings`, `canManageParticipants`, `canViewBilling`, `canManageBilling`.
- `booking_summary`: service/slot/booking policy facts needed for the question.
- `invitation_summary`: invitation capability and current invite state facts.
- `ticket_summary`: ticket type, ticket pack, and ledger summary facts.
- `participant_summary`: participant record and participant booking eligibility facts.
- `billing_summary`: plan state, payment issue state, entitlement state, and owner action availability.

**Validation rules**:

- Derived at answer time; not stored as raw prompt history except sanitized keys in `retrieved_context_json`.
- Billing details remain owner-only. Non-owner summaries must not expose invoices, receipts, payment method details, or payment document links.
- If required facts cannot be retrieved safely, answer generation must fall back without unsupported assertions.

## State Transitions

### Knowledge document lifecycle

```text
pending -> indexed -> stale -> indexed
pending -> failed -> pending
indexed -> deleted
```

### Conversation retention lifecycle

```text
active -> retention_due -> anonymized
active -> retention_due -> deleted
```

### Chat request lifecycle

```text
received
  -> unauthorized
  -> rate_limited
  -> context_resolved
  -> retrieved
  -> answered
  -> fallback_answered
  -> stored
```

### Feedback lifecycle

```text
submitted -> reviewed -> resolved
submitted -> aggregate_retained -> expired
```

## Migration Position

Add one D1 migration for AI tables and indexes. The migration is additive and must not rewrite existing organization,
classroom, booking, ticket, invitation, billing, or auth rows. Vectorize index creation is an infrastructure step, not
a D1 migration, and must be recorded in quickstart/release evidence with the verified embedding shape.
