# 権限設計（全体Org + 複数Classroom）

最終更新: 2026-03-07

## 1. 目的

`organization = 全体Org`、`classroom = 教室` の2階層で認可する。

- Org 層: 組織全体の管理責務
- Classroom 層: 教室単位の運用責務

## 2. ロールモデル

### OrgRole

- `owner`
- `admin`
- `member`

### ClassroomRole

- `manager`
- `staff`
- `participant`

## 3. 実効権限

### OrgRole 由来

- `owner/admin`
  - 全教室の管理（教室作成・招待・設定）
  - 管理者ダッシュボード導線
- `member`
  - Org 全体管理は不可

### ClassroomRole 由来

- `manager`
  - 当該教室の管理操作を許可
- `staff`
  - 予約運用・参加者管理を許可
  - サービス/枠/定期の管理は不可
- `participant`
  - 参加者導線のみ許可

## 4. ロール別権限一覧

### 4-1. OrgRole 単独

| OrgRole | Org全体管理 | 全教室の設定/招待 | 予約運用 | 参加者管理 | participant導線 |
| --- | --- | --- | --- | --- | --- |
| `owner` | 可 | 可 | 可 | 可 | 参加者レコードがある教室のみ可 |
| `admin` | 可 | 可 | 可 | 可 | 参加者レコードがある教室のみ可 |
| `member` | 不可 | 不可 | 不可 | 不可 | 不可 |

補足:

- `owner` / `admin` は実装上、全教室で `manager` 相当として扱う。
- `member` は Org 所属を表すだけで、単独では管理権限も participant 権限も持たない。

### 4-2. ClassroomRole 単独

前提: OrgRole は `member` または `null` で、教室側ロールだけが効いているケース。

| ClassroomRole | 対象教室の設定/招待 | 予約運用 | 参加者管理 | participant導線 |
| --- | --- | --- | --- | --- |
| `manager` | 可 | 可 | 可 | 不可 |
| `staff` | 不可 | 可 | 可 | 不可 |
| `participant` | 不可 | 不可 | 不可 | 可 |

補足:

- `manager` は教室単位の管理操作を実行できる。
- `staff` は予約運用と参加者管理までで、サービス/枠/定期の管理はできない。
- `participant` は自分の予約導線だけを利用できる。

### 4-3. 実効権限の優先ルール

| 条件 | `activeOrganizationRole` | `activeClassroomRole` | 実効権限 |
| --- | --- | --- | --- |
| OrgRole が `owner` / `admin` | `owner` / `admin` | `manager` | Org 管理 + 教室管理 + 予約運用 + 参加者管理 |
| OrgRole が `member` かつ classroom member が `manager` | `member` | `manager` | 対象教室の管理 + 予約運用 + 参加者管理 |
| OrgRole が `member` かつ classroom member が `staff` | `member` | `staff` | 対象教室の予約運用 + 参加者管理 |
| participant レコードのみ存在 | `member` または `null` | `participant` | participant 導線のみ |
| OrgRole `member` のみ | `member` | `null` | 権限なし |

補足:

- `activeClassroomRole` は `OrgRole -> classroom member -> participant` の順で解決する。
- `canUseParticipantBooking` は `participant` レコードがある教室だけで `true` になる。
- `manager` / `staff` であっても、participant レコードがなければ participant 画面の利用権は付かない。

## 5. 判定フェーズ

### Stage 1: 全体アクセス（cross-org）

- `hasOrganizationAdminAccess`
- `hasParticipantAccess`

用途:

- ログイン直後のポータル振り分け
- 管理者/参加者導線の可否

### Stage 2: active context（org + classroom）

- `canManage`
- `canManageBookings`
- `canManageParticipants`
- `canUseParticipantBooking`
- `activeOrganizationRole`
- `activeClassroomRole`

用途:

- 画面内ボタン表示
- API 実行可否

## 6. アクセスAPI

### `GET /api/v1/auth/orgs/access-tree`

ログインユーザーのアクセス木を返す。

- `orgs[].org`: `{ id, slug, name }`
- `orgs[].orgRole`: `owner | admin | member | null`
- `orgs[].classrooms[]`
  - `id`, `slug`, `name`
  - `role`: `manager | staff | participant | null`
  - `canManage`, `canManageBookings`, `canManageParticipants`, `canUseParticipantBooking`

## 7. 招待モデル

### 教室メンバー招待

- API: `/api/v1/auth/orgs/{orgSlug}/classrooms/{classroomSlug}/invitations`
- role: `manager | staff`
- 内部的には Better Auth の `invitation` を利用

### 教室参加者招待

- API: 上記と同一（`role: participant`）
- DB: `classroom_invitation`
- 監査ログ: `classroom_invitation_audit_log`

### 承諾・拒否・取消

- `/api/v1/auth/orgs/classrooms/invitations/{accept|reject|cancel}`
- 受諾時、participant は Org member を自動付与しない

## 8. 画面導線

- Org admin/owner
  - `/admin/dashboard` へ誘導
  - Org/Classroom 切替 UI を表示
- Classroom staff/manager
  - 管理導線を表示（許可範囲に限定）
- participant-only
  - `/participant/home` へ誘導

## 9. 実装メモ

- 既存 organization 作成時、既定 classroom を自動作成する。
- `classroom_id` は予約ドメイン全テーブルで必須。
- 旧 organization 単位 API は段階的に縮退し、org/classroom スコープAPIへ移行する。
