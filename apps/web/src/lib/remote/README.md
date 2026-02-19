# Remote Functions 運用ルール

## 目的

このディレクトリは SvelteKit Remote Functions の段階移行用です。
今回は設定と雛形のみ導入し、既存 `authRpc` は維持します。

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

## 禁止事項

- 一度に全画面・全機能を Remote Functions に置換しない
- 既存 API 契約を壊す変更をしない
- `.remote.ts` からクライアント専用モジュール（`$app/navigation` 等）を参照しない
