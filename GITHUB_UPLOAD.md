# GitHub source package

Upload the repository source using Git or GitHub Desktop. Include `wrangler.jsonc`, `vite.config.ts`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` and the safe placeholder file `.env.example` along with the application files.

Keep actual API credentials in ignored `.env` files for local use and in your hosting service's server-side secret settings for production. `.env.example` lists the expected variable names without credentials.

Do not upload `.env`, installed dependencies, local tool caches or build output. GitHub repository contents do not automatically set deployed runtime secrets.

The source includes application code, solar-load calculations, packaged heating/cooling fits and mixed-air calculations, EPA emissions data, rate connections, verification scripts, and the engineering guide. Hosting is configured directly through `wrangler.jsonc`.

## Run locally

Use Node.js 22.13 or later and the pnpm version specified in `package.json`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Copy `.env.example` to `.env` and enter your credentials before downloading weather. The development application uses port 5173. Run `pnpm build` to build it and `pnpm start` to preview the production build. See [Local setup and hosting](docs/HOSTING.md) for full instructions.

## Edit the code

- `app/page.tsx`: main interface
- `app/globals.css`: styling
- `lib/solar.ts`: radiation and solar gains
- `lib/school.ts`: building heat and moisture balance (existing internal filename)
- `lib/packaged-cooling.ts`, `lib/packaged-heating.ts`, `lib/mixed-air.ts` and `lib/equipment-model.ts`: catalog heating/cooling fits, calculated entering conditions, equipment sizing, nominal power, fan heat/energy and automatic heating/cooling labels
- `lib/unit-ratings.ts`: standard/high nominal cooling inputs and inferred supply-fan data
- `app/api/`: server connections
- `public/engineering-guide.pdf`: calculation documentation

This project uses React/Vinext and Cloudflare Worker server routes. Uploading it to GitHub saves the code; it does not deploy the application. GitHub Pages alone cannot run the weather and rate API routes.
