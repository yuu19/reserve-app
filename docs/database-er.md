# 予約管理システム DB説明とER図

最終更新: 2026-02-17  
参照元: `apps/backend/src/db/schema.ts`

## 1. 概要

このDBは以下の4ドメインで構成される。

1. 認証・アカウント（Better Authコア）
2. 組織・招待（管理者招待 / 参加者招待）
3. 予約管理（service / slot / recurring schedule / booking）
4. 回数券・監査ログ

## 2. テーブル説明

### 2.1 認証・アカウント

- `user`: ユーザー本体
- `session`: セッション情報（`user_id` FK）
- `account`: OAuth/認証プロバイダ連携情報（`user_id` FK）
- `verification`: 認証用トークン・検証値

### 2.2 組織・招待・参加者

- `organization`: 組織
- `member`: 組織メンバー（`organization_id` FK, `user_id` FK）
- `participant`: 予約主体の参加者（`organization_id` FK, `user_id` FK）
  - Unique: `(organization_id, user_id)`, `(organization_id, email)`
- `invitation`: 管理者招待（Better Auth organization invitation）
- `invitation_audit_log`: 管理者招待の監査ログ
- `participant_invitation`: 参加者招待
- `participant_invitation_audit_log`: 参加者招待の監査ログ

### 2.3 予約管理

- `service`: 予約メニュー（単発/定期）
- `recurring_schedule`: 定期スケジュール定義
- `recurring_schedule_exception`: 定期スケジュール例外（休講/上書き）
  - Unique: `(recurring_schedule_id, date)`
- `slot`: 予約可能枠
  - Unique: `(organization_id, recurring_schedule_id, start_at)`（定期生成重複防止）
- `booking`: 予約
  - Unique: `(slot_id, participant_id)`（同一枠の二重予約防止）
- `booking_audit_log`: 予約操作監査ログ

### 2.4 回数券

- `ticket_type`: 回数券種別
- `ticket_pack`: 参加者への付与回数券
- `ticket_ledger`: 付与/消費/戻しの台帳

## 3. 実装上の補足

- `booking.ticket_pack_id -> ticket_pack.id` はFK制約あり（`ON DELETE SET NULL`）。
- `ticket_ledger.booking_id -> booking.id` はFK制約あり（`ON DELETE SET NULL`）。
- `slot.reserved_count` は予約作成/取消で増減し、0未満にならない条件で更新する。
- 監査ログ系はすべて「成功時のみ記録」を前提とする。

## 4. ER図（Mermaid）

```mermaid
erDiagram
  USER {
    text id PK
    text email
    text name
  }

  SESSION {
    text id PK
    text user_id FK
    text token
  }

  ACCOUNT {
    text id PK
    text user_id FK
    text provider_id
    text account_id
  }

  VERIFICATION {
    text id PK
    text identifier
    text value
  }

  ORGANIZATION {
    text id PK
    text slug
    text name
  }

  MEMBER {
    text id PK
    text organization_id FK
    text user_id FK
    text role
  }

  PARTICIPANT {
    text id PK
    text organization_id FK
    text user_id FK
    text email
    text name
  }

  INVITATION {
    text id PK
    text organization_id FK
    text inviter_id FK
    text email
    text role
    text status
  }

  INVITATION_AUDIT_LOG {
    text id PK
    text invitation_id FK
    text organization_id FK
    text actor_user_id FK
    text action
  }

  PARTICIPANT_INVITATION {
    text id PK
    text organization_id FK
    text invited_by_user_id FK
    text responded_by_user_id FK
    text email
    text participant_name
    text status
  }

  PARTICIPANT_INVITATION_AUDIT_LOG {
    text id PK
    text participant_invitation_id FK
    text organization_id FK
    text actor_user_id FK
    text action
  }

  SERVICE {
    text id PK
    text organization_id FK
    text name
    text kind
    int duration_minutes
    int capacity
  }

  RECURRING_SCHEDULE {
    text id PK
    text organization_id FK
    text service_id FK
    text frequency
    int interval
    text start_date
    text end_date
  }

  RECURRING_SCHEDULE_EXCEPTION {
    text id PK
    text recurring_schedule_id FK
    text organization_id FK
    text date
    text action
  }

  SLOT {
    text id PK
    text organization_id FK
    text service_id FK
    text recurring_schedule_id FK
    int start_at
    int end_at
    int capacity
    int reserved_count
    text status
  }

  BOOKING {
    text id PK
    text organization_id FK
    text slot_id FK
    text service_id FK
    text participant_id FK
    text cancelled_by_user_id FK
    text ticket_pack_id FK
    int participants_count
    text status
  }

  BOOKING_AUDIT_LOG {
    text id PK
    text booking_id FK
    text organization_id FK
    text actor_user_id FK
    text action
  }

  TICKET_TYPE {
    text id PK
    text organization_id FK
    text name
    int total_count
    int expires_in_days
  }

  TICKET_PACK {
    text id PK
    text organization_id FK
    text participant_id FK
    text ticket_type_id FK
    int initial_count
    int remaining_count
    text status
  }

  TICKET_LEDGER {
    text id PK
    text organization_id FK
    text ticket_pack_id FK
    text booking_id FK
    text actor_user_id FK
    text action
    int delta
    int balance_after
  }

  USER ||--o{ SESSION : has
  USER ||--o{ ACCOUNT : has
  USER ||--o{ MEMBER : belongs
  USER ||--o{ PARTICIPANT : belongs
  USER ||--o{ INVITATION : invites
  USER ||--o{ PARTICIPANT_INVITATION : invites_or_responds
  USER ||--o{ BOOKING : cancels
  USER ||--o{ TICKET_LEDGER : acts
  USER ||--o{ INVITATION_AUDIT_LOG : acts
  USER ||--o{ PARTICIPANT_INVITATION_AUDIT_LOG : acts
  USER ||--o{ BOOKING_AUDIT_LOG : acts

  ORGANIZATION ||--o{ MEMBER : has
  ORGANIZATION ||--o{ PARTICIPANT : has
  ORGANIZATION ||--o{ INVITATION : has
  ORGANIZATION ||--o{ PARTICIPANT_INVITATION : has
  ORGANIZATION ||--o{ INVITATION_AUDIT_LOG : has
  ORGANIZATION ||--o{ PARTICIPANT_INVITATION_AUDIT_LOG : has
  ORGANIZATION ||--o{ SERVICE : has
  ORGANIZATION ||--o{ RECURRING_SCHEDULE : has
  ORGANIZATION ||--o{ RECURRING_SCHEDULE_EXCEPTION : has
  ORGANIZATION ||--o{ SLOT : has
  ORGANIZATION ||--o{ BOOKING : has
  ORGANIZATION ||--o{ BOOKING_AUDIT_LOG : has
  ORGANIZATION ||--o{ TICKET_TYPE : has
  ORGANIZATION ||--o{ TICKET_PACK : has
  ORGANIZATION ||--o{ TICKET_LEDGER : has

  SERVICE ||--o{ RECURRING_SCHEDULE : defines
  SERVICE ||--o{ SLOT : opens
  SERVICE ||--o{ BOOKING : booked_as

  RECURRING_SCHEDULE ||--o{ RECURRING_SCHEDULE_EXCEPTION : has
  RECURRING_SCHEDULE ||--o{ SLOT : generates

  SLOT ||--o{ BOOKING : receives
  PARTICIPANT ||--o{ BOOKING : makes
  PARTICIPANT ||--o{ TICKET_PACK : owns

  TICKET_TYPE ||--o{ TICKET_PACK : classifies
  TICKET_PACK ||--o{ BOOKING : consumed_by
  TICKET_PACK ||--o{ TICKET_LEDGER : records
  BOOKING ||--o{ TICKET_LEDGER : references

  INVITATION ||--o{ INVITATION_AUDIT_LOG : logged
  PARTICIPANT_INVITATION ||--o{ PARTICIPANT_INVITATION_AUDIT_LOG : logged
  BOOKING ||--o{ BOOKING_AUDIT_LOG : logged
```
