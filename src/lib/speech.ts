import type { Character, DialogueLine } from "./types";

/**
 * Lit une réplique vocale via la Web Speech API native du navigateur.
 * Zéro latence, 100% hors-ligne, aucune clé d'API requise.
 */
export function speakSingleLine(
  text: string,
  voiceId: string = "fr-FR-HenriNeural",
  onEnd?: () => void
): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    onEnd?.();
    return false;
  }

  window.speechSynthesis.cancel();

  const cleanText = text.replace(/["«»]/g, "").trim();
  if (!cleanText) {
    onEnd?.();
    return true;
  }

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = "fr-FR";

  const isFemale =
    voiceId.toLowerCase().includes("femme") ||
    /denise|eloise|vivienne|charline|sylvie|ariane/i.test(voiceId);

  const voices = window.speechSynthesis.getVoices();
  const frVoices = voices.filter((v) => v.lang.startsWith("fr"));

  if (frVoices.length > 0) {
    if (isFemale) {
      const fVoice = frVoices.find((v) =>
        /female|femme|hortense|julie|celine|denise|eloise/i.test(v.name)
      );
      if (fVoice) {
        utterance.voice = fVoice;
      } else {
        utterance.voice = frVoices[0];
        utterance.pitch = 1.25;
      }
    } else {
      const mVoice = frVoices.find((v) =>
        /male|homme|paul|henri|mathieu|claude|nicolas/i.test(v.name)
      );
      if (mVoice) {
        utterance.voice = mVoice;
      } else {
        utterance.voice = frVoices[0];
        utterance.pitch = 0.85;
      }
    }
  } else {
    utterance.pitch = isFemale ? 1.25 : 0.85;
  }

  utterance.rate = 1.0;
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();

  window.speechSynthesis.speak(utterance);
  return true;
}

/**
 * Lit séquentiellement toutes les répliques d'une scène avec voix différenciées par personnage.
 * Retourne une fonction d'annulation immédiate (stop).
 */
export function playSceneDialogues(
  lines: DialogueLine[],
  characters: Character[],
  onLineChange?: (index: number | null) => void,
  onComplete?: () => void
): () => void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    onComplete?.();
    return () => {};
  }

  window.speechSynthesis.cancel();

  if (!lines || lines.length === 0) {
    onComplete?.();
    return () => {};
  }

  let currentIndex = 0;
  let isCancelled = false;

  const playNext = () => {
    if (isCancelled || currentIndex >= lines.length) {
      onLineChange?.(null);
      onComplete?.();
      return;
    }

    const currentLine = lines[currentIndex];
    onLineChange?.(currentIndex);

    const char = characters.find(
      (c) =>
        c.id === currentLine.characterId ||
        c.name.toLowerCase().includes(currentLine.speaker.toLowerCase()) ||
        currentLine.speaker.toLowerCase().includes(c.name.toLowerCase())
    );
    const voiceId = char?.voiceId || "fr-FR-HenriNeural";

    speakSingleLine(currentLine.text, voiceId, () => {
      currentIndex++;
      if (!isCancelled) {
        setTimeout(playNext, 250);
      }
    });
  };

  playNext();

  return () => {
    isCancelled = true;
    window.speechSynthesis.cancel();
    onLineChange?.(null);
    onComplete?.();
  };
}

