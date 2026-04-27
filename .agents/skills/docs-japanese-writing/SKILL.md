---
name: docs-japanese-writing
description: Write, edit, or review Japanese documentation under /docs with business-domain wording first and implementation identifiers second. Use when the user asks to create, revise, proofread, or standardize docs/README-style documentation, operational guides, deployment notes, or product behavior documents in this repository.
---

# Docs Japanese Writing

## Core Rule

Write `/docs` documentation around business targets, states, and operations in Japanese. Explain behavior first. Put implementation identifiers only where they help the reader connect the behavior to code or operations.

## Writing Guidelines

- Center the main text on業務上の対象, 状態, 操作, and結果.
- Prefer Japanese when the business meaning is clear in Japanese.
- Do not make English concept words the center of the prose, except for required proper nouns such as external service names, public API names, and event names.
- Keep DB table names, column names, event names, and API parameter names out of the main sentence when possible.
- Explain behavior first, then add implementation identifiers as supporting notes.
- Use English alongside Japanese, or keep original English, for industry-standard terms or concepts where translation may cause confusion.
- Keep sentences short. Do not pack target, condition, result, and exception into one sentence.

## Structure Pattern

Use this order when it fits the document:

1. State what happens in business terms.
2. State who or what is affected.
3. State conditions and exceptions in separate short sentences.
4. Add implementation notes only after the behavior is clear.

Example:

```markdown
契約状態が有効な組織では、予約運用の拡張機能を利用できます。
無料プランの組織では、この操作は実行できません。

実装メモ:
- 契約状態は `organization_billing` の状態から判定します。
- API は `organizationId` を受け取り、対象組織の権限を確認します。
```

## Avoid

- Avoid starting a section with table names, column names, or API parameters before explaining the behavior.
- Avoid prose that reads as translated English when a natural Japanese business phrase exists.
- Avoid long sentences that combine normal behavior, failure behavior, storage location, and identifiers.
- Avoid using implementation identifiers as the only explanation of business meaning.

## Review Checklist

Before finishing, check:

- The first explanation says what happens, not where a value is stored.
- Business readers can understand the state or operation without knowing DB/API names.
- Necessary identifiers are present only as supplements or implementation notes.
- Exceptions are separated into short sentences.
- Proper nouns and industry-standard terms are left in English only when that improves accuracy.
