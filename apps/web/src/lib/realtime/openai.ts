/**
 * OpenAI Realtime over plain WebRTC, without an SDK: one peer connection with the
 * microphone track, a data channel for events, and the SDP offer posted to the API's
 * relay with the short-lived client secret. The session (instructions, voice,
 * transcription, turn detection) was configured by the server when it minted the
 * secret; this client never sends `session.update`, so it cannot change it.
 *
 * Event names: the GA API uses `response.output_audio_transcript.*`; the older
 * `response.audio_transcript.*` names are accepted too.
 */
import type { ConnectOptions, RealtimeTransport, TransportEvent } from "./types";
import { BLOCKED_NETWORK } from "./types";

export function openAiTransport(): RealtimeTransport {
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let emit: (e: TransportEvent) => void = () => undefined;
  let tutorLine = "";
  let micTrack: MediaStreamTrack | null = null;

  const send = (ev: Record<string, unknown>) => {
    if (dc?.readyState === "open") dc.send(JSON.stringify(ev));
  };

  const onMessage = (raw: string) => {
    let ev: { type?: string; delta?: string; transcript?: string; error?: { message?: string } };
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    switch (ev.type) {
      case "input_audio_buffer.speech_started":
        emit({ type: "speaking", who: "learner", on: true });
        break;
      case "input_audio_buffer.speech_stopped":
        emit({ type: "speaking", who: "learner", on: false });
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (ev.transcript?.trim()) emit({ type: "line", role: "learner", text: ev.transcript.trim() });
        break;
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
        tutorLine += ev.delta ?? "";
        emit({ type: "line", role: "tutor", text: tutorLine, partial: true });
        emit({ type: "speaking", who: "tutor", on: true });
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        emit({ type: "line", role: "tutor", text: (ev.transcript ?? tutorLine).trim() });
        tutorLine = "";
        break;
      case "output_audio_buffer.stopped":
      case "response.done":
        emit({ type: "speaking", who: "tutor", on: false });
        break;
      case "error":
        emit({ type: "error", message: ev.error?.message ?? "The voice service reported an error." });
        break;
    }
  };

  return {
    async connect({ grant, mic, audio, onEvent }: ConnectOptions) {
      emit = onEvent;
      emit({ type: "stage", stage: "connecting" });
      pc = new RTCPeerConnection();
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0] ?? null;
        void audio.play().catch(() => undefined);
      };
      pc.onconnectionstatechange = () => {
        if (pc?.connectionState === "failed") emit({ type: "error", message: BLOCKED_NETWORK });
        if (pc?.connectionState === "closed" || pc?.connectionState === "failed") emit({ type: "stage", stage: "closed" });
      };
      micTrack = mic?.getAudioTracks()[0] ?? null;
      if (micTrack) pc.addTrack(micTrack, mic!);
      else pc.addTransceiver("audio", { direction: "recvonly" });
      dc = pc.createDataChannel("oai-events");
      dc.onmessage = (m) => onMessage(String(m.data));
      const opened = new Promise<void>((resolve) => {
        dc!.onopen = () => resolve();
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const res = await fetch(grant.connectUrl ?? "", {
        method: "POST",
        headers: { "Content-Type": "application/sdp", Authorization: `Bearer ${grant.credential}` },
        body: offer.sdp,
        credentials: "omit",
      });
      if (!res.ok) throw new Error(res.status === 401 ? "The voice session expired. Start the question again." : BLOCKED_NETWORK);
      await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
      await Promise.race([opened, new Promise((_, reject) => setTimeout(() => reject(new Error(BLOCKED_NETWORK)), 15_000))]);
      emit({ type: "stage", stage: "live" });
      // The tutor speaks first.
      send({ type: "response.create" });
    },
    sendText(text) {
      send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
      send({ type: "response.create" });
      emit({ type: "line", role: "learner", text });
    },
    setMuted(muted) {
      if (micTrack) micTrack.enabled = !muted;
    },
    close() {
      try {
        dc?.close();
        pc?.getSenders().forEach((s) => pc?.removeTrack(s));
        pc?.close();
      } catch {
        /* already closed */
      }
      dc = null;
      pc = null;
      emit({ type: "stage", stage: "closed" });
    },
  };
}
