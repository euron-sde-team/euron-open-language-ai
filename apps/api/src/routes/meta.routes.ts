/** /api/meta: public facts a client reads before anyone signs in. */
import { Router } from "express";
import * as ctrl from "../controllers/me.controller";

export const router = Router();
/** Public: name, tutor name, features, limits and the minimum app version (`AppMeta`). Cached 30 seconds. */
router.get("/", ctrl.meta);
/** Public: every language the product knows (`LanguageOption[]`); `teachable` marks those the tutor can be asked to teach. Cached 5 minutes. */
router.get("/languages", ctrl.languages);
