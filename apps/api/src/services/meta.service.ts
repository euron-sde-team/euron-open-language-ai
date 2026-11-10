/** GET /api/meta: what a client needs before anyone signs in. Never a key, never a provider name. */
import type { AppMeta } from "@open-language/types";
import { getSettings } from "./settings.service";
import { MAX_TRANSCRIPT_CHARS_PER_LINE, MAX_TRANSCRIPT_LINES } from "./practice/transcript";

export async function appMeta(): Promise<AppMeta> {
  const s = await getSettings();
  return {
    appName: s.appName,
    tagline: s.tagline,
    registration: s.registration,
    tutorName: s.tutorName,
    features: { ...s.features },
    limits: { maxTranscriptLineChars: MAX_TRANSCRIPT_CHARS_PER_LINE, maxTranscriptLines: MAX_TRANSCRIPT_LINES },
    support: { email: s.supportEmail },
    minSupportedVersion: s.minSupportedVersion,
  };
}
