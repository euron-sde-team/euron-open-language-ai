/** /api/me: your profile, progress, usage, voice models and preferences. */
import { Router } from "express";
import * as learn from "../controllers/learn.controller";
import * as ctrl from "../controllers/me.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();
/** Your learner profile (`LearnerProfile`); created with defaults (native English, target Spanish, level A1) on first read. */
router.get("/profile", authenticate, learn.getProfile);
/** Change any of `{ nativeLanguage, targetLanguage, level, goals, dailyMinutesTarget, onboardingComplete }`. `onboardingComplete: true` finishes onboarding. 400 LANGUAGE_UNKNOWN, LANGUAGE_NOT_TEACHABLE, LANGUAGE_SAME. */
router.put("/profile", authenticate, rateLimit("profile-update", 120, 3600), learn.putProfile);
/** Streak, minutes, scores over time, deck counts and your most frequent mistakes (`Dashboard`). */
router.get("/dashboard", authenticate, learn.dashboard);
/** This month's use against your allowance (`Usage`): practice sessions and minutes of live voice. Resets on the 1st, UTC. */
router.get("/usage", authenticate, ctrl.usage);
/** The voice models you can practise with (`RealtimeModelOption[]`). */
router.get("/realtime-models", authenticate, ctrl.realtimeModels);
/** Your `Preferences`. */
router.get("/preferences", authenticate, ctrl.getPreferences);
/** Change preferences: any of `{ voice, defaultRealtimeModelId }`. */
router.patch("/preferences", authenticate, ctrl.updatePreferences);
