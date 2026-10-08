// Text-to-speech providers. Adding one = add an entry to PROVIDERS (server-side only).

import { VOICE_RATES } from "./pricing";

export type VoiceProviderId = keyof typeof VOICE_RATES;

export interface VoiceOption {
  id: string;
  label: string;
}

export interface VoiceProviderInfo {
  id: VoiceProviderId;
  label: string;
  available: boolean;
  voices: VoiceOption[];
}

type Synthesis = { ok: true; audio: ArrayBuffer } | { ok: false; error: string };

const ELEVEN_DEFAULT_VOICES: VoiceOption[] = [{ id: "pNInz6OB85MvRmPLz5QN", label: "Adam" }];
const ELEVEN_VOICE_ID = /^[A-Za-z0-9]{10,40}$/;

const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"];
const OPENAI_MODEL = "gpt-4o-mini-tts";

const key = (name: string) => process.env[name]?.trim() || undefined;

async function elevenLabsVoices(): Promise<VoiceOption[]> {
  const apiKey = key("ELEVENLABS_API_KEY");
  if (!apiKey) return ELEVEN_DEFAULT_VOICES;
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": apiKey }, cache: "no-store" });
    if (!res.ok) return ELEVEN_DEFAULT_VOICES;
    const data = (await res.json()) as { voices?: { voice_id: string; name: string }[] };
    const voices = (data.voices ?? []).slice(0, 30).map((v) => ({ id: v.voice_id, label: v.name }));
    return voices.length ? voices : ELEVEN_DEFAULT_VOICES;
  } catch {
    return ELEVEN_DEFAULT_VOICES;
  }
}

export async function listVoiceProviders(opts: { live: boolean }): Promise<VoiceProviderInfo[]> {
  return [
    { id: "elevenlabs", label: "ElevenLabs", available: !!key("ELEVENLABS_API_KEY"), voices: opts.live ? await elevenLabsVoices() : ELEVEN_DEFAULT_VOICES },
    { id: "openai", label: "OpenAI", available: !!key("OPENAI_API_KEY"), voices: OPENAI_VOICES.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) })) },
  ];
}

async function readAudio(res: Response, prefix: string): Promise<Synthesis> {
  if (!res.ok) return { ok: false, error: `${prefix}_HTTP_${res.status}` };
  return { ok: true, audio: await res.arrayBuffer() };
}

export async function synthesize(provider: VoiceProviderId, text: string, voiceId: string): Promise<Synthesis> {
  switch (provider) {
    case "elevenlabs": {
      const apiKey = key("ELEVENLABS_API_KEY");
      if (!apiKey) return { ok: false, error: "CLÉ_ELEVEN_MANQUANTE" };
      if (!ELEVEN_VOICE_ID.test(voiceId)) return { ok: false, error: "VOIX_INVALIDE" };
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.5 } }),
      });
      return readAudio(res, "ELEVEN");
    }
    case "openai": {
      const apiKey = key("OPENAI_API_KEY");
      if (!apiKey) return { ok: false, error: "CLÉ_OPENAI_MANQUANTE" };
      if (!OPENAI_VOICES.includes(voiceId)) return { ok: false, error: "VOIX_INVALIDE" };
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: OPENAI_MODEL, voice: voiceId, input: text, response_format: "mp3" }),
      });
      return readAudio(res, "OPENAI");
    }
    default:
      return { ok: false, error: "FOURNISSEUR_INCONNU" };
  }
}
