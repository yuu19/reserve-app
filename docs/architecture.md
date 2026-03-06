# システムアーキテクチャ（Org + Classroom 2階層）

最終更新: 2026-03-06

## 1. 概要

本システムは以下の3層で構成する。

1. Backend: Cloudflare Workers + Hono + Better Auth + D1
2. Web: SvelteKit
3. Mobile: Expo（今回スコープ外）

認可スコープは `organization(全体Org)` と `classroom(教室)` の2階層。

## 2. Backend 構成

主要モジュール:

- `src/routes/auth-routes.ts`
  - 認証
  - organization/classroom アクセス情報
  - 招待（classroom member / participant）
- `src/routes/booking-routes.ts`
  - サービス・枠・定期・予約・回数券
- `src/routes/public-routes.ts`
  - 公開イベント API
- `src/booking/authorization.ts`
  - 2段階認可判定

## 3. API スコープ

### 認可・招待（新）

- `GET /api/v1/auth/orgs/access-tree`
- `POST /api/v1/auth/orgs/{orgSlug}/classrooms/{classroomSlug}/invitations`
- `GET /api/v1/auth/orgs/{orgSlug}/classrooms/{classroomSlug}/invitations`
- `GET /api/v1/auth/orgs/classrooms/invitations/user`
- `GET /api/v1/auth/orgs/classrooms/invitations/detail`
- `POST /api/v1/auth/orgs/classrooms/invitations/accept`
- `POST /api/v1/auth/orgs/classrooms/invitations/reject`
- `POST /api/v1/auth/orgs/classrooms/invitations/cancel`

### 公開イベント（新）

- `GET /api/v1/public/orgs/{orgSlug}/classrooms/{classroomSlug}/events`
- `GET /api/v1/public/orgs/{orgSlug}/classrooms/{classroomSlug}/events/{slotId}`

### 予約運用（移行中）

- `booking-routes` は組織ベース API を段階維持しつつ、DB は `classroom_id` 必須で運用。
- 新規データは全て `classroom_id` を保存する。

## 4. Web 構成

主要機能:

- 認証セッション/ポータル判定
  - `src/lib/features/auth-session.svelte.ts`
- 組織/教室文脈
  - `src/lib/features/organization-context.svelte.ts`
  - `src/lib/features/scoped-routing.ts`
- API クライアント
  - `src/lib/rpc-client.ts`
  - `src/lib/remote/*.remote.ts`

主要導線:

- 管理者: `/admin/*`
- 参加者: `/participant/*`
- 公開イベント: `/events/*`

## 5. データモデル方針

- `organization`: 全体Org
- `classroom`: 教室
- 予約ドメインテーブルは `organization_id` + `classroom_id` を保持
- participant 招待は `classroom_invitation` / `classroom_invitation_audit_log` へ移行

## 6. 既定 classroom 自動作成

organization 作成時に既定 classroom を自動作成する。

- 目的: 招待/認可 API の classroom 解決を即時可能にする
- 効果: 新規 organization 直後でも `/orgs/{orgSlug}/classrooms/{classroomSlug}/*` が利用可能

## 7. 非機能

- 型安全: TypeScript + zod-openapi
- テスト: Vitest（server/browser）
- デプロイ: Wrangler + GitHub Actions

## 8. 今回のスコープ外

- Mobile の新権限モデル反映
- 旧 UI ルート完全削除
- booking API の URL 完全 classroom 化
