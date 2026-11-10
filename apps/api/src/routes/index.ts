/**
 * Every router and where it is mounted. scripts/gen-openapi.ts reads this file, so keep
 * one `[prefix, router]` entry per line.
 */
import type { Express } from "express";
import { router as admin } from "./admin.routes";
import { router as auth } from "./auth.routes";
import { router as me } from "./me.routes";
import { router as meta } from "./meta.routes";
import { router as practice } from "./practice.routes";
import { router as realtime } from "./realtime.routes";
import { router as review } from "./review.routes";
import { router as scenarios } from "./scenarios.routes";
import { router as users } from "./users.routes";
import { router as vocab } from "./vocab.routes";

export const MOUNTS = [
  ["/api/auth", auth],
  ["/api/users", users],
  ["/api/meta", meta],
  ["/api/me", me],
  ["/api/scenarios", scenarios],
  ["/api/practice", practice],
  ["/api/vocab", vocab],
  ["/api/review", review],
  ["/api/realtime", realtime],
  ["/api/admin", admin],
] as const;

export function mountRoutes(app: Express): void {
  for (const [prefix, router] of MOUNTS) app.use(prefix, router);
}
