/** Pure helpers for the settings page (tested in test/settings). No React, no fetching. */
import type { Preferences, RealtimeModelOption } from "@open-language/types";

/** The voice model that runs your practice: your pick while it is still offered, else the deployment's default, else the first. */
export function effectiveModel(models: readonly RealtimeModelOption[], prefs: Pick<Preferences, "defaultRealtimeModelId">): RealtimeModelOption | null {
  return models.find((m) => m.id === prefs.defaultRealtimeModelId) ?? models.find((m) => m.isDefault) ?? models[0] ?? null;
}

/** The voice the room will use with this model: yours when the model offers it, else the model's first (as the server does). */
export function effectiveVoice(model: RealtimeModelOption | null, voice: string): string {
  if (!model || !model.voices.length) return voice;
  return model.voices.includes(voice) ? voice : model.voices[0]!;
}

/** The preference change for picking a model: the voice follows when the new model does not offer it. */
export function modelPatch(models: readonly RealtimeModelOption[], id: string | null, voice: string): Partial<Preferences> {
  const next = effectiveModel(models, { defaultRealtimeModelId: id });
  const v = effectiveVoice(next, voice);
  return v === voice ? { defaultRealtimeModelId: id } : { defaultRealtimeModelId: id, voice: v };
}

/** "alloy" to "Alloy". */
export function voiceLabel(v: string): string {
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
}
