# 権限設計（全体Org + 複数Store）

最終更新: 2026-06-02

## 1. 目的

`organization = 全体Org`、`store = 店舗` の2階層で認可する。

- Org 層: 組織全体の管理責務
- Store 層: 店舗単位の運用責務
- Participant: 店舗ロールではなく、参加者レコードの有無で扱う

## 2. 事実モデル

### OrgRole

- `owner`
- `admin`
- `member`

### StoreStaffRole

- `manager`
- `staff`

### Participant fact

- `hasParticipantRecord: boolean`
- participant は `store_member.role` には入れない
- participant-only user は `orgRole = null | member` かつ `storeStaffRole = null` になりうる

## 3. 認可の4層

`GET /api/v1/auth/orgs/access-tree` とサーバ内部の認可は、単一ロールではなく次の4層で扱う。

### facts

入力事実。権限の根拠そのもの。

- `facts.orgRole: owner | admin | member | null`
- `facts.storeStaffRole: manager | staff | null`
- `facts.hasParticipantRecord: boolean`

### effective

実際に判定へ使う capability。

- `effective.canManageOrganization`
- `effective.canManageStore`
- `effective.canManageBookings`
- `effective.canManageParticipants`
- `effective.canUseParticipantBooking`

### sources

各 capability がどこから導出されたか。

- `sources.canManageOrganization: org_role | null`
- `sources.canManageStore: org_role | store_member | null`
- `sources.canManageBookings: org_role | store_member | null`
- `sources.canManageParticipants: org_role | store_member | null`
- `sources.canUseParticipantBooking: participant_record | null`

### display

UI 表示専用の補助値。権限判定の正本には使わない。

- `display.primaryRole: owner | admin | manager | staff | participant | null`
- `display.badges: ('owner' | 'admin' | 'manager' | 'staff' | 'participant')[]`

`primaryRole` の優先順は `owner/admin > manager > staff > participant`。
`badges` は複数保持できるため、`staff + participant` のような重なりを潰さない。

UI では enum 値をそのまま表示しない。ユーザー向けには次の表示名を使う。

| enum 値       | ユーザー向け表示名 |
| ------------- | ------------------ |
| `owner`       | 組織オーナー       |
| `admin`       | 組織管理者         |
| `member`      | 組織メンバー       |
| `manager`     | 店舗管理者         |
| `staff`       | 店舗スタッフ       |
| `participant` | 参加者             |

## 4. 実効権限

### 4-1. OrgRole 由来

| OrgRole  | Org全体管理 | 全店舗の設定/招待 | 予約運用 | 参加者管理 | participant導線                |
| -------- | ----------- | ----------------- | -------- | ---------- | ------------------------------ |
| `owner`  | 可          | 可                | 可       | 可         | 参加者レコードがある店舗のみ可 |
| `admin`  | 可          | 可                | 可       | 可         | 参加者レコードがある店舗のみ可 |
| `member` | 不可        | 不可              | 不可     | 不可       | 不可                           |

補足:

- `owner` / `admin` は store member がなくても全店舗で管理権限を持つ。
- ただし `display.primaryRole` が `manager` に偽装されることはない。根拠は `sources.* = org_role` で追う。

### 4-2. StoreStaffRole 由来

前提: OrgRole は `member` または `null` で、店舗スタッフ権限だけが効いているケース。

| StoreStaffRole | 対象店舗の設定/招待 | 予約運用 | 参加者管理 | participant導線 |
| -------------- | ------------------- | -------- | ---------- | --------------- |
| `manager`      | 可                  | 可       | 可         | 不可            |
| `staff`        | 不可                | 可       | 可         | 不可            |

補足:

- `manager` は店舗単位の管理操作を実行できる。
- `staff` は予約運用と参加者管理までで、サービス/枠/定期の管理はできない。

### 4-3. Participant record 由来

| 条件                           | participant導線 |
| ------------------------------ | --------------- |
| `hasParticipantRecord = true`  | 可              |
| `hasParticipantRecord = false` | 不可            |

補足:

- `manager` / `staff` であっても、participant レコードがなければ `effective.canUseParticipantBooking = false`。
- participant 導線の厳格仕様は維持する。管理者向けの代理閲覧・代理予約は別フェーズ。

## 5. access-tree API

### `GET /api/v1/auth/orgs/access-tree`

ログインユーザーのアクセス木を返す。

- `orgs[].org`
  - `{ id, slug, name, logo? }`
- `orgs[].facts`
  - `{ orgRole }`
- `orgs[].stores[]`
  - `id`, `slug`, `name`, `logo?`
  - `facts`
  - `effective`
  - `sources`
  - `display`

例:

```json
{
  "orgs": [
    {
      "org": {
        "id": "org_123",
        "slug": "tokyo-school",
        "name": "Tokyo School"
      },
      "facts": {
        "orgRole": "admin"
      },
      "stores": [
        {
          "id": "cls_123",
          "slug": "tokyo-school",
          "name": "Default Store",
          "facts": {
            "orgRole": "admin",
            "storeStaffRole": "staff",
            "hasParticipantRecord": true
          },
          "effective": {
            "canManageOrganization": true,
            "canManageStore": true,
            "canManageBookings": true,
            "canManageParticipants": true,
            "canUseParticipantBooking": true
          },
          "sources": {
            "canManageOrganization": "org_role",
            "canManageStore": "org_role",
            "canManageBookings": "org_role",
            "canManageParticipants": "org_role",
            "canUseParticipantBooking": "participant_record"
          },
          "display": {
            "primaryRole": "admin",
            "badges": ["admin", "staff", "participant"]
          }
        }
      ]
    }
  ]
}
```

## 6. 招待モデル

招待の正本は自前DBの unified invitation モデルに統一する。Better Auth invitation は業務招待フローでは使わない。

### invitation

- `subjectKind: org_operator | store_operator | participant`
- `role: admin | member | manager | staff | participant`
- `organizationId`
- `storeId | null`
- `email`
- `principalKind: email | existing_user`
- `participantName | null`
- `status: pending | accepted | rejected | cancelled | expired`
- `respondedByUserId | null`
- `respondedAt | null`
- `acceptedMemberId | null`
- `acceptedStoreMemberId | null`
- `acceptedParticipantId | null`
- `invitedByUserId`
- `expiresAt`, `createdAt`, `updatedAt`

### invitation_audit_log

- `eventType: created | resent | accepted | rejected | cancelled | expired`
- `invitationId`
- `organizationId`
- `storeId | null`
- `actorUserId`
- `targetEmail`
- `metadata`
- `createdAt`

### 受諾時の挙動

- `subjectKind = org_operator`
  - `role = admin | member`
  - `member` を upsert
- `subjectKind = store_operator`
  - `role = manager | staff`
  - org member を最低 `member` として存在保証し、`store_member` を upsert
  - `manager -> admin` のような org 権限昇格は行わない
- `subjectKind = participant`
  - `participant` を upsert
  - Org member は自動付与しない

## 7. 招待API

### Org operator 招待

- `POST /api/v1/auth/orgs/{orgSlug}/invitations`
- `GET /api/v1/auth/orgs/{orgSlug}/invitations`

### Store 招待

- `POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/invitations`
- `GET /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/invitations`

`role = participant`（参加者）は参加者招待として扱う。
`role = manager | staff`（店舗管理者 / 店舗スタッフ）は store operator 招待として同じ endpoint を使う。

### ユーザー操作

- `GET /api/v1/auth/invitations/user`
- `GET /api/v1/auth/invitations/{invitationId}`
- `POST /api/v1/auth/invitations/{invitationId}/accept`
- `POST /api/v1/auth/invitations/{invitationId}/reject`
- `POST /api/v1/auth/invitations/{invitationId}/cancel`

## 8. 画面導線

- Org admin/owner
  - `/admin/dashboard` へ誘導
  - Org/Store 切替 UI を表示
- Store staff/manager
  - 管理導線を表示
- participant-only
  - `/participant/home` へ誘導

招待受諾 UI は API が統一されていても、現状の Web では管理者向け `/invitations/accept` と participant 向け `/participants/invitations/accept` を使い分ける。

## 9. 実装メモ

- organization 作成時、既定 store を自動作成する。
- `store_id` は予約ドメイン全テーブルで必須。
- 旧 `activeStoreRole` ベースの判定と旧 `/api/v1/auth/organizations/access` は廃止済み。
