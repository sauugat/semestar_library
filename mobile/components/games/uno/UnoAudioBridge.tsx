import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import {
  playUnoSfx,
  UnoSfxType,
  NepaliTuneId,
  getUnoCurrentTune,
  setUnoCurrentTune,
} from './uno-sfx';

export interface UnoAudioBridgeRef {
  playSfx: (type: string) => void;
  setMuted: (muted: boolean) => void;
  setTune: (tuneId: NepaliTuneId) => void;
  playTune: () => void;
  stopTune: () => void;
}

interface UnoAudioBridgeProps {
  isMuted: boolean;
  tuneId?: NepaliTuneId;
}

export const UnoAudioBridge = forwardRef<UnoAudioBridgeRef, UnoAudioBridgeProps>(
  ({ isMuted, tuneId }, ref) => {
    const webViewRef = useRef<WebView>(null);
    const [, setIsBridgeReady] = useState(false);
    const initialTune = tuneId || getUnoCurrentTune() || 'resham_firiri';

    // Studio-grade Web Audio Nepali Acoustic Synthesizer
    // Features:
    // - Master 2200Hz Warm Acoustic Lowpass Filter + Stereo Hall Echo Delay
    // - Soft Continuous Tanpura/Sarangi Drone (D3 + A3)
    // - Expressive Bamboo Bansuri Flute with Pitch Glide (Meend) & Delayed Vibrato
    // - Plucked Himalayan Tungna Lute Chords & Warm Low-Passed Madal Rhythm
    const audioHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Himalayan Acoustic Audio Engine</title>
</head>
<body>
<script>
  let audioCtx = null;
  let masterBus = null;
  let droneNodes = [];
  let isMuted = ${isMuted ? 'true' : 'false'};
  let currentTune = '${initialTune}';
  let tuneTimer = null;
  let stepIdx = 0;
  let lastFluteFreq = 587.33;

  function initAudio() {
    if (!audioCtx) {
      const WinAudio = window.AudioContext || window.webkitAudioContext;
      if (WinAudio) {
        audioCtx = new WinAudio();

        // Warm acoustic lowpass filter + wooden hall echo
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2100;
        filter.Q.value = 0.65;

        const delay = audioCtx.createDelay();
        delay.delayTime.value = 0.27;

        const delayFilter = audioCtx.createBiquadFilter();
        delayFilter.type = 'lowpass';
        delayFilter.frequency.value = 1350;

        const feedback = audioCtx.createGain();
        feedback.gain.value = 0.28;

        const wetGain = audioCtx.createGain();
        wetGain.gain.value = 0.30;

        filter.connect(audioCtx.destination);
        filter.connect(delay);
        delay.connect(delayFilter);
        delayFilter.connect(feedback);
        feedback.connect(delay);
        delayFilter.connect(wetGain);
        wetGain.connect(audioCtx.destination);

        masterBus = filter;
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function startAmbientDrone() {
    stopAmbientDrone();
    if (!audioCtx || isMuted) return;
    const now = audioCtx.currentTime;
    // Soft Sa-Pa (D3 = 146.83Hz, A3 = 220.00Hz) warm Tanpura/Sarangi pad
    [146.83, 220.00].forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(idx === 0 ? 0.018 : 0.012, now + 1.2);
      osc.connect(gain);
      gain.connect(masterBus || audioCtx.destination);
      osc.start(now);
      droneNodes.push({ osc, gain });
    });
  }

  function stopAmbientDrone() {
    droneNodes.forEach((n) => {
      try {
        n.osc.stop();
        n.osc.disconnect();
      } catch (e) {}
    });
    droneNodes = [];
  }

  // 1. Pahadi Flute & Madal (Resham Firiri inspired flowing Pahadi Raga in D Major Pentatonic)
  const PAHADI_MELODY = [
    { f: 587.33, dur: 0.48, madal: 'dhin', tungna: 293.66 }, // D5
    { f: 659.25, dur: 0.44, madal: 'ti',   tungna: 0 },      // E5
    { f: 739.99, dur: 0.56, madal: 'na',   tungna: 440.00 }, // F#5
    { f: 880.00, dur: 0.52, madal: 'dhin', tungna: 0 },      // A5
    { f: 987.77, dur: 0.46, madal: 'ta',   tungna: 493.88 }, // B5
    { f: 880.00, dur: 0.52, madal: 'dhin', tungna: 0 },      // A5
    { f: 739.99, dur: 0.48, madal: 'ti',   tungna: 369.99 }, // F#5
    { f: 659.25, dur: 0.52, madal: 'na',   tungna: 0 },      // E5
    { f: 587.33, dur: 0.68, madal: 'dhin', tungna: 293.66 }, // D5
    { f: 493.88, dur: 0.44, madal: 'ta',   tungna: 0 },      // B4
    { f: 440.00, dur: 0.48, madal: 'ti',   tungna: 220.00 }, // A4
    { f: 587.33, dur: 0.72, madal: 'dhin', tungna: 293.66 }, // D5
  ];

  // 2. Royal Durbar Malshree (Auspicious Malla Court Melody)
  const MALSHREE_MELODY = [
    { f: 587.33, dur: 0.52, madal: 'dhin', tungna: 293.66, bell: true },
    { f: 739.99, dur: 0.48, madal: 'na',   tungna: 369.99, bell: false },
    { f: 880.00, dur: 0.58, madal: 'dhin', tungna: 440.00, bell: false },
    { f: 987.77, dur: 0.48, madal: 'ta',   tungna: 0,      bell: false },
    { f: 880.00, dur: 0.62, madal: 'dhin', tungna: 440.00, bell: true },
    { f: 739.99, dur: 0.48, madal: 'ti',   tungna: 0,      bell: false },
    { f: 659.25, dur: 0.48, madal: 'na',   tungna: 329.63, bell: false },
    { f: 587.33, dur: 0.72, madal: 'dhin', tungna: 293.66, bell: true },
  ];

  // 3. Himalayan Evening Raga (Calm Meditative Flute & Tungna)
  const EVENING_MELODY = [
    { f: 440.00, dur: 0.68, madal: 'dhin', tungna: 220.00 },
    { f: 493.88, dur: 0.58, madal: 'ti',   tungna: 0 },
    { f: 587.33, dur: 0.75, madal: 'dhin', tungna: 293.66 },
    { f: 739.99, dur: 0.68, madal: 'na',   tungna: 369.99 },
    { f: 659.25, dur: 0.62, madal: 'dhin', tungna: 0 },
    { f: 587.33, dur: 0.80, madal: 'ta',   tungna: 293.66 },
  ];

  function playExpressiveBansuri(targetFreq, dur) {
    if (!audioCtx || isMuted) return;
    const now = audioCtx.currentTime;
    const dest = masterBus || audioCtx.destination;

    const osc = audioCtx.createOscillator();
    const octaveSub = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    octaveSub.type = 'sine';

    // Smooth Nepali Bansuri Meend (pitch glide from previous note)
    const startFreq = lastFluteFreq || targetFreq;
    lastFluteFreq = targetFreq;

    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(targetFreq, now + 0.085);

    octaveSub.frequency.setValueAtTime(startFreq * 0.5, now);
    octaveSub.frequency.exponentialRampToValueAtTime(targetFreq * 0.5, now + 0.085);

    // Gentle human breath vibrato
    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    lfo.frequency.setValueAtTime(5.2, now);
    lfoGain.gain.setValueAtTime(0.1, now);
    lfoGain.gain.linearRampToValueAtTime(2.8, now + dur * 0.5);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    // Soft breathy fade-in and natural decay
    gain.gain.setValueAtTime(0.0008, now);
    gain.gain.linearRampToValueAtTime(0.038, now + 0.09);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + dur);

    const subGain = audioCtx.createGain();
    subGain.gain.setValueAtTime(0.014, now);

    osc.connect(gain);
    octaveSub.connect(subGain);
    subGain.connect(gain);
    gain.connect(dest);

    osc.start(now);
    octaveSub.start(now);
    lfo.start(now);
    osc.stop(now + dur + 0.03);
    octaveSub.stop(now + dur + 0.03);
    lfo.stop(now + dur + 0.03);
  }

  function playTungnaPluck(freq) {
    if (!audioCtx || isMuted || !freq) return;
    const now = audioCtx.currentTime;
    const dest = masterBus || audioCtx.destination;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.026, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.48);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  function playWarmMadalBeat(stroke) {
    if (!audioCtx || isMuted) return;
    const now = audioCtx.currentTime;
    const dest = masterBus || audioCtx.destination;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';

    if (stroke === 'dhin') {
      osc.frequency.setValueAtTime(138, now);
      osc.frequency.exponentialRampToValueAtTime(54, now + 0.16);
      gain.gain.setValueAtTime(0.055, now);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.16);
    } else if (stroke === 'ta') {
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.07);
      gain.gain.setValueAtTime(0.032, now);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.07);
    } else {
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.exponentialRampToValueAtTime(115, now + 0.06);
      gain.gain.setValueAtTime(0.02, now);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.06);
    }

    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  function playSoftTingshaBell() {
    if (!audioCtx || isMuted) return;
    const now = audioCtx.currentTime;
    const dest = masterBus || audioCtx.destination;
    [1760, 2637].forEach((f, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now);
      gain.gain.setValueAtTime(0.014 / (idx + 1), now);
      gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.85);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.88);
    });
  }

  function startFolkTune() {
    stopFolkTune();
    if (isMuted) return;
    initAudio();
    startAmbientDrone();

    const intervalMs =
      currentTune === 'malshree_dhun'
        ? 540
        : currentTune === 'panche_baja'
        ? 640
        : 480;

    tuneTimer = setInterval(() => {
      if (isMuted) return;
      const list =
        currentTune === 'malshree_dhun'
          ? MALSHREE_MELODY
          : currentTune === 'panche_baja'
          ? EVENING_MELODY
          : PAHADI_MELODY;

      const note = list[stepIdx % list.length];
      playExpressiveBansuri(note.f, note.dur);
      if (note.tungna) playTungnaPluck(note.tungna);
      if (note.madal) playWarmMadalBeat(note.madal);
      if (note.bell) playSoftTingshaBell();
      stepIdx = (stepIdx + 1) % list.length;
    }, intervalMs);
  }

  function stopFolkTune() {
    if (tuneTimer) {
      clearInterval(tuneTimer);
      tuneTimer = null;
    }
    stopAmbientDrone();
  }

  function playSound(type) {
    initAudio();
    if (!audioCtx || isMuted) return;
    const now = audioCtx.currentTime;
    const dest = masterBus || audioCtx.destination;

    if (type === 'card_play') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(175, now);
      osc.frequency.exponentialRampToValueAtTime(64, now + 0.13);
      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.14);
    } else if (type === 'card_draw') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(293.66, now);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.1);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'bell_chime' || type === 'uno_call' || type === 'tika_blessing') {
      [1174.66, 1760, 2349.32].forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.02);
        gain.gain.setValueAtTime(0.2 / (idx + 1), now + idx * 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(now + idx * 0.02);
        osc.stop(now + 1.0);
      });
    } else if (type === 'skip') {
      [587.33, 739.99, 880].forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        const t = now + idx * 0.05;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(t);
        osc.stop(t + 0.16);
      });
    } else if (type === 'reverse') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.14);
      osc.frequency.exponentialRampToValueAtTime(587.33, now + 0.3);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.33);
    } else if (type === 'draw2') {
      [0, 0.12].forEach((d, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(180 + idx * 35, now + d);
        osc.frequency.exponentialRampToValueAtTime(62, now + d + 0.14);
        gain.gain.setValueAtTime(0.35, now + d);
        gain.gain.exponentialRampToValueAtTime(0.001, now + d + 0.14);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(now + d);
        osc.stop(now + d + 0.15);
      });
    } else if (type === 'wild' || type === 'wild4') {
      [293.66, 440, 587.33, 739.99].forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        const t = now + idx * 0.05;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.18 / (idx * 0.4 + 1), t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(t);
        osc.stop(t + 0.5);
      });
    } else if (type === 'uno_penalty') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(175, now);
      osc.frequency.exponentialRampToValueAtTime(98, now + 0.28);
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.32);
    } else if (type === 'win_celebration') {
      [587.33, 659.25, 739.99, 880, 987.77, 1174.66].forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        const t = now + idx * 0.11;
        const dur = idx === 5 ? 0.65 : 0.24;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.24, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(t);
        osc.stop(t + dur + 0.02);
      });
    }
  }

  function handleIncomingPayload(rawData) {
    try {
      const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      if (data.action === 'sfx') {
        playSound(data.type);
      } else if (data.action === 'mute') {
        isMuted = data.muted;
        if (isMuted) stopFolkTune();
        else startFolkTune();
      } else if (data.action === 'set_tune') {
        currentTune = data.tuneId || 'resham_firiri';
        stepIdx = 0;
        if (!isMuted) startFolkTune();
      } else if (data.action === 'start_tune') {
        startFolkTune();
      } else if (data.action === 'stop_tune') {
        stopFolkTune();
      }
    } catch(e) {}
  }

  window.addEventListener('message', (event) => handleIncomingPayload(event.data));
  document.addEventListener('message', (event) => handleIncomingPayload(event.data));

  window.addEventListener('load', () => {
    initAudio();
    if (!isMuted) setTimeout(startFolkTune, 450);
  });
</script>
</body>
</html>
`;

    useImperativeHandle(ref, () => ({
      playSfx: (type: string) => {
        playUnoSfx(type as UnoSfxType);

        if (Platform.OS !== 'web' && webViewRef.current) {
          const payload = JSON.stringify({ action: 'sfx', type });
          webViewRef.current.postMessage(payload);
        }
      },
      setMuted: (muted: boolean) => {
        if (webViewRef.current) {
          const payload = JSON.stringify({ action: 'mute', muted });
          webViewRef.current.postMessage(payload);
        }
      },
      setTune: (nextTune: NepaliTuneId) => {
        setUnoCurrentTune(nextTune);
        if (webViewRef.current) {
          const payload = JSON.stringify({ action: 'set_tune', tuneId: nextTune });
          webViewRef.current.postMessage(payload);
        }
      },
      playTune: () => {
        if (webViewRef.current) {
          webViewRef.current.postMessage(JSON.stringify({ action: 'start_tune' }));
        }
      },
      stopTune: () => {
        if (webViewRef.current) {
          webViewRef.current.postMessage(JSON.stringify({ action: 'stop_tune' }));
        }
      },
    }));

    if (Platform.OS === 'web') {
      return null;
    }

    return (
      <View style={styles.hiddenBridge} pointerEvents="none">
        <WebView
          ref={webViewRef}
          originWhitelist={['*']}
          source={{ html: audioHtml }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback={true}
          onLoadEnd={() => setIsBridgeReady(true)}
          style={styles.hiddenWebView}
        />
      </View>
    );
  }
);

const styles = StyleSheet.create({
  hiddenBridge: {
    width: 1,
    height: 1,
    opacity: 0,
    position: 'absolute',
    top: -100,
    left: -100,
  },
  hiddenWebView: {
    width: 1,
    height: 1,
  },
});
