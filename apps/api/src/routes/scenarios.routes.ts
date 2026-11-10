/** /api/scenarios: the role-plays a learner can pick. */
import { Router } from "express";
import * as ctrl from "../controllers/learn.controller";
import { authenticate } from "../middleware/auth";

export const router = Router();
/** Active scenarios in display order (`Scenario[]`). `?forProfile=true` keeps those that fit your level and goals. */
router.get("/", authenticate, ctrl.listScenarios);
/** One active scenario (`Scenario`). 404 SCENARIO_NOT_FOUND. */
router.get("/:id", authenticate, ctrl.getScenario);
