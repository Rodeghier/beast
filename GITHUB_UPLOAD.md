# GitHub source package

Extract `hvac-analysis-github.zip` and upload its files and folders to the root of your GitHub repository. Include the hidden configuration files, especially `.openai/hosting.json`, which Vite imports. If you encounter GitHub's upload file-count limit, upload in batches or use GitHub Desktop.

The ZIP includes the current site's existing NLR API key and request metadata in `.env`, as requested. Keep this archive and any repository containing those credentials private. The OpenEI and EIA keys have not been configured; `.env.example` lists their variable names.

`.env` remains in `.gitignore`, so Git and GitHub Desktop do not commit it automatically. It is included in the ZIP for local setup. If you choose to upload it manually, use a private repository. API keys must also be configured in the hosting service's server environment; GitHub repository contents do not automatically set deployed runtime secrets.

The complete source includes application code, solar-load calculations, equipment curves, EPA emissions data, rate connections, verification scripts, and the engineering guide. It excludes installed dependencies, Git history, build output, and machine-local runtime state. The original Site deployment ID is removed from this exported copy.

## Run locally

Use Node.js 24 or later and the pnpm version specified in `package.json`.

```bash
corepack enable
pnpm install
pnpm dev
```

The development application uses port 5173. Run `pnpm build` to build it.

## Edit the code

- `app/page.tsx`: main interface
- `app/globals.css`: styling
- `lib/solar.ts`: radiation and solar gains
- `lib/school.ts`: building heat and moisture balance (existing internal filename)
- `lib/rtu.ts` and `lib/rtu-curves.ts`: equipment sizing, SHR, performance, and energy
- `app/api/`: server connections
- `public/engineering-guide.pdf`: calculation documentation

This project uses React/Vinext and Cloudflare Worker server routes. Uploading it to GitHub saves the code; it does not deploy the application. GitHub Pages alone cannot run the weather and rate API routes.
