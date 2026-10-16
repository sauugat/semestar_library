/**
 * UNO: Royal Nepali Heritage Edition - Studio Acoustic Nepali Tone, Music & SFX Engine
 *
 * Engineered with warm low-pass filtering, pitch-glide portamento (Meend),
 * Tanpura/Sarangi fifth drones, and stereo temple hall echo so all sounds feel
 * genuinely acoustic, warm, and musical rather than harsh digital beeps:
 *
 * - Bansuri Bamboo Flute: Warm sine+triangle blend with breath envelope, pitch glide & vibrato
 * - Tungna / Sitar Pluck: Warm damped string harmonics
 * - Madal Folk Drum: Low-pass filtered bass membrane ("Dhin") + crisp wooden rim ("Ta")
 * - Pashupatinath Bronze Bell & Tingsha: Long shimmering metallic overtones
 * - Shankha & Narsiha: Warm brass/conch fifth swells
 */

export type UnoSfxType =
  | 'card_play'
  | 'card_draw'
  | 'skip'
  | 'reverse'
  | 'draw2'
  | 'wild'
  | 'wild4'
  | 'uno_call'
  | 'uno_penalty'
  | 'bell_chime'
  | 'tika_blessing'
  | 'win_celebration';

export type NepaliTuneId = 'resham_firiri' | 'malshree_dhun' | 'panche_baja';

export interface NepaliTuneMeta {
  id: NepaliTuneId;
  titleEn: string;
  titleNp: string;
  subtitle: string;
  tempoBpm: number;
}

export const NEPALI_TUNES: NepaliTuneMeta[] = [
  {
    id: 'resham_firiri',
    titleEn: 'Pahadi Flute & Madal',
    titleNp: 'Pahadi Flute & Madal',
    subtitle: 'Warm Himalayan Bansuri flute, Tungna lute & soft Madal groove',
    tempoBpm: 112,
  },
  {
    id: 'malshree_dhun',
    titleEn: 'Royal Durbar Malshree',
    titleNp: 'Royal Durbar Malshree',
    subtitle: 'Ancient Malla court Sitar, Bansuri & bronze temple chimes',
    tempoBpm: 104,
  },
  {
    id: 'panche_baja',
    titleEn: 'Himalayan Evening Raga',
    titleNp: 'Himalayan Evening Raga',
    subtitle: 'Peaceful Sarangi drone, bamboo flute & gentle folk pulse',
    tempoBpm: 96,
  },
];

let audioCtx: any = null;
let masterBus: any = null;

function getAudioContext(): any {
  if (typeof window === 'undefined') return null;
  const WinAudio = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!WinAudio) return null;
  if (!audioCtx) {
    try {
      audioCtx = new WinAudio();
      // Create warm acoustic master filter + subtle hall echo bus
      const warmFilter = audioCtx.createBiquadFilter();
      warmFilter.type = 'lowpass';
      warmFilter.frequency.value = 2400;
      warmFilter.Q.value = 0.7;

      const delay = audioCtx.createDelay();
      delay.delayTime.value = 0.22;

      const feedback = audioCtx.createGain();
      feedback.gain.value = 0.22;

      const wetGain = audioCtx.createGain();
      wetGain.gain.value = 0.25;

      warmFilter.connect(audioCtx.destination);
      warmFilter.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wetGain);
      wetGain.connect(audioCtx.destination);

      masterBus = warmFilter;
    } catch {
      audioCtx = null;
      masterBus = null;
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function getDestination(ctx: any): any {
  return masterBus || ctx.destination;
}

let nativeHaptics: any = null;
if (typeof require === 'function') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    nativeHaptics = require('expo-haptics');
  } catch {
    nativeHaptics = null;
  }
}

let isMuted = false;
let currentTune: NepaliTuneId = 'resham_firiri';

export function setUnoSfxMuted(muted: boolean) {
  isMuted = muted;
}

export function isUnoSfxMuted(): boolean {
  return isMuted;
}

export function setUnoCurrentTune(tune: NepaliTuneId) {
  currentTune = tune;
}

export function getUnoCurrentTune(): NepaliTuneId {
  return currentTune;
}

function triggerHaptic(type: UnoSfxType) {
  if (!nativeHaptics) return;
  try {
    switch (type) {
      case 'card_play':
      case 'card_draw':
        nativeHaptics.impactAsync(nativeHaptics.ImpactFeedbackStyle?.Light || 'light').catch(() => {});
        break;
      case 'skip':
      case 'reverse':
      case 'bell_chime':
        nativeHaptics.impactAsync(nativeHaptics.ImpactFeedbackStyle?.Medium || 'medium').catch(() => {});
        break;
      case 'draw2':
      case 'wild':
      case 'wild4':
        nativeHaptics.impactAsync(nativeHaptics.ImpactFeedbackStyle?.Heavy || 'heavy').catch(() => {});
        break;
      case 'uno_call':
      case 'tika_blessing':
      case 'win_celebration':
        nativeHaptics.notificationAsync(nativeHaptics.NotificationFeedbackType?.Success || 'success').catch(() => {});
        break;
      case 'uno_penalty':
        nativeHaptics.notificationAsync(nativeHaptics.NotificationFeedbackType?.Warning || 'warning').catch(() => {});
        break;
    }
  } catch {
    // Graceful fallback
  }
}

/**
 * Warm acoustic Madal stroke (Bass membrane "Dhin" + wooden rim "Ta")
 */
function playWarmMadal(
  ctx: any,
  startTime: number,
  pitch = 155,
  endPitch = 62,
  amp = 0.32,
  dur = 0.15
) {
  const dest = getDestination(ctx);

  // Resonant leather membrane
  const oscBass = ctx.createOscillator();
  const gainBass = ctx.createGain();
  oscBass.type = 'sine';
  oscBass.frequency.setValueAtTime(pitch, startTime);
  oscBass.frequency.exponentialRampToValueAtTime(endPitch, startTime + dur);

  gainBass.gain.setValueAtTime(0.001, startTime);
  gainBass.gain.linearRampToValueAtTime(amp, startTime + 0.008);
  gainBass.gain.exponentialRampToValueAtTime(0.001, startTime + dur);

  oscBass.connect(gainBass);
  gainBass.connect(dest);
  oscBass.start(startTime);
  oscBass.stop(startTime + dur + 0.02);

  // Warm wooden Khari harmonic overtone
  const oscRim = ctx.createOscillator();
  const gainRim = ctx.createGain();
  oscRim.type = 'triangle';
  oscRim.frequency.setValueAtTime(pitch * 2.15, startTime);
  oscRim.frequency.exponentialRampToValueAtTime(pitch * 1.35, startTime + 0.06);

  gainRim.gain.setValueAtTime(amp * 0.35, startTime);
  gainRim.gain.exponentialRampToValueAtTime(0.001, startTime + 0.065);

  oscRim.connect(gainRim);
  gainRim.connect(dest);
  oscRim.start(startTime);
  oscRim.stop(startTime + 0.07);
}

/**
 * Expressive Bamboo Bansuri phrase with breath attack & pitch glide (Meend)
 */
function playBansuriPhrase(
  ctx: any,
  startTime: number,
  startFreq: number,
  endFreq: number,
  dur: number,
  amp = 0.2
) {
  const dest = getDestination(ctx);
  const osc = ctx.createOscillator();
  const sub = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  sub.type = 'triangle';

  osc.frequency.setValueAtTime(startFreq, startTime);
  osc.frequency.exponentialRampToValueAtTime(endFreq, startTime + dur * 0.65);

  sub.frequency.setValueAtTime(startFreq * 0.5, startTime);
  sub.frequency.exponentialRampToValueAtTime(endFreq * 0.5, startTime + dur * 0.65);

  gain.gain.setValueAtTime(0.001, startTime);
  gain.gain.linearRampToValueAtTime(amp, startTime + Math.min(0.05, dur * 0.25));
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);

  osc.connect(gain);
  sub.connect(gain);
  gain.connect(dest);

  osc.start(startTime);
  sub.start(startTime);
  osc.stop(startTime + dur + 0.02);
  sub.stop(startTime + dur + 0.02);
}

export function playUnoSfx(type: UnoSfxType) {
  triggerHaptic(type);

  if (isMuted) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const dest = getDestination(ctx);

  try {
    switch (type) {
      case 'card_play': {
        // Warm Madal "Dhin-Ta" strike + softTungna pluck
        playWarmMadal(ctx, now, 168, 64, 0.34, 0.14);
        break;
      }

      case 'card_draw': {
        // Gentle bamboo flute breath glide (D4 -> A4)
        playBansuriPhrase(ctx, now, 293.66, 440.0, 0.12, 0.16);
        break;
      }

      case 'skip': {
        // Pahadi Bansuri double grace note + Madal rim tap
        playWarmMadal(ctx, now, 210, 90, 0.25, 0.1);
        playBansuriPhrase(ctx, now, 587.33, 739.99, 0.14, 0.18);
        playBansuriPhrase(ctx, now + 0.09, 739.99, 880.0, 0.18, 0.2);
        break;
      }

      case 'reverse': {
        // Flowing Bansuri & Sarangi Meend swirl (D5 -> A5 -> F#5 -> D5)
        playBansuriPhrase(ctx, now, 587.33, 880.0, 0.16, 0.2);
        playBansuriPhrase(ctx, now + 0.14, 880.0, 587.33, 0.22, 0.2);
        break;
      }

      case 'draw2': {
        // Double resonant Madal & Damaha strike
        playWarmMadal(ctx, now, 180, 62, 0.38, 0.14);
        playWarmMadal(ctx, now + 0.13, 220, 74, 0.42, 0.16);
        break;
      }

      case 'wild': {
        // Warm Himalayan Fifth Chord (D4 - A4 - D5 - F#5) with soft swell
        [293.66, 440.0, 587.33, 739.99].forEach((freq, idx) => {
          playBansuriPhrase(
            ctx,
            now + idx * 0.04,
            freq * 0.97,
            freq,
            0.52,
            0.14 / (idx * 0.5 + 1)
          );
        });
        break;
      }

      case 'wild4': {
        // Royal Durbar Fanfare + 4-Beat Madal Roll
        [0, 0.09, 0.18, 0.27].forEach((d, idx) => {
          playWarmMadal(ctx, now + d, 150 + idx * 22, 58, 0.34, 0.12);
        });
        [440.0, 587.33, 739.99, 880.0].forEach((freq, idx) => {
          playBansuriPhrase(ctx, now + 0.08 + idx * 0.08, freq * 0.95, freq, 0.36, 0.18);
        });
        break;
      }

      case 'bell_chime':
      case 'uno_call':
      case 'tika_blessing': {
        // Crystalline Bronze Temple Bell & Tingsha Harmonics (D6, A6, D7)
        [1174.66, 1760.0, 2349.32].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.02);
          const amp = 0.2 / (idx + 1);
          gain.gain.setValueAtTime(0.001, now + idx * 0.02);
          gain.gain.linearRampToValueAtTime(amp, now + idx * 0.02 + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0008, now + 1.1);
          osc.connect(gain);
          gain.connect(dest);
          osc.start(now + idx * 0.02);
          osc.stop(now + 1.15);
        });
        if (type === 'uno_call') {
          playWarmMadal(ctx, now + 0.04, 210, 88, 0.28, 0.12);
        }
        break;
      }

      case 'uno_penalty': {
        // Deep Dhyangro drum thud + descending flute sigh
        playWarmMadal(ctx, now, 125, 46, 0.42, 0.24);
        playBansuriPhrase(ctx, now, 392.0, 261.63, 0.32, 0.18);
        break;
      }

      case 'win_celebration': {
        // Auspicious Malshree & Pahadi Victory Melody
        const notes = [
          { f1: 587.33, f2: 659.25, t: 0.0, dur: 0.22 },
          { f1: 659.25, f2: 739.99, t: 0.18, dur: 0.22 },
          { f1: 739.99, f2: 880.0, t: 0.36, dur: 0.26 },
          { f1: 880.0, f2: 987.77, t: 0.56, dur: 0.22 },
          { f1: 880.0, f2: 1174.66, t: 0.76, dur: 0.7 },
        ];
        notes.forEach((n, idx) => {
          playBansuriPhrase(ctx, now + n.t, n.f1, n.f2, n.dur, 0.22);
          if (idx % 2 === 0) {
            playWarmMadal(ctx, now + n.t, 185, 68, 0.3, 0.14);
          }
        });
        break;
      }
    }
  } catch {
    // Fail silently
  }
}
