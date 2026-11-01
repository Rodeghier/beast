/**
 * BUILD AND LOCAL SERVER CONFIGURATION. Vinext compiles browser and server
 * code. Cloudflare runs the API routes using wrangler.jsonc; no external site
 * builder or hosting manifest is needed. HVAC equations remain in lib/.
 */
import vinext from "vinext";
import { defineConfig } from "vite";
import "./scripts/runtime-env.mjs";

export default defineConfig(async () => {
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    server: {
      watch: { ignored: ["**/work/**", "**/outputs/**", "**/.sites-runtime/**"] },
    },
    plugins: [
      vinext(),
      cloudflare({
        configPath: "./wrangler.jsonc",
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
      }),
    ],
  };
});
