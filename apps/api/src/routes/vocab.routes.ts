/** /api/vocab: your vocabulary deck. */
import { Router } from "express";
import * as ctrl from "../controllers/learn.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();
/** Your deck, newest first (`Page<VocabItem>`). `?q=` searches phrase and meaning. */
router.get("/", authenticate, ctrl.listVocab);
/** Save a phrase `{ phrase, meaningNative, examples?, sessionId? }`. Saving the same phrase again returns the existing card. */
router.post("/", authenticate, rateLimit("vocab-save", 300, 3600), ctrl.saveVocab);
/** Remove a card. 204. 404 VOCAB_NOT_FOUND. */
router.delete("/:id", authenticate, ctrl.deleteVocab);
