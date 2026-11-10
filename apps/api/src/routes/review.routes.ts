/** /api/review: spaced-repetition review of your deck. */
import { Router } from "express";
import * as ctrl from "../controllers/learn.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();
/** The cards due now, oldest first, at most 50 (`ReviewToday`), with how many are due in all and how many you reviewed today (UTC). */
router.get("/today", authenticate, ctrl.today);
/** Grade one card `{ vocabId, grade: again | hard | good | easy }` and schedule it (`VocabItem`). */
router.post("/grade", authenticate, rateLimit("review-grade", 1200, 3600), ctrl.grade);
