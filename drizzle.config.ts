/**
 * DATABASE MIGRATION TOOL CONFIGURATION. Relevant only if database storage is
 * added. It does not control the weather, building model or equipment curves.
 */

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./db/schema.ts",
  dialect: "sqlite",
});
