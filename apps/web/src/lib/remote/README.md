# Remote Functions 運用ルール

## 目的

このディレクトリは SvelteKit Remote Functions の段階移行用です。
取得系を段階的に Remote Functions へ移しつつ、既存 `authRpc` は書き込み系を中心に維持します。

## 配置

- Remote Functions は `src/lib/remote/*.remote.ts` に配置する
- `src/lib/server` 直下には配置しない

## 命名

- 読み取り: `getXxx` を `query` で定義
- 更新系: `createXxx` / `updateXxx` / `deleteXxx` を `command` または `form` で定義

## 入力検証

- 引数あり関数は `zod` スキーマを必須にする
- `unchecked` は使用しない

## 既存実装との共存

- `src/lib/rpc-client.ts` は当面維持
- 移行は「1機能ずつ」行う
- 既存 UI 挙動を変える移行は段階ごとにテストする

## ページ集約 Query（運用中）

- `/admin/bookings` と `/participant/bookings` 表示データ: `bookings-page.remote.ts` の `getBookingsPageData`
- `/admin/participants` と `/participant/invitations` 表示データ: `participants-page.remote.ts` の `getParticipantsPageData`
- `/events` 公開閲覧データ: `events-page.remote.ts` の `getPublicEvents` / `getPublicEventDetail`
- bookings/participants 系は active organization 解決を query 内で行う

## エラー方針

- データ取得は Fail-fast を採用し、想定外の非OKレスポンスは即時エラー化する
- 権限分岐で想定される `403` は通常分岐として扱い、画面側の権限制御を維持する
- active organization 未選択時はエラーにせず空データを返す

## 禁止事項

- 一度に全画面・全機能を Remote Functions に置換しない
- 既存 API 契約を壊す変更をしない
- `.remote.ts` からクライアント専用モジュール（`$app/navigation` 等）を参照しない
