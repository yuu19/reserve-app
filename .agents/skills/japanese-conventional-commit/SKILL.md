---
name: japanese-conventional-commit
description: Create or review Git commit messages in Conventional Commits format with Japanese subject/body text. Use when the user asks to write, fix, validate, or choose a commit message, including requests involving git diff/status/staged changes, commit titles, PR-ready commits, or Japanese commit-message conventions.
---

# Japanese Conventional Commit

## Core Rules

- Write commit messages in Conventional Commits format.
- Use `type` and add `scope` when it improves clarity.
- Write the subject and body explanations in Japanese.
- Keep each commit focused on one purpose.
- Add a body when the change is not self-evident; explain both what changed and why.

## Format

Use this structure:

```text
type(scope): 日本語の件名

日本語の本文。変更内容と変更理由を書く。
```

Omit `scope` when it would be noisy:

```text
type: 日本語の件名
```

## Workflow

1. Inspect the actual change when available, preferring `git status --short`, `git diff --cached`, then `git diff`.
2. Identify one primary purpose for the commit. If the change mixes unrelated purposes, suggest splitting commits.
3. Choose a Conventional Commits `type`.
4. Add a concise `scope` when a package, app, domain, or subsystem is clear.
5. Write a short Japanese subject in imperative or noun-style project convention. Avoid a trailing period.
6. Add a Japanese body when context, motivation, risk, migration, or non-obvious behavior matters.

## Type Selection

- `feat`: user-visible feature or capability.
- `fix`: bug fix or incorrect behavior correction.
- `docs`: documentation-only change.
- `test`: test-only change.
- `refactor`: internal restructure without behavior change.
- `style`: formatting-only change.
- `chore`: tooling, repository maintenance, generated metadata, or non-product task.
- `ci`: CI/CD workflow change.
- `build`: build system or dependency packaging change.
- `perf`: performance improvement.
- `revert`: revert a previous commit.

## Scope Guidance

Prefer a specific, stable scope when useful:

- App/package: `backend`, `web`, `mobile`, `docs`.
- Domain: `billing`, `auth`, `booking`, `contracts`, `stripe`.
- Tooling: `lint`, `deps`, `ci`, `speckit`.

Avoid scopes that duplicate the type or are too broad, such as `app`, `code`, or `changes`.

## Body Guidance

Add a body when:

- The reason is not obvious from the subject.
- The change affects behavior, data, migration, deployment, billing, auth, security, or user workflows.
- The commit intentionally leaves known limitations or follow-up work.

Keep the body focused:

```text
feat(billing): 組織単位の契約状態を表示する

owner が現在のプラン、トライアル期限、支払い方法の状態を確認できるようにした。
契約操作の権限を運用ロールと分離し、誤って管理者が支払い設定を変更しないようにするため。
```

## Validation

Before returning a final message, check:

- The first line matches `type(scope): 件名` or `type: 件名`.
- `type` is a valid Conventional Commits type.
- Subject/body text is Japanese, except code identifiers and product names.
- The message describes one commit purpose.
- A body is present when the change needs rationale.
