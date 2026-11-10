/* global fetch, TextDecoder */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decide, fenced, startStubs, stubLesson } from "../server.mjs";

const LESSON_SYSTEM = "You are a language learning analyst...\nOutput format: lesson_report\nReturn one JSON object";

const convo = (...lines) => `<untrusted source="conversation">\n${lines.join("\n")}\n</untrusted>`;

describe("the text model", () => {
  it("reads fenced material", () => {
    expect(fenced('x\n<untrusted source="role">\nData Analyst\n</untrusted>\ny', "role")).toBe("Data Analyst");
    expect(fenced("nothing here", "role")).toBe("");
  });

  it("writes a lesson from the conversation: vocabulary from the tutor, scores from what the learner said, five drills", () => {
    const short = stubLesson(convo("Tutor: Hola (Hello)", "Learner: hola"));
    const long = stubLesson(convo("Tutor: Hola, ¿cómo estás? (Hello, how are you?)", `Learner: Estoy muy bien ${"gracias ".repeat(30)}`));
    expect(long.score.fluency).toBeGreaterThan(short.score.fluency);
    expect(short.vocab[0]).toMatchObject({ phrase: "Hola", meaningNative: "Hello" });
    expect(short.drills).toHaveLength(5);
    expect(short.corrections[0]).toMatchObject({ original: "hola", corrected: "Hola" });
    expect(long.corrections).toEqual([]);
  });

  it("routes on the output format and the failure words", () => {
    expect(JSON.parse(decide(LESSON_SYSTEM, convo("Learner: Hola")).text).drills).toHaveLength(5);
    expect(decide(LESSON_SYSTEM, "STUB_FAIL").status).toBe(500);
    expect(decide(LESSON_SYSTEM, "STUB_RATELIMIT").status).toBe(429);
    expect(() => JSON.parse(decide(LESSON_SYSTEM, "STUB_GARBAGE").text)).toThrow();
    expect(decide("anything", "Reply with the single word: ok").text).toBe("ok");
  });
});

describe("server", () => {
  let stubs;
  beforeAll(async () => {
    stubs = await startStubs();
  });
  afterAll(async () => {
    await stubs.close();
  });
  beforeEach(async () => {
    await fetch(`${stubs.url}/__/reset`, { method: "POST" });
  });

  it("streams chat completions", async () => {
    const res = await fetch(`${stubs.url}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stream: true, messages: [{ role: "system", content: LESSON_SYSTEM }, { role: "user", content: convo("Learner: Hola") }] }) });
    const text = new TextDecoder().decode(await res.arrayBuffer());
    expect(text).toContain("fluency");
    expect(text).toContain("[DONE]");
  });

  it("mints realtime client secrets, accepts the SDP offer with them, and records hang-ups", async () => {
    const mint = await fetch(`${stubs.url}/v1/realtime/client_secrets`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" }, body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 60 }, session: { type: "realtime", instructions: "Greet the learner." } }) });
    const { value } = await mint.json();
    expect(value).toMatch(/^ek_stub/);
    const call = await fetch(`${stubs.url}/v1/realtime/calls`, { method: "POST", headers: { "Content-Type": "application/sdp", Authorization: `Bearer ${value}` }, body: "v=0\r\n" });
    expect(call.status).toBe(201);
    const callId = call.headers.get("location").split("/").pop();
    const unknown = await fetch(`${stubs.url}/v1/realtime/calls`, { method: "POST", headers: { Authorization: "Bearer ek_nope" }, body: "v=0" });
    expect(unknown.status).toBe(401);
    await fetch(`${stubs.url}/v1/realtime/calls/${callId}/hangup`, { method: "POST" });
    const seen = await (await fetch(`${stubs.url}/__/realtime`)).json();
    expect(seen.secrets[0].session.instructions).toBe("Greet the learner.");
    expect(seen.hangups).toEqual([callId]);
  });
});
