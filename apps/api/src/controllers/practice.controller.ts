/** Practice sessions, live voice and the OpenAI SDP relay. Thin controllers. */
import type { Request, Response } from "express";
import { z } from "zod";
import { badRequest } from "../core/errors";
import { captureError } from "../core/logger";
import { id, idParam, pageQuery, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as live from "../services/practice/live.service";
import * as practice from "../services/practice/practice.service";
import { MAX_TRANSCRIPT_CHARS_PER_LINE, MAX_TRANSCRIPT_LINES } from "../services/practice/transcript";

export async function list(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ status: z.enum(["IN_PROGRESS", "ANALYZING", "COMPLETED", "FAILED"]).optional() }), req.query);
  res.json(await practice.listPractice(actorOf(req), q));
}

export async function get(req: Request, res: Response) {
  // The client polls this while the report is being written.
  res.setHeader("Cache-Control", "no-store");
  res.json(await practice.getPractice(actorOf(req), parse(idParam, req.params).id));
}

export async function start(req: Request, res: Response) {
  const body = parse(z.object({ scenarioId: id().nullish() }).strict(), req.body);
  res.status(201).json(await practice.startPractice(actorOf(req), { scenarioId: body.scenarioId ?? null }));
}

export async function end(req: Request, res: Response) {
  // Only roles and text are accepted: scores, corrections and instructions are never read from a client.
  const body = parse(
    z
      .object({
        transcript: z
          .array(z.object({ role: z.enum(["tutor", "learner"]), text: z.string().max(MAX_TRANSCRIPT_CHARS_PER_LINE * 4) }).strict())
          .max(MAX_TRANSCRIPT_LINES * 2)
          .default([]),
      })
      .strict(),
    req.body,
  );
  res.status(202).json(await practice.endPractice(actorOf(req), parse(idParam, req.params).id, body));
}

export async function retry(req: Request, res: Response) {
  res.status(202).json(await practice.retryPractice(actorOf(req), parse(idParam, req.params).id));
}

export async function remove(req: Request, res: Response) {
  await practice.deletePractice(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function startLive(req: Request, res: Response) {
  // No body is read: nothing the browser sends can shape the session.
  res.setHeader("Cache-Control", "no-store");
  res.status(201).json(await live.startLive(actorOf(req), parse(idParam, req.params).id));
}

export async function endLive(req: Request, res: Response) {
  const p = parse(z.object({ id: id(), sid: id() }), req.params);
  res.json(await live.endLive(actorOf(req), p.id, p.sid));
}

// ─── OpenAI SDP relay ───────────────────────────────────────────────────────

/**
 * POST /api/realtime/openai/calls: forwards the browser's WebRTC SDP offer to OpenAI and
 * returns the answer. It exists for two reasons: networks that block api.openai.com can
 * still hold a lesson (the browser only talks to this API for the handshake), and the
 * server learns the call id so it can hang up when the session's time is over. Only a
 * credential minted by POST /practice/:id/live, still in its connection window and not
 * used before, is relayed.
 */
export async function relayOpenAiSdp(req: Request, res: Response) {
  const auth = req.get("authorization") ?? "";
  const credential = auth.match(/^Bearer\s+(ek_[A-Za-z0-9_-]{8,400})$/)?.[1];
  const claim = credential ? await live.claimRelay(credential) : null;
  if (!credential || !claim) {
    res.status(401).json({ error: "This voice session is not valid or has expired", code: "REALTIME_SESSION_INVALID" });
    return;
  }
  const offer = typeof req.body === "string" ? req.body : "";
  if (!offer.startsWith("v=0")) throw badRequest("Missing SDP offer", "SDP_REQUIRED");
  try {
    const upstream = await fetch(`${claim.baseUrl.replace(/\/$/, "")}/realtime/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/sdp", Authorization: `Bearer ${credential}` },
      body: offer,
      signal: AbortSignal.timeout(20_000),
    });
    const answer = await upstream.text();
    const location = upstream.headers.get("location");
    const callId = location?.split("/").filter(Boolean).pop();
    if (upstream.ok && callId) await live.rememberCall(claim.sessionId, callId);
    if (location) res.setHeader("Location", location);
    res.setHeader("Access-Control-Expose-Headers", "Location");
    res.status(upstream.ok ? upstream.status : 502).type("application/sdp").send(upstream.ok ? answer : "");
  } catch (err) {
    captureError(err, { where: "realtime.relay" });
    res.status(502).json({ error: "The voice service could not be reached", code: "REALTIME_UNAVAILABLE" });
  }
}
