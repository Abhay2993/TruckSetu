/**
 * Vernacular voice interface — output half.
 *
 * Text-to-speech works TODAY in Expo Go and browsers via expo-speech, so
 * spoken announcements (amenity summaries, payment confirmations) ship now,
 * in the user's selected language. Note: Indic voice availability varies by
 * device — Android needs the Google TTS language packs installed; when a
 * voice is missing the OS falls back to the default voice.
 *
 * The input half (speech-to-text) requires a native module outside Expo Go
 * (e.g. expo-speech-recognition or @react-native-voice/voice in a dev
 * build). `listen()` is the documented slot: wire the recogniser there and
 * every caller gets voice input without changes.
 */

import * as Speech from 'expo-speech';
import type { Locale } from '../types';

const LOCALE_TO_BCP47: Record<Locale, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  pa: 'pa-IN',
  te: 'te-IN',
  ta: 'ta-IN',
};

export function speak(text: string, locale: Locale): void {
  Speech.stop();
  Speech.speak(text, { language: LOCALE_TO_BCP47[locale], rate: 0.95 });
}

export function stopSpeaking(): void {
  Speech.stop();
}

/** Fill a translated template like "{count} stops ahead…" with values. */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

/**
 * Speech-to-text slot. Not available in Expo Go — requires a development
 * build with a recogniser module. Returns null until that lands so callers
 * can degrade gracefully.
 */
export async function listen(): Promise<string | null> {
  return null;
}
