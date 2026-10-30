/**
 * OPTIONAL DATABASE SCAFFOLD. No active analysis page/API imports this helper.
 * A D1 binding is required before getDb can be used. Current HVAC results are
 * held in browser state rather than written through this module.
 */

import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Configure a D1 database with binding `DB` in wrangler.jsonc before using this optional helper."
    );
  }

  return drizzle(env.DB, { schema });
}
