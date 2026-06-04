---
name: ai-agent-billing-verification
description: Use when running reserve-app AI-agent-assisted billing verification, Stripe Billing E2E, Webwright/UI evidence capture for contract screens, read-only Cloudflare/Stripe/GitHub Actions/Resend checks, or preparing billing verification reports.
---

# AI Agent Billing Verification

## 最初に読む正本

まず `docs/operations/ai-agent-billing-verification.md` を読む。この skill は実行時の手順をまとめるだけで、詳細な確認項目やレポート形式は repo 内ドキュメントを正本にする。

- 確認項目の正本: `docs/operations/billing-verification-checklist.md`
- CI/E2E の位置づけの正本: `docs/operations/test-strategy.md`
- AI agent は最終判定者ではない。検証手順を実行し、観測結果と証跡を整理する担当として扱う。

## 実行前確認

作業開始前に、次をユーザー指示、repo 状態、対象環境情報から確認する。不明で安全に推測できない場合は、実行前に確認する。

- 対象 commit または差分
- 対象環境: local、preview、staging など
- 実行権限: E2E、UI agent、外部サービス read-only 確認の可否
- 確認範囲: チェックリスト全体か、特定レイヤーまたは特定項目か

## 実行ルール

1. `docs/operations/billing-verification-checklist.md` から今回の対象項目を決める。
2. Deterministic E2E は次のコマンドを使う。

   ```bash
   BILLING_E2E_ENABLED=true pnpm --filter @repo/e2e test:e2e:billing
   ```

3. UI agent / Webwright は契約画面の表示差分、操作導線、スクリーンショット証跡の確認に限定する。Stripe Test Clock、Webhook replay、外部設定変更の正本として扱わない。
4. Cloudflare、Stripe、GitHub Actions、Resend は read-only の CLI/API または管理画面閲覧に限定する。設定変更は行わない。
5. 実行結果は `pass`、`fail`、`skipped`、`manual-required` のいずれかで記録する。
6. `fail` は再現手順、期待結果、実際の結果、証跡パスを残す。`manual-required` は必要な権限、確認先、後続確認者を残す。
7. レポートは必要に応じて `reports/billing-verification/YYYY-MM-DD-<commit>.md` 形式で作成する。常に commit する前提にはせず、GitHub Actions artifact、PR 添付、リリース判断資料として扱えるようにする。

## 保存禁止情報

次の情報はログ、スクリーンショット、レポート、チャット応答に残さない。

- Stripe secret
- Webhook signing secret
- カード番号
- 税務詳細
- Stripe raw payload

必要な場合は、安全な識別子、状態、時刻、実行 ID、証跡パスだけを記録する。保存禁止情報が証跡に含まれた場合は共有せず、安全な情報だけで再取得し、削除は担当者に依頼する。
