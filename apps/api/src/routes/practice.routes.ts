/** /api/practice: start, hold and review conversations with the tutor. Every route is owner-scoped. */
import { Router } from "express";
import * as ctrl from "../controllers/practice.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

/** Your practice sessions, newest first (`Page<PracticeSummary>`). `?status=` filters. */
router.get("/", authenticate, ctrl.list);
/**
 * Start a session `{ scenarioId? }` (omit it for free conversation). Books one session against this month's quota and returns the
 * `PracticeSession` in IN_PROGRESS. 400 SCENARIO_NOT_FOUND, 403 FEATURE_DISABLED, 409 PROFILE_INCOMPLETE, 429 QUOTA_EXCEEDED, 503 NO_REALTIME_MODEL.
 */
router.post("/", authenticate, rateLimit("practice-create", 60, 3600), ctrl.start);
/** One session with its transcript and, once COMPLETED, its lesson report (`PracticeSession`). 404 when it is not yours. Poll while ANALYZING. */
router.get("/:id", authenticate, ctrl.get);
/** Delete the session, its transcript, corrections and drills. Does not give quota back. 204. */
router.delete("/:id", authenticate, ctrl.remove);
/**
 * Open a live voice session (`LiveSessionGrant`): a short-lived credential with the tutor's instructions locked inside it by the
 * server. The body is ignored. Closes any other open session of yours. 409 PRACTICE_ENDED, 429 QUOTA_EXCEEDED, 502 REALTIME_UNAVAILABLE, 503 NO_REALTIME_MODEL.
 */
router.post("/:id/live", authenticate, rateLimit("practice-live", 60, 3600), ctrl.startLive);
/** Close a live session and book its server-measured time (`LiveSessionEnd`). Idempotent. */
router.post("/:id/live/:sid/end", authenticate, ctrl.endLive);
/**
 * Finish the conversation `{ transcript: [{ role: "tutor" | "learner", text }] }`. The server cleans the transcript (400 lines, 2000
 * characters each), measures the time itself and queues the lesson report. 202 `PracticeSession` in ANALYZING; calling it again changes nothing.
 */
router.post("/:id/end", authenticate, rateLimit("practice-end", 120, 3600), ctrl.end);
/** Write the report again after FAILED, or after five minutes in ANALYZING (a lost job). 202 `PracticeSession`. 409 PRACTICE_NOT_FAILED. */
router.post("/:id/retry", authenticate, rateLimit("practice-retry", 20, 3600), ctrl.retry);
