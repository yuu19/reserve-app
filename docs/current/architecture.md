# システムアーキテクチャ（Org + Store 2階層）

最終更新: 2026-05-30

## 1. 概要

本システムは以下の3層で構成する。

1. Backend: Cloudflare Workers + Hono + Better Auth + D1
2. Web: SvelteKit
3. Mobile: Expo

認可スコープは `organization(全体Org)` と `store(店舗)` の2階層。
権限判定は単一ロールではなく `facts -> effective -> sources -> display` の4層で扱う。

## 2. Backend 構成

主要モジュール:

- `src/routes/auth-routes.ts`
  - 認証
  - organization/store アクセス情報
  - unified invitation API
- `src/routes/booking-routes.ts`
  - サービス・枠・定期・予約・回数券
- `src/routes/public-routes.ts`
  - 公開イベント API
- `src/domain/booking/authorization.ts`
  - Org/Store/participant のアクセス解決
- `src/infra/db/schema.ts`
  - organization/store/participant/invitation を含む D1 スキーマ

Better Auth は認証・セッション・organization context に使い、業務招待の正本は自前DBの `invitation` / `invitation_audit_log` に置く。

## 3. API スコープ

### 認可・招待

- `GET /api/v1/auth/orgs/access-tree`
- `POST /api/v1/auth/orgs/{orgSlug}/invitations`
- `GET /api/v1/auth/orgs/{orgSlug}/invitations`
- `POST /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/invitations`
- `GET /api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/invitations`
- `GET /api/v1/auth/invitations/user`
- `GET /api/v1/auth/invitations/{invitationId}`
- `POST /api/v1/auth/invitations/{invitationId}/accept`
- `POST /api/v1/auth/invitations/{invitationId}/reject`
- `POST /api/v1/auth/invitations/{invitationId}/cancel`

### 公開イベント

- `GET /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/events`
- `GET /api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/events/{slotId}`

### 予約運用

- `booking-routes` は組織ベース API を段階維持しつつ、DB は `store_id` 必須で運用。
- 新規データは全て `store_id` を保存する。

## 4. 認可モデル

### facts

- `orgRole`
- `storeStaffRole`
- `hasParticipantRecord`

### effective

- `canManageOrganization`
- `canManageStore`
- `canManageBookings`
- `canManageParticipants`
- `canUseParticipantBooking`

### sources

- `org_role`
- `store_member`
- `participant_record`

### display

- `primaryRole`
- `badges`

`display` は UI 表示専用で、サーバ/クライアントの判定は `effective` を正本にする。

## 5. Web / Mobile 構成

主要機能:

- Web
  - 認証セッション/ポータル判定: `apps/web/src/lib/features/auth-session.svelte.ts`
  - 組織/店舗文脈: `apps/web/src/lib/features/organization-context.svelte.ts`
  - API クライアント: `apps/web/src/lib/rpc-client.ts`
- Mobile
  - 認証済み API クライアント: `apps/mobile/src/lib/mobile-api.ts`
  - 招待受諾/一覧/送信 UI: `apps/mobile/App.tsx`

Web/Mobile は同じ access-tree DTO と unified invitation DTO を消費する。

## 6. データモデル方針

- `organization`: 全体Org
- `store`: 店舗
- `member`: Org 単位メンバー
- `store_member`: 店舗スタッフ権限
- `participant`: participant record
- `invitation`: org operator / store operator / participant 招待の単一正本
- `invitation_audit_log`: 招待イベントの単一監査ログ
- 予約ドメインテーブルは `organization_id` + `store_id` を保持

## 7. 既定 store 自動作成

organization 作成時に既定 store を自動作成する。

- 目的: 招待/認可 API の store 解決を即時可能にする
- 効果: 新規 organization 直後でも `/orgs/{orgSlug}/stores/{storeSlug}/*` が利用可能

## 8. 非機能

- 型安全: TypeScript + zod-openapi
- テスト: Vitest（server/browser）
- デプロイ: Wrangler + GitHub Actions

## 9. 今回のスコープ外

- participant UI の代理閲覧/代理予約
- `member` 概念の再定義
- booking API の URL 完全 store 化
