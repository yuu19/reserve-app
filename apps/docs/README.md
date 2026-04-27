# Docs (SvelteKit + mdsvex + Cloudflare Workers)

ユーザーマニュアルを公開するための docs アプリです。  
本番公開先は `https://docs.wakureserve.com` を想定しています。

## Local development

```sh
pnpm install
pnpm --filter @apps/docs dev
```

Cloudflare Workers ライクなローカル実行:

```sh
pnpm --filter @apps/docs run cf:dev
```

## Build / check

```sh
pnpm --filter @apps/docs build
pnpm --filter @apps/docs check
```

Production build の Worker preview:

```sh
pnpm --filter @apps/docs preview
```

## Cloudflare Workers deploy

`wrangler.jsonc` では次を前提にしています。

- Worker 名: `reserve-app-docs`
- Custom domain: `docs.wakureserve.com`
- `workers_dev: true`

手動デプロイ:

```sh
pnpm --filter @apps/docs run cf:deploy
```

リポジトリ root から:

```sh
pnpm deploy:docs
```

## GitHub Actions deploy

`.github/workflows/deploy-workers.yml` に `docs` 用の deploy job を追加しています。  
`main` への push、または manual dispatch の `target=docs` / `target=all` でデプロイされます。

必要な GitHub Secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

docs アプリ単体には追加の GitHub Variables は不要です。
