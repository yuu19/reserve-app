# Web (SvelteKit + Hono RPC)

## Local development

```bash
cp .env.example .env
# (Cloudflare dev を使う場合)
cp .dev.vars.example .dev.vars
pnpm install
pnpm --filter @apps/web dev
```

`PUBLIC_BACKEND_URL` points to backend URL (default: `http://localhost:3000`).

## Cloudflare Workers deploy setup

1. Set backend URL in `wrangler.jsonc`:

- `vars.PUBLIC_BACKEND_URL`

2. Deploy:

```bash
pnpm --filter @apps/web run cf:deploy
```

## Cloudflare Workers local dev

```bash
pnpm --filter @apps/web run cf:dev
```

## GitHub Actions deploy

`.github/workflows/deploy-workers.yml` で web Worker をデプロイします。  
`PUBLIC_BACKEND_URL` は GitHub Variables から `wrangler deploy --var ...` で注入されます。
