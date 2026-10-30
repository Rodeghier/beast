# Local setup and hosting

BEAST builds with Vinext and runs its server routes on Cloudflare Workers. The browser performs the engineering calculations. The server keeps provider credentials private and retrieves weather and price data. Hosting uses the repository's `wrangler.jsonc` directly; no site-builder account or sign-in integration is required.

## Local development

Install Node.js 22.13 or later and pnpm 11.25.0, the version pinned in `package.json`. Run from the repository root:

```text
pnpm install --frozen-lockfile
```

Copy `.env.example` to `.env` with your file manager, then enter your own values. The placeholder file contains no credentials. Both the development server and the production-build preview read the root `.env` file.

| Variable | Purpose | Requirement |
| --- | --- | --- |
| `NLR_API_KEY` | Hourly climate download authorization | Required to download weather |
| `NLR_EMAIL` | Climate provider request identity | Required to download weather |
| `NLR_FULL_NAME` | Climate request metadata | Supply your provider details |
| `NLR_AFFILIATION` | Climate request metadata | Supply your provider details |
| `OPENEI_API_KEY` | Electricity tariff lookup | Optional; manual electricity rates remain available |
| `EIA_API_KEY` | State commercial gas prices | Optional; gas cost requires price data |

Start the development server:

```text
pnpm dev
```

Open `http://localhost:5173`. The page and bundled location search work without provider keys. Weather downloads require the NLR configuration; unconfigured providers return an unavailable result rather than invented data.

## Build and preview

```text
pnpm build
pnpm start
```

The build writes browser assets and a Worker bundle to `dist/`. `pnpm start` uses Vite preview to run that output in the local Cloudflare runtime at `http://127.0.0.1:8787`; open the address printed in the terminal. This is a local preview and does not publish anything. Stop either server with Ctrl+C.

`vite.config.ts` combines Vinext and Cloudflare's Vite plugin. `wrangler.jsonc` supplies the Worker name, entry point, compatibility date and Node compatibility setting. Vite writes the deployable configuration to `dist/server/wrangler.json`; edit the root source configuration rather than the generated file. `scripts/runtime-env.mjs` keeps local tool logs and registries under the ignored `.wrangler/` directory.

## Deploy to your own Cloudflare account

Deployment is separate from local development. It requires a Cloudflare account with permission to publish Workers. Choose an appropriate Worker name in `wrangler.jsonc`, then authenticate:

```text
pnpm exec wrangler login
pnpm build
```

Set provider values as Worker secrets, using interactive prompts so their values are not written into command history. Repeat for each configured variable from the table above:

```text
pnpm exec wrangler secret put NLR_API_KEY --config dist/server/wrangler.json
pnpm exec wrangler secret put NLR_EMAIL --config dist/server/wrangler.json
```

On first use, Wrangler may offer to create the named Worker before adding a secret. Confirm the intended account and Worker. The `NLR_FULL_NAME`, `NLR_AFFILIATION`, `OPENEI_API_KEY` and `EIA_API_KEY` values can be added with the same command pattern. Local `.env` values are not a replacement for production secrets and must not be copied into `wrangler.jsonc` or `public/`.

Publish when ready:

```text
pnpm run deploy
```

The script builds first, then Wrangler publishes the generated Worker and browser assets to your account. Use `pnpm run deploy` explicitly because pnpm also has a separate built-in command named `deploy`. The terminal prints the deployed URL. Future deployments retain existing Worker secrets unless you explicitly change them.

For a packaging check without publishing or uploading:

```text
pnpm build
pnpm exec wrangler deploy --config dist/server/wrangler.json --dry-run
```

## Optional storage and other hosts

The active analysis has no database or object-storage requirement. `db/`, `drizzle/` and `examples/d1/` remain optional scaffolding. If you later use them, configure a real D1 binding named `DB` in `wrangler.jsonc` and apply the corresponding migrations. No placeholder database IDs are supplied.

GitHub stores the source. GitHub Pages alone cannot run the server routes. This configuration targets Cloudflare Workers; a different server host requires adapting the `cloudflare:workers` imports and build/runtime configuration. The HVAC equations do not depend on the hosting provider.

Installed packages, `.env` files, `.wrangler/`, `dist/`, `work/` and `outputs/` are local or generated artifacts. An older checkout may also contain an ignored `.sites-runtime/` cache; no project command reads it. Do not include these folders in a source upload.

## Verification

```text
node node_modules/typescript/bin/tsc --noEmit
node scripts/check-school-model.mjs
node scripts/check-equipment-model.mjs
node scripts/check-beast-scorecard.mjs
node scripts/check-location-energy.mjs
pnpm build
```

After starting the app, check the home page and a city search, then download weather and load price data with your configured keys. A successful build verifies compilation, not provider availability or engineering accuracy at every operating condition.

Framework references: [Vinext](https://github.com/cloudflare/vinext), [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/), [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
