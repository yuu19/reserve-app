# システムアーキテクチャ（Org + Classroom 2階層）

最終更新: 2026-03-10

## 1. 概要

本システムは以下の3層で構成する。

1. Backend: Cloudflare Workers + Hono + Better Auth + D1
2. Web: SvelteKit
3. Mobile: Expo

認可スコープは `organization(全体Org)` と `classroom(教室)` の2階層。
権限判定は単一ロールではなく `facts -> effective -> sources -> display` の4層で扱う。

## 2. Backend 構成

主要モジュール:

- `src/routes/auth-routes.ts`
  - 認証
  - organization/classroom アクセス情報
  - unified invitation API
- `src/routes/booking-routes.ts`
  - サービス・枠・定期・予約・回数券
- `src/routes/public-routes.ts`
  - 公開イベント API
- `src/booking/authorization.ts`
  - Org/Classroom/participant のアクセス解決
- `src/db/schema.ts`
  - organization/classroom/participant/invitation を含む D1 スキーマ

Better Auth は認証・セッション・organization context に使い、業務招待の正本は自前DBの `invitation` / `invitation_audit_log` に置く。

## 3. API スコープ

### 認可・招待

- `GET /api/v1/auth/orgs/access-tree`
- `POST /api/v1/auth/orgs/{orgSlug}/invitations`
- `GET /api/v1/auth/orgs/{orgSlug}/invitations`
- `POST /api/v1/auth/orgs/{orgSlug}/classrooms/{classroomSlug}/invitations`
- `GET /api/v1/auth/orgs/{orgSlug}/classrooms/{classroomSlug}/invitations`
- `GET /api/v1/auth/invitations/user`
- `GET /api/v1/auth/invitations/{invitationId}`
- `POST /api/v1/auth/invitations/{invitationId}/accept`
- `POST /api/v1/auth/invitations/{invitationId}/reject`
- `POST /api/v1/auth/invitations/{invitationId}/cancel`

### 公開イベント

- `GET /api/v1/public/orgs/{orgSlug}/classrooms/{classroomSlug}/events`
- `GET /api/v1/public/orgs/{orgSlug}/classrooms/{classroomSlug}/events/{slotId}`

### 予約運用

- `booking-routes` は組織ベース API を段階維持しつつ、DB は `classroom_id` 必須で運用。
- 新規データは全て `classroom_id` を保存する。

## 4. 認可モデル

### facts

- `orgRole`
- `classroomStaffRole`
- `hasParticipantRecord`

### effective

- `canManageOrganization`
- `canManageClassroom`
- `canManageBookings`
- `canManageParticipants`
- `canUseParticipantBooking`

### sources

- `org_role`
- `classroom_member`
- `participant_record`

### display

- `primaryRole`
- `badges`

`display` は UI 表示専用で、サーバ/クライアントの判定は `effective` を正本にする。

## 5. Web / Mobile 構成

主要機能:

- Web
  - 認証セッション/ポータル判定: `apps/web/src/lib/features/auth-session.svelte.ts`
  - 組織/教室文脈: `apps/web/src/lib/features/organization-context.svelte.ts`
  - API クライアント: `apps/web/src/lib/rpc-client.ts`
- Mobile
  - 認証済み API クライアント: `apps/mobile/src/lib/mobile-api.ts`
  - 招待受諾/一覧/送信 UI: `apps/mobile/App.tsx`

Web/Mobile は同じ access-tree DTO と unified invitation DTO を消費する。

## 6. データモデル方針

- `organization`: 全体Org
- `classroom`: 教室
- `member`: Org 単位メンバー
- `classroom_member`: 教室スタッフ権限
- `participant`: participant record
- `invitation`: org operator / classroom operator / participant 招待の単一正本
- `invitation_audit_log`: 招待イベントの単一監査ログ
- 予約ドメインテーブルは `organization_id` + `classroom_id` を保持

## 7. 既定 classroom 自動作成

organization 作成時に既定 classroom を自動作成する。

- 目的: 招待/認可 API の classroom 解決を即時可能にする
- 効果: 新規 organization 直後でも `/orgs/{orgSlug}/classrooms/{classroomSlug}/*` が利用可能

## 8. 非機能

- 型安全: TypeScript + zod-openapi
- テスト: Vitest（server/browser）
- デプロイ: Wrangler + GitHub Actions

## 9. 今回のスコープ外

- participant UI の代理閲覧/代理予約
- `member` 概念の再定義
- booking API の URL 完全 classroom 化
