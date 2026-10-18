import { THREE_MIN_JS } from './threeMinJs';
import { HORROR_CONFIG } from './horrorConfig';

export function getHideAndSeekHtml(): string {
  const configJson = JSON.stringify(HORROR_CONFIG);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <title>Gandaki University - Realistic Night Campus 3D</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
    }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #020408;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      touch-action: none;
    }
    #game-canvas {
      width: 100%;
      height: 100%;
      display: block;
      touch-action: none;
    }

    /* FAST & LOW Mode Clean CSS Grade Fallback (Used when ULTRA WebGL grade pass is off — clean edge vignette without scanline noise) */
    #fast-css-grade-fallback {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 3;
      display: none;
      background:
        radial-gradient(circle at 50% 50%, rgba(10, 22, 32, 0.0) 56%, rgba(5, 13, 22, 0.22) 84%, rgba(2, 5, 10, 0.48) 100%);
    }

    /* Clean Cool-Night Vignette (No Yellow Screen Wash) */
    #cinematic-vignette {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      background:
        radial-gradient(circle at 50% 50%, transparent 58%, rgba(4, 9, 18, 0.35) 82%, rgba(2, 5, 11, 0.65) 100%);
      z-index: 2;
    }

    /* Warden Near / About-to-Catch Horror Pulse Overlay & Blood Veins */
    #horror-pulse-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.08s ease, transform 0.08s ease;
      z-index: 4;
      background:
        radial-gradient(circle at 50% 50%, transparent 28%, rgba(153, 27, 27, 0.56) 68%, rgba(45, 4, 4, 0.96) 100%),
        repeating-radial-gradient(circle at 50% 50%, rgba(220, 38, 38, 0.0) 0px, rgba(220, 38, 38, 0.0) 18px, rgba(127, 29, 29, 0.18) 20px, transparent 24px);
    }

    /* VHS Scanlines & Chromatic Glitch Overlay during Terror/Stalker Proximity */
    #horror-glitch-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      opacity: 0;
      z-index: 5;
      background:
        repeating-linear-gradient(
          0deg,
          rgba(0, 0, 0, 0.0) 0px,
          rgba(0, 0, 0, 0.0) 2px,
          rgba(255, 255, 255, 0.05) 3px,
          rgba(0, 0, 0, 0.32) 4px
        );
      mix-blend-mode: screen;
      transition: opacity 0.06s linear;
    }

    /* Terrifying Lakhey / Haunted Demon Mask Hallucination & Jumpscare Flash */
    #horror-jumpscare-flash {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      opacity: 0;
      z-index: 9;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at 50% 46%, rgba(220, 38, 38, 0.38) 0%, rgba(15, 2, 2, 0.94) 65%, #000000 100%);
      transition: opacity 0.05s ease-out;
    }
    #horror-jumpscare-flash svg {
      width: min(72vw, 380px);
      height: min(72vw, 380px);
      filter: drop-shadow(0 0 28px rgba(239, 68, 68, 0.95)) contrast(1.45);
      transform: scale(1.08);
    }

    /* Stealth Overlay (Under Classroom Table / Chair) */
    #stealth-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.35s ease;
      z-index: 5;
      background: radial-gradient(circle at center, transparent 26%, rgba(4, 8, 16, 0.84) 72%, rgba(2, 4, 9, 0.97) 100%);
    }
    #stealth-overlay.active {
      opacity: 1;
    }
    #stealth-badge {
      position: absolute;
      bottom: max(16px, env(safe-area-inset-bottom, 16px));
      left: 50%;
      transform: translateX(-50%);
      background: rgba(8, 13, 22, 0.94);
      border: 1px solid rgba(224, 142, 54, 0.45);
      color: #f1f5f9;
      font-size: 10.5px;
      font-weight: 800;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      padding: 6px 16px;
      border-radius: 16px;
      box-shadow: 0 4px 22px rgba(0, 0, 0, 0.9);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #stealth-badge .pulse-dot {
      width: 7px;
      height: 7px;
      border-radius: 4px;
      background: #e08e36;
      box-shadow: 0 0 8px #e08e36;
      animation: blink 0.9s infinite alternate;
    }
    @keyframes blink { from { opacity: 0.3; } to { opacity: 1; } }

    /* Seeker Grace Period Countdown */
    #blindfold-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: radial-gradient(circle at center, rgba(8, 14, 24, 0.96) 0%, rgba(3, 6, 12, 0.99) 100%);
      color: #f1f5f9;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      z-index: 10;
      padding: 20px;
      pointer-events: none;
    }
    #blindfold-overlay.active {
      display: flex;
    }
    .blindfold-title {
      font-size: 20px;
      font-weight: 900;
      color: #e08e36;
      letter-spacing: 2px;
      margin-bottom: 6px;
      text-transform: uppercase;
    }
    .blindfold-sub {
      font-size: 12px;
      color: #94a3b8;
      max-width: 440px;
      line-height: 1.45;
      margin-bottom: 14px;
    }
    .blindfold-timer-box {
      width: 64px;
      height: 64px;
      border-radius: 32px;
      border: 2px solid #e08e36;
      background: rgba(10, 16, 28, 0.9);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      font-weight: 900;
      color: #f8fafc;
      box-shadow: 0 0 24px rgba(224, 142, 54, 0.35);
    }

    /* Crosshair */
    #crosshair {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 12px;
      height: 12px;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 4;
      opacity: 0.6;
      transition: transform 0.15s ease, opacity 0.15s ease;
    }
    #crosshair.active {
      transform: translate(-50%, -50%) scale(1.35);
      opacity: 1;
    }
    #crosshair::before, #crosshair::after {
      content: '';
      position: absolute;
      background: #cbd5e1;
      border-radius: 1px;
    }
    #crosshair.active::before, #crosshair.active::after {
      background: #ef4444;
      box-shadow: 0 0 8px rgba(239, 68, 68, 0.95);
    }
    #crosshair::before { top: 5px; left: 0; width: 12px; height: 2px; }
    #crosshair::after { top: 0; left: 5px; width: 2px; height: 12px; }

    /* Action Prompt Banner */
    #action-prompt {
      position: absolute;
      top: 64%;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(8, 13, 22, 0.92);
      border: 1px solid rgba(148, 163, 184, 0.38);
      color: #f1f5f9;
      font-size: 11.5px;
      font-weight: 800;
      letter-spacing: 0.8px;
      padding: 7px 18px;
      border-radius: 16px;
      display: none;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.9);
      z-index: 8;
      pointer-events: none;
    }
    #action-prompt.active {
      display: flex;
    }
    #action-prompt .key-pill {
      background: #e08e36;
      color: #060a10;
      font-size: 10px;
      font-weight: 900;
      padding: 2px 7px;
      border-radius: 4px;
    }

    /* Dark Slate Controls */
    #joystick-zone {
      position: absolute;
      bottom: max(16px, env(safe-area-inset-bottom, 16px));
      left: max(22px, env(safe-area-inset-left, 22px));
      width: 112px;
      height: 112px;
      border-radius: 56px;
      background: radial-gradient(circle, rgba(15, 23, 42, 0.45) 0%, rgba(6, 10, 18, 0.88) 100%);
      border: 1.5px solid rgba(148, 163, 184, 0.32);
      z-index: 12;
      touch-action: none;
      box-shadow: 0 4px 22px rgba(0, 0, 0, 0.9);
    }
    #joystick-thumb {
      position: absolute;
      top: 34px;
      left: 34px;
      width: 44px;
      height: 44px;
      border-radius: 22px;
      background: radial-gradient(circle, #e08e36 0%, #7c2d12 100%);
      border: 1.5px solid #cbd5e1;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.9);
      pointer-events: none;
      transition: transform 0.04s ease-out;
    }

    #action-cluster {
      position: absolute;
      bottom: max(16px, env(safe-area-inset-bottom, 16px));
      right: max(22px, env(safe-area-inset-right, 22px));
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 12;
      touch-action: none;
      pointer-events: none;
    }
    .action-row {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      align-items: center;
      pointer-events: none;
    }
    .touch-btn {
      width: 50px;
      height: 50px;
      border-radius: 25px;
      background: rgba(8, 13, 22, 0.86);
      border: 1px solid rgba(148, 163, 184, 0.32);
      color: #e2e8f0;
      font-size: 9px;
      font-weight: 800;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.85);
      touch-action: none;
      pointer-events: auto;
      cursor: pointer;
    }
    .touch-btn:active {
      transform: scale(0.92);
      background: rgba(224, 142, 54, 0.25);
      border-color: #e08e36;
    }
    .touch-btn.primary {
      width: 64px;
      height: 64px;
      border-radius: 32px;
      background: linear-gradient(135deg, #991b1b, #450a0a);
      border: 1.5px solid #e08e36;
      color: #f8fafc;
      font-size: 10.5px;
      font-weight: 900;
      box-shadow: 0 4px 20px rgba(153, 27, 27, 0.6);
    }
    .touch-btn svg {
      width: 18px;
      height: 18px;
      fill: currentColor;
      margin-bottom: 2px;
      pointer-events: none;
    }
    .touch-btn span { pointer-events: none; }

    #physics-debug-hud {
      position: absolute;
      top: 52px;
      left: 16px;
      background: rgba(3, 7, 12, 0.94);
      border: 1px solid rgba(0, 255, 200, 0.45);
      border-radius: 8px;
      padding: 8px 12px;
      font-family: monospace;
      font-size: 11px;
      line-height: 1.45;
      color: #00ffcc;
      z-index: 25;
      pointer-events: auto;
      display: none;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.85);
      max-width: 320px;
    }
    #physics-debug-hud .debug-title {
      font-weight: bold;
      color: #ffc27a;
      margin-bottom: 4px;
      font-size: 11px;
      letter-spacing: 0.5px;
    }
    .debug-controls-section {
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid rgba(0, 255, 200, 0.25);
    }
    .debug-section-label {
      font-size: 9px;
      font-weight: bold;
      color: #ffc27a;
      margin-bottom: 4px;
      letter-spacing: 0.5px;
    }
    .debug-btn-row {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    .dbg-btn {
      background: rgba(15, 23, 42, 0.9);
      border: 1px solid rgba(0, 255, 200, 0.5);
      color: #00ffcc;
      font-family: monospace;
      font-size: 10px;
      padding: 3px 6px;
      border-radius: 4px;
      cursor: pointer;
    }
    .dbg-btn:active, .dbg-btn.active {
      background: rgba(0, 255, 200, 0.35);
      color: #fff;
    }
    .dbg-select {
      width: 100%;
      background: rgba(15, 23, 42, 0.9);
      border: 1px solid rgba(0, 255, 200, 0.5);
      color: #00ffcc;
      font-family: monospace;
      font-size: 10px;
      padding: 3px 4px;
      border-radius: 4px;
    }

    #campus-banner {
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(8, 13, 22, 0.88);
      border: 1px solid rgba(148, 163, 184, 0.32);
      padding: 5px 16px;
      border-radius: 12px;
      color: #f1f5f9;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 1.1px;
      text-transform: uppercase;
      z-index: 6;
      display: flex;
      align-items: center;
      gap: 7px;
      pointer-events: none;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.85);
    }
    #campus-banner .beacon {
      width: 7px;
      height: 7px;
      border-radius: 4px;
      background: #e08e36;
      box-shadow: 0 0 8px #e08e36;
    }
    #campus-banner.danger {
      border-color: #ef4444;
      color: #fca5a5;
    }
    #campus-banner.danger .beacon {
      background: #ef4444;
      box-shadow: 0 0 12px #ef4444;
    }

    #toast {
      position: absolute;
      top: 48px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(8, 13, 22, 0.94);
      border: 1px solid rgba(224, 142, 54, 0.55);
      color: #f8fafc;
      padding: 7px 18px;
      border-radius: 16px;
      font-size: 11px;
      font-weight: 800;
      z-index: 15;
      opacity: 0;
      transition: opacity 0.25s ease;
      pointer-events: none;
      white-space: nowrap;
    }
    #toast.show { opacity: 1; }
  </style>

  <!-- Embedded Three.js Library -->
  <script>
    ${THREE_MIN_JS}
  </script>
</head>
<body>
  <canvas id="game-canvas"></canvas>
  <div id="fast-css-grade-fallback"></div>
  <div id="cinematic-vignette" style="opacity: 0.35;">
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style="display:block;width:100%;height:100%;pointer-events:none;">
      <defs>
        <radialGradient id="horror-svg-vignette" cx="50%" cy="50%" r="58%" fx="50%" fy="50%">
          <stop offset="0%" stop-color="#04070b" stop-opacity="0.0" />
          <stop offset="55%" stop-color="#04070b" stop-opacity="0.15" />
          <stop offset="85%" stop-color="#030609" stop-opacity="0.45" />
          <stop offset="100%" stop-color="#010204" stop-opacity="0.75" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="100" height="100" fill="url(#horror-svg-vignette)" />
    </svg>
  </div>
  <div id="horror-pulse-overlay"></div>
  <div id="horror-glitch-overlay"></div>
  <div id="horror-jumpscare-flash">
    <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Haunted Nepali Lakhey / Bhairav Nightmare Mask Silhouette -->
      <path d="M30 45 C50 12, 150 12, 170 45 C185 88, 172 152, 100 186 C28 152, 15 88, 30 45 Z" fill="#090204" stroke="#dc2626" stroke-width="3.5"/>
      <!-- Third Eye (Trinetra) on Forehead -->
      <ellipse cx="100" cy="54" rx="11" ry="18" fill="#fef08a" stroke="#ef4444" stroke-width="3"/>
      <circle cx="100" cy="54" r="5" fill="#991b1b"/>
      <!-- Fierce Glowing Demon Eyes -->
      <ellipse cx="64" cy="92" rx="20" ry="13" transform="rotate(-14 64 92)" fill="#fef08a" stroke="#ef4444" stroke-width="3.5"/>
      <circle cx="66" cy="92" r="6.5" fill="#7f1d1d"/>
      <circle cx="66" cy="92" r="2.5" fill="#ffffff"/>
      <ellipse cx="136" cy="92" rx="20" ry="13" transform="rotate(14 136 92)" fill="#fef08a" stroke="#ef4444" stroke-width="3.5"/>
      <circle cx="134" cy="92" r="6.5" fill="#7f1d1d"/>
      <circle cx="134" cy="92" r="2.5" fill="#ffffff"/>
      <!-- Jagged Fangs & Roaring Mouth -->
      <path d="M52 136 Q100 116 148 136 Q138 172 100 172 Q62 172 52 136 Z" fill="#450a0a" stroke="#ef4444" stroke-width="3"/>
      <polygon points="58,136 66,158 74,135" fill="#f8fafc"/>
      <polygon points="78,134 84,150 90,133" fill="#f8fafc"/>
      <polygon points="110,133 116,150 122,134" fill="#f8fafc"/>
      <polygon points="126,135 134,158 142,136" fill="#f8fafc"/>
      <polygon points="68,166 75,148 82,168" fill="#fca5a5"/>
      <polygon points="118,168 125,148 132,166" fill="#fca5a5"/>
    </svg>
  </div>

  <div id="stealth-overlay">
    <div id="stealth-badge">
      <div class="pulse-dot"></div>
      <span id="stealth-badge-text">HIDDEN UNDER CLASSROOM DESK • PEEK VIEW</span>
    </div>
  </div>

  <!-- Hold-Your-Breath Mini-Game Overlay (Triggered when Hunter inspects nearby hiding spot) -->
  <div id="breath-minigame-overlay" style="position:absolute;top:24%;left:50%;transform:translateX(-50%);background:rgba(6,10,18,0.95);border:1.5px solid #ef4444;border-radius:16px;padding:12px 20px;z-index:22;display:none;flex-direction:column;align-items:center;gap:8px;box-shadow:0 0 28px rgba(220,38,38,0.65);min-width:260px;">
    <div style="color:#fca5a5;font-size:11px;font-weight:900;letter-spacing:1.4px;text-transform:uppercase;">HUNTER SEARCHING ROOM — HOLD YOUR BREATH!</div>
    <div style="width:220px;height:12px;background:rgba(15,23,42,0.95);border:1px solid rgba(239,68,68,0.55);border-radius:6px;overflow:hidden;">
      <div id="breath-meter-fill" style="width:100%;height:100%;background:linear-gradient(90deg,#ef4444,#f59e0b,#22c55e);transition:width 0.05s linear;"></div>
    </div>
    <button id="btn-hold-breath" style="background:linear-gradient(135deg,#991b1b,#450a0a);border:1.5px solid #fca5a5;color:#fff;font-size:11px;font-weight:900;letter-spacing:1px;padding:7px 22px;border-radius:12px;cursor:pointer;touch-action:none;">HOLD BREATH (SPACE)</button>
  </div>

  <!-- Spectator / Captured Rescue Banner -->
  <div id="spectator-overlay" style="position:absolute;top:15%;left:50%;transform:translateX(-50%);background:rgba(12,18,30,0.94);border:1.5px solid #38bdf8;border-radius:14px;padding:8px 18px;z-index:18;display:none;flex-direction:column;align-items:center;gap:4px;pointer-events:auto;">
    <div id="spectator-title" style="color:#38bdf8;font-size:11px;font-weight:900;letter-spacing:1.2px;">CAPTURED (1/2) • SPECTATING TEAMMATES</div>
    <div id="spectator-sub" style="color:#cbd5e1;font-size:10px;">A teammate can still free you once! Tap VIEW to cycle cameras.</div>
  </div>

  <!-- Subtle Gameplay Telemetry Bar: Noise Indicator, Flashlight Battery, Fuses & Throwables -->
  <div id="gameplay-telemetry-hud" style="position:absolute;bottom:max(14px,env(safe-area-inset-bottom,14px));left:50%;transform:translateX(-50%);background:rgba(6,10,18,0.88);border:1px solid rgba(148,163,184,0.28);border-radius:14px;padding:5px 14px;z-index:11;display:flex;align-items:center;gap:12px;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,0.85);">
    <div style="display:flex;align-items:center;gap:5px;">
      <span style="color:#94a3b8;font-size:9.5px;font-weight:800;">NOISE</span>
      <div style="width:46px;height:6px;background:#0f172a;border-radius:3px;overflow:hidden;border:1px solid rgba(148,163,184,0.3);">
        <div id="hud-noise-bar" style="width:12%;height:100%;background:#22c55e;transition:width 0.1s ease;"></div>
      </div>
      <span id="hud-noise-label" style="color:#cbd5e1;font-size:9px;font-weight:800;min-width:38px;">QUIET</span>
    </div>
    <div style="width:1px;height:12px;background:rgba(148,163,184,0.25);"></div>
    <div style="display:flex;align-items:center;gap:4px;">
      <span style="color:#fde047;font-size:9.5px;font-weight:800;">BATT</span>
      <span id="hud-battery-label" style="color:#f8fafc;font-size:9.5px;font-weight:800;">100%</span>
    </div>
    <div style="width:1px;height:12px;background:rgba(148,163,184,0.25);"></div>
    <div style="display:flex;align-items:center;gap:4px;">
      <span style="color:#f59e0b;font-size:9.5px;font-weight:800;">FUSES</span>
      <span id="hud-fuses-label" style="color:#f8fafc;font-size:9.5px;font-weight:800;">0/4</span>
    </div>
  </div>

  <div id="crosshair"></div>

  <div id="campus-banner">
    <div class="beacon"></div>
    <span id="campus-zone-text">GANDAKI UNIVERSITY BLUEPRINT • MAIN PARKING PLAZA</span>
  </div>

  <div id="action-prompt">
    <span class="key-pill" id="action-prompt-key">E</span>
    <span id="action-prompt-text">PRESS TO HIDE</span>
  </div>

  <div id="blindfold-overlay">
    <div class="blindfold-title">GANDAKI UNIVERSITY BLUEPRINT MAP</div>
    <div class="blindfold-sub">Restore 4 Fuse Boxes across the campus buildings to unlock the South Main Gate and escape the Hollow Proctor.</div>
    <div class="blindfold-timer-box" id="blindfold-counter">10</div>
  </div>

  <!-- Pre-Game Audio Unlock Gate (Shown if first touch was consumed by React Native Lobby before WebView mounted) -->
  <div id="audio-unlock-gate" style="position:absolute;top:52px;left:50%;transform:translateX(-50%);background:rgba(224,142,54,0.95);border:1.5px solid #fef08a;color:#060a10;padding:6px 16px;border-radius:16px;font-size:10.5px;font-weight:900;letter-spacing:1px;z-index:24;display:flex;align-items:center;gap:7px;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,0.85);">
    <span>TAP ANYWHERE TO ENABLE NIGHTFALL AUDIO</span>
  </div>

  <div id="toast"></div>

  <!-- Live Coordinate, Building, Room ID & Light Mood Readout Pill (Explore Mode) -->
  <div id="explore-coord-pill" style="position:absolute;top:36px;left:50%;transform:translateX(-50%);background:rgba(6,10,18,0.88);border:1px solid rgba(56,189,248,0.42);color:#e0f2fe;font-family:monospace;font-size:10px;font-weight:700;padding:4px 12px;border-radius:10px;z-index:7;pointer-events:none;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,0.8);">
    XYZ: (-4.0, 0.0, -48.0) • BLDG: OUTDOORS • ROOM: OUTDOORS • MOOD: NIGHT_SKY
  </div>

  <!-- Floating UI Restore Button (Shown only while Free Screenshot Mode hides all HUD) -->
  <button id="screenshot-restore-btn" style="position:absolute;bottom:14px;right:14px;background:rgba(8,13,22,0.55);border:1px solid rgba(148,163,184,0.4);color:#cbd5e1;font-size:9.5px;font-weight:800;padding:5px 10px;border-radius:10px;z-index:30;display:none;cursor:pointer;">
    SHOW UI
  </button>

  <div id="physics-debug-hud" style="max-height:82vh;overflow-y:auto;">
    <div class="debug-title">MAP-DESIGN &amp; TELEMETRY TOOLS</div>
    <div id="dbg-fps">FPS: 60 | Physics: 0.00ms</div>
    <div id="dbg-pos">Pos: 0.00, 0.00, 0.00</div>
    <div id="dbg-room-info" style="color:#38bdf8;font-weight:bold;">Room: OUTDOORS [CAMPUS] | Mood: night_sky</div>
    <div id="dbg-vel">Vel: (0.00, 0.00, 0.00) 0.00 m/s</div>
    <div id="dbg-move">MoveVec: (0.00, 0.00)</div>
    <div id="dbg-input">Input: Fwd: 0.00, Right: 0.00</div>
    <div id="dbg-look">Yaw: 0.0° (0.00 rad) | Pitch: 0.0°</div>
    <div id="dbg-ground">Grounded: true | Crouching: false</div>
    <div id="dbg-normal">Coll Normal: None</div>

    <div class="debug-controls-section">
      <div class="debug-section-label">1. CAMERA &amp; FREE-FLY (NOCLIP)</div>
      <div class="debug-btn-row">
        <button id="dbg-btn-freefly" class="dbg-btn">Free-Fly: OFF</button>
        <button id="dbg-btn-walkmode" class="dbg-btn active">Walk Mode</button>
        <button id="dbg-btn-overview-cam" class="dbg-btn">Overview Cam: OFF</button>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
        <span style="font-size:9.5px;color:#94a3b8;">Fly Spd:</span>
        <input id="dbg-slider-flyspeed" type="range" min="4" max="40" step="1" value="14" style="flex:1;" />
        <span id="dbg-flyspeed-val" style="font-size:9.5px;min-width:34px;">14m/s</span>
      </div>
      <div class="debug-btn-row" style="margin-top:4px;">
        <button id="dbg-btn-spd-1" class="dbg-btn active">1x</button>
        <button id="dbg-btn-spd-2" class="dbg-btn">2x</button>
        <button id="dbg-btn-spd-5" class="dbg-btn">5x</button>
        <button id="dbg-btn-lowfps" class="dbg-btn">15 FPS</button>
        <button id="dbg-btn-lag" class="dbg-btn">1s Freeze</button>
      </div>
    </div>

    <div class="debug-controls-section">
      <div class="debug-section-label">2. TELEPORT TO ANY ROOM / BUILDING (32 ROOMS)</div>
      <select id="dbg-room-teleport-select" class="dbg-select">
        <option value="">Jump to Room / Building / Floor...</option>
      </select>
      <div style="margin-top:4px;">
        <select id="dbg-teleport-select" class="dbg-select">
          <option value="">Landmark Teleport Presets...</option>
          <option value="1.8,0,-51.2,-0.55">Bus A exterior</option>
          <option value="5.2,0.54,-43.2,0">Bus A interior</option>
          <option value="12.0,0,-52.2,-0.55">Bus B exterior</option>
          <option value="15.4,0.54,-44.2,0.04">Bus B interior</option>
          <option value="-5.7,0.48,64.0,0">Main Bldg: Hall 101 (Flicker Tube)</option>
          <option value="17.7,0.48,64.0,0">Main Bldg: Admin 102 (Warm Lamp)</option>
          <option value="-5.7,4.08,64.0,0">Main Bldg: Class 201 (Moonlit)</option>
          <option value="17.7,4.08,64.0,0">Main Bldg: Library 202 (Warm Lamp)</option>
          <option value="-5.7,7.68,64.0,0">Main Bldg: Seminar 301 (Dark)</option>
          <option value="17.7,7.68,64.0,0">Main Bldg: Lab 302 (Emergency Red)</option>
          <option value="-3.8,0,-18.0,-1.57">West Wing L1 Exterior Wall</option>
          <option value="-38.2,0.22,-48.45,0.785">Heritage W1 Inside Corner</option>
          <option value="-4.5,0,-33.5,1.57">Narrow Gap (Car vs Wall)</option>
          <option value="3.2,0,-60.0,0">Street Lamp Post</option>
          <option value="-6.0,0,40.0,3.14">Wrought-Iron Spiked Fence</option>
          <option value="-12.0,0,-14.0,0">Stone Chaitya Stupa Base</option>
          <option value="0,0,-60,0">Spawn: South Main Gate</option>
          <option value="-4,0,-48,0">Spawn: Parking Plaza</option>
        </select>
      </div>
    </div>

    <div class="debug-controls-section">
      <div class="debug-section-label">3. LIGHTING MOOD, TIME, FOG &amp; EFFECT LAYERS</div>
      <div class="debug-btn-row">
        <button id="dbg-btn-cycle-mood" class="dbg-btn">Cycle Room Mood</button>
        <button id="dbg-btn-wireframes" class="dbg-btn">Colliders+WPs</button>
        <button id="dbg-btn-shadows" class="dbg-btn active">Shadows: ON</button>
        <button id="dbg-btn-screenshot" class="dbg-btn" style="border-color:#fde047;color:#fde047;">Screenshot (Hide UI)</button>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
        <span style="font-size:9.5px;color:#94a3b8;min-width:52px;">Night Light:</span>
        <input id="dbg-slider-time" type="range" min="0.2" max="2.5" step="0.05" value="1.0" style="flex:1;" />
        <span id="dbg-time-val" style="font-size:9.5px;min-width:32px;">100%</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
        <span style="font-size:9.5px;color:#94a3b8;min-width:52px;">Fog Density:</span>
        <input id="dbg-slider-fog" type="range" min="0.0" max="2.5" step="0.05" value="1.0" style="flex:1;" />
        <span id="dbg-fog-val" style="font-size:9.5px;min-width:32px;">100%</span>
      </div>
      <div class="debug-btn-row" style="margin-top:4px;">
        <button id="dbg-btn-layer-fog" class="dbg-btn active">Fog: ON</button>
        <button id="dbg-btn-layer-dust" class="dbg-btn active">Dust: ON</button>
        <button id="dbg-btn-layer-shafts" class="dbg-btn active">Shafts: ON</button>
        <button id="dbg-btn-layer-beam" class="dbg-btn active">FL Beam: ON</button>
      </div>
    </div>

    <div class="debug-controls-section">
      <div class="debug-section-label">4. AUDIO AMBIENCE &amp; TOP-DOWN MINIMAP</div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:9.5px;color:#94a3b8;">Amb Vol:</span>
        <input id="dbg-slider-volume" type="range" min="0" max="1.4" step="0.05" value="1.0" style="flex:1;" />
        <span id="dbg-vol-val" style="font-size:9.5px;min-width:32px;">100%</span>
        <button id="dbg-btn-mute-audio" class="dbg-btn">Mute Audio</button>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:5px;">
        <button id="dbg-btn-minimap" class="dbg-btn active">2D Minimap</button>
        <button id="dbg-btn-run-audit" class="dbg-btn">Run Audit</button>
      </div>
      <canvas id="explore-minimap-canvas" width="160" height="190" style="display:block;margin-top:5px;border:1px solid rgba(56,189,248,0.4);border-radius:6px;background:#050b14;"></canvas>
    </div>

    <div class="debug-controls-section">
      <div class="debug-section-label">5. MAP DESIGN NOTES LOGGER</div>
      <div style="display:flex;gap:4px;">
        <input id="dbg-note-input" type="text" placeholder="Note what to fix here..." style="flex:1;background:rgba(15,23,42,0.95);border:1px solid rgba(0,255,200,0.45);color:#e2e8f0;font-family:monospace;font-size:10px;padding:3px 6px;border-radius:4px;" />
        <button id="dbg-btn-add-note" class="dbg-btn">+Log</button>
        <button id="dbg-btn-copy-notes" class="dbg-btn">Copy</button>
      </div>
      <textarea id="dbg-notes-output" readonly rows="3" placeholder="Logged room/coord notes appear here..." style="width:100%;margin-top:4px;background:rgba(6,10,18,0.95);border:1px solid rgba(148,163,184,0.3);color:#cbd5e1;font-family:monospace;font-size:9.5px;padding:4px;border-radius:4px;resize:vertical;"></textarea>
    </div>

    <div class="debug-controls-section" style="display:none;">
      <button id="dbg-btn-fear" class="dbg-btn">Fear: HIGH</button>
      <button id="dbg-btn-flicker" class="dbg-btn">Flicker: FULL</button>
      <button id="dbg-btn-shake" class="dbg-btn">Shake: ON</button>
    </div>
  </div>

  <div id="joystick-zone">
    <div id="joystick-thumb"></div>
  </div>

  <div id="action-cluster">
    <div class="action-row">
      <div class="touch-btn" id="btn-debug-physics" style="display:flex;" title="Toggle Physics Colliders &amp; Telemetry (P)">
        <svg viewBox="0 0 24 24"><path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.86L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/></svg>
        <span>DEBUG</span>
      </div>
      <div class="touch-btn" id="btn-flashlight" title="Toggle Flashlight / Hunter Ping (F/Q)">
        <svg viewBox="0 0 24 24"><path d="M6 2h12v6l-3 3v11H9V11L6 8V2zm2 2v3.17l3 3V20h2v-9.83l3-3V4H8z"/></svg>
        <span id="btn-flashlight-label">LIGHT</span>
      </div>
      <div class="touch-btn" id="btn-throw" title="Throw Distraction / Hunter Ability (G)">
        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        <span id="btn-throw-label">THROW (2)</span>
      </div>
      <div class="touch-btn" id="btn-cam" title="Toggle 1P/3P View (V)">
        <svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
        <span>VIEW</span>
      </div>
      <div class="touch-btn" id="btn-sprint" title="Sprint / Run (Shift)">
        <svg viewBox="0 0 24 24"><path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/></svg>
        <span>SPRINT</span>
      </div>
    </div>
    <div class="action-row">
      <div class="touch-btn" id="btn-crouch" title="Crouch / Stealth (C)">
        <svg viewBox="0 0 24 24"><path d="M12 2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm4.5 9c-.83 0-1.5-.67-1.5-1.5S15.67 8 16.5 8s1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM6 14.5V10c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2v2.5L18 17v5h-2v-4l-3-2.5V22H9v-5.5L7 15v7H5v-7.5z"/></svg>
        <span>CROUCH</span>
      </div>
      <div class="touch-btn" id="btn-jump" title="Jump (Space)">
        <svg viewBox="0 0 24 24"><path d="M12 3l4 4h-3v6h-2V7H8zM5 19h14v2H5z"/></svg>
        <span>JUMP</span>
      </div>
      <div class="touch-btn primary" id="btn-action" title="Interact / Hide / Repair / Tag (E)">
        <svg viewBox="0 0 24 24"><path d="M13 2.05v3.03c3.39.49 6 3.39 6 6.92 0 .9-.18 1.75-.5 2.54l2.25 1.5c.8-1.25 1.25-2.73 1.25-4.04 0-4.97-4.03-9-9-9.95zM12 19c-3.87 0-7-3.13-7-7 0-3.53 2.61-6.43 6-6.92V2.05C6.03 3 2 7.03 2 12c0 5.52 4.48 10 10 10 2.2 0 4.22-.72 5.86-1.93l-2.06-1.42C14.63 19.55 13.38 19 12 19zm8 2.08l-4.59-3.16A7.94 7.94 0 0 1 12 20c-4.41 0-8-3.59-8-8 0-4.04 3.01-7.39 6.95-7.92L12 1.05C6.54 1.58 2 5.97 2 11.5 2 17.3 6.7 22 12.5 22c2.4 0 4.61-.81 6.38-2.18L21.08 22l1.42-1.42-2.5-1.5z"/></svg>
        <span id="btn-action-label">HIDE</span>
      </div>
    </div>
  </div>

  <script>
    const pendingRnMessages = [];
    function sendToReactNative(type, payload = {}) {
      try {
        const msg = { type, ...payload };
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          while (pendingRnMessages.length > 0) {
            const p = pendingRnMessages.shift();
            window.ReactNativeWebView.postMessage(JSON.stringify(p));
          }
          window.ReactNativeWebView.postMessage(JSON.stringify(msg));
        } else {
          pendingRnMessages.push(msg);
        }
      } catch (e) {}
    }

    const rnCheckTimer = setInterval(() => {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        clearInterval(rnCheckTimer);
        while (pendingRnMessages.length > 0) {
          const p = pendingRnMessages.shift();
          try {
            window.ReactNativeWebView.postMessage(JSON.stringify(p));
          } catch (e) {}
        }
      }
    }, 60);

    function showToast(msg) {
      const el = document.getElementById('toast');
      if (!el) return;
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(el._hideTimer);
      el._hideTimer = setTimeout(() => el.classList.remove('show'), 2300);
    }

    window.onerror = function(message, source, lineno, colno, error) {
      const errMsg = 'Hide&Seek Error [' + lineno + ':' + colno + ']: ' + message;
      console.error(errMsg, error);
      sendToReactNative('LOG_ERROR', {
        message: errMsg,
        stack: error ? error.stack : ''
      });
      showToast(errMsg);
    };

    window.addEventListener('unhandledrejection', function(event) {
      const errMsg = 'Hide&Seek Unhandled Promise: ' + (event.reason ? (event.reason.message || event.reason) : 'Unknown');
      console.error(errMsg);
      sendToReactNative('LOG_ERROR', { message: errMsg });
    });

    const HORROR_CONFIG = ${configJson};
    let EXPLORE_MODE = HORROR_CONFIG.exploreMode !== undefined ? Boolean(HORROR_CONFIG.exploreMode) : true;
    const EXPLORE_FLAGS = {
      // 1. Hide-and-seek gameplay flags
      ENABLE_GAMEPLAY: !EXPLORE_MODE,
      ENABLE_HIDE_AND_SEEK_GAMEPLAY: !EXPLORE_MODE,
      ENABLE_HUNTER_AND_BOTS: !EXPLORE_MODE,
      ENABLE_ROLES_AND_TIMER: !EXPLORE_MODE,
      ENABLE_ROLES_TIMER_WIN_LOSE: !EXPLORE_MODE,
      ENABLE_WIN_LOSE_EVALUATION: !EXPLORE_MODE,
      ENABLE_TAGGING_AND_CATCHING: !EXPLORE_MODE,
      ENABLE_HIDING_PROMPTS: !EXPLORE_MODE,
      ENABLE_HIDING_SPOTS_AND_MINIGAME: !EXPLORE_MODE,
      ENABLE_BREATH_MINIGAME: !EXPLORE_MODE,
      ENABLE_FUSE_OBJECTIVES: !EXPLORE_MODE,
      ENABLE_FUSE_BOXES_AND_OBJECTIVES: !EXPLORE_MODE,
      ENABLE_THROWABLE_DISTRACTIONS: !EXPLORE_MODE,
      ENABLE_GAMEPLAY_HUD: !EXPLORE_MODE,
      // 2. Scare & fear flags
      ENABLE_SCARES: !EXPLORE_MODE,
      ENABLE_GHOST_APPARITIONS: !EXPLORE_MODE,
      ENABLE_JUMPSCARES_AND_STINGERS: !EXPLORE_MODE,
      ENABLE_RANDOM_SCARE_EVENTS: !EXPLORE_MODE,
      ENABLE_WHISPERS_AND_WEEPING: !EXPLORE_MODE,
      ENABLE_HEARTBEAT: !EXPLORE_MODE,
      ENABLE_HEARTBEAT_AND_CHASE_AUDIO: !EXPLORE_MODE,
      ENABLE_PROXIMITY_AND_CHASE_AUDIO: !EXPLORE_MODE,
      // 3. Camera & screen effect flags
      ENABLE_CAMERA_AND_SCREEN_EFFECTS: !EXPLORE_MODE,
      ENABLE_CAMERA_AND_SCREEN_SHAKE: !EXPLORE_MODE,
      ENABLE_RED_VIGNETTE_AND_PULSES: !EXPLORE_MODE,
      ENABLE_SCREEN_GLITCH_AND_DISTORTION: !EXPLORE_MODE,
      ENABLE_FEAR_FOV_AND_TENSION_FOG: !EXPLORE_MODE,
      // 4. Flicker & room light mood flags
      ENABLE_STROBING_AND_BROWNOUTS: !EXPLORE_MODE,
      CALM_DYING_TUBE_FLICKER: EXPLORE_MODE,
      STEADY_EMERGENCY_RED: EXPLORE_MODE,
      // 5. Flashlight battery flag
      INFINITE_FLASHLIGHT_BATTERY: EXPLORE_MODE,
    };
    const exploreTools = {
      freeFly: false,
      overviewCam: false,
      flyUpHeld: false,
      flyDownHeld: false,
      fogEnabled: true,
      fogFar: (HORROR_CONFIG.renderer && HORROR_CONFIG.renderer.fogFar) || 88.0,
      dustEnabled: true,
      lightShaftsEnabled: true,
      flashlightBeamEnabled: true,
      initUI() {},
      updateFrame() {},
      syncAudioUi() {},
    };
    function setExploreMode(enabled) {
      EXPLORE_MODE = !!enabled;
      HORROR_CONFIG.exploreMode = EXPLORE_MODE;
      const gOn = !EXPLORE_MODE;
      EXPLORE_FLAGS.ENABLE_GAMEPLAY = gOn;
      EXPLORE_FLAGS.ENABLE_HIDE_AND_SEEK_GAMEPLAY = gOn;
      EXPLORE_FLAGS.ENABLE_HUNTER_AND_BOTS = gOn;
      EXPLORE_FLAGS.ENABLE_ROLES_AND_TIMER = gOn;
      EXPLORE_FLAGS.ENABLE_ROLES_TIMER_WIN_LOSE = gOn;
      EXPLORE_FLAGS.ENABLE_WIN_LOSE_EVALUATION = gOn;
      EXPLORE_FLAGS.ENABLE_TAGGING_AND_CATCHING = gOn;
      EXPLORE_FLAGS.ENABLE_HIDING_PROMPTS = gOn;
      EXPLORE_FLAGS.ENABLE_HIDING_SPOTS_AND_MINIGAME = gOn;
      EXPLORE_FLAGS.ENABLE_BREATH_MINIGAME = gOn;
      EXPLORE_FLAGS.ENABLE_FUSE_OBJECTIVES = gOn;
      EXPLORE_FLAGS.ENABLE_FUSE_BOXES_AND_OBJECTIVES = gOn;
      EXPLORE_FLAGS.ENABLE_THROWABLE_DISTRACTIONS = gOn;
      EXPLORE_FLAGS.ENABLE_GAMEPLAY_HUD = gOn;
      EXPLORE_FLAGS.ENABLE_SCARES = gOn;
      EXPLORE_FLAGS.ENABLE_GHOST_APPARITIONS = gOn;
      EXPLORE_FLAGS.ENABLE_JUMPSCARES_AND_STINGERS = gOn;
      EXPLORE_FLAGS.ENABLE_RANDOM_SCARE_EVENTS = gOn;
      EXPLORE_FLAGS.ENABLE_WHISPERS_AND_WEEPING = gOn;
      EXPLORE_FLAGS.ENABLE_HEARTBEAT = gOn;
      EXPLORE_FLAGS.ENABLE_HEARTBEAT_AND_CHASE_AUDIO = gOn;
      EXPLORE_FLAGS.ENABLE_PROXIMITY_AND_CHASE_AUDIO = gOn;
      EXPLORE_FLAGS.ENABLE_CAMERA_AND_SCREEN_EFFECTS = gOn;
      EXPLORE_FLAGS.ENABLE_CAMERA_AND_SCREEN_SHAKE = gOn;
      EXPLORE_FLAGS.ENABLE_RED_VIGNETTE_AND_PULSES = gOn;
      EXPLORE_FLAGS.ENABLE_SCREEN_GLITCH_AND_DISTORTION = gOn;
      EXPLORE_FLAGS.ENABLE_FEAR_FOV_AND_TENSION_FOG = gOn;
      EXPLORE_FLAGS.ENABLE_STROBING_AND_BROWNOUTS = gOn;
      EXPLORE_FLAGS.CALM_DYING_TUBE_FLICKER = EXPLORE_MODE;
      EXPLORE_FLAGS.STEADY_EMERGENCY_RED = EXPLORE_MODE;
      EXPLORE_FLAGS.INFINITE_FLASHLIGHT_BATTERY = EXPLORE_MODE;

      const gpHud = document.getElementById('gameplay-telemetry-hud');
      if (gpHud) gpHud.style.display = gOn ? 'flex' : 'none';
      const throwBtn = document.getElementById('btn-throw');
      if (throwBtn) throwBtn.style.display = gOn ? 'flex' : 'none';
      const actLbl = document.getElementById('btn-action-label');
      if (actLbl && !gOn) actLbl.textContent = 'DOOR';
      const coordPill = document.getElementById('explore-coord-pill');
      if (coordPill) coordPill.style.display = EXPLORE_MODE ? 'block' : 'none';
    }
    window.setExploreMode = setExploreMode;
    window.EXPLORE_FLAGS = EXPLORE_FLAGS;
    let currentQuality = 'high';
    let qualityPinMode = (HORROR_CONFIG.accessibility && HORROR_CONFIG.accessibility.qualityPinMode) || 'auto';
    let batterySaverEnabled = !!(HORROR_CONFIG.accessibility && HORROR_CONFIG.accessibility.batterySaver);
    let activePreset = HORROR_CONFIG.qualityPresets[currentQuality] || HORROR_CONFIG.qualityPresets.high;
    window.__PROCEDURAL_TEX_CACHE__ = window.__PROCEDURAL_TEX_CACHE__ || new Map();
    window.__TEXTURE_CHUNK_QUEUE__ = window.__TEXTURE_CHUNK_QUEUE__ || [];

    /* =========================================================================
       PHASE A PERFORMANCE FOUNDATION:
       1. Global Geometry Parameter Cache (shares Box/Cylinder/Plane/Cone/Sphere/Dodec)
       2. THREE.BufferGeometryUtils.mergeBufferGeometries (r128 static room merger)
       3. bakeStaticGroup (per-room InstancedMesh for repeated props + material merge)
       4. RoomVisibilityManager (room/building portal & distance culling)
       ========================================================================= */
    (function installGeometryCacheAndMerger() {
      const geoCache = new Map();
      function wrapGeoCtor(name, OrigCtor, skipPred) {
        if (!OrigCtor) return;
        const Wrapped = function(...args) {
          if (skipPred && skipPred(args)) {
            return new OrigCtor(...args);
          }
          const key = name + ':' + args.map(a => (typeof a === 'number' ? Math.round(a * 10000) / 10000 : String(a))).join(',');
          let cached = geoCache.get(key);
          if (!cached) {
            cached = new OrigCtor(...args);
            geoCache.set(key, cached);
          }
          return cached;
        };
        Wrapped.prototype = OrigCtor.prototype;
        Object.setPrototypeOf(Wrapped, OrigCtor);
        THREE[name] = Wrapped;
      }
      wrapGeoCtor('BoxGeometry', THREE.BoxGeometry, null);
      wrapGeoCtor('CylinderGeometry', THREE.CylinderGeometry, (args) => args[5] === true && args[3] >= 28);
      wrapGeoCtor('PlaneGeometry', THREE.PlaneGeometry, null);
      wrapGeoCtor('ConeGeometry', THREE.ConeGeometry, null);
      wrapGeoCtor('SphereGeometry', THREE.SphereGeometry, null);
      wrapGeoCtor('DodecahedronGeometry', THREE.DodecahedronGeometry, null);

      function mergeBufferGeometries(geometries) {
        if (!geometries || geometries.length === 0) return null;
        let totalVerts = 0;
        let totalIndices = 0;
        let hasAnyColor = false;
        const validGeos = [];

        for (let i = 0; i < geometries.length; i++) {
          const g = geometries[i];
          if (!g || !g.attributes || !g.attributes.position) continue;
          const vCount = g.attributes.position.count;
          if (vCount === 0) continue;
          if (g.attributes.color) hasAnyColor = true;
          const iCount = g.index ? g.index.count : vCount;
          totalVerts += vCount;
          totalIndices += iCount;
          validGeos.push(g);
        }
        if (validGeos.length === 0) return null;

        const positions = new Float32Array(totalVerts * 3);
        const normals = new Float32Array(totalVerts * 3);
        const uvs = new Float32Array(totalVerts * 2);
        const colors = hasAnyColor ? new Float32Array(totalVerts * 3) : null;
        const indices = totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

        let vOffset = 0;
        let iOffset = 0;

        for (let i = 0; i < validGeos.length; i++) {
          const g = validGeos[i];
          const posAttr = g.attributes.position;
          const normAttr = g.attributes.normal;
          const uvAttr = g.attributes.uv;
          const colAttr = g.attributes.color;
          const vCount = posAttr.count;

          if (posAttr.array && posAttr.itemSize === 3) {
            positions.set(posAttr.array.subarray(0, vCount * 3), vOffset * 3);
          } else {
            for (let v = 0; v < vCount; v++) {
              positions[(vOffset + v) * 3] = posAttr.getX(v);
              positions[(vOffset + v) * 3 + 1] = posAttr.getY(v);
              positions[(vOffset + v) * 3 + 2] = posAttr.getZ(v);
            }
          }

          if (normAttr) {
            if (normAttr.array && normAttr.itemSize === 3) {
              normals.set(normAttr.array.subarray(0, vCount * 3), vOffset * 3);
            } else {
              for (let v = 0; v < vCount; v++) {
                normals[(vOffset + v) * 3] = normAttr.getX(v);
                normals[(vOffset + v) * 3 + 1] = normAttr.getY(v);
                normals[(vOffset + v) * 3 + 2] = normAttr.getZ(v);
              }
            }
          } else {
            for (let v = 0; v < vCount; v++) {
              normals[(vOffset + v) * 3 + 1] = 1.0;
            }
          }

          if (uvAttr) {
            if (uvAttr.array && uvAttr.itemSize === 2) {
              uvs.set(uvAttr.array.subarray(0, vCount * 2), vOffset * 2);
            } else {
              for (let v = 0; v < vCount; v++) {
                uvs[(vOffset + v) * 2] = uvAttr.getX(v);
                uvs[(vOffset + v) * 2 + 1] = uvAttr.getY(v);
              }
            }
          }

          if (colors) {
            if (colAttr && colAttr.array && colAttr.itemSize === 3) {
              colors.set(colAttr.array.subarray(0, vCount * 3), vOffset * 3);
            } else if (colAttr) {
              for (let v = 0; v < vCount; v++) {
                colors[(vOffset + v) * 3] = colAttr.getX(v);
                colors[(vOffset + v) * 3 + 1] = colAttr.getY(v);
                colors[(vOffset + v) * 3 + 2] = colAttr.getZ(v);
              }
            } else {
              for (let v = 0; v < vCount; v++) {
                colors[(vOffset + v) * 3] = 1.0;
                colors[(vOffset + v) * 3 + 1] = 1.0;
                colors[(vOffset + v) * 3 + 2] = 1.0;
              }
            }
          }

          if (g.index) {
            const idxArr = g.index.array;
            const iCount = g.index.count;
            for (let k = 0; k < iCount; k++) {
              indices[iOffset + k] = idxArr[k] + vOffset;
            }
            iOffset += iCount;
          } else {
            for (let k = 0; k < vCount; k++) {
              indices[iOffset + k] = vOffset + k;
            }
            iOffset += vCount;
          }

          vOffset += vCount;
        }

        const merged = new THREE.BufferGeometry();
        merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        if (colors) {
          merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        }
        merged.setIndex(new THREE.BufferAttribute(indices, 1));
        merged.computeBoundingBox();
        merged.computeBoundingSphere();
        return merged;
      }

      THREE.BufferGeometryUtils = THREE.BufferGeometryUtils || {};
      THREE.BufferGeometryUtils.mergeBufferGeometries = mergeBufferGeometries;
    })();

    // Baked Vertex-Color Ambient Occlusion helper (Requirement 3: darkening in corners, floor/ceiling contact & furniture undersides)
    function applyBakedVertexAO(geo, isRoomInterior = true) {
      if (!geo || !geo.attributes || !geo.attributes.position) return geo;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bbox = geo.boundingBox;
      if (!bbox) return geo;

      const posAttr = geo.attributes.position;
      const normAttr = geo.attributes.normal;
      const vCount = posAttr.count;
      const colors = new Float32Array(vCount * 3);

      const minX = bbox.min.x, maxX = bbox.max.x;
      const minY = bbox.min.y, maxY = bbox.max.y;
      const minZ = bbox.min.z, maxZ = bbox.max.z;
      const spanX = Math.max(0.5, maxX - minX);
      const spanZ = Math.max(0.5, maxZ - minZ);

      for (let i = 0; i < vCount; i++) {
        const vx = posAttr.getX(i);
        const vy = posAttr.getY(i);
        const vz = posAttr.getZ(i);
        const ny = normAttr ? normAttr.getY(i) : 0.0;

        let ao = 1.0;

        // 1. Floor contact & baseboard darkening (vertices within 0.36m of floor)
        const hFromFloor = Math.max(0.0, vy - Math.max(0.0, minY));
        if (hFromFloor < 0.38) {
          const floorFactor = hFromFloor / 0.38;
          ao *= (0.48 + 0.52 * floorFactor);
        }

        // 2. Under-desk / furniture underside cavity darkening (downward-facing normals or low furniture cavities)
        if (ny < -0.35 && vy > 0.15 && vy < 1.35) {
          ao *= 0.52;
        } else if (vy > 0.05 && vy < 0.68 && isRoomInterior) {
          // Slight ambient cavity shadow in lower furniture leg zone
          ao *= 0.84;
        }

        // 3. Ceiling coving darkening (near 3.25m - 3.45m room ceiling)
        if (isRoomInterior && vy > 2.95 && vy < 3.55) {
          const ceilFactor = Math.min(1.0, Math.max(0.0, (3.42 - vy) / 0.45));
          ao *= (0.58 + 0.42 * ceilFactor);
        }

        // 4. Vertical room corner darkening (where X and Z both approach room perimeter bounds)
        if (isRoomInterior && spanX > 2.5 && spanZ > 2.5) {
          const dxWall = Math.min(Math.abs(vx - minX), Math.abs(maxX - vx));
          const dzWall = Math.min(Math.abs(vz - minZ), Math.abs(maxZ - vz));
          if (dxWall < 1.15 && dzWall < 1.15) {
            const cornerT = Math.max(dxWall / 1.15, dzWall / 1.15);
            ao *= (0.46 + 0.54 * cornerT);
          } else if (dxWall < 0.45 || dzWall < 0.45) {
            const wallT = Math.min(dxWall, dzWall) / 0.45;
            ao *= (0.76 + 0.24 * wallT);
          }
        }

        ao = Math.max(0.28, Math.min(1.0, ao));
        // Slight cool slate tint in deepest occluded creases
        colors[i * 3]     = ao * (0.94 + 0.06 * ao);
        colors[i * 3 + 1] = ao * (0.97 + 0.03 * ao);
        colors[i * 3 + 2] = ao;
      }

      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return geo;
    }

    function getVertexColoredMaterial(mat) {
      if (!mat) return mat;
      if (mat.vertexColors) return mat;
      if (!mat.userData) mat.userData = {};
      if (!mat.userData._vcMat) {
        const cloned = mat.clone();
        cloned.vertexColors = true;
        cloned.needsUpdate = true;
        mat.userData._vcMat = cloned;
      }
      return mat.userData._vcMat;
    }

    function computeInstancedBoundingSphere(instMesh, count) {
      if (!instMesh || !instMesh.geometry) return;
      const baseGeo = instMesh.geometry;
      if (!baseGeo.boundingBox) baseGeo.computeBoundingBox();
      if (!baseGeo.boundingSphere) baseGeo.computeBoundingSphere();
      const baseBox = baseGeo.boundingBox;
      if (!baseBox) return;

      const totalBox = new THREE.Box3();
      const instBox = new THREE.Box3();
      const mat = new THREE.Matrix4();
      const n = typeof count === 'number' ? count : instMesh.count;
      for (let i = 0; i < n; i++) {
        instMesh.getMatrixAt(i, mat);
        instBox.copy(baseBox).applyMatrix4(mat);
        totalBox.union(instBox);
      }
      if (!totalBox.isEmpty()) {
        const clonedGeo = baseGeo.clone();
        clonedGeo.boundingBox = totalBox;
        clonedGeo.boundingSphere = new THREE.Sphere();
        totalBox.getBoundingSphere(clonedGeo.boundingSphere);
        instMesh.geometry = clonedGeo;
        instMesh.frustumCulled = true;
      }
    }

    function bakeStaticGroup(rootGroup, allowInstancing = true) {
      if (!rootGroup || rootGroup.userData._baked) return;
      rootGroup.userData._baked = true;
      rootGroup.updateMatrixWorld(true);

      const rootInv = new THREE.Matrix4().copy(rootGroup.matrixWorld).invert();
      const meshesToBake = [];

      rootGroup.traverse((child) => {
        if (child === rootGroup) return;
        if (child.userData && child.userData.noMerge) return;
        if (child.isInstancedMesh || child.isSprite || child.isPoints || child.isLine || child.isLight) return;
        if (child.isMesh && child.geometry && child.material && !Array.isArray(child.material)) {
          meshesToBake.push(child);
        }
      });

      if (meshesToBake.length <= 1) return;

      const isIndoorRoom = !!(rootGroup.userData && rootGroup.userData.isRoomGroup);
      const shadowCasterMats = new Set(isIndoorRoom ? [
        materials.deskWoodTop && materials.deskWoodTop.uuid,
      ] : [
        materials.campusStucco && materials.campusStucco.uuid,
        materials.nepalDachiBrick && materials.nepalDachiBrick.uuid,
        materials.rotundaBrick && materials.rotundaBrick.uuid,
        materials.brightBlueRoof && materials.brightBlueRoof.uuid,
        materials.terracottaRoof && materials.terracottaRoof.uuid,
        materials.jhingatiTerracottaRoof && materials.jhingatiTerracottaRoof.uuid,
      ]);
      const instancedBuckets = new Map();
      const materialBuckets = new Map();
      const relMatrix = new THREE.Matrix4();

      for (let i = 0; i < meshesToBake.length; i++) {
        const m = meshesToBake[i];
        relMatrix.copy(rootInv).multiply(m.matrixWorld);
        const rOrder = m.renderOrder || 0;
        const instCat = allowInstancing && m.geometry.userData && m.geometry.userData.instancedCategory;
        if (instCat) {
          const key = m.geometry.uuid + '|' + m.material.uuid + '|' + rOrder;
          let bucket = instancedBuckets.get(key);
          if (!bucket) {
            bucket = { geo: m.geometry, mat: m.material, renderOrder: rOrder, matrices: [], meshes: [] };
            instancedBuckets.set(key, bucket);
          }
          bucket.matrices.push(relMatrix.clone());
          bucket.meshes.push(m);
        } else {
          const matKey = m.material.uuid + '|' + rOrder;
          let mBucket = materialBuckets.get(matKey);
          if (!mBucket) {
            mBucket = { mat: m.material, renderOrder: rOrder, items: [] };
            materialBuckets.set(matKey, mBucket);
          }
          mBucket.items.push({ geo: m.geometry, matrix: relMatrix.clone(), mesh: m });
        }
      }

      // Fold into material merge bucket if < 3 instances OR if that material already has a static merge bucket in this room
      instancedBuckets.forEach((bucket) => {
        const matKey = bucket.mat.uuid + '|' + bucket.renderOrder;
        if (bucket.matrices.length < 3 || materialBuckets.has(matKey)) {
          let mBucket = materialBuckets.get(matKey);
          if (!mBucket) {
            mBucket = { mat: bucket.mat, renderOrder: bucket.renderOrder, items: [] };
            materialBuckets.set(matKey, mBucket);
          }
          for (let i = 0; i < bucket.matrices.length; i++) {
            mBucket.items.push({ geo: bucket.geo, matrix: bucket.matrices[i], mesh: bucket.meshes[i] });
          }
        } else {
          const inst = new THREE.InstancedMesh(bucket.geo, bucket.mat, bucket.matrices.length);
          for (let i = 0; i < bucket.matrices.length; i++) {
            inst.setMatrixAt(i, bucket.matrices[i]);
          }
          inst.instanceMatrix.needsUpdate = true;
          inst.renderOrder = bucket.renderOrder;
          const isOpaque = !bucket.mat.transparent;
          inst.castShadow = isOpaque && shadowCasterMats.has(bucket.mat.uuid);
          inst.receiveShadow = isOpaque;
          computeInstancedBoundingSphere(inst, bucket.matrices.length);
          rootGroup.add(inst);
        }
      });

      // Merge each material bucket into a single BufferGeometry & Mesh with Baked Vertex AO
      const isRoom = !!(rootGroup.userData && rootGroup.userData.isRoomGroup);
      materialBuckets.forEach((mBucket) => {
        const isOpaque = !mBucket.mat.transparent;
        const shouldBakeVertexAO = isOpaque && !mBucket.mat.isMeshBasicMaterial;
        if (mBucket.items.length === 1) {
          const item = mBucket.items[0];
          const clonedSingle = item.geo.clone();
          clonedSingle.applyMatrix4(item.matrix);
          clonedSingle.computeBoundingBox();
          clonedSingle.computeBoundingSphere();
          let finalMat = mBucket.mat;
          if (shouldBakeVertexAO) {
            applyBakedVertexAO(clonedSingle, isRoom);
            finalMat = getVertexColoredMaterial(mBucket.mat);
          }
          const singleMesh = new THREE.Mesh(clonedSingle, finalMat);
          singleMesh.renderOrder = mBucket.renderOrder;
          singleMesh.castShadow = isOpaque && shadowCasterMats.has(mBucket.mat.uuid);
          singleMesh.receiveShadow = isOpaque;
          singleMesh.frustumCulled = true;
          rootGroup.add(singleMesh);
          return;
        }
        const transformedGeos = [];
        for (let i = 0; i < mBucket.items.length; i++) {
          const item = mBucket.items[i];
          const cloned = item.geo.clone();
          cloned.applyMatrix4(item.matrix);
          transformedGeos.push(cloned);
        }
        const mergedGeo = THREE.BufferGeometryUtils.mergeBufferGeometries(transformedGeos);
        if (mergedGeo) {
          let finalMat = mBucket.mat;
          if (shouldBakeVertexAO) {
            applyBakedVertexAO(mergedGeo, isRoom);
            finalMat = getVertexColoredMaterial(mBucket.mat);
          }
          const mergedMesh = new THREE.Mesh(mergedGeo, finalMat);
          mergedMesh.renderOrder = mBucket.renderOrder;
          mergedMesh.castShadow = isOpaque && shadowCasterMats.has(mBucket.mat.uuid);
          mergedMesh.receiveShadow = isOpaque;
          mergedMesh.frustumCulled = true;
          rootGroup.add(mergedMesh);
        }
      });

      // Remove original unmerged meshes
      for (let i = 0; i < meshesToBake.length; i++) {
        const m = meshesToBake[i];
        if (m.parent) m.parent.remove(m);
      }

      // Prune empty intermediate Groups
      const emptyGroups = [];
      rootGroup.traverse((child) => {
        if (child !== rootGroup && child.isGroup && child.children.length === 0) {
          emptyGroups.push(child);
        }
      });
      for (let i = 0; i < emptyGroups.length; i++) {
        if (emptyGroups[i].parent) emptyGroups[i].parent.remove(emptyGroups[i]);
      }
    }

    /* =========================================================================
       PROCEDURAL NEPALI HORROR MUSIC, TERRIFYING SFX & VISUAL SHOCK ENGINE
       - Custom 2.8s Convolution Reverb (Dark Stone Courtyard & Rotunda Atrium)
       - Continuous Abyssal Sub-Bass Drone + Dissonant Tritone & Singing Bowl Score
       - Dynamic Seeker Proximity Bowed Waterphone/Sarangi Screech & Tinnitus Ring
       - Terrifying Jumpscare Banshee Scream, Ghost Whispers, Temple Ghanta Bells,
         Demonic Kangling Horn, Thunder Cracks, Wood Groans & Visceral Heartbeats
       ========================================================================= */
    let horrorCameraShake = 0.0;
    let horrorGlitchTimer = 0.0;

    const accessibilitySettings = {
      fearIntensity: (HORROR_CONFIG.accessibility && HORROR_CONFIG.accessibility.fearIntensity) || 'high',
      flickerReduction: !!(HORROR_CONFIG.accessibility && HORROR_CONFIG.accessibility.flickerReduction),
      screenShakeOff: !!(HORROR_CONFIG.accessibility && HORROR_CONFIG.accessibility.screenShakeOff),
    };

    function getFearMultiplier() {
      if (accessibilitySettings.fearIntensity === 'low') return 0.28;
      if (accessibilitySettings.fearIntensity === 'medium') return 0.62;
      return 1.0;
    }

    function triggerHorrorVisualShock(intensity = 0.75, showMaskFlash = false) {
      if (!EXPLORE_FLAGS.ENABLE_CAMERA_AND_SCREEN_EFFECTS && !EXPLORE_FLAGS.ENABLE_JUMPSCARES_AND_STINGERS) {
        return;
      }
      const scaled = intensity * getFearMultiplier();
      if (EXPLORE_FLAGS.ENABLE_CAMERA_AND_SCREEN_EFFECTS && !accessibilitySettings.screenShakeOff) {
        horrorCameraShake = Math.max(horrorCameraShake, scaled * 0.42);
      }
      if (EXPLORE_FLAGS.ENABLE_CAMERA_AND_SCREEN_EFFECTS) {
        horrorGlitchTimer = Math.max(horrorGlitchTimer, 0.22 + scaled * 0.35);
        const glitchEl = document.getElementById('horror-glitch-overlay');
        if (glitchEl) {
          glitchEl.style.opacity = Math.min(0.95, scaled * 0.88).toFixed(2);
        }
      }
      if (EXPLORE_FLAGS.ENABLE_GHOST_APPARITIONS && showMaskFlash && !accessibilitySettings.flickerReduction) {
        const flashEl = document.getElementById('horror-jumpscare-flash');
        if (flashEl) {
          flashEl.style.opacity = Math.min(0.92, 0.35 + scaled * 0.5).toFixed(2);
          clearTimeout(flashEl._hideTimer);
          flashEl._hideTimer = setTimeout(() => {
            flashEl.style.opacity = '0';
          }, 190 + Math.floor(scaled * 180));
        }
      }
    }

    class CampusNightSoundEngine {
      constructor() {
        this.ctx = null;
        this.isMuffled = false;
        this.isMuted = false;
        this.ambienceVolume = 1.0;
        this.isIndoors = false;
        this.inCorridor = false;
        this.cricketsSilenced = false;
        this.isUnlocked = false;
        this.isBackgrounded = false;
        this.enableTinnitus = Boolean(
          HORROR_CONFIG && HORROR_CONFIG.audio && HORROR_CONFIG.audio.enableTinnitus
        );
        this.tinnitusMaxGain = 0.018;
        this.masterGain = null;
        this.compressor = null;
        this.muffleFilter = null;
        this.reverbNode = null;
        this.reverbSend = null;
        this.distortionCurve = null;
        this.windGain = null;
        this.droneGain = null;
        this.proximityScreechGain = null;
        this.proximityScreechOsc1 = null;
        this.proximityScreechOsc2 = null;
        this.proximityFilter = null;
        this.tinnitusGain = null;
        this.serverRackGain = null;
        this.serverRackFilter = null;
        this.serverRackPan = null;
        this.cricketTimer = null;
        this.musicLoopTimer = null;
        this.trackedTimeouts = new Set();
        this.trackedIntervals = new Set();
        this.loopSources = [];
        this.cachedBuffers = {
          silentWarmup: null,
          windLoop: null,
          whisper: null,
          thunder: null,
          jumpscareNoise: null,
          dogBark: null,
          paStatic: null,
        };
      }

      setTrackedTimeout(fn, delayMs) {
        const id = setTimeout(() => {
          this.trackedTimeouts.delete(id);
          if (!this.isBackgrounded && this.ctx) {
            try { fn(); } catch (e) {}
          }
        }, delayMs);
        this.trackedTimeouts.add(id);
        return id;
      }

      setTrackedInterval(fn, intervalMs) {
        const id = setInterval(() => {
          if (!this.isBackgrounded && this.ctx) {
            try { fn(); } catch (e) {}
          }
        }, intervalMs);
        this.trackedIntervals.add(id);
        return id;
      }

      clearAllTrackedTimers() {
        this.trackedTimeouts.forEach((id) => clearTimeout(id));
        this.trackedTimeouts.clear();
        this.trackedIntervals.forEach((id) => clearInterval(id));
        this.trackedIntervals.clear();
        this.cricketTimer = null;
        this.musicLoopTimer = null;
      }

      // Apply click-free 8-15 ms linear attack ramp and smooth exponential release on every voice
      scheduleEnvelope(gainParam, startTime, peakGain, attackSec, totalDurSec, floorGain = 0.0001) {
        const atk = Math.max(0.008, Math.min(0.015, attackSec || 0.010));
        const safePeak = Math.max(floorGain * 2, peakGain);
        const endT = startTime + Math.max(atk + 0.012, totalDurSec);
        gainParam.setValueAtTime(floorGain, startTime);
        gainParam.linearRampToValueAtTime(safePeak, startTime + atk);
        gainParam.exponentialRampToValueAtTime(floorGain, endT);
      }

      makeDistortionCurve(amount = 65) {
        const n = 8192;
        const curve = new Float32Array(n);
        const deg = Math.PI / 180;
        for (let i = 0; i < n; i++) {
          const x = (i * 2) / n - 1;
          curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
        }
        return curve;
      }

      // Pre-generate all noise & one-shot AudioBuffers once at load time (zero synchronous buffer fill during gameplay)
      pregenerateCachedBuffers() {
        if (!this.ctx || this.cachedBuffers.windLoop) return;
        const rate = this.ctx.sampleRate;

        // 0. 1-sample silent buffer for reliable iOS/Android gesture warm-up unlock
        this.cachedBuffers.silentWarmup = this.ctx.createBuffer(1, 1, rate);

        // 1. Seamless crossfaded 3.2s Himalayan wind buffer (equal-power 0.45s loop seam crossfade)
        const windDur = 3.2;
        const fadeDur = 0.45;
        const windSamples = Math.floor(rate * windDur);
        const fadeSamples = Math.floor(rate * fadeDur);
        const totalGen = windSamples + fadeSamples;
        const rawWind = new Float32Array(totalGen);
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < totalGen; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.992 * b0 + white * 0.05;
          b1 = 0.96 * b1 + white * 0.08;
          b2 = 0.86 * b2 + white * 0.12;
          rawWind[i] = (b0 + b1 + b2) * 0.38;
        }
        const windBuf = this.ctx.createBuffer(1, windSamples, rate);
        const windOut = windBuf.getChannelData(0);
        const bodySamples = windSamples - fadeSamples;
        for (let i = 0; i < bodySamples; i++) {
          windOut[i] = rawWind[i + fadeSamples];
        }
        // Crossfade tail [windSamples..windSamples+fadeSamples] with head [0..fadeSamples]
        for (let i = 0; i < fadeSamples; i++) {
          const alpha = i / fadeSamples;
          const tailSample = rawWind[bodySamples + fadeSamples + i];
          const headSample = rawWind[i];
          windOut[bodySamples + i] =
            tailSample * Math.cos(alpha * Math.PI * 0.5) +
            headSample * Math.sin(alpha * Math.PI * 0.5);
        }
        this.cachedBuffers.windLoop = windBuf;

        // 2. Cached 1.45s 3-syllable spectral whisper buffer
        const whispLen = Math.floor(rate * 1.45);
        const whispBuf = this.ctx.createBuffer(1, whispLen, rate);
        const whispData = whispBuf.getChannelData(0);
        for (let i = 0; i < whispLen; i++) {
          const t = i / whispLen;
          const syl = Math.pow(Math.sin(t * Math.PI * 3), 2) * Math.sin(t * Math.PI);
          whispData[i] = (Math.random() * 2 - 1) * syl * 0.65;
        }
        this.cachedBuffers.whisper = whispBuf;

        // 3. Cached 2.6s lightning crack & rolling thunder buffer
        const thunLen = Math.floor(rate * 2.6);
        const thunBuf = this.ctx.createBuffer(1, thunLen, rate);
        const thunData = thunBuf.getChannelData(0);
        for (let i = 0; i < thunLen; i++) {
          const t = i / thunLen;
          const atk = i < rate * 0.010 ? (i / (rate * 0.010)) : 1.0;
          const crackEnv = (t < 0.06 ? 1.0 : Math.pow(1 - t, 1.8) * (0.65 + 0.35 * Math.sin(t * 28))) * atk;
          thunData[i] = (Math.random() * 2 - 1) * crackEnv;
        }
        this.cachedBuffers.thunder = thunBuf;

        // 4. Cached 0.90s jumpscare roaring noise burst buffer
        const jsLen = Math.floor(rate * 0.90);
        const jsBuf = this.ctx.createBuffer(1, jsLen, rate);
        const jsData = jsBuf.getChannelData(0);
        for (let i = 0; i < jsLen; i++) {
          const atk = i < rate * 0.010 ? (i / (rate * 0.010)) : 1.0;
          jsData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / jsLen, 1.2) * atk;
        }
        this.cachedBuffers.jumpscareNoise = jsBuf;

        // 5. Cached 0.22s feral dog bark noise transient buffer
        const barkLen = Math.floor(rate * 0.22);
        const barkBuf = this.ctx.createBuffer(1, barkLen, rate);
        const barkData = barkBuf.getChannelData(0);
        for (let i = 0; i < barkLen; i++) {
          const atk = i < rate * 0.010 ? (i / (rate * 0.010)) : 1.0;
          barkData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (barkLen * 0.35)) * atk;
        }
        this.cachedBuffers.dogBark = barkBuf;

        // 6. Cached 0.42s PA crackle static burst buffer
        const paLen = Math.floor(rate * 0.42);
        const paBuf = this.ctx.createBuffer(1, paLen, rate);
        const paData = paBuf.getChannelData(0);
        for (let i = 0; i < paLen; i++) {
          const atk = i < rate * 0.010 ? (i / (rate * 0.010)) : 1.0;
          const rel = Math.pow(1 - i / paLen, 1.4);
          paData[i] = (Math.random() * 2 - 1) * 0.42 * atk * rel;
        }
        this.cachedBuffers.paStatic = paBuf;
      }

      init() {
        if (this.ctx) return;
        try {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (!AudioContext) return;
          this.ctx = new AudioContext();
          this.distortionCurve = this.makeDistortionCurve(78);
          this.pregenerateCachedBuffers();

          // Dynamics compressor to keep jumpscares punchy and loud without digital clipping
          this.compressor = this.ctx.createDynamicsCompressor();
          this.compressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
          this.compressor.knee.setValueAtTime(12, this.ctx.currentTime);
          this.compressor.ratio.setValueAtTime(6, this.ctx.currentTime);
          this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
          this.compressor.release.setValueAtTime(0.22, this.ctx.currentTime);

          this.masterGain = this.ctx.createGain();
          this.masterGain.gain.setValueAtTime(this.isMuted ? 0.0001 : 0.94, this.ctx.currentTime);

          this.muffleFilter = this.ctx.createBiquadFilter();
          this.muffleFilter.type = 'lowpass';
          this.muffleFilter.frequency.setValueAtTime(18000, this.ctx.currentTime);

          // Ultra-Lightweight Dual-Tap Courtyard Echo Bus (Zero FFT CPU/Thermal Overhead)
          this.reverbSend = this.ctx.createGain();
          this.reverbSend.gain.setValueAtTime(0.36, this.ctx.currentTime);

          const echoDelay1 = this.ctx.createDelay(1.0);
          echoDelay1.delayTime.setValueAtTime(0.16, this.ctx.currentTime);
          const echoDelay2 = this.ctx.createDelay(1.0);
          echoDelay2.delayTime.setValueAtTime(0.37, this.ctx.currentTime);
          const echoDamp = this.ctx.createBiquadFilter();
          echoDamp.type = 'lowpass';
          echoDamp.frequency.setValueAtTime(1650, this.ctx.currentTime);
          const echoFeedback = this.ctx.createGain();
          echoFeedback.gain.setValueAtTime(0.34, this.ctx.currentTime);

          this.reverbSend.connect(echoDelay1);
          echoDelay1.connect(echoDamp);
          echoDamp.connect(echoDelay2);
          echoDelay2.connect(echoFeedback);
          echoFeedback.connect(echoDelay1);

          this.masterGain.connect(this.muffleFilter);
          echoDamp.connect(this.muffleFilter);
          echoDelay2.connect(this.muffleFilter);
          this.muffleFilter.connect(this.compressor);
          this.compressor.connect(this.ctx.destination);

          if (typeof this.ctx.addEventListener === 'function') {
            this.ctx.addEventListener('statechange', () => {
              this.updateUnlockGateBanner();
            });
          }

          this.startLowWindLoop();
          this.startTensionDrone();
          this.startProximityChaseLayer();
          this.startServerRackLoop();
          this.startHauntedMusicLoop();
          this.startNightCrickets();
          this.updateUnlockGateBanner();
        } catch (e) {}
      }

      updateUnlockGateBanner() {
        const gateEl = document.getElementById('audio-unlock-gate');
        if (!gateEl) return;
        if (this.ctx && this.ctx.state === 'running') {
          this.isUnlocked = true;
          gateEl.style.display = 'none';
        } else {
          gateEl.style.display = 'flex';
        }
      }

      unlockAudio() {
        if (!this.ctx) this.init();
        if (!this.ctx) return;
        try {
          if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') {
            this.ctx.resume().then(() => {
              this.updateUnlockGateBanner();
            }).catch(() => {});
          }
          // Play 1-sample silent warm-up buffer on first user gesture to unlock iOS WKWebView & Android WebAudio hardware pipeline
          if (!this.isUnlocked && this.cachedBuffers.silentWarmup) {
            const warmSrc = this.ctx.createBufferSource();
            warmSrc.buffer = this.cachedBuffers.silentWarmup;
            warmSrc.connect(this.ctx.destination);
            warmSrc.start(0);
            if (this.ctx.state === 'running') {
              this.isUnlocked = true;
            }
          }
          this.updateUnlockGateBanner();
        } catch (e) {}
      }

      resume() {
        this.unlockAudio();
      }

      ensureReady() {
        this.unlockAudio();
      }

      suspendForBackground() {
        this.isBackgrounded = true;
        if (this.ctx && this.ctx.state === 'running') {
          try {
            this.ctx.suspend().catch(() => {});
          } catch (e) {}
        }
      }

      resumeFromBackground() {
        this.isBackgrounded = false;
        if (!this.ctx) return;
        try {
          if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') {
            this.ctx.resume().then(() => {
              this.updateUnlockGateBanner();
            }).catch(() => {});
          }
        } catch (e) {}
      }

      setMuted(muted) {
        this.isMuted = !!muted;
        if (this.ctx && this.masterGain) {
          this.masterGain.gain.setTargetAtTime(this.isMuted ? 0.0001 : (this.ambienceVolume || 0.94), this.ctx.currentTime, 0.04);
        }
      }

      setAmbienceVolume(vol) {
        this.ambienceVolume = Math.max(0.0, Math.min(1.5, Number(vol)));
        if (this.ctx && this.masterGain && !this.isMuted) {
          this.masterGain.gain.setTargetAtTime(Math.max(0.0001, this.ambienceVolume * 0.94), this.ctx.currentTime, 0.04);
        }
      }

      // 1. Seamless Crossfaded Himalayan Midnight Wind Loop (pre-generated at load time)
      startLowWindLoop() {
        if (!this.ctx || !this.cachedBuffers.windLoop) return;
        try {
          const now = this.ctx.currentTime;
          const whiteNoise = this.ctx.createBufferSource();
          whiteNoise.buffer = this.cachedBuffers.windLoop;
          whiteNoise.loop = true;

          const gustFilter = this.ctx.createBiquadFilter();
          gustFilter.type = 'bandpass';
          gustFilter.frequency.setValueAtTime(220, now);
          gustFilter.Q.setValueAtTime(3.2, now);

          // Slow LFO modulating wind pitch so the courtyard wind moans smoothly
          const windLfo = this.ctx.createOscillator();
          const windLfoGain = this.ctx.createGain();
          windLfo.type = 'sine';
          windLfo.frequency.setValueAtTime(0.14, now);
          windLfoGain.gain.setValueAtTime(95, now);
          windLfo.connect(windLfoGain);
          windLfoGain.connect(gustFilter.frequency);

          this.windGain = this.ctx.createGain();
          this.windGain.gain.setValueAtTime(0.0001, now);
          this.windGain.gain.linearRampToValueAtTime(0.085, now + 0.015);

          whiteNoise.connect(gustFilter);
          gustFilter.connect(this.windGain);
          this.windGain.connect(this.masterGain);
          whiteNoise.start(now);
          windLfo.start(now);
          this.loopSources.push(whiteNoise, windLfo);
        } catch (e) {}
      }

      // 2. Abyssal Sub-Bass & Dissonant Tritone Dark Horror Music Drone
      startTensionDrone() {
        if (!this.ctx) return;
        try {
          const now = this.ctx.currentTime;
          const subOsc = this.ctx.createOscillator();
          const detuneOsc = this.ctx.createOscillator();
          const tritoneOsc = this.ctx.createOscillator();
          const darkFilter = this.ctx.createBiquadFilter();
          this.droneGain = this.ctx.createGain();

          subOsc.type = 'sine';
          subOsc.frequency.setValueAtTime(36.71, now); // D1 sub-bass
          detuneOsc.type = 'sawtooth';
          detuneOsc.frequency.setValueAtTime(37.45, now); // Beating dissonance
          tritoneOsc.type = 'triangle';
          tritoneOsc.frequency.setValueAtTime(51.91, now); // G#1 tritone interval

          darkFilter.type = 'lowpass';
          darkFilter.frequency.setValueAtTime(135, now);
          darkFilter.Q.setValueAtTime(4.2, now);

          const lfo = this.ctx.createOscillator();
          const lfoGain = this.ctx.createGain();
          lfo.type = 'sine';
          lfo.frequency.setValueAtTime(0.09, now);
          lfoGain.gain.setValueAtTime(65, now);
          lfo.connect(lfoGain);
          lfoGain.connect(darkFilter.frequency);

          this.droneGain.gain.setValueAtTime(0.0001, now);
          this.droneGain.gain.linearRampToValueAtTime(0.068, now + 0.015);

          subOsc.connect(darkFilter);
          detuneOsc.connect(darkFilter);
          tritoneOsc.connect(darkFilter);
          darkFilter.connect(this.droneGain);
          this.droneGain.connect(this.masterGain);

          subOsc.start(now);
          detuneOsc.start(now);
          tritoneOsc.start(now);
          lfo.start(now);
          this.loopSources.push(subOsc, detuneOsc, tritoneOsc, lfo);
        } catch (e) {}
      }

      // 3. Dynamic Seeker Proximity Bowed Waterphone / Sarangi Tension Layer + Optional Tinnitus Ear-Ring (Off by Default)
      startProximityChaseLayer() {
        if (!this.ctx) return;
        try {
          const now = this.ctx.currentTime;
          this.proximityScreechOsc1 = this.ctx.createOscillator();
          this.proximityScreechOsc2 = this.ctx.createOscillator();
          this.proximityFilter = this.ctx.createBiquadFilter();
          this.proximityScreechGain = this.ctx.createGain();

          this.proximityScreechOsc1.type = 'sawtooth';
          this.proximityScreechOsc1.frequency.setValueAtTime(155.56, now); // D#3
          this.proximityScreechOsc2.type = 'sawtooth';
          this.proximityScreechOsc2.frequency.setValueAtTime(164.81, now); // E3 minor-second clash

          this.proximityFilter.type = 'bandpass';
          this.proximityFilter.frequency.setValueAtTime(520, now);
          this.proximityFilter.Q.setValueAtTime(5.5, now);

          this.proximityScreechGain.gain.setValueAtTime(0.0001, now);

          this.proximityScreechOsc1.connect(this.proximityFilter);
          this.proximityScreechOsc2.connect(this.proximityFilter);
          this.proximityFilter.connect(this.proximityScreechGain);
          this.proximityScreechGain.connect(this.masterGain);

          this.proximityScreechOsc1.start(now);
          this.proximityScreechOsc2.start(now);

          // Optional high-pitched tinnitus ring (off by default, quieter max 0.018 when enabled)
          const tinOsc = this.ctx.createOscillator();
          this.tinnitusGain = this.ctx.createGain();
          tinOsc.type = 'sine';
          tinOsc.frequency.setValueAtTime(3820, now);
          this.tinnitusGain.gain.setValueAtTime(0.0, now);
          tinOsc.connect(this.tinnitusGain);
          this.tinnitusGain.connect(this.masterGain);
          tinOsc.start(now);
          this.loopSources.push(this.proximityScreechOsc1, this.proximityScreechOsc2, tinOsc);
        } catch (e) {}
      }

      // 3b. Continuous Positional Server Rack Hum Loop (60Hz / 120Hz / 240Hz)
      startServerRackLoop() {
        if (!this.ctx) return;
        try {
          const now = this.ctx.currentTime;
          this.serverRackFilter = this.ctx.createBiquadFilter();
          this.serverRackFilter.type = 'lowpass';
          this.serverRackFilter.frequency.setValueAtTime(340, now);
          this.serverRackGain = this.ctx.createGain();
          this.serverRackGain.gain.setValueAtTime(0.0, now);
          this.serverRackPan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;

          [60, 120, 240].forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const partGain = this.ctx.createGain();
            osc.type = idx === 1 ? 'sawtooth' : 'sine';
            osc.frequency.setValueAtTime(freq, now);
            partGain.gain.setValueAtTime(idx === 0 ? 0.55 : (idx === 1 ? 0.28 : 0.14), now);
            osc.connect(partGain);
            partGain.connect(this.serverRackFilter);
            osc.start(now);
            this.loopSources.push(osc);
          });

          if (this.serverRackPan) {
            this.serverRackFilter.connect(this.serverRackPan);
            this.serverRackPan.connect(this.serverRackGain);
          } else {
            this.serverRackFilter.connect(this.serverRackGain);
          }
          this.serverRackGain.connect(this.masterGain);
        } catch (e) {}
      }

      updateSpatialLoops(playerPos, playerYaw = 0, isIndoors = false) {
        this.isIndoors = !!isIndoors;
        if (!this.ctx || !this.serverRackGain || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          // Two campus server rack installations: Main Bldg Lab 302 (17.7, 7.68, 64.0) & West Wing L2 Lab (-16.0, 0.22, -16.5)
          const r1x = 17.7, r1y = 7.68, r1z = 64.0;
          const r2x = -16.0, r2y = 0.22, r2z = -16.5;
          const d1 = Math.hypot(playerPos.x - r1x, (playerPos.y - r1y) * 2.2, playerPos.z - r1z);
          const d2 = Math.hypot(playerPos.x - r2x, (playerPos.y - r2y) * 2.2, playerPos.z - r2z);
          const useR1 = d1 <= d2;
          const nearestDist = useR1 ? d1 : d2;
          const tx = useR1 ? r1x : r2x;
          const tz = useR1 ? r1z : r2z;

          const maxAudibleDist = 20.0;
          if (nearestDist < maxAudibleDist) {
            const norm = 1.0 - nearestDist / maxAudibleDist;
            const targetVol = Math.pow(norm, 1.85) * 0.065;
            this.serverRackGain.gain.setTargetAtTime(targetVol, now, 0.10);
            if (this.serverRackFilter) {
              this.serverRackFilter.frequency.setTargetAtTime(160 + norm * 280, now, 0.12);
            }
            if (this.serverRackPan) {
              const angleToSource = Math.atan2(tx - playerPos.x, tz - playerPos.z) - playerYaw;
              const panVal = Math.max(-0.92, Math.min(0.92, -Math.sin(angleToSource)));
              this.serverRackPan.pan.setTargetAtTime(panVal, now, 0.08);
            }
          } else {
            this.serverRackGain.gain.setTargetAtTime(0.0, now, 0.15);
          }
        } catch (e) {}
      }

      setTinnitusEnabled(enabled) {
        this.enableTinnitus = !!enabled;
        if (this.ctx && this.tinnitusGain && !this.enableTinnitus) {
          this.tinnitusGain.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.08);
        }
      }

      updateProximityTension(proximity = 0.0) {
        if (!this.ctx || !this.proximityScreechGain || this.isMuted || this.isBackgrounded) return;
        if (!EXPLORE_FLAGS.ENABLE_PROXIMITY_AND_CHASE_AUDIO) {
          this.cricketsSilenced = false;
          this.proximityScreechGain.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.08);
          if (this.tinnitusGain) this.tinnitusGain.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.08);
          return;
        }
        try {
          const now = this.ctx.currentTime;
          const clamped = Math.max(0, Math.min(1, proximity));
          this.cricketsSilenced = clamped > 0.25;
          // Swell bowed horror strings and glide pitch upward as the Seeker closes in
          const targetScreech = clamped > 0.08 ? Math.pow(clamped, 1.7) * 0.16 : 0.0;
          this.proximityScreechGain.gain.setTargetAtTime(targetScreech, now, 0.12);
          this.proximityFilter.frequency.setTargetAtTime(420 + clamped * 1650, now, 0.12);
          this.proximityScreechOsc1.frequency.setTargetAtTime(155.56 + clamped * 48, now, 0.15);
          this.proximityScreechOsc2.frequency.setTargetAtTime(164.81 + clamped * 62, now, 0.15);

          // Optional tinnitus ear-ring when proximity > 0.65 (off by default, quieter <= 0.018)
          const tinLevel = (this.enableTinnitus && clamped > 0.65)
            ? ((clamped - 0.65) / 0.35) * this.tinnitusMaxGain
            : 0.0;
          this.tinnitusGain.gain.setTargetAtTime(tinLevel, now, 0.18);
        } catch (e) {}
      }

      // 4. Generative Haunted Nepali Singing Bowl, Pluck & Ghostly Choir Motif Loop
      startHauntedMusicLoop() {
        if (this.musicLoopTimer) {
          clearInterval(this.musicLoopTimer);
          this.trackedIntervals.delete(this.musicLoopTimer);
        }
        const darkNotes = [73.42, 77.78, 103.83, 110.0, 116.54, 138.59, 146.83, 155.56, 207.65];
        this.musicLoopTimer = this.setTrackedInterval(() => {
          if (!this.ctx || this.isMuted || this.isBackgrounded || this.ctx.state !== 'running') return;
          try {
            const now = this.ctx.currentTime;
            const root = darkNotes[Math.floor(Math.random() * darkNotes.length)];
            [1.0, 2.756, 5.404].forEach((ratio, idx) => {
              const osc = this.ctx.createOscillator();
              const gain = this.ctx.createGain();
              const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
              osc.type = idx === 0 ? 'sine' : 'triangle';
              const freq = root * ratio;
              osc.frequency.setValueAtTime(freq, now);
              osc.frequency.exponentialRampToValueAtTime(freq * (idx === 1 ? 0.96 : 0.985), now + 4.8);

              const peak = (idx === 0 ? 0.048 : (idx === 1 ? 0.022 : 0.009));
              gain.gain.setValueAtTime(0.0001, now);
              gain.gain.linearRampToValueAtTime(peak * 0.35, now + 0.015);
              gain.gain.linearRampToValueAtTime(peak, now + 0.35);
              gain.gain.exponentialRampToValueAtTime(0.0001, now + 4.9);

              if (panner) {
                panner.pan.setValueAtTime((Math.random() - 0.5) * 1.4, now);
                osc.connect(panner);
                panner.connect(gain);
              } else {
                osc.connect(gain);
              }
              gain.connect(this.masterGain);
              gain.connect(this.reverbSend);
              osc.start(now);
              osc.stop(now + 5.0);
            });

            if (EXPLORE_FLAGS.ENABLE_WHISPERS_AND_WEEPING && Math.random() < 0.42) {
              this.setTrackedTimeout(() => {
                if (Math.random() < 0.55) this.playGhostWhisperSfx();
                else this.playDistantFemaleWeepOrSigh();
              }, 1600);
            }
          } catch (e) {}
        }, 6400);
      }

      startNightCrickets() {
        if (this.cricketTimer) {
          clearInterval(this.cricketTimer);
          this.trackedIntervals.delete(this.cricketTimer);
        }
        this.cricketTimer = this.setTrackedInterval(() => {
          // Silenced when indoors, in covered corridors, or when Hunter is close
          if (!this.ctx || this.isMuted || this.isBackgrounded || this.cricketsSilenced || this.isIndoors || this.inCorridor || this.ctx.state !== 'running') return;
          if (Math.random() > 0.65) return;
          try {
            const now = this.ctx.currentTime;
            const pulses = 3 + Math.floor(Math.random() * 2);
            const baseFreq = 4180 + (Math.random() - 0.5) * 160;
            for (let p = 0; p < pulses; p++) {
              const t0 = now + p * 0.055;
              const osc = this.ctx.createOscillator();
              const gain = this.ctx.createGain();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(baseFreq, t0);
              this.scheduleEnvelope(gain.gain, t0, 0.014, 0.010, 0.042);
              osc.connect(gain);
              gain.connect(this.masterGain);
              osc.start(t0);
              osc.stop(t0 + 0.048);
            }
          } catch (e) {}
        }, 1550);
      }

      // 5. Demonic Kangling Horn & Metallic Blade-Scrape when Seeker is Hunting Close (< 11.5m)
      playWardenKillApproachSfx(dangerIntensity = 0.85) {
        if (!EXPLORE_FLAGS.ENABLE_JUMPSCARES_AND_STINGERS) return;
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          triggerHorrorVisualShock(dangerIntensity * 0.55, dangerIntensity > 0.82);

          const growlOsc = this.ctx.createOscillator();
          const subOsc = this.ctx.createOscillator();
          const shaper = this.ctx.createWaveShaper();
          const growlGain = this.ctx.createGain();
          const growlFilter = this.ctx.createBiquadFilter();

          shaper.curve = this.distortionCurve;
          growlOsc.type = 'sawtooth';
          growlOsc.frequency.setValueAtTime(76, now);
          growlOsc.frequency.exponentialRampToValueAtTime(46, now + 0.62);

          subOsc.type = 'sine';
          subOsc.frequency.setValueAtTime(38, now);
          subOsc.frequency.exponentialRampToValueAtTime(24, now + 0.62);

          growlFilter.type = 'lowpass';
          growlFilter.frequency.setValueAtTime(380 + dangerIntensity * 420, now);
          growlFilter.Q.setValueAtTime(4.5, now);

          this.scheduleEnvelope(growlGain.gain, now, 0.28 * dangerIntensity, 0.012, 0.64);

          growlOsc.connect(shaper);
          shaper.connect(growlFilter);
          subOsc.connect(growlFilter);
          growlFilter.connect(growlGain);
          growlGain.connect(this.masterGain);
          growlGain.connect(this.reverbSend);
          growlOsc.start(now);
          subOsc.start(now);
          growlOsc.stop(now + 0.66);
          subOsc.stop(now + 0.66);

          [622.25, 880.0, 1174.66, 1661.22].forEach((f, idx) => {
            const sOsc = this.ctx.createOscillator();
            const sGain = this.ctx.createGain();
            sOsc.type = idx % 2 === 0 ? 'sawtooth' : 'square';
            sOsc.frequency.setValueAtTime(f, now);
            sOsc.frequency.exponentialRampToValueAtTime(f * (1.12 + idx * 0.04), now + 0.48);
            this.scheduleEnvelope(sGain.gain, now, 0.09 * dangerIntensity, 0.012, 0.50);
            sOsc.connect(sGain);
            sGain.connect(this.masterGain);
            sGain.connect(this.reverbSend);
            sOsc.start(now);
            sOsc.stop(now + 0.52);
          });
        } catch (e) {}
      }

      // 6. Stereo-Panned Spectral Ghost Whisper (reuses pre-generated cached buffer)
      playGhostWhisperSfx() {
        if (!EXPLORE_FLAGS.ENABLE_WHISPERS_AND_WEEPING) return;
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        if (!this.cachedBuffers.whisper) this.pregenerateCachedBuffers();
        if (!this.cachedBuffers.whisper) return;
        try {
          const now = this.ctx.currentTime;
          const dur = 1.45;
          const src = this.ctx.createBufferSource();
          src.buffer = this.cachedBuffers.whisper;

          const f1 = this.ctx.createBiquadFilter();
          f1.type = 'bandpass';
          f1.frequency.setValueAtTime(580, now);
          f1.frequency.linearRampToValueAtTime(420, now + dur);
          f1.Q.setValueAtTime(6.0, now);

          const f2 = this.ctx.createBiquadFilter();
          f2.type = 'bandpass';
          f2.frequency.setValueAtTime(1680, now);
          f2.frequency.linearRampToValueAtTime(2150, now + dur * 0.5);
          f2.frequency.linearRampToValueAtTime(1320, now + dur);
          f2.Q.setValueAtTime(7.5, now);

          const wGain = this.ctx.createGain();
          this.scheduleEnvelope(wGain.gain, now, 0.22, 0.015, dur);

          const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
          if (panner) {
            const startPan = Math.random() < 0.5 ? -0.88 : 0.88;
            panner.pan.setValueAtTime(startPan, now);
            panner.pan.linearRampToValueAtTime(-startPan, now + dur);
            src.connect(f1);
            src.connect(f2);
            f1.connect(panner);
            f2.connect(panner);
            panner.connect(wGain);
          } else {
            src.connect(f1);
            src.connect(f2);
            f1.connect(wGain);
            f2.connect(wGain);
          }

          wGain.connect(this.masterGain);
          wGain.connect(this.reverbSend);
          src.start(now);
          src.stop(now + dur + 0.02);
        } catch (e) {}
      }

      // 7. Haunting Distant Ghostly Wail / Weeping Echo in the Courtyard
      playDistantFemaleWeepOrSigh() {
        if (!EXPLORE_FLAGS.ENABLE_WHISPERS_AND_WEEPING) return;
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          const osc1 = this.ctx.createOscillator();
          const osc2 = this.ctx.createOscillator();
          const vib = this.ctx.createOscillator();
          const vibGain = this.ctx.createGain();
          const formant = this.ctx.createBiquadFilter();
          const gain = this.ctx.createGain();

          osc1.type = 'triangle';
          osc2.type = 'sine';
          osc1.frequency.setValueAtTime(659.25, now); // E5
          osc1.frequency.exponentialRampToValueAtTime(587.33, now + 0.85); // D5
          osc1.frequency.exponentialRampToValueAtTime(466.16, now + 2.3);  // Bb4

          osc2.frequency.setValueAtTime(663.5, now);
          osc2.frequency.exponentialRampToValueAtTime(462.0, now + 2.3);

          vib.type = 'sine';
          vib.frequency.setValueAtTime(6.2, now);
          vibGain.gain.setValueAtTime(11.0, now);
          vib.connect(vibGain);
          vibGain.connect(osc1.frequency);

          formant.type = 'bandpass';
          formant.frequency.setValueAtTime(920, now);
          formant.Q.setValueAtTime(3.8, now);

          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.linearRampToValueAtTime(0.025, now + 0.015);
          gain.gain.linearRampToValueAtTime(0.075, now + 0.35);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.45);

          osc1.connect(formant);
          osc2.connect(formant);
          formant.connect(gain);
          gain.connect(this.reverbSend);
          gain.connect(this.masterGain);

          osc1.start(now);
          osc2.start(now);
          vib.start(now);
          osc1.stop(now + 2.5);
          osc2.stop(now + 2.5);
          vib.stop(now + 2.5);
        } catch (e) {}
      }

      // 8. High-Voltage Lightning Crack & Rolling Himalayan Thunder Rumble (reuses cached buffer)
      playThunderCrackSfx() {
        if (!EXPLORE_FLAGS.ENABLE_RANDOM_SCARE_EVENTS) return;
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        if (!this.cachedBuffers.thunder) this.pregenerateCachedBuffers();
        if (!this.cachedBuffers.thunder) return;
        try {
          const now = this.ctx.currentTime;
          triggerHorrorVisualShock(0.72, Math.random() < 0.45);

          const dur = 2.6;
          const src = this.ctx.createBufferSource();
          src.buffer = this.cachedBuffers.thunder;

          const lp = this.ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.setValueAtTime(1600, now);
          lp.frequency.exponentialRampToValueAtTime(95, now + dur);

          const gain = this.ctx.createGain();
          this.scheduleEnvelope(gain.gain, now, 0.46, 0.010, dur);

          src.connect(lp);
          lp.connect(gain);
          gain.connect(this.masterGain);
          gain.connect(this.reverbSend);
          src.start(now);
          src.stop(now + dur + 0.02);
        } catch (e) {}
      }

      playLampBuzz() {
        if (!EXPLORE_FLAGS.ENABLE_STROBING_AND_BROWNOUTS) return;
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(110, now);
          this.scheduleEnvelope(gain.gain, now, 0.032, 0.009, 0.09);
          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now);
          osc.stop(now + 0.105);
        } catch (e) {}
      }

      // 9. FULL-SPECTRUM NIGHTMARE JUMPSCARE SCREAM & SEISMIC SUB-DROP (reuses cached noise buffer)
      playJumpscareSting() {
        if (!EXPLORE_FLAGS.ENABLE_JUMPSCARES_AND_STINGERS) return;
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        if (!this.cachedBuffers.jumpscareNoise) this.pregenerateCachedBuffers();
        try {
          const now = this.ctx.currentTime;
          triggerHorrorVisualShock(1.0, true);

          // A. Seismic 115Hz -> 22Hz Sub-Bass Slam with 10ms click-free attack ramp
          const sub = this.ctx.createOscillator();
          const subGain = this.ctx.createGain();
          sub.type = 'sine';
          sub.frequency.setValueAtTime(115, now);
          sub.frequency.exponentialRampToValueAtTime(22, now + 0.95);
          this.scheduleEnvelope(subGain.gain, now, 0.85, 0.010, 1.05);
          sub.connect(subGain);
          subGain.connect(this.masterGain);
          sub.start(now);
          sub.stop(now + 1.08);

          // B. Distorted Banshee Scream (6 Detuned FM Sawtooth/Square Oscillators) with 12ms attack ramp
          const shaper = this.ctx.createWaveShaper();
          shaper.curve = this.distortionCurve;
          const screamGain = this.ctx.createGain();
          this.scheduleEnvelope(screamGain.gain, now, 0.32, 0.012, 1.14);
          shaper.connect(screamGain);
          screamGain.connect(this.masterGain);
          screamGain.connect(this.reverbSend);

          const fmMod = this.ctx.createOscillator();
          const fmModGain = this.ctx.createGain();
          fmMod.type = 'sawtooth';
          fmMod.frequency.setValueAtTime(34, now);
          fmModGain.gain.setValueAtTime(95, now);
          fmMod.connect(fmModGain);
          fmMod.start(now);
          fmMod.stop(now + 1.16);

          [277.18, 392.0, 554.37, 783.99, 1108.73, 1567.98].forEach((f, idx) => {
            const osc = this.ctx.createOscillator();
            osc.type = idx % 2 === 0 ? 'sawtooth' : 'square';
            osc.frequency.setValueAtTime(f * 0.88, now);
            osc.frequency.exponentialRampToValueAtTime(f * 1.18, now + 0.14);
            osc.frequency.exponentialRampToValueAtTime(f * 0.76, now + 1.12);
            fmModGain.connect(osc.frequency);
            osc.connect(shaper);
            osc.start(now);
            osc.stop(now + 1.16);
          });

          // C. Roaring Noise Burst from pre-cached buffer through Formant Bandpass
          if (this.cachedBuffers.jumpscareNoise) {
            const nSrc = this.ctx.createBufferSource();
            nSrc.buffer = this.cachedBuffers.jumpscareNoise;
            const nBand = this.ctx.createBiquadFilter();
            nBand.type = 'bandpass';
            nBand.frequency.setValueAtTime(1450, now);
            nBand.frequency.exponentialRampToValueAtTime(520, now + 0.9);
            nBand.Q.setValueAtTime(2.2, now);
            nSrc.connect(nBand);
            nBand.connect(shaper);
            nSrc.start(now);
            nSrc.stop(now + 0.92);
          }
        } catch (e) {}
      }

      playFootstep(surface = 'paver', isCrouching = false) {
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          const filter = this.ctx.createBiquadFilter();

          osc.type = 'triangle';
          let baseFreq = 130, cutOff = 750, dur = 0.11;
          if (surface === 'paver') {
            baseFreq = 135; cutOff = 820; dur = 0.11;
          } else if (surface === 'classroom') {
            baseFreq = 155; cutOff = 940; dur = 0.12;
          } else if (surface === 'stair') {
            baseFreq = 185; cutOff = 1250; dur = 0.13;
          } else if (surface === 'grass') {
            baseFreq = 68; cutOff = 310; dur = 0.09;
          } else if (surface === 'road') {
            baseFreq = 105; cutOff = 580; dur = 0.11;
          }

          if (isCrouching) { baseFreq *= 0.74; cutOff *= 0.52; }

          osc.frequency.setValueAtTime(baseFreq, now);
          osc.frequency.exponentialRampToValueAtTime(28, now + dur);
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(cutOff, now);
          const peakVol = isCrouching ? 0.07 : (surface === 'grass' ? 0.12 : 0.22);
          this.scheduleEnvelope(gain.gain, now, peakVol, 0.010, dur);

          osc.connect(filter);
          filter.connect(gain);
          gain.connect(this.masterGain);

          if (this.inCorridor) {
            gain.connect(this.reverbSend);
          }

          osc.start(now);
          osc.stop(now + dur + 0.02);
        } catch (e) {}
      }

      setCorridorAcoustics(inCorridor) {
        if (this.inCorridor === inCorridor) return;
        this.inCorridor = inCorridor;
        if (!this.ctx || !this.windGain) return;
        try {
          this.windGain.gain.setTargetAtTime(inCorridor ? 0.038 : 0.085, this.ctx.currentTime, 0.4);
        } catch (e) {}
      }

      // TASK 2: Distant Feral Dog Bark One-Shot in the Foggy Valley (reuses cached bark noise buffer)
      playDistantDogBarkSfx() {
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        if (!this.cachedBuffers.dogBark) this.pregenerateCachedBuffers();
        try {
          const now = this.ctx.currentTime;
          [0, 0.34].forEach((offset, idx) => {
            const t0 = now + offset;
            const osc = this.ctx.createOscillator();
            const formant = this.ctx.createBiquadFilter();
            formant.type = 'bandpass';
            formant.frequency.setValueAtTime(idx === 0 ? 480 : 440, t0);
            formant.frequency.exponentialRampToValueAtTime(260, t0 + 0.20);
            formant.Q.setValueAtTime(3.2, t0);

            const gain = this.ctx.createGain();
            this.scheduleEnvelope(gain.gain, t0, idx === 0 ? 0.085 : 0.065, 0.012, 0.22);

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(idx === 0 ? 235 : 215, t0);
            osc.frequency.exponentialRampToValueAtTime(125, t0 + 0.20);

            osc.connect(formant);
            if (this.cachedBuffers.dogBark) {
              const nSrc = this.ctx.createBufferSource();
              nSrc.buffer = this.cachedBuffers.dogBark;
              nSrc.connect(formant);
              nSrc.start(t0);
              nSrc.stop(t0 + 0.22);
            }
            formant.connect(gain);
            gain.connect(this.reverbSend);
            gain.connect(this.masterGain);

            osc.start(t0);
            osc.stop(t0 + 0.24);
          });
        } catch (e) {}
      }

      // TASK 2: Distant Phantom Footsteps Hurrying in the Fog (10ms click-free attack ramp)
      playPhantomFootstepsSfx() {
        if (!EXPLORE_FLAGS.ENABLE_PROXIMITY_AND_CHASE_AUDIO) return;
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          for (let s = 0; s < 5; s++) {
            const t0 = now + s * 0.29;
            const osc = this.ctx.createOscillator();
            const filter = this.ctx.createBiquadFilter();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(140 - s * 8, t0);
            osc.frequency.exponentialRampToValueAtTime(34, t0 + 0.09);
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(520, t0);
            this.scheduleEnvelope(gain.gain, t0, 0.055 * Math.pow(0.82, s), 0.010, 0.095);
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.reverbSend);
            osc.start(t0);
            osc.stop(t0 + 0.11);
          }
        } catch (e) {}
      }

      // 10. Cursed Nepali Bronze Temple Ghanta Bell with Inharmonic Minor-Second Decay
      playDistantChime() {
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          [174.61, 366.0, 523.25, 830.61, 1396.91].forEach((f, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
            osc.frequency.setValueAtTime(f, now);
            osc.frequency.exponentialRampToValueAtTime(f * 0.965, now + 3.8);
            const peak = idx === 0 ? 0.11 : (0.045 / idx);
            this.scheduleEnvelope(gain.gain, now, peak, 0.012, 3.85);
            osc.connect(gain);
            gain.connect(this.masterGain);
            gain.connect(this.reverbSend);
            osc.start(now);
            osc.stop(now + 3.9);
          });
        } catch (e) {}
      }

      playWindGustSfx() {
        if (!this.ctx || this.isMuted || this.isBackgrounded || !this.windGain) return;
        try {
          const now = this.ctx.currentTime;
          this.windGain.gain.cancelScheduledValues(now);
          this.windGain.gain.setValueAtTime(Math.max(0.0001, this.windGain.gain.value), now);
          this.windGain.gain.linearRampToValueAtTime(this.inCorridor ? 0.11 : 0.22, now + 1.1);
          this.windGain.gain.exponentialRampToValueAtTime(this.inCorridor ? 0.038 : 0.085, now + 3.6);
          if (EXPLORE_FLAGS.ENABLE_WHISPERS_AND_WEEPING) {
            this.playGhostWhisperSfx();
          }
        } catch (e) {}
      }

      // 11. Heavy Old Sal-Wood Timber Creak (decoupled from forced door slam)
      playStructuralCreak() {
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const filter = this.ctx.createBiquadFilter();
          const gain = this.ctx.createGain();

          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(92, now);
          osc.frequency.linearRampToValueAtTime(168, now + 0.22);
          osc.frequency.linearRampToValueAtTime(74, now + 0.55);

          filter.type = 'bandpass';
          filter.frequency.setValueAtTime(380, now);
          filter.Q.setValueAtTime(4.2, now);

          this.scheduleEnvelope(gain.gain, now, 0.085, 0.014, 0.58);

          osc.connect(filter);
          filter.connect(gain);
          gain.connect(this.masterGain);
          gain.connect(this.reverbSend);
          osc.start(now);
          osc.stop(now + 0.60);
        } catch (e) {}
      }

      playPowerDipHum() {
        if (!EXPLORE_FLAGS.ENABLE_RANDOM_SCARE_EVENTS) return;
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          triggerHorrorVisualShock(0.45, false);
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(60, now);
          osc.frequency.exponentialRampToValueAtTime(42, now + 0.45);
          this.scheduleEnvelope(gain.gain, now, 0.11, 0.012, 0.48);
          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now);
          osc.stop(now + 0.50);
        } catch (e) {}
      }

      playHideSwoosh() {
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(390, now);
          osc.frequency.exponentialRampToValueAtTime(115, now + 0.26);
          this.scheduleEnvelope(gain.gain, now, 0.28, 0.012, 0.26);
          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now);
          osc.stop(now + 0.28);
        } catch (e) {}
      }

      playCatchSting() {
        if (!EXPLORE_FLAGS.ENABLE_JUMPSCARES_AND_STINGERS) return;
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          triggerHorrorVisualShock(0.7, false);
          [311.13, 440.0, 587.33, 880.0].forEach((freq, idx) => {
            const t0 = now + idx * 0.06;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, t0);
            this.scheduleEnvelope(gain.gain, t0, 0.30, 0.010, 0.38);
            osc.connect(gain);
            gain.connect(this.masterGain);
            gain.connect(this.reverbSend);
            osc.start(t0);
            osc.stop(t0 + 0.40);
          });
        } catch (e) {}
      }

      // 12. Visceral Double Chest-Thump Heartbeat (Lub-Dub) with 10ms attack ramp + tracked visual pulse
      playHeartbeat(intensity = 0.7) {
        if (!EXPLORE_FLAGS.ENABLE_HEARTBEAT) return;
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          const scaledInt = intensity * getFearMultiplier();
          const vol = Math.min(0.88, 0.22 + scaledInt * 0.58);
          const pulseEl = document.getElementById('horror-pulse-overlay');
          if (pulseEl && !accessibilitySettings.screenShakeOff) {
            pulseEl.style.transform = 'scale(' + (1.0 + scaledInt * 0.035).toFixed(3) + ')';
            this.setTrackedTimeout(() => {
              if (pulseEl) pulseEl.style.transform = 'scale(1.0)';
            }, 140);
          }

          [0, 0.14].forEach((tOffset, idx) => {
            const t0 = now + tOffset;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(idx === 0 ? 82 : 68, t0);
            osc.frequency.exponentialRampToValueAtTime(26, t0 + 0.12);
            this.scheduleEnvelope(gain.gain, t0, vol * (idx === 0 ? 1.0 : 0.82), 0.010, 0.125);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(t0);
            osc.stop(t0 + 0.14);
          });
        } catch (e) {}
      }

      // 13. Room-Specific Procedural Soundscape with 8-15ms click-free attack ramps
      playWaterDripSfx() {
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          const baseF = 1180 + Math.random() * 280;
          osc.frequency.setValueAtTime(baseF, now);
          osc.frequency.exponentialRampToValueAtTime(baseF * 1.65, now + 0.065);
          this.scheduleEnvelope(gain.gain, now, 0.08, 0.009, 0.09);
          osc.connect(gain);
          gain.connect(this.masterGain);
          if (this.reverbSend) gain.connect(this.reverbSend);
          osc.start(now);
          osc.stop(now + 0.105);
        } catch (e) {}
      }

      // Continuous positional server rack loop now handles primary server hum; pulse provides a subtle relay click/swell
      playServerRackHumPulse() {
        if (!this.ctx || this.isMuted || this.isBackgrounded || !this.serverRackGain) return;
        try {
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(120, now);
          this.scheduleEnvelope(gain.gain, now, 0.018, 0.015, 0.85);
          osc.connect(gain);
          if (this.serverRackPan) {
            gain.connect(this.serverRackPan);
          } else {
            gain.connect(this.masterGain);
          }
          osc.start(now);
          osc.stop(now + 0.88);
        } catch (e) {}
      }

      playChairScrapeSfx() {
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const filter = this.ctx.createBiquadFilter();
          const gain = this.ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(145, now);
          osc.frequency.linearRampToValueAtTime(210, now + 0.18);
          osc.frequency.exponentialRampToValueAtTime(98, now + 0.48);
          filter.type = 'bandpass';
          filter.frequency.setValueAtTime(520, now);
          filter.Q.setValueAtTime(5.5, now);
          this.scheduleEnvelope(gain.gain, now, 0.095, 0.012, 0.50);
          osc.connect(filter);
          filter.connect(gain);
          gain.connect(this.masterGain);
          if (this.reverbSend) gain.connect(this.reverbSend);
          osc.start(now);
          osc.stop(now + 0.52);
        } catch (e) {}
      }

      playPaCrackleSfx() {
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        if (!this.cachedBuffers.paStatic) this.pregenerateCachedBuffers();
        try {
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(580, now);
          osc.frequency.setValueAtTime(435, now + 0.18);
          this.scheduleEnvelope(gain.gain, now, 0.055, 0.010, 0.42);
          osc.connect(gain);
          if (this.cachedBuffers.paStatic) {
            const nSrc = this.ctx.createBufferSource();
            nSrc.buffer = this.cachedBuffers.paStatic;
            const bp = this.ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.setValueAtTime(1400, now);
            bp.Q.setValueAtTime(2.5, now);
            nSrc.connect(bp);
            bp.connect(gain);
            nSrc.start(now);
            nSrc.stop(now + 0.42);
          }
          gain.connect(this.masterGain);
          if (this.reverbSend) gain.connect(this.reverbSend);
          osc.start(now);
          osc.stop(now + 0.45);
        } catch (e) {}
      }

      playDistractionClatterSfx() {
        if (!EXPLORE_FLAGS.ENABLE_GAMEPLAY) return;
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          [0, 0.09, 0.21].forEach((tOff, idx) => {
            const t0 = now + tOff;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(820 - idx * 140, t0);
            osc.frequency.exponentialRampToValueAtTime(240, t0 + 0.08);
            this.scheduleEnvelope(gain.gain, t0, 0.16 / (idx + 1), 0.008, 0.09);
            osc.connect(gain);
            gain.connect(this.masterGain);
            if (this.reverbSend) gain.connect(this.reverbSend);
            osc.start(t0);
            osc.stop(t0 + 0.105);
          });
        } catch (e) {}
      }

      playFuseRepairSfx() {
        if (!EXPLORE_FLAGS.ENABLE_FUSE_OBJECTIVES) return;
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          [220, 330, 440, 660].forEach((f, idx) => {
            const t0 = now + idx * 0.055;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(f, t0);
            this.scheduleEnvelope(gain.gain, t0, 0.12, 0.010, 0.22);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(t0);
            osc.stop(t0 + 0.24);
          });
        } catch (e) {}
      }

      playSonarPingSfx() {
        if (!EXPLORE_FLAGS.ENABLE_GAMEPLAY) return;
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(520, now);
          osc.frequency.exponentialRampToValueAtTime(195, now + 0.55);
          this.scheduleEnvelope(gain.gain, now, 0.14, 0.012, 0.58);
          osc.connect(gain);
          gain.connect(this.masterGain);
          if (this.reverbSend) gain.connect(this.reverbSend);
          osc.start(now);
          osc.stop(now + 0.60);
        } catch (e) {}
      }

      // 14. Per-Room Procedural Room Tone, Door Creak, Far Door Slam, Distant Echoing Footsteps & Tube Flicker Buzz
      playRoomTonePulse(archetype = 'rotunda_lecture') {
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const sub = this.ctx.createOscillator();
          const filter = this.ctx.createBiquadFilter();
          const gain = this.ctx.createGain();
          const isLab = archetype === 'rotunda_lab' || archetype === 'computer_lab';
          const isToilet = archetype === 'toilets';
          const isLib = archetype === 'library';
          const baseFreq = isLab ? 60 : (isToilet ? 74 : (isLib ? 46 : 52));
          osc.type = isLab ? 'sawtooth' : 'triangle';
          sub.type = 'sine';
          osc.frequency.setValueAtTime(baseFreq, now);
          sub.frequency.setValueAtTime(baseFreq * 1.5, now);
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(isLab ? 190 : 125, now);
          const peak = isLab ? 0.032 : 0.022;
          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.linearRampToValueAtTime(peak * 0.4, now + 0.015);
          gain.gain.linearRampToValueAtTime(peak, now + 0.65);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.8);
          osc.connect(filter);
          sub.connect(filter);
          filter.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now);
          sub.start(now);
          osc.stop(now + 2.85);
          sub.stop(now + 2.85);
        } catch (e) {}
      }

      playDoorCreakSfx() {
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const filter = this.ctx.createBiquadFilter();
          const gain = this.ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(210, now);
          osc.frequency.linearRampToValueAtTime(164, now + 0.24);
          osc.frequency.linearRampToValueAtTime(238, now + 0.52);
          filter.type = 'bandpass';
          filter.frequency.setValueAtTime(480, now);
          filter.Q.setValueAtTime(6.5, now);
          this.scheduleEnvelope(gain.gain, now, 0.068, 0.012, 0.56);
          osc.connect(filter);
          filter.connect(gain);
          gain.connect(this.masterGain);
          if (this.reverbSend) gain.connect(this.reverbSend);
          osc.start(now);
          osc.stop(now + 0.58);
        } catch (e) {}
      }

      playFarDoorSlamSfx() {
        if (!EXPLORE_FLAGS.ENABLE_RANDOM_SCARE_EVENTS) return;
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(96, now);
          osc.frequency.exponentialRampToValueAtTime(24, now + 0.34);
          this.scheduleEnvelope(gain.gain, now, 0.22, 0.010, 0.42);
          osc.connect(gain);
          gain.connect(this.masterGain);
          if (this.reverbSend) gain.connect(this.reverbSend);
          osc.start(now);
          osc.stop(now + 0.44);
          // Secondary metallic latch rattle with 9ms attack ramp
          const latch = this.ctx.createOscillator();
          const lGain = this.ctx.createGain();
          latch.type = 'triangle';
          latch.frequency.setValueAtTime(640, now + 0.02);
          latch.frequency.exponentialRampToValueAtTime(180, now + 0.09);
          this.scheduleEnvelope(lGain.gain, now + 0.02, 0.06, 0.009, 0.09);
          latch.connect(lGain);
          lGain.connect(this.masterGain);
          latch.start(now + 0.02);
          latch.stop(now + 0.12);
        } catch (e) {}
      }

      playDistantCorridorFootsteps() {
        if (!EXPLORE_FLAGS.ENABLE_PROXIMITY_AND_CHASE_AUDIO) return;
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          [0.0, 0.46, 0.94, 1.44].forEach((tOff, idx) => {
            const t0 = now + tOff;
            const osc = this.ctx.createOscillator();
            const filter = this.ctx.createBiquadFilter();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(118 - idx * 8, t0);
            osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.11);
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(320, t0);
            const stepVol = 0.065 * Math.pow(0.78, idx);
            this.scheduleEnvelope(gain.gain, t0, stepVol, 0.010, 0.14);
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);
            if (this.reverbSend) gain.connect(this.reverbSend);
            osc.start(t0);
            osc.stop(t0 + 0.16);
          });
        } catch (e) {}
      }

      playTubeFlickerBuzzSfx() {
        if (!this.ctx || this.isMuted || this.isBackgrounded) return;
        try {
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(120, now);
          osc.frequency.setValueAtTime(240, now + 0.045);
          osc.frequency.setValueAtTime(120, now + 0.09);
          this.scheduleEnvelope(gain.gain, now, 0.038, 0.010, 0.16);
          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now);
          osc.stop(now + 0.18);
        } catch (e) {}
      }

      setMuffled(muffled) {
        if (!this.ctx || this.isMuffled === muffled) return;
        this.isMuffled = muffled;
        this.muffleFilter.frequency.setTargetAtTime(muffled ? 420 : 18000, this.ctx.currentTime, 0.2);
      }

      dispose() {
        this.isBackgrounded = true;
        this.clearAllTrackedTimers();
        if (this.loopSources && this.loopSources.length > 0) {
          for (let i = 0; i < this.loopSources.length; i++) {
            try { this.loopSources[i].stop(); } catch (e) {}
            try { this.loopSources[i].disconnect(); } catch (e) {}
          }
          this.loopSources = [];
        }
        if (this.ctx) {
          try {
            if (this.serverRackGain) this.serverRackGain.disconnect();
            if (this.serverRackPan) this.serverRackPan.disconnect();
            if (this.serverRackFilter) this.serverRackFilter.disconnect();
            if (this.reverbSend) this.reverbSend.disconnect();
            if (this.masterGain) this.masterGain.disconnect();
            if (this.muffleFilter) this.muffleFilter.disconnect();
            if (this.compressor) this.compressor.disconnect();
            this.ctx.close().catch(() => {});
          } catch (e) {}
          this.ctx = null;
        }
        try {
          sendToReactNative('DISPOSE_ACK', {});
        } catch (e) {}
      }
    }

    const soundEngine = new CampusNightSoundEngine();

    /* =========================================================================
       SHARED PROCEDURAL TEXTURES FOR REALISTIC NIGHT & WARM LANTERN LIGHTING
       ========================================================================= */
    function createSoftRoundParticleTexture() {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
      g.addColorStop(0.32, 'rgba(226, 232, 240, 0.65)');
      g.addColorStop(0.7, 'rgba(148, 163, 184, 0.18)');
      g.addColorStop(1.0, 'rgba(148, 163, 184, 0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    }

    // Smooth atmospheric warm-amber lantern bloom (NO artificial X-lines, matching Ref 1 & 3)
    // Step 2: Saturated Orange Halo Sprite with a Smaller Bright Core (Reads Orange, Not White!)
    function createWarmLampBloomTexture() {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0.0, 'rgba(255, 205, 135, 0.92)');
      g.addColorStop(0.09, 'rgba(255, 138, 42, 0.82)');
      g.addColorStop(0.32, 'rgba(230, 96, 20, 0.42)');
      g.addColorStop(0.68, 'rgba(154, 48, 10, 0.12)');
      g.addColorStop(1.0, 'rgba(90, 24, 4, 0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    }

    // Step 2: Ground Pool Texture — Pure Orange to Transparent (No White Center, Low Opacity so it Never Clips!)
    function createRealisticGroundPoolTexture() {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 256;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      g.addColorStop(0.0, 'rgba(255, 138, 42, 0.72)');
      g.addColorStop(0.28, 'rgba(224, 92, 22, 0.44)');
      g.addColorStop(0.60, 'rgba(148, 52, 12, 0.16)');
      g.addColorStop(0.86, 'rgba(78, 24, 6, 0.04)');
      g.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);

      // Subtle wet paving joint streaks inside the orange reflection pool
      ctx.strokeStyle = 'rgba(8, 14, 20, 0.24)';
      ctx.lineWidth = 1.5;
      for (let y = 16; y < 240; y += 16) {
        ctx.beginPath();
        ctx.moveTo(16, y);
        ctx.lineTo(240, y);
        ctx.stroke();
      }
      return new THREE.CanvasTexture(c);
    }

    function createVolumetricConeAlphaTexture() {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 256;
      const ctx = c.getContext('2d');
      const vg = ctx.createLinearGradient(0, 0, 0, 256);
      vg.addColorStop(0.0, 'rgba(255, 255, 255, 0.0)');
      vg.addColorStop(0.08, 'rgba(255, 218, 158, 0.55)');
      vg.addColorStop(0.45, 'rgba(255, 146, 36, 0.18)');
      vg.addColorStop(0.84, 'rgba(194, 65, 12, 0.04)');
      vg.addColorStop(1.0, 'rgba(154, 52, 18, 0.0)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, 128, 256);
      return new THREE.CanvasTexture(c);
    }

    // Cool blue-grey ground mist texture (Ref 1 street fog)
    function createGroundMistTexture() {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 256;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 124);
      g.addColorStop(0.0, 'rgba(148, 184, 218, 0.28)');
      g.addColorStop(0.45, 'rgba(71, 108, 145, 0.16)');
      g.addColorStop(0.8, 'rgba(23, 42, 69, 0.05)');
      g.addColorStop(1.0, 'rgba(10, 22, 38, 0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
      return new THREE.CanvasTexture(c);
    }

    // Lantern glass pane texture (warm glowing center with dark iron bevel edges, Ref 1)
    function createLanternGlassTexture() {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 192;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(64, 96, 6, 64, 96, 92);
      g.addColorStop(0.0, '#fff9eb');
      g.addColorStop(0.35, '#ffd175');
      g.addColorStop(0.75, '#ff8c1a');
      g.addColorStop(1.0, '#9a3412');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 192);
      ctx.strokeStyle = '#11161f';
      ctx.lineWidth = 10;
      ctx.strokeRect(0, 0, 128, 192);
      return new THREE.CanvasTexture(c);
    }

    const softRoundParticleTex = createSoftRoundParticleTexture();
    const softRadialGlowTex = softRoundParticleTex;
    const warmLampBloomTex = createWarmLampBloomTexture();
    const realisticGroundPoolTex = createRealisticGroundPoolTexture();
    const volumetricConeTex = createVolumetricConeAlphaTexture();
    const groundMistTex = softRoundParticleTex;
    const lanternGlassTex = warmLampBloomTex;

    function createSoftContactShadowTexture() {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
      g.addColorStop(0.0, 'rgba(4, 7, 14, 0.78)');
      g.addColorStop(0.42, 'rgba(4, 7, 14, 0.44)');
      g.addColorStop(0.80, 'rgba(4, 7, 14, 0.12)');
      g.addColorStop(1.0, 'rgba(4, 7, 14, 0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    }

    const softContactShadowTex = createSoftContactShadowTexture();

    function createRectContactAOTexture() {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, 128, 128);
      // Soft rectangular under-desk / furniture contact AO shadow
      const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 62);
      g.addColorStop(0.0, 'rgba(2, 5, 10, 0.88)');
      g.addColorStop(0.48, 'rgba(3, 7, 14, 0.64)');
      g.addColorStop(0.78, 'rgba(4, 8, 16, 0.26)');
      g.addColorStop(1.0, 'rgba(4, 8, 16, 0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    }

    function createCornerAOStripTexture() {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 64, 0);
      g.addColorStop(0.0, 'rgba(2, 4, 9, 0.82)');
      g.addColorStop(0.32, 'rgba(3, 6, 12, 0.46)');
      g.addColorStop(0.72, 'rgba(4, 8, 15, 0.12)');
      g.addColorStop(1.0, 'rgba(4, 8, 15, 0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    }

    function createFlashlightBeamConeTexture() {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 256;
      const ctx = c.getContext('2d');
      // Axial falloff from emitter top (y=0) to far end (y=256) with soft radial edge fade
      const vg = ctx.createLinearGradient(0, 0, 0, 256);
      vg.addColorStop(0.0, 'rgba(255, 250, 235, 0.0)');
      vg.addColorStop(0.05, 'rgba(255, 246, 220, 0.72)');
      vg.addColorStop(0.24, 'rgba(255, 238, 198, 0.42)');
      vg.addColorStop(0.58, 'rgba(225, 210, 178, 0.16)');
      vg.addColorStop(0.88, 'rgba(180, 175, 160, 0.04)');
      vg.addColorStop(1.0, 'rgba(140, 145, 150, 0.0)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, 128, 256);
      return new THREE.CanvasTexture(c);
    }

    function createWindowLightShaftTexture() {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 256;
      const ctx = c.getContext('2d');
      const vg = ctx.createLinearGradient(0, 0, 0, 256);
      vg.addColorStop(0.0, 'rgba(165, 208, 248, 0.0)');
      vg.addColorStop(0.07, 'rgba(178, 218, 252, 0.56)');
      vg.addColorStop(0.42, 'rgba(132, 182, 232, 0.28)');
      vg.addColorStop(0.84, 'rgba(84, 134, 188, 0.08)');
      vg.addColorStop(1.0, 'rgba(48, 88, 136, 0.0)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, 128, 256);

      // Window mullion & Venetian blind slat shadow rays cutting through the volumetric shaft (Ref 4 & Ref 5)
      ctx.fillStyle = 'rgba(6, 14, 24, 0.30)';
      ctx.fillRect(40, 0, 5, 256);
      ctx.fillRect(83, 0, 5, 256);
      for (let sy = 14; sy < 240; sy += 18) {
        ctx.fillStyle = 'rgba(4, 10, 18, 0.16)';
        ctx.fillRect(0, sy, 128, 5);
      }
      return new THREE.CanvasTexture(c);
    }

    function createMoonWindowFloorGoboTexture() {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
      g.addColorStop(0.0, 'rgba(162, 206, 248, 0.48)');
      g.addColorStop(0.68, 'rgba(112, 162, 216, 0.24)');
      g.addColorStop(1.0, 'rgba(54, 92, 138, 0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(8, 8, 112, 112);
      // Window frame crossbars & Venetian blind slat shadow bars on floor (matching Ref 4 & Ref 5!)
      ctx.fillStyle = 'rgba(5, 10, 18, 0.42)';
      ctx.fillRect(61, 8, 6, 112);
      for (let by = 12; by < 116; by += 10) {
        ctx.fillRect(8, by, 112, 3.5);
      }
      return new THREE.CanvasTexture(c);
    }

    const rectContactShadowTex = createRectContactAOTexture();
    const aoCornerStripTex = createCornerAOStripTexture();
    const corridorDarknessTex = rectContactShadowTex;
    const flashlightBeamTex = createFlashlightBeamConeTexture();
    const windowLightShaftTex = createWindowLightShaftTexture();
    const moonWindowGoboTex = createMoonWindowFloorGoboTexture();
    const corridorFogTex = createGroundMistTexture();

    /* =========================================================================
       MODULE 1: NightAtmosphere — COOL SLATE-BLUE NIGHT SKY, STORM CLOUDS & MOON
       + MAIN PLAYER FLASHLIGHT (Soft-Edged Spotlight, Visible Cone, Dust & Battery Flicker)
       + LOWER, COOLER GLOBAL AMBIENT WITH ROOM MOOD TRANSITIONS
       ========================================================================= */
    class NightAtmosphere {
      constructor(canvasEl) {
        this.scene = new THREE.Scene();
        const fogHex = (HORROR_CONFIG.grade && HORROR_CONFIG.grade.fogColor) || HORROR_CONFIG.renderer.fogColor || 0x14222c;
        this.scene.background = new THREE.Color(HORROR_CONFIG.renderer.clearColor || 0x071118);
        this.baseFogColor = new THREE.Color(fogHex);
        this.warmFogColor = new THREE.Color(HORROR_CONFIG.renderer.fogWarmTintColor || 0x221d18);
        this.corridorFogColor = new THREE.Color(0x0a141e);
        this.scene.fog = new THREE.Fog(
          this.baseFogColor.clone(),
          (HORROR_CONFIG.renderer && HORROR_CONFIG.renderer.fogNear) || 14.0,
          (HORROR_CONFIG.renderer && HORROR_CONFIG.renderer.fogFar) || 88.0
        );

        const initW = Math.max(window.innerWidth || 0, 320);
        const initH = Math.max(window.innerHeight || 0, 240);
        const camNear = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.cameraNear) || 0.05;
        this.camera = new THREE.PerspectiveCamera(68, initW / initH, camNear, 260);
        this.camera.rotation.order = 'YXZ';
        this.scene.add(this.camera);

        try {
          canvasEl.addEventListener('webglcontextlost', (ev) => {
            ev.preventDefault();
            console.warn('[HideAndSeek] WebGL context lost event caught');
          }, false);
          canvasEl.addEventListener('webglcontextrestored', () => {
            console.log('[HideAndSeek] WebGL context restored');
            if (typeof handleResize === 'function') handleResize();
          }, false);
        } catch (e) {}

        let createdRenderer = null;
        const rendererConfigs = [
          { canvas: canvasEl, antialias: false, alpha: false, stencil: false, depth: true, powerPreference: 'default' },
          { canvas: canvasEl, antialias: false, alpha: true, stencil: false, depth: true },
          { canvas: canvasEl, antialias: false },
        ];
        for (let i = 0; i < rendererConfigs.length; i++) {
          try {
            createdRenderer = new THREE.WebGLRenderer(rendererConfigs[i]);
            if (createdRenderer) break;
          } catch (err) {
            console.warn('[HideAndSeek] WebGL context attempt ' + i + ' failed:', err);
          }
        }
        if (!createdRenderer) {
          try {
            const freshCanvas = document.createElement('canvas');
            freshCanvas.id = 'game-canvas';
            freshCanvas.style.cssText = canvasEl.style.cssText;
            freshCanvas.style.width = '100%';
            freshCanvas.style.height = '100%';
            freshCanvas.style.display = 'block';
            freshCanvas.style.touchAction = 'none';
            if (canvasEl.parentNode) {
              canvasEl.parentNode.replaceChild(freshCanvas, canvasEl);
            }
            createdRenderer = new THREE.WebGLRenderer({ canvas: freshCanvas, antialias: false, alpha: false });
            canvasEl = freshCanvas;
          } catch (err2) {
            console.warn('[HideAndSeek] Fresh canvas WebGL attempt failed:', err2);
          }
        }
        if (!createdRenderer) {
          try {
            createdRenderer = new THREE.WebGLRenderer({ antialias: false });
            createdRenderer.domElement.id = 'game-canvas';
            createdRenderer.domElement.style.width = '100%';
            createdRenderer.domElement.style.height = '100%';
            createdRenderer.domElement.style.display = 'block';
            createdRenderer.domElement.style.touchAction = 'none';
            if (canvasEl.parentNode) {
              canvasEl.parentNode.replaceChild(createdRenderer.domElement, canvasEl);
            } else {
              document.body.insertBefore(createdRenderer.domElement, document.body.firstChild);
            }
            canvasEl = createdRenderer.domElement;
          } catch (err3) {
            console.error('[HideAndSeek] Critical WebGL context failure:', err3);
            showToast('WebGL starting up...');
            sendToReactNative('LOG_ERROR', { message: 'WebGL initialization issue: ' + (err3 ? err3.message : 'Unknown') });
          }
        }
        this.renderer = createdRenderer || {
          setSize() {},
          setPixelRatio() {},
          render() {},
          setRenderTarget() {},
          dispose() {},
          shadowMap: { enabled: false, autoUpdate: false }
        };

        this.stylizedMode = !!(HORROR_CONFIG.grade && HORROR_CONFIG.grade.stylizedPs1Mode);
        this.gradeEnabledByConfig = !!(HORROR_CONFIG.grade ? HORROR_CONFIG.grade.enabled : true);
        this.gradeAutoDisabledByFps = false;
        this.gradeDevToggle = true;

        const targetPR = this.getEffectivePixelRatio(activePreset);
        this.renderer.setSize(initW, initH);
        this.renderer.setPixelRatio(targetPR);

        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = (HORROR_CONFIG.renderer && HORROR_CONFIG.renderer.toneMappingExposure) || 1.15;
        if ('outputColorSpace' in this.renderer && THREE.SRGBColorSpace) {
          this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        } else if ('outputEncoding' in this.renderer && THREE.sRGBEncoding) {
          this.renderer.outputEncoding = THREE.sRGBEncoding;
        }

        const shadowsOn = !!(activePreset && activePreset.enableShadows);
        const shadowSize = (activePreset && activePreset.shadowMapSize) || 512;
        this.shadowsDebugOverride = null;
        this.lastTotalDrawCalls = 0;
        if (this.renderer.info) {
          this.renderer.info.autoReset = false;
        }
        this.renderer.shadowMap.enabled = shadowsOn;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.shadowMap.autoUpdate = true;

        // Requirement 2: Much lower, cooler global ambient & hemisphere fill so rooms stop looking flat!
        const lCfg = HORROR_CONFIG.lighting || {};
        this.baseAmbColor = new THREE.Color(lCfg.ambientColor || 0x162436);
        this.targetAmbColor = this.baseAmbColor.clone();
        this.baseAmbIntensity = lCfg.ambientIntensity || 0.14;
        this.baseHemiIntensity = lCfg.hemiIntensity || 0.16;
        this.baseMoonIntensity = lCfg.moonIntensity || 0.58;

        this.ambientLight = new THREE.AmbientLight(
          this.baseAmbColor.clone(),
          this.baseAmbIntensity
        );
        this.scene.add(this.ambientLight);

        this.hemiLight = new THREE.HemisphereLight(
          lCfg.hemiSkyColor || 0x1e334a,
          lCfg.hemiGroundColor || 0x070c12,
          this.baseHemiIntensity
        );
        this.scene.add(this.hemiLight);

        this.moonDirLight = new THREE.DirectionalLight(
          lCfg.moonColor || 0x8eb8d6,
          this.baseMoonIntensity
        );
        this.moonDirLight.position.set(-38, 64, -44);
        this.moonDirLight.castShadow = shadowsOn;
        if (this.moonDirLight.shadow) {
          this.moonDirLight.shadow.mapSize.width = shadowSize;
          this.moonDirLight.shadow.mapSize.height = shadowSize;
          if (this.moonDirLight.shadow.camera) {
            this.moonDirLight.shadow.camera.left = -52;
            this.moonDirLight.shadow.camera.right = 52;
            this.moonDirLight.shadow.camera.top = 68;
            this.moonDirLight.shadow.camera.bottom = -68;
            this.moonDirLight.shadow.camera.near = 10;
            this.moonDirLight.shadow.camera.far = 165;
          }
        }
        this.scene.add(this.moonDirLight);

        // Requirement 1: Bring the flashlight back as the main light!
        // Soft-edged spotlight, visible volumetric beam cone, dust motes in beam, battery flicker & realistic falloff
        this.flBaseColor = new THREE.Color(lCfg.flashlightColor || 0xfff1d6);
        this.flLowBattColor = new THREE.Color(lCfg.flashlightLowBatteryColor || 0xffb366);
        this.flBaseIntensity = lCfg.flashlightIntensity || 9.8;
        this.flBaseDistance = lCfg.flashlightDistance || 28.0;
        this.flBaseAngle = lCfg.flashlightAngle || 0.60;
        this.flBasePenumbra = lCfg.flashlightPenumbra || 0.88;
        this.flBaseDecay = lCfg.flashlightDecay || 1.85;
        this.flBaseBeamOpacity = lCfg.flashlightBeamOpacity || 0.13;

        this.flashlight = new THREE.SpotLight(
          this.flBaseColor.clone(),
          this.flBaseIntensity,
          this.flBaseDistance,
          this.flBaseAngle,
          this.flBasePenumbra,
          this.flBaseDecay
        );
        this.flashlight.position.set(-4, 1.5, -48);
        this.flashlight.castShadow = shadowsOn;
        if (this.flashlight.shadow) {
          this.flashlight.shadow.mapSize.width = shadowSize;
          this.flashlight.shadow.mapSize.height = shadowSize;
          this.flashlight.shadow.bias = -0.0005;
          if (this.flashlight.shadow.camera) {
            this.flashlight.shadow.camera.near = 0.25;
            this.flashlight.shadow.camera.far = this.flBaseDistance;
          }
        }
        this.flashlightTarget = new THREE.Object3D();
        this.flashlightTarget.position.set(-4, 1.4, -58);
        this.scene.add(this.flashlightTarget);
        this.flashlight.target = this.flashlightTarget;
        this.scene.add(this.flashlight);

        // Close-range soft peripheral bounce fill so immediate 2-5m around player isn't pitch-black outside cone
        this.flashlightSpill = new THREE.PointLight(
          this.flBaseColor.clone(),
          lCfg.flashlightSpillIntensity || 1.15,
          lCfg.flashlightSpillDistance || 6.2,
          2.0
        );
        this.flashlightSpill.castShadow = false;
        this.scene.add(this.flashlightSpill);

        // Visible Volumetric Beam Cone + Emitter Lens Halo + Floating Dust Motes in Beam
        this.flashlightRig = new THREE.Group();
        this.flashlightRig.userData.noMerge = true;
        this.scene.add(this.flashlightRig);

        const coneLen = 10.5;
        const coneEndRadius = Math.tan(this.flBaseAngle * 0.72) * coneLen;
        const beamConeGeo = new THREE.CylinderGeometry(0.06, coneEndRadius, coneLen, 20, 1, true);
        // Shift cylinder so its narrow tip is at local (0,0,0) and it extends along -Z (lookAt forward direction)
        beamConeGeo.translate(0, -coneLen * 0.5, 0);
        beamConeGeo.rotateX(Math.PI * 0.5);

        this.flashlightBeamMat = new THREE.MeshBasicMaterial({
          map: flashlightBeamTex,
          color: this.flBaseColor.clone(),
          transparent: true,
          opacity: this.flBaseBeamOpacity,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
          fog: false,
        });
        this.flashlightBeamCone = new THREE.Mesh(beamConeGeo, this.flashlightBeamMat);
        this.flashlightBeamCone.userData.noMerge = true;
        this.flashlightBeamCone.renderOrder = 12;
        this.flashlightRig.add(this.flashlightBeamCone);

        // Inner tighter core beam for soft multi-layered volumetric look
        const innerConeGeo = new THREE.CylinderGeometry(0.03, coneEndRadius * 0.45, coneLen * 0.78, 14, 1, true);
        innerConeGeo.translate(0, -coneLen * 0.39, 0);
        innerConeGeo.rotateX(Math.PI * 0.5);
        this.flashlightCoreMat = new THREE.MeshBasicMaterial({
          map: flashlightBeamTex,
          color: 0xfff8e7,
          transparent: true,
          opacity: this.flBaseBeamOpacity * 0.68,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
          fog: false,
        });
        this.flashlightCoreCone = new THREE.Mesh(innerConeGeo, this.flashlightCoreMat);
        this.flashlightCoreCone.userData.noMerge = true;
        this.flashlightCoreCone.renderOrder = 13;
        this.flashlightRig.add(this.flashlightCoreCone);

        // Emitter lens glow sprite at flashlight tip
        this.flashlightLensMat = new THREE.SpriteMaterial({
          map: warmLampBloomTex,
          color: 0xfff8e7,
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        this.flashlightLensSprite = new THREE.Sprite(this.flashlightLensMat);
        this.flashlightLensSprite.scale.set(0.28, 0.28, 1);
        this.flashlightLensSprite.position.set(0, 0, -0.05);
        this.flashlightRig.add(this.flashlightLensSprite);

        // Requirement 3: Dust particles suspended inside the flashlight beam cone
        this.beamDustCount = 28;
        this.beamDustGeo = new THREE.BufferGeometry();
        this.beamDustPos = new Float32Array(this.beamDustCount * 3);
        this.beamDustMeta = [];
        for (let i = 0; i < this.beamDustCount; i++) {
          const distZ = 0.8 + Math.random() * 8.2;
          const maxR = (distZ / coneLen) * coneEndRadius * 0.82;
          const ang = Math.random() * Math.PI * 2;
          const rad = Math.random() * maxR;
          this.beamDustPos[i * 3]     = Math.cos(ang) * rad;
          this.beamDustPos[i * 3 + 1] = Math.sin(ang) * rad;
          this.beamDustPos[i * 3 + 2] = -distZ;
          this.beamDustMeta.push({
            vx: (Math.random() - 0.5) * 0.16,
            vy: 0.04 + Math.random() * 0.12,
            vz: (Math.random() - 0.5) * 0.14,
            phase: Math.random() * 6.28,
          });
        }
        this.beamDustGeo.setAttribute('position', new THREE.BufferAttribute(this.beamDustPos, 3));
        this.beamDustMat = new THREE.PointsMaterial({
          map: softRoundParticleTex,
          color: 0xfff3d1,
          size: 0.065,
          transparent: true,
          opacity: 0.52,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        this.beamDustPoints = new THREE.Points(this.beamDustGeo, this.beamDustMat);
        this.beamDustPoints.frustumCulled = false;
        this.flashlightRig.add(this.beamDustPoints);

        // Battery Flicker State Machine
        this.flBattState = 'steady';
        this.flBattTimer = 6.5 + Math.random() * 6.0;
        this.flBattCharge = 0.88; // Simulates aging battery with periodic voltage sag & recovery
        this.flCurrentFactor = 1.0;

        this.skyGroup = null;
        this.buildCloudyMoonlitSkyDome();

        // Step 1: Single-Pass Full-Screen Color Grade (1 WebGLRenderTarget + 1 Full-Screen Quad)
        this.initColorGradePass(initW, initH, targetPR);
      }

      updateFlashlight(delta, timeSec, camPos, yaw, pitch, hunterProximity = 0.0, isHiding = false, isFirstPerson = true) {
        if (!this.flashlight || !this.flashlightTarget) return;

        let battFactor = 1.0;
        let warmShift = 0.0;
        const minReserve = (HORROR_CONFIG.gameplay && HORROR_CONFIG.gameplay.flashlightMinReserveFactor) || 0.28;
        let chargeScale = 1.0;

        if (EXPLORE_FLAGS.INFINITE_FLASHLIGHT_BATTERY) {
          // Explore Mode: Infinite steady flashlight battery — no drain, no sputter, no brownout, no Hunter interference
          this.flBattState = 'steady';
          battFactor = 1.0;
          warmShift = 0.0;
          chargeScale = 1.0;
        } else {
          const safeFlicker = !!(accessibilitySettings && accessibilitySettings.flickerReduction);
          // 1. Battery Flicker State Machine (steady -> micro_sag -> sputter -> brownout -> recover)
          this.flBattTimer -= delta * (1.0 + hunterProximity * (safeFlicker ? 0.65 : 1.65));
          if (this.flBattTimer <= 0) {
            if (this.flBattState === 'steady') {
              const roll = Math.random();
              if (roll < 0.52) {
                this.flBattState = 'sputter';
                this.flBattTimer = 0.32 + Math.random() * 0.55;
              } else if (roll < 0.82) {
                this.flBattState = 'micro_sag';
                this.flBattTimer = 0.65 + Math.random() * 0.85;
              } else {
                this.flBattState = 'brownout';
                this.flBattTimer = 0.40 + Math.random() * 0.55;
              }
            } else if (this.flBattState === 'sputter' || this.flBattState === 'brownout' || this.flBattState === 'micro_sag') {
              this.flBattState = 'recover';
              this.flBattTimer = 0.24 + Math.random() * 0.25;
            } else {
              this.flBattState = 'steady';
              this.flBattTimer = Math.max(2.8, (6.0 + Math.random() * 7.5) * (1.0 - hunterProximity * 0.55));
            }
          }

          if (safeFlicker) {
            // Requirement 4 (Light Safety): <= 2 flashes/sec (omega <= 4*pi = 12.56 rad/s), smaller brightness swings, gentler brownouts
            const slowWave = Math.sin(timeSec * 9.8); // ~1.56 Hz (<= 2 flashes/sec)
            if (this.flBattState === 'steady') {
              battFactor = 0.96 + Math.sin(timeSec * 5.2) * 0.025;
              if (hunterProximity > 0.25) {
                battFactor *= (1.0 - hunterProximity * 0.16);
                warmShift = hunterProximity * 0.25;
              }
            } else if (this.flBattState === 'micro_sag') {
              battFactor = 0.84 + slowWave * 0.05;
              warmShift = 0.22;
            } else if (this.flBattState === 'sputter') {
              battFactor = 0.82 + slowWave * 0.08;
              warmShift = 0.28;
            } else if (this.flBattState === 'brownout') {
              battFactor = 0.74 + slowWave * 0.05; // Gentler brownout
              warmShift = 0.35;
            } else {
              battFactor = 0.92 + slowWave * 0.04;
              warmShift = 0.12;
            }
          } else {
            if (this.flBattState === 'steady') {
              // Subtle filament voltage hum + hunter interference
              battFactor = 0.96 + Math.sin(timeSec * 7.3) * 0.025 + Math.cos(timeSec * 19.1) * 0.015;
              if (hunterProximity > 0.25) {
                const interfere = Math.sin(timeSec * 43.0) * Math.cos(timeSec * 29.0);
                if (interfere > 0.55) {
                  battFactor *= (1.0 - hunterProximity * 0.52);
                  warmShift = hunterProximity * 0.45;
                }
              }
            } else if (this.flBattState === 'micro_sag') {
              battFactor = 0.66 + Math.sin(timeSec * 18.0) * 0.10;
              warmShift = 0.38;
            } else if (this.flBattState === 'sputter') {
              const wave = Math.sin(timeSec * 58.0) + Math.cos(timeSec * 41.0) * 0.8;
              battFactor = wave > 0.05 ? 0.94 : (wave > -0.65 ? 0.28 : 0.06);
              warmShift = 0.65 * (1.0 - battFactor);
            } else if (this.flBattState === 'brownout') {
              battFactor = 0.24 + Math.sin(timeSec * 27.0) * 0.07;
              warmShift = 0.78;
            } else if (this.flBattState === 'recover') {
              battFactor = 0.85 + Math.sin(timeSec * 34.0) * 0.12;
              warmShift = 0.20;
            }
          }

          // Requirement 5 (Playability): Scale with remaining battery charge while guaranteeing >= 4m visibility in 'dark' rooms at minimum battery
          const rawBattCharge = (typeof flashlightBattery === 'number') ? Math.max(0.0, Math.min(1.0, flashlightBattery / 100.0)) : 1.0;
          chargeScale = minReserve + (1.0 - minReserve) * Math.pow(rawBattCharge, 0.55);
          battFactor *= chargeScale;
          if (rawBattCharge < 0.30) {
            warmShift = Math.max(warmShift, (1.0 - rawBattCharge / 0.30) * 0.55);
          }

          if (isHiding) {
            battFactor *= 0.32; // Dimmed when tucked under desk cover
          }
        }

        this.flCurrentFactor += (battFactor - this.flCurrentFactor) * Math.min(1.0, 26.0 * delta);
        const inDarkRoom = (this._currentRoomMood === 'dark');
        const minFloorF = inDarkRoom ? Math.max(0.26, minReserve) : 0.16;
        const f = Math.max(minFloorF, this.flCurrentFactor);

        // Non-ULTRA modes without post-process blackLift get a slight clean visibility boost on flashlight
        const isLowOrFast = (currentQuality === 'fast' || currentQuality === 'low');
        const qualityMult = isLowOrFast ? 1.14 : 1.0;

        this.flashlight.intensity = this.flBaseIntensity * f * qualityMult;
        // Guarantee >= 4.2m effective reveal cone even at minimum battery (0%) in 'dark' rooms
        const baseDist = (HORROR_CONFIG.lighting && HORROR_CONFIG.lighting.flashlightDistance) || 28.0;
        const minDarkDist = (HORROR_CONFIG.gameplay && HORROR_CONFIG.gameplay.flashlightMinDarkRoomDistance) || 4.6;
        this.flashlight.distance = Math.max(minDarkDist, baseDist * (0.22 + 0.78 * chargeScale));
        this.flashlight.color.copy(this.flBaseColor).lerp(this.flLowBattColor, warmShift);

        if (this.flashlightSpill) {
          this.flashlightSpill.position.copy(camPos);
          this.flashlightSpill.intensity = ((HORROR_CONFIG.lighting && HORROR_CONFIG.lighting.flashlightSpillIntensity) || 1.15) * f * qualityMult;
          this.flashlightSpill.distance = Math.max(4.4, ((HORROR_CONFIG.lighting && HORROR_CONFIG.lighting.flashlightSpillDistance) || 6.2) * (0.72 + 0.28 * chargeScale));
          this.flashlightSpill.color.copy(this.flashlight.color);
        }

        // 2. Position & Aim Flashlight and Volumetric Beam Cone
        const fx = -Math.sin(yaw) * Math.cos(pitch);
        const fy = Math.sin(pitch);
        const fz = -Math.cos(yaw) * Math.cos(pitch);
        const rightX = Math.cos(yaw);
        const rightZ = -Math.sin(yaw);

        // Offset emitter slightly right and down from eye so the volumetric cone is clearly visible in 1st-person
        const handOffR = isFirstPerson ? 0.22 : 0.28;
        const handOffY = isFirstPerson ? -0.19 : -0.25;
        const handOffFwd = isFirstPerson ? 0.18 : 0.35;

        const emitX = camPos.x + rightX * handOffR + fx * handOffFwd;
        const emitY = camPos.y + handOffY + fy * handOffFwd;
        const emitZ = camPos.z + rightZ * handOffR + fz * handOffFwd;

        const targetX = camPos.x + fx * 14.0;
        const targetY = camPos.y + fy * 14.0;
        const targetZ = camPos.z + fz * 14.0;

        this.flashlight.position.set(emitX, emitY, emitZ);
        this.flashlightTarget.position.set(targetX, targetY, targetZ);

        if (this.flashlightRig) {
          this.flashlightRig.position.set(emitX, emitY, emitZ);
          this.flashlightRig.lookAt(targetX, targetY, targetZ);
          const coneOpacity = this.flBaseBeamOpacity * f * (isHiding ? 0.35 : 1.0);
          this.flashlightBeamMat.opacity = coneOpacity;
          this.flashlightBeamMat.color.copy(this.flashlight.color);
          // Requirement 2: Reduce second beam layer, lens flare & dust ONLY on LOW and FAST; keep HIGH & ULTRA 100% untouched
          if (this.flashlightCoreCone) this.flashlightCoreCone.visible = !isLowOrFast;
          if (this.flashlightLensSprite) this.flashlightLensSprite.visible = !isLowOrFast;
          this.flashlightCoreMat.opacity = coneOpacity * 0.68;
          this.flashlightLensMat.opacity = Math.min(0.85, 0.55 * f);

          // Animate dust motes drifting inside the flashlight beam cone (HIGH & ULTRA)
          const dustAllowed = (typeof exploreTools === 'undefined' || exploreTools.dustEnabled !== false);
          const showBeamDust = !isLowOrFast && dustAllowed;
          this.beamDustPoints.visible = showBeamDust && !isHiding;
          if (showBeamDust && !isHiding) {
            this.beamDustMat.opacity = Math.min(0.68, 0.52 * f);
            const coneLen = 10.5;
            const coneEndR = Math.tan(this.flBaseAngle * 0.72) * coneLen;
            for (let i = 0; i < this.beamDustCount; i++) {
              const dm = this.beamDustMeta[i];
              const idx = i * 3;
              let dx = this.beamDustPos[idx]     + (dm.vx + Math.sin(timeSec * 1.4 + dm.phase) * 0.05) * delta;
              let dy = this.beamDustPos[idx + 1] + (dm.vy + Math.cos(timeSec * 1.1 + dm.phase) * 0.04) * delta;
              let dz = this.beamDustPos[idx + 2] + dm.vz * delta;
              if (dz > -0.7 || dz < -9.2) dz = -0.8 - Math.random() * 8.0;
              const maxR = (Math.abs(dz) / coneLen) * coneEndR * 0.80;
              if (dx * dx + dy * dy > maxR * maxR) {
                const a = Math.random() * 6.28;
                const r = Math.random() * maxR * 0.65;
                dx = Math.cos(a) * r;
                dy = Math.sin(a) * r;
              }
              this.beamDustPos[idx]     = dx;
              this.beamDustPos[idx + 1] = dy;
              this.beamDustPos[idx + 2] = dz;
            }
            this.beamDustGeo.attributes.position.needsUpdate = true;
          }
        }
      }

      updateRoomMoodAmbient(delta, activeRoomMood, inCorridor = false) {
        this._currentRoomMood = activeRoomMood || null;
        const lCfg = HORROR_CONFIG.lighting || {};
        const moods = HORROR_CONFIG.roomLightMoods || {};
        const isCleanLowMode = (currentQuality === 'fast' || currentQuality === 'low');
        const lowModeLift = isCleanLowMode ? 1.28 : 1.0;

        let targetAmbInt = this.baseAmbIntensity * lowModeLift;
        let targetHemiInt = this.baseHemiIntensity * lowModeLift;
        let targetMoonInt = this.baseMoonIntensity;
        this.targetAmbColor.copy(this.baseAmbColor);

        if (activeRoomMood) {
          const mCfg = moods[activeRoomMood] || { ambientColor: 0x0a1520, ambientMult: 0.45 };
          // Requirement 5: Very low, cool indoor ambient so the player's flashlight is the hero!
          const ambMult = mCfg.ambientMult || mCfg.ambientScale || 0.45;
          const indoorAmb = (lCfg.indoorAmbientIntensity || 0.045) * ambMult * lowModeLift;
          const indoorHemi = (lCfg.indoorHemiIntensity || 0.05) * ambMult * lowModeLift;
          targetAmbInt = indoorAmb;
          targetHemiInt = indoorHemi;
          targetMoonInt = activeRoomMood === 'moonlight'
            ? (this.baseMoonIntensity * 0.42)
            : (lCfg.indoorMoonIntensity || 0.06);
          this.targetAmbColor.setHex(mCfg.ambientColor || 0x0a1520);
        } else if (inCorridor) {
          targetAmbInt = (lCfg.indoorAmbientIntensity || 0.045) * 0.65 * lowModeLift;
          targetHemiInt = (lCfg.indoorHemiIntensity || 0.05) * 0.65 * lowModeLift;
          targetMoonInt = this.baseMoonIntensity * 0.18;
          this.targetAmbColor.setHex(0x0d1822);
        }

        const lerpRate = Math.min(1.0, 4.5 * delta);
        this.ambientLight.intensity += (targetAmbInt - this.ambientLight.intensity) * lerpRate;
        this.ambientLight.color.lerp(this.targetAmbColor, lerpRate);
        this.hemiLight.intensity += (targetHemiInt - this.hemiLight.intensity) * lerpRate;
        if (this.moonDirLight && this.moonDirLight.intensity <= this.baseMoonIntensity * 1.5) {
          this.moonDirLight.intensity += (targetMoonInt - this.moonDirLight.intensity) * lerpRate;
        }
      }

      getEffectivePixelRatio(preset) {
        if (this.stylizedMode) {
          return (HORROR_CONFIG.grade && HORROR_CONFIG.grade.stylizedPixelRatio) || 0.7;
        }
        const cap = batterySaverEnabled ? Math.min(1.0, (preset && preset.pixelRatioCap) || 1.0) : ((preset && preset.pixelRatioCap) || 1.4);
        return Math.min(window.devicePixelRatio || 1, cap);
      }

      initColorGradePass(w, h, pr) {
        const gCfg = HORROR_CONFIG.grade || {};
        const rtW = Math.max(160, Math.floor(w * pr));
        const rtH = Math.max(120, Math.floor(h * pr));
        const filterMode = this.stylizedMode ? THREE.NearestFilter : THREE.LinearFilter;

        this.gradeTarget = new THREE.WebGLRenderTarget(rtW, rtH, {
          minFilter: filterMode,
          magFilter: filterMode,
          format: THREE.RGBAFormat,
          depthBuffer: true,
          stencilBuffer: false,
        });

        this.gradeOrthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
        this.gradeScene = new THREE.Scene();

        const sTint = gCfg.shadowTint || [0.06, 0.16, 0.22];
        const hTint = gCfg.highlightTint || [1.08, 0.78, 0.46];

        this.gradeUniforms = {
          tDiffuse: { value: this.gradeTarget.texture },
          uTime: { value: 0.0 },
          uShadowTint: { value: new THREE.Vector3(sTint[0], sTint[1], sTint[2]) },
          uHighlightTint: { value: new THREE.Vector3(hTint[0], hTint[1], hTint[2]) },
          uSaturation: { value: typeof gCfg.saturation === 'number' ? gCfg.saturation : 0.80 },
          uContrast: { value: typeof gCfg.contrast === 'number' ? gCfg.contrast : 1.14 },
          uBlackLift: { value: typeof gCfg.blackLift === 'number' ? gCfg.blackLift : 0.022 },
          uVignette: { value: typeof gCfg.vignette === 'number' ? gCfg.vignette : 0.46 },
          uGrain: { value: typeof gCfg.grain === 'number' ? gCfg.grain : 0.04 },
          uEdgeDesat: { value: typeof gCfg.edgeDesat === 'number' ? gCfg.edgeDesat : 0.28 },
          uStylized: { value: this.stylizedMode ? 1.0 : 0.0 },
          uResolution: { value: new THREE.Vector2(rtW, rtH) },
        };

        this.gradeMat = new THREE.ShaderMaterial({
          uniforms: this.gradeUniforms,
          depthTest: false,
          depthWrite: false,
          vertexShader: [
            'varying vec2 vUv;',
            'void main() {',
            '  vUv = uv;',
            '  gl_Position = vec4(position.xy, 0.0, 1.0);',
            '}'
          ].join('\\n'),
          fragmentShader: [
            'precision highp float;',
            'uniform sampler2D tDiffuse;',
            'uniform float uTime;',
            'uniform vec3 uShadowTint;',
            'uniform vec3 uHighlightTint;',
            'uniform float uSaturation;',
            'uniform float uContrast;',
            'uniform float uBlackLift;',
            'uniform float uVignette;',
            'uniform float uGrain;',
            'uniform float uEdgeDesat;',
            'uniform float uStylized;',
            'uniform vec2 uResolution;',
            'varying vec2 vUv;',
            '',
            'float hash12(vec2 p) {',
            '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
            '  p3 += dot(p3, p3.yzx + 33.33);',
            '  return fract((p3.x + p3.y) * p3.z);',
            '}',
            '',
            'void main() {',
            '  vec3 col = texture2D(tDiffuse, vUv).rgb;',
            '',
            '  // 1. Luminance & Edge-aware desaturation (midtones ~0.8, further desaturated toward edges)',
            '  vec2 centered = vUv - 0.5;',
            '  float edgeDistSq = dot(centered, centered) * 2.4;',
            '  float luma = dot(col, vec3(0.299, 0.587, 0.114));',
            '  float localSat = max(0.0, uSaturation * (1.0 - edgeDistSq * uEdgeDesat));',
            '  col = mix(vec3(luma), col, localSat);',
            '',
            '  // 2. Split-Tone: Shadows tinted teal-blue, Highlights tinted warm orange (#ff8a2a)',
            '  float shadowWeight = pow(clamp(1.0 - luma, 0.0, 1.0), 1.55);',
            '  float highlightWeight = pow(clamp(luma, 0.0, 1.0), 1.35);',
            '  col += uShadowTint * shadowWeight * 0.42;',
            '  col *= mix(vec3(1.0), uHighlightTint, highlightWeight * 0.55);',
            '',
            '  // 3. Gentle S-curve contrast + lifted blacks (never crushed)',
            '  vec3 sCurve = smoothstep(0.0, 1.0, col);',
            '  col = mix(col, sCurve, clamp((uContrast - 1.0) * 1.8, 0.0, 0.65));',
            '  col = col * (1.0 - uBlackLift) + vec3(uBlackLift);',
            '',
            '  // 4. Optional PS1 Stylized Quantization & Ordered Dither',
            '  if (uStylized > 0.5) {',
            '    vec2 pix = floor(vUv * uResolution);',
            '    float bayer = mod(pix.x * 3.0 + pix.y * 5.0, 8.0) / 8.0 - 0.5;',
            '    col = floor((col + bayer * 0.035) * 24.0) / 24.0;',
            '  }',
            '',
            '  // 5. Animated Film Grain (~0.04)',
            '  float noise = (hash12(vUv * uResolution + vec2(uTime * 61.7, uTime * 37.3)) - 0.5) * 2.0;',
            '  col += noise * uGrain * (0.45 + 0.55 * (1.0 - luma));',
            '',
            '  // 6. Smooth Radial Vignette',
            '  float vig = clamp(1.0 - edgeDistSq * uVignette, 0.12, 1.0);',
            '  col *= vig;',
            '',
            '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
            '}'
          ].join('\\n'),
        });

        this.gradeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.gradeMat);
        this.gradeScene.add(this.gradeQuad);
        this.updateCssFallbackVisibility();
      }

      isColorGradePassActive() {
        const presetAllows = !!(activePreset && activePreset.enableColorGrade);
        return (presetAllows || this.stylizedMode) && this.gradeEnabledByConfig && !this.gradeAutoDisabledByFps && this.gradeDevToggle;
      }

      updateCssFallbackVisibility() {
        const active = this.isColorGradePassActive();
        const fallbackEl = document.getElementById('fast-css-grade-fallback');
        const vigEl = document.getElementById('cinematic-vignette');
        if (fallbackEl) {
          fallbackEl.style.display = active ? 'none' : 'block';
        }
        if (vigEl) {
          vigEl.style.display = active ? 'none' : 'block';
        }
      }

      resizeGradeTarget(w, h) {
        const pr = this.getEffectivePixelRatio(activePreset);
        this.renderer.setPixelRatio(pr);
        this.renderer.setSize(w, h);
        if (this.gradeTarget) {
          const rtW = Math.max(160, Math.floor(w * pr));
          const rtH = Math.max(120, Math.floor(h * pr));
          this.gradeTarget.setSize(rtW, rtH);
          if (this.gradeUniforms && this.gradeUniforms.uResolution) {
            this.gradeUniforms.uResolution.value.set(rtW, rtH);
          }
        }
      }

      renderFrame(timeSec) {
        if (this.renderer.info && typeof this.renderer.info.reset === 'function') {
          this.renderer.info.reset();
        }
        if (this.isColorGradePassActive() && this.gradeTarget && typeof this.renderer.setRenderTarget === "function") {
          try {
            this.gradeUniforms.uTime.value = timeSec;
            this.renderer.setRenderTarget(this.gradeTarget);
            this.renderer.render(this.scene, this.camera);
            this.renderer.setRenderTarget(null);
            this.renderer.render(this.gradeScene, this.gradeOrthoCam);
          } catch (gradeErr) {
            console.warn('[HideAndSeek] Grade pass failed, disabling and falling back to direct render:', gradeErr);
            this.gradeEnabledByConfig = false;
            this.updateCssFallbackVisibility();
            if (this.renderer.setRenderTarget) this.renderer.setRenderTarget(null);
            this.renderer.render(this.scene, this.camera);
          }
        } else {
          if (this.renderer.setRenderTarget) this.renderer.setRenderTarget(null);
          this.renderer.render(this.scene, this.camera);
        }
        this.lastTotalDrawCalls = (this.renderer.info && this.renderer.info.render) ? (this.renderer.info.render.calls || 0) : 0;
      }

      buildCloudyMoonlitSkyDome() {
        if (this.skyGroup) {
          this.scene.remove(this.skyGroup);
        }
        this.skyGroup = new THREE.Group();

        const skyCanvas = document.createElement('canvas');
        skyCanvas.width = 512;
        skyCanvas.height = 256;
        const sCtx = skyCanvas.getContext('2d');

        const grad = sCtx.createLinearGradient(0, 0, 0, 256);
        grad.addColorStop(0.0, '#060c18');
        grad.addColorStop(0.35, '#0b1626');
        grad.addColorStop(0.65, '#132338');
        grad.addColorStop(0.85, '#1b3248');
        grad.addColorStop(1.0, '#162738');
        sCtx.fillStyle = grad;
        sCtx.fillRect(0, 0, 512, 256);

        const moonGlow = sCtx.createRadialGradient(340, 74, 4, 340, 74, 110);
        moonGlow.addColorStop(0.0, 'rgba(215, 235, 248, 0.75)');
        moonGlow.addColorStop(0.20, 'rgba(140, 180, 210, 0.42)');
        moonGlow.addColorStop(0.55, 'rgba(60, 100, 130, 0.18)');
        moonGlow.addColorStop(1.0, 'rgba(16, 32, 48, 0.0)');
        sCtx.fillStyle = moonGlow;
        sCtx.fillRect(0, 0, 512, 256);

        sCtx.fillStyle = 'rgba(240, 248, 255, 0.92)';
        sCtx.beginPath();
        sCtx.arc(340, 74, 11, 0, Math.PI * 2);
        sCtx.fill();

        [68, 92].forEach((bandY, bIdx) => {
          const bandGrad = sCtx.createLinearGradient(0, bandY - 12, 0, bandY + 12);
          bandGrad.addColorStop(0.0, 'rgba(14, 28, 36, 0.0)');
          bandGrad.addColorStop(0.5, bIdx === 0 ? 'rgba(64, 96, 110, 0.16)' : 'rgba(38, 62, 74, 0.14)');
          bandGrad.addColorStop(1.0, 'rgba(14, 28, 36, 0.0)');
          sCtx.fillStyle = bandGrad;
          sCtx.fillRect(0, bandY - 12, 512, 24);
        });

        const skyTex = new THREE.CanvasTexture(skyCanvas);
        const skySphere = new THREE.Mesh(
          new THREE.SphereGeometry(116, 20, 14),
          new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
        );
        this.skyGroup.add(skySphere);

        const ridgeConfigs = [
          { radius: 110, height: 34, color: 0x142533, opacity: 0.82, seed: 1.1, freq1: 5, freq2: 11 },
          { radius: 101, height: 24, color: 0x101f2b, opacity: 0.88, seed: 2.7, freq1: 7, freq2: 13 },
          { radius: 92,  height: 15, color: 0x0c1720, opacity: 0.94, seed: 4.3, freq1: 9, freq2: 17 },
        ];

        ridgeConfigs.forEach(rc => {
          const rGeo = new THREE.CylinderGeometry(rc.radius, rc.radius, rc.height, 48, 1, true);
          const posAttr = rGeo.attributes.position;
          for (let i = 0; i < posAttr.count; i++) {
            const vy = posAttr.getY(i);
            if (vy > 0) {
              const vx = posAttr.getX(i);
              const vz = posAttr.getZ(i);
              const ang = Math.atan2(vx, vz);
              const peakWave =
                Math.sin(ang * rc.freq1 + rc.seed) * 0.34 +
                Math.cos(ang * rc.freq2 - rc.seed) * 0.18 +
                Math.sin(ang * 3.0) * 0.22;
              posAttr.setY(i, (rc.height * 0.5) * (0.65 + peakWave));
            } else {
              posAttr.setY(i, -4.0);
            }
          }
          rGeo.computeVertexNormals();
          const rMat = new THREE.MeshBasicMaterial({
            color: rc.color,
            transparent: true,
            opacity: rc.opacity,
            side: THREE.BackSide,
            fog: false,
          });
          const rMesh = new THREE.Mesh(rGeo, rMat);
          rMesh.position.y = rc.height * 0.32;
          this.skyGroup.add(rMesh);
        });

        this.scene.add(this.skyGroup);
      }

      setShadowsOnly(enabled) {
        const shadowsOn = !!enabled;
        this.shadowsDebugOverride = shadowsOn;
        this.renderer.shadowMap.enabled = shadowsOn;
        if (this.moonDirLight) this.moonDirLight.castShadow = shadowsOn;
        if (this.flashlight) this.flashlight.castShadow = shadowsOn;
        this.scene.traverse(obj => {
          if ((obj.isMesh || obj.isInstancedMesh) && obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(m => { m.needsUpdate = true; });
            else obj.material.needsUpdate = true;
          }
        });
        const btn = document.getElementById('dbg-btn-shadows');
        if (btn) {
          btn.textContent = shadowsOn ? 'Shadows: ON' : 'Shadows: OFF';
          btn.classList.toggle('active', shadowsOn);
        }
        return shadowsOn;
      }

      toggleShadowsOnly() {
        const cur = this.renderer.shadowMap.enabled;
        return this.setShadowsOnly(!cur);
      }

      applyQuality(preset) {
        const w = Math.max(window.innerWidth || 0, 320);
        const h = Math.max(window.innerHeight || 0, 240);
        this.resizeGradeTarget(w, h);
        const shadowsOn = (this.shadowsDebugOverride !== null && this.shadowsDebugOverride !== undefined)
          ? this.shadowsDebugOverride
          : !!(preset && preset.enableShadows);
        this.renderer.shadowMap.enabled = shadowsOn;
        if (this.moonDirLight) this.moonDirLight.castShadow = shadowsOn;
        if (this.flashlight) this.flashlight.castShadow = shadowsOn;
        // Keep FAST and LOW looking clean and readable when ULTRA post-grade pass is off
        const baseExp = (HORROR_CONFIG.renderer && HORROR_CONFIG.renderer.toneMappingExposure) || 1.15;
        this.renderer.toneMappingExposure = (preset && preset.enableColorGrade) ? baseExp : (baseExp * 1.07);
        const btn = document.getElementById('dbg-btn-shadows');
        if (btn) {
          btn.textContent = shadowsOn ? 'Shadows: ON' : 'Shadows: OFF';
          btn.classList.toggle('active', shadowsOn);
        }
        if (!this.skyGroup) this.buildCloudyMoonlitSkyDome();
        this.updateCssFallbackVisibility();
      }

      dispose() {
        if (this.gradeTarget) this.gradeTarget.dispose();
        this.scene.traverse(obj => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
            else obj.material.dispose();
          }
        });
        this.renderer.dispose();
      }
    }

    /* =========================================================================
       MODULE 2: LampFlicker — ORNAMENTAL CAST-IRON WARM LANTERN POLES & WALL SCONCES
       Phase A Optimized:
       - InstancedMesh for all 16 Streetlamp Iron Posts & Glass Lanterns (2 draw calls total!)
       - Shared 4-Profile Material Pool (eliminates 105 duplicate per-lamp materials)
       - Strict Dynamic Light Budget: At most 3 pooled PointLights (castShadow = false)
       ========================================================================= */
    class LampFlicker {
      constructor(scene, sharedGeos, materials) {
        this.scene = scene;
        this.sharedGeos = sharedGeos;
        this.materials = materials;
        this.lamps = [];
        this.allVisualLamps = this.lamps;
        this.lightPool = [];
        this.indoorOverrideLight = null;
        this.nearestLampDist = 999;
        this._dummy = new THREE.Object3D();
        this._streetLampCount = 0;

        const poolDiam = HORROR_CONFIG.lighting.lampPoolSize || 6.0;
        this.sharedPoolGeo = new THREE.PlaneGeometry(poolDiam, poolDiam);
        this.sconceBracketGeo = new THREE.BoxGeometry(0.14, 0.24, 0.28);
        this.sconceLanternGeo = new THREE.BoxGeometry(0.24, 0.34, 0.24);

        // Pre-merge all 10 cast-iron parts of a streetlamp into 1 single BufferGeometry for InstancedMesh
        const lanternY = 4.82;
        const ironPartSpecs = [
          { geo: sharedGeos.lampPlinth, x: 0, y: 0.22, z: 0, ry: 0 },
          { geo: sharedGeos.lampBase, x: 0, y: 0.72, z: 0, ry: 0 },
          { geo: sharedGeos.lampCollar, x: 0, y: 1.18, z: 0, ry: 0 },
          { geo: sharedGeos.lampPole, x: 0, y: 2.85, z: 0, ry: 0 },
          { geo: sharedGeos.lampCollar, x: 0, y: 4.42, z: 0, ry: 0 },
          { geo: sharedGeos.lanternBottomTray, x: 0, y: lanternY - 0.34, z: 0, ry: 0 },
          { geo: sharedGeos.lanternCornerRib, x: -0.21, y: lanternY, z: -0.21, ry: 0 },
          { geo: sharedGeos.lanternCornerRib, x: 0.21, y: lanternY, z: -0.21, ry: 0 },
          { geo: sharedGeos.lanternCornerRib, x: -0.21, y: lanternY, z: 0.21, ry: 0 },
          { geo: sharedGeos.lanternCornerRib, x: 0.21, y: lanternY, z: 0.21, ry: 0 },
          { geo: sharedGeos.lanternRoofCap, x: 0, y: lanternY + 0.42, z: 0, ry: Math.PI / 4 },
          { geo: sharedGeos.lanternFinial, x: 0, y: lanternY + 0.68, z: 0, ry: 0 },
        ];
        const ironGeos = ironPartSpecs.map(sp => {
          const g = sp.geo.clone();
          this._dummy.position.set(sp.x, sp.y, sp.z);
          this._dummy.rotation.set(0, sp.ry, 0);
          this._dummy.scale.set(1, 1, 1);
          this._dummy.updateMatrix();
          g.applyMatrix4(this._dummy.matrix);
          return g;
        });
        this.mergedLampIronGeo = THREE.BufferGeometryUtils.mergeBufferGeometries(ironGeos);
        this.instLampPosts = new THREE.InstancedMesh(this.mergedLampIronGeo, materials.castIronDark, 16);
        this.instLampPosts.count = 0;
        this.instLampPosts.castShadow = true;
        this.instLampPosts.receiveShadow = true;
        this.instLampPosts.frustumCulled = true;
        scene.add(this.instLampPosts);

        // Shared material sets by blinkProfile (4 sets instead of 21*5=105 materials!)
        this.profileMats = {};
        ['steady_warm', 'intermittent', 'heavy_blink', 'dead'].forEach(prof => {
          const isDead = prof === 'dead';
          this.profileMats[prof] = {
            bulbMat: new THREE.MeshBasicMaterial({
              map: lanternGlassTex,
              color: isDead ? 0x1e242b : (HORROR_CONFIG.lighting.lampCoreColor || 0xffe8c2),
              transparent: true,
              opacity: isDead ? 0.15 : 0.85,
            }),
            innerGlowMat: new THREE.SpriteMaterial({
              map: warmLampBloomTex,
              color: HORROR_CONFIG.lighting.lampCoreColor || 0xffe8c2,
              transparent: true,
              opacity: isDead ? 0.0 : 0.62,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
            outerGlareMat: new THREE.SpriteMaterial({
              map: warmLampBloomTex,
              color: HORROR_CONFIG.lighting.lampColor || 0xffb35c,
              transparent: true,
              opacity: isDead ? 0.0 : 0.34,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
            coneMat: new THREE.MeshBasicMaterial({
              map: volumetricConeTex,
              color: HORROR_CONFIG.lighting.lampColor || 0xffb35c,
              transparent: true,
              opacity: isDead ? 0.0 : (HORROR_CONFIG.lighting.lampConeOpacity || 0.065),
              blending: THREE.AdditiveBlending,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
            puddleMat: new THREE.MeshBasicMaterial({
              map: realisticGroundPoolTex,
              color: HORROR_CONFIG.lighting.lampColor || 0xffb35c,
              transparent: true,
              opacity: isDead ? 0.0 : 0.24,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
          };
        });

        // Phase A Requirement 4: Limit dynamic lights to flashlight + at most 3 nearby PointLights!
        for (let i = 0; i < 3; i++) {
          const pl = new THREE.PointLight(
            HORROR_CONFIG.lighting.lampColor || 0xffb35c,
            0,
            HORROR_CONFIG.lighting.lampDistance || 11.0,
            HORROR_CONFIG.lighting.lampDecay || 2.0
          );
          pl.castShadow = false;
          pl.visible = true;
          pl.position.set(0, -9999, 0);
          scene.add(pl);
          this.lightPool.push(pl);
        }
      }

      addLamp(x, z, armDir = 1, blinkProfile = 'steady_warm') {
        const group = new THREE.Group();
        group.userData.noMerge = true;
        const lampIdx = this.lamps.length;
        const lanternY = 4.82;
        const pMats = this.profileMats[blinkProfile] || this.profileMats.steady_warm;

        // Add static cast-iron post to InstancedMesh (1 draw call for all 16 lamps!)
        if (this._streetLampCount < 16) {
          this._dummy.position.set(x, 0, z);
          this._dummy.rotation.set(0, 0, 0);
          this._dummy.scale.set(1, 1, 1);
          this._dummy.updateMatrix();
          this.instLampPosts.setMatrixAt(this._streetLampCount, this._dummy.matrix);
          this._streetLampCount++;
          this.instLampPosts.count = this._streetLampCount;
          this.instLampPosts.instanceMatrix.needsUpdate = true;
          computeInstancedBoundingSphere(this.instLampPosts, this._streetLampCount);
        }

        const lanternGlass = new THREE.Mesh(this.sharedGeos.lanternGlassBody, pMats.bulbMat);
        lanternGlass.position.y = lanternY;
        lanternGlass.userData.noMerge = true;
        group.add(lanternGlass);

        const bulbPos = new THREE.Vector3(x, lanternY, z);

        const innerGlow = new THREE.Sprite(pMats.innerGlowMat);
        innerGlow.position.set(0, lanternY, 0);
        innerGlow.scale.set(1.45, 1.45, 1);
        group.add(innerGlow);

        const haloScale = HORROR_CONFIG.lighting.lampHaloScale || 2.45;
        const outerGlare = new THREE.Sprite(pMats.outerGlareMat);
        outerGlare.position.set(0, lanternY, 0);
        outerGlare.scale.set(haloScale, haloScale, 1);
        group.add(outerGlare);

        const coneMesh = new THREE.Mesh(this.sharedGeos.lampCone, pMats.coneMat);
        coneMesh.position.set(0, 2.35, 0);
        coneMesh.userData.noMerge = true;
        coneMesh.visible = !!(activePreset && activePreset.enableLampCones && blinkProfile !== 'dead');
        group.add(coneMesh);

        const puddle = new THREE.Mesh(this.sharedPoolGeo, pMats.puddleMat);
        puddle.rotation.x = -Math.PI / 2;
        puddle.position.set(x, 0.032, z);
        puddle.userData.noMerge = true;
        this.scene.add(puddle);

        group.position.set(x, 0, z);
        this.scene.add(group);

        const seed = Math.abs(x * 1.9 + z * 2.7);
        this.lamps.push({
          idx: lampIdx,
          isWallSconce: false,
          x,
          z,
          group,
          bulbPos,
          blinkProfile,
          bulbMat: pMats.bulbMat,
          innerGlowMat: pMats.innerGlowMat,
          outerGlareMat: pMats.outerGlareMat,
          coneMat: pMats.coneMat,
          coneMesh,
          puddleMat: pMats.puddleMat,
          puddleMesh: puddle,
          baseIntensity: HORROR_CONFIG.lighting.lampIntensity || 16.5,
          currentIntensity: HORROR_CONFIG.lighting.lampIntensity || 16.5,
          seed,
          blinkState: 'steady',
          stateTimer: 2.8 + (seed % 4.5),
          stutterClock: 0,
        });
        if (typeof addColliderCylinder === 'function') {
          addColliderCylinder(x, z, 0.22, 0, 4.2);
        }
      }

      addWallSconce(x, y, z, blinkProfile = 'steady_warm') {
        const sGroup = new THREE.Group();
        sGroup.userData.noMerge = true;
        sGroup.position.set(x, y, z);
        const lampIdx = this.lamps.length;
        const pMats = this.profileMats[blinkProfile] || this.profileMats.steady_warm;

        const bracket = new THREE.Mesh(this.sconceBracketGeo, this.materials.castIronDark);
        bracket.userData.noMerge = true;
        sGroup.add(bracket);

        const lantern = new THREE.Mesh(this.sconceLanternGeo, pMats.bulbMat);
        lantern.position.set(0, 0.16, 0.14);
        lantern.userData.noMerge = true;
        sGroup.add(lantern);

        const innerGlow = new THREE.Sprite(pMats.innerGlowMat);
        innerGlow.position.set(0, 0.16, 0.18);
        innerGlow.scale.set(1.15, 1.15, 1);
        sGroup.add(innerGlow);

        const outerGlare = new THREE.Sprite(pMats.outerGlareMat);
        outerGlare.position.set(0, 0.16, 0.18);
        outerGlare.scale.set(1.9, 1.9, 1);
        sGroup.add(outerGlare);

        const puddle = new THREE.Mesh(this.sharedPoolGeo, pMats.puddleMat);
        puddle.rotation.x = -Math.PI / 2;
        puddle.position.set(x, 0.032, z);
        puddle.userData.noMerge = true;
        this.scene.add(puddle);

        this.scene.add(sGroup);

        const seed = Math.abs(x * 2.3 + z * 3.1);
        this.lamps.push({
          idx: lampIdx,
          isWallSconce: true,
          x,
          z,
          group: sGroup,
          bulbPos: new THREE.Vector3(x, y + 0.16, z),
          blinkProfile,
          bulbMat: pMats.bulbMat,
          innerGlowMat: pMats.innerGlowMat,
          outerGlareMat: pMats.outerGlareMat,
          coneMat: pMats.coneMat,
          coneMesh: null,
          puddleMat: pMats.puddleMat,
          puddleMesh: puddle,
          baseIntensity: (HORROR_CONFIG.lighting.lampIntensity || 16.5) * 0.82,
          currentIntensity: (HORROR_CONFIG.lighting.lampIntensity || 16.5) * 0.82,
          seed,
          blinkState: 'steady',
          stateTimer: 3.5 + (seed % 5.0),
          stutterClock: 0,
        });
      }

      triggerPowerDip(duration = 0.42) {
        for (let i = 0; i < this.lamps.length; i++) {
          const l = this.lamps[i];
          if (l.blinkProfile !== 'dead') {
            l.blinkState = 'power_dip';
            l.stateTimer = duration;
          }
        }
      }

      applyQuality(preset) {
        const showCones = !!(preset && preset.enableLampCones);
        const stride = (preset && preset.fakePoolStride) || 1;
        for (let i = 0; i < this.lamps.length; i++) {
          const l = this.lamps[i];
          const isDead = l.blinkProfile === 'dead';
          if (l.coneMesh) {
            l.coneMesh.visible = showCones && !isDead;
          }
          if (l.puddleMesh) {
            l.puddleMesh.visible = !isDead && (stride === 1 || i % stride === 0);
          }
        }
      }

      setVisualState(lamp, factor) {
        lamp.currentIntensity = lamp.baseIntensity * factor;
        lamp.bulbMat.opacity = Math.max(0.08, 0.88 * factor);
        lamp.coneMat.opacity = (HORROR_CONFIG.lighting.lampConeOpacity || 0.065) * factor;
        lamp.innerGlowMat.opacity = Math.min(1.0, 0.62 * factor);
        lamp.outerGlareMat.opacity = 0.34 * Math.pow(factor, 0.85);
        lamp.puddleMat.opacity = ((HORROR_CONFIG.grade && HORROR_CONFIG.grade.poolOpacity) || 0.24) * factor;

        if (factor > 0.65) {
          lamp.bulbMat.color.setHex(HORROR_CONFIG.lighting.lampCoreColor || 0xffe8c2);
        } else if (factor > 0.20) {
          lamp.bulbMat.color.setHex(HORROR_CONFIG.lighting.lampColor || 0xffb35c);
        } else {
          lamp.bulbMat.color.setHex(0x1e242b);
        }
      }

      update(delta, timeSec, playerPos) {
        let minActiveDistSq = 999999;
        const maxCullDist = (activePreset && activePreset.cullDistProps) || 50;
        const maxCullDistSq = maxCullDist * maxCullDist;
        const shaftsAllowed = (typeof exploreTools === 'undefined' || exploreTools.lightShaftsEnabled !== false);
        const showCones = !!(activePreset && activePreset.enableLampCones) && shaftsAllowed;
        const stride = (activePreset && activePreset.fakePoolStride) || 1;
        const allowStrobing = !!EXPLORE_FLAGS.ENABLE_STROBING_AND_BROWNOUTS;

        for (let i = 0; i < this.lamps.length; i++) {
          const l = this.lamps[i];
          const dSq = (l.x - playerPos.x) ** 2 + (l.z - playerPos.z) ** 2;
          const inRange = dSq <= maxCullDistSq;
          if (l.group) l.group.visible = inRange;
          if (l.puddleMesh) {
            l.puddleMesh.visible = inRange && l.blinkProfile !== 'dead' && (stride === 1 || i % stride === 0);
          }
          if (l.coneMesh) {
            l.coneMesh.visible = inRange && showCones && l.blinkProfile !== 'dead' && dSq <= 1225;
          }

          l.stateTimer -= delta;
          let factor = 1.0;

          const safeFlicker = !!(accessibilitySettings && accessibilitySettings.flickerReduction);
          if (l.blinkProfile === 'dead') {
            factor = 0.0;
          } else if (!allowStrobing) {
            factor = 0.96 + Math.sin(timeSec * 1.8 + l.seed) * 0.03;
            l.blinkState = 'steady';
          } else if (l.blinkState === 'power_dip') {
            factor = safeFlicker
              ? (0.76 + Math.sin(timeSec * 9.5 + l.seed) * 0.06)
              : (0.22 + Math.sin(timeSec * 38.0 + l.seed) * 0.08);
            if (l.stateTimer <= 0) {
              l.blinkState = 'recover';
              l.stateTimer = 0.22;
            }
          } else if (l.blinkState === 'steady') {
            factor = 0.92 + Math.sin(timeSec * 2.4 + l.seed) * 0.05;
            if (l.stateTimer <= 0) {
              if (l.blinkProfile === 'steady_warm') {
                l.stateTimer = 4.0 + Math.random() * 5.0;
              } else {
                l.blinkState = Math.random() < 0.72 ? 'stutter' : 'brownout';
                l.stateTimer = l.blinkState === 'stutter'
                  ? (0.28 + Math.random() * 0.45)
                  : (0.45 + Math.random() * 0.65);
              }
            }
          } else if (l.blinkState === 'stutter') {
            if (safeFlicker) {
              // <= 2 flashes/sec (omega <= 12.56 rad/s) & smaller swing
              factor = 0.78 + Math.sin(timeSec * 10.5 + l.seed) * 0.10;
            } else {
              const wave = Math.sin(timeSec * 52.0 + l.seed * 3.1) + Math.cos(timeSec * 33.0 + l.seed);
              factor = wave > 0.15 ? 0.95 : (l.blinkProfile === 'heavy_blink' ? 0.06 : 0.24);
            }
            if (Math.random() < 0.025) soundEngine.playLampBuzz();
            if (l.stateTimer <= 0) {
              l.blinkState = 'recover';
              l.stateTimer = 0.18;
            }
          } else if (l.blinkState === 'brownout') {
            factor = safeFlicker
              ? (0.74 + Math.sin(timeSec * 8.5 + l.seed) * 0.05)
              : (0.22 + Math.sin(timeSec * 24.0 + l.seed) * 0.06);
            if (l.stateTimer <= 0) {
              l.blinkState = 'recover';
              l.stateTimer = 0.20;
            }
          } else if (l.blinkState === 'recover') {
            factor = 1.0;
            if (l.stateTimer <= 0) {
              l.blinkState = 'steady';
              const baseWait = l.blinkProfile === 'heavy_blink' ? 2.4 : 4.5;
              l.stateTimer = baseWait + Math.random() * 4.0;
            }
          }

          this.setVisualState(l, factor);
          l._lastDistSq = dSq;

          if (factor > 0.1) {
            if (dSq < minActiveDistSq) minActiveDistSq = dSq;
          }
        }

        this.nearestLampDist = Math.sqrt(minActiveDistSq);

        // Zero per-frame allocation selection of top 3 nearest active lamps
        let best0 = null, best1 = null, best2 = null;
        let d0 = Infinity, d1 = Infinity, d2 = Infinity;
        for (let i = 0; i < this.lamps.length; i++) {
          const l = this.lamps[i];
          if (l.blinkProfile === 'dead' || l.currentIntensity <= 0.5) continue;
          const distSq = l._lastDistSq;
          if (distSq < d0) {
            d2 = d1; best2 = best1;
            d1 = d0; best1 = best0;
            d0 = distSq; best0 = l;
          } else if (distSq < d1) {
            d2 = d1; best2 = best1;
            d1 = distSq; best1 = l;
          } else if (distSq < d2) {
            d2 = distSq; best2 = l;
          }
        }

        const activeCount = Math.min(this.lightPool.length, activePreset.maxActiveLampLights || 3);
        const ov = this.indoorOverrideLight;
        let pickIdx = 0;
        for (let i = 0; i < this.lightPool.length; i++) {
          const pl = this.lightPool[i];
          if (i === 0 && ov && ov.intensity > 0.01) {
            pl.color.setHex(ov.color || 0xb4f0e4);
            pl.position.set(ov.x, ov.y, ov.z);
            pl.distance = ov.distance || 10.5;
            pl.intensity = ov.intensity;
          } else if (i < activeCount) {
            const chosenLamp = pickIdx === 0 ? best0 : (pickIdx === 1 ? best1 : best2);
            pickIdx++;
            if (chosenLamp) {
              pl.color.setHex(HORROR_CONFIG.lighting.lampColor || 0xff8a2a);
              pl.distance = HORROR_CONFIG.lighting.lampDistance || 16.5;
              pl.position.copy(chosenLamp.bulbPos);
              pl.intensity = chosenLamp.currentIntensity;
            } else {
              pl.intensity = 0;
              pl.position.set(0, -9999, 0);
            }
          } else {
            pl.intensity = 0;
            pl.position.set(0, -9999, 0);
          }
        }
      }
    }

    /* =========================================================================
       MODULE 3: ParticleField & Low Drifting Ground Mist Planes
       (Cool night mist motes + layered ground fog planes along the road, Ref 1)
       ========================================================================= */
    class ParticleField {
      constructor(scene) {
        // TASK 1: Slow drifting low-opacity mist/dust motes (NO bright floating sparkles!)
        this.maxParticles = 36;
        this.geo = new THREE.BufferGeometry();
        this.positions = new Float32Array(this.maxParticles * 3);
        this.colors = new Float32Array(this.maxParticles * 3);
        this.meta = [];

        for (let i = 0; i < this.maxParticles; i++) {
          this.positions[i * 3 + 0] = (Math.random() - 0.5) * 28;
          this.positions[i * 3 + 1] = 0.20 + Math.random() * 2.4;
          this.positions[i * 3 + 2] = -20 + (Math.random() - 0.5) * 28;

          // Muted sickly green-gray / slate dust color
          const r = 0.36, g = 0.42, b = 0.40;
          this.colors[i * 3 + 0] = r;
          this.colors[i * 3 + 1] = g;
          this.colors[i * 3 + 2] = b;

          this.meta.push({
            vx: 0.08 + Math.random() * 0.10,
            vy: (Math.random() - 0.5) * 0.02,
            vz: (Math.random() - 0.5) * 0.08,
            phase: Math.random() * Math.PI * 2,
            r, g, b,
          });
        }
        this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
        this.geo.setDrawRange(0, activePreset.particleCount);

        this.points = new THREE.Points(this.geo, new THREE.PointsMaterial({
          map: softRoundParticleTex,
          size: 0.58,
          sizeAttenuation: true,
          vertexColors: true,
          transparent: true,
          opacity: 0.16,
          blending: THREE.NormalBlending,
          depthWrite: false,
        }));
        this.points.frustumCulled = false;
        scene.add(this.points);

        // Low-lying drifting ground mist planes
        this.mistPlanes = [];
        const mistGeo = new THREE.PlaneGeometry(16, 16);
        const mistPositions = [
          [-2, -48], [1, -32], [2, -16], [3, 0], [4, 16], [5, 34],
        ];
        mistPositions.forEach(([mx, mz], idx) => {
          const mMat = new THREE.MeshBasicMaterial({
            map: groundMistTex,
            color: 0x5c6b64,
            transparent: true,
            opacity: 0.08,
            depthWrite: false,
            blending: THREE.NormalBlending,
          });
          const mMesh = new THREE.Mesh(mistGeo, mMat);
          mMesh.rotation.x = -Math.PI / 2;
          mMesh.position.set(mx, 0.14 + (idx % 3) * 0.06, mz);
          scene.add(mMesh);
          this.mistPlanes.push({ mesh: mMesh, baseX: mx, baseZ: mz, phase: idx * 1.3 });
        });
        this.windBoostTimer = 0;
      }

      applyQuality(preset) {
        this.geo.setDrawRange(0, preset.particleCount);
        this.mistPlanes.forEach((m, idx) => {
          m.mesh.visible = idx < (preset.mistPlaneCount || 4);
        });
      }

      boostWind(duration = 2.5) {
        this.windBoostTimer = duration;
      }

      update(delta, timeSec, playerPos) {
        const dustAllowed = (typeof exploreTools === 'undefined' || exploreTools.dustEnabled !== false);
        const fogAllowed = (typeof exploreTools === 'undefined' || exploreTools.fogEnabled !== false);
        if (this.points) this.points.visible = dustAllowed;
        const count = dustAllowed ? activePreset.particleCount : 0;
        const px = playerPos.x, pz = playerPos.z;
        let speedMult = 1.0;
        if (this.windBoostTimer > 0) {
          this.windBoostTimer -= delta;
          speedMult = 1.8;
        }

        for (let i = 0; i < count; i++) {
          const m = this.meta[i];
          const idx = i * 3;
          this.positions[idx + 0] += (m.vx * speedMult + Math.sin(timeSec * 0.4 + m.phase) * 0.06) * delta;
          this.positions[idx + 1] += m.vy * delta;
          this.positions[idx + 2] += (m.vz * speedMult + Math.cos(timeSec * 0.35 + m.phase) * 0.05) * delta;

          if (this.positions[idx + 1] < 0.15) this.positions[idx + 1] = 2.4;
          if (this.positions[idx + 1] > 2.6) this.positions[idx + 1] = 0.20;

          const dx = this.positions[idx + 0] - px;
          const dz = this.positions[idx + 2] - pz;
          if (dx > 14) this.positions[idx + 0] -= 28;
          else if (dx < -14) this.positions[idx + 0] += 28;
          if (dz > 14) this.positions[idx + 2] -= 28;
          else if (dz < -14) this.positions[idx + 2] += 28;
        }
        if (count > 0) {
          this.geo.attributes.position.needsUpdate = true;
        }

        const maxMist = (activePreset && activePreset.mistPlaneCount) || 4;
        for (let i = 0; i < this.mistPlanes.length; i++) {
          const mp = this.mistPlanes[i];
          mp.mesh.visible = fogAllowed && (i < maxMist);
          if (!mp.mesh.visible) continue;
          mp.mesh.position.x = mp.baseX + Math.sin(timeSec * 0.22 + mp.phase) * (1.2 * speedMult);
          mp.mesh.position.z = mp.baseZ + Math.cos(timeSec * 0.18 + mp.phase) * (1.1 * speedMult);
        }
      }
    }

    /* =========================================================================
       MODULE 4: RareSilhouetteManager — RARE FLEETING DISTANT NIGHT SILHOUETTES
       (Adds restrained campus horror: fleeting shadowy figures in distant mist)
       ========================================================================= */
    class RareSilhouetteManager {
      constructor(scene, materials) {
        this.scene = scene;
        this.materials = materials;
        this.timer = 28 + Math.random() * 22;
        this.activeDuration = 0;
        this.currentOpacity = 0;
        this.targetOpacity = 0;

        // Distant perimeter locations 35m - 55m from center
        this.spawnSpots = [
          { x: -34, y: 0, z: -58 },
          { x: 28, y: 0, z: -56 },
          { x: -36, y: 0, z: 18 },
          { x: 26, y: 0, z: 32 },
          { x: -6, y: 0, z: 68 },
        ];

        this.group = new THREE.Group();
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.35, 2.05, 8),
          materials.rareSilhouetteMat
        );
        body.position.y = 1.02;
        this.group.add(body);

        const cowl = new THREE.Mesh(
          new THREE.SphereGeometry(0.24, 8, 8),
          materials.rareSilhouetteMat
        );
        cowl.position.y = 2.15;
        this.group.add(cowl);

        const hem = new THREE.Mesh(
          new THREE.ConeGeometry(0.55, 1.4, 7, 1, true),
          materials.rareSilhouetteMat
        );
        hem.position.y = 0.7;
        this.group.add(hem);

        this.group.position.set(0, -999, 0);
        this.group.visible = false;
        scene.add(this.group);
      }

      update(delta, playerPos) {
        this.timer -= delta;
        if (this.timer <= 0 && this.activeDuration <= 0) {
          const validSpots = this.spawnSpots.filter(s => {
            const d = Math.hypot(s.x - playerPos.x, s.z - playerPos.z);
            return d >= 28 && d <= 56;
          });
          const chosen = (validSpots.length > 0)
            ? validSpots[Math.floor(Math.random() * validSpots.length)]
            : this.spawnSpots[Math.floor(Math.random() * this.spawnSpots.length)];

          this.group.position.set(chosen.x, chosen.y, chosen.z);
          this.group.lookAt(playerPos.x, chosen.y, playerPos.z);
          this.group.visible = true;
          this.activeDuration = 4.2;
          this.targetOpacity = 0.72;
          this.timer = 45 + Math.random() * 35;
        }

        if (this.activeDuration > 0) {
          this.activeDuration -= delta;
          const distToPlayer = Math.hypot(this.group.position.x - playerPos.x, this.group.position.z - playerPos.z);
          if (distToPlayer < 20 || this.activeDuration <= 1.2) {
            this.targetOpacity = 0.0;
          }
          if (this.activeDuration <= 0) {
            this.group.visible = false;
            this.group.position.set(0, -999, 0);
          }
        } else {
          this.targetOpacity = 0.0;
        }

        const rate = (this.targetOpacity > this.currentOpacity) ? 1.5 : 2.5;
        this.currentOpacity += (this.targetOpacity - this.currentOpacity) * Math.min(1.0, rate * delta);
        this.materials.rareSilhouetteMat.opacity = this.currentOpacity;
      }
    }

    /* =========================================================================
       SCENE INITIALIZATION & HIGH-DETAIL PROCEDURAL PBR TEXTURES
       ========================================================================= */
    const canvas = document.getElementById('game-canvas');
    const atmosphere = new NightAtmosphere(canvas);
    const scene = atmosphere.scene;
    const camera = atmosphere.camera;
    const renderer = atmosphere.renderer;

    const _noopGrad = { addColorStop() {} };
    const _noopCtx = {
      fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
      fillRect() {}, strokeRect() {}, clearRect() {}, beginPath() {}, closePath() {},
      moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arc() {}, ellipse() {},
      fill() {}, stroke() {}, fillText() {}, createLinearGradient() { return _noopGrad; },
      createRadialGradient() { return _noopGrad; }
    };

    function createProceduralTexture(width, height, drawFn, cacheKey) {
      const key = cacheKey || ('proc:' + width + 'x' + height + ':' + (drawFn ? drawFn.toString().length : 0));
      if (cacheKey && window.__PROCEDURAL_TEX_CACHE__.has(key)) {
        return window.__PROCEDURAL_TEX_CACHE__.get(key);
      }
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const ctx = c.getContext('2d');
      if (ctx && typeof drawFn === 'function') {
        drawFn(ctx);
      }
      const tex = new THREE.CanvasTexture(c);
      if (cacheKey) window.__PROCEDURAL_TEX_CACHE__.set(key, tex);
      return tex;
    }

    function createProceduralTextureWithBump(type) {
      if (window.__PROCEDURAL_TEX_CACHE__.has(type)) {
        return window.__PROCEDURAL_TEX_CACHE__.get(type);
      }
      const dedicatedBumpTypes = {
        'scuffed-classroom-floor': true,
        'stained-ceiling-tiles': true,
        'peeling-paint-wall': true,
        'worn-wood-grain': true,
      };
      const needsBumpCanvas = !!dedicatedBumpTypes[type] || !window.__sharedArchBumpTex;
      const needsRoughCanvas = !window.__sharedArchRoughTex;

      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 512;
      const ctx = c.getContext('2d');

      let bumpC = null;
      let bCtx = _noopCtx;
      if (needsBumpCanvas) {
        bumpC = document.createElement('canvas');
        bumpC.width = 512;
        bumpC.height = 512;
        bCtx = bumpC.getContext('2d') || _noopCtx;
      }

      let roughC = null;
      let rCtx = _noopCtx;
      if (needsRoughCanvas) {
        roughC = document.createElement('canvas');
        roughC.width = 512;
        roughC.height = 512;
        rCtx = roughC.getContext('2d') || _noopCtx;
        rCtx.fillStyle = '#a0a0a0';
        rCtx.fillRect(0, 0, 512, 512);
      }

      const runProceduralDraw = () => {

      if (type === 'nepali-river-stone') {
        ctx.fillStyle = '#1b2028';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#08090c';
        bCtx.fillRect(0, 0, 512, 512);

        const riverColors = ['#3b4758', '#4f5d70', '#484542', '#3a3634', '#5c5855', '#2d3748'];
        for (let y = 14; y < 512; y += 34) {
          const rowOffset = ((y / 34) % 2) * 26;
          for (let x = -26; x < 512 + 26; x += 52) {
            const sx = x + rowOffset + ((x * 7 + y * 11) % 10) - 5;
            const sy = y + ((x * 13 + y * 7) % 8) - 4;
            const rx = 20 + ((x * 19) % 8);
            const ry = 13 + ((y * 17) % 6);
            ctx.fillStyle = riverColors[Math.abs(Math.floor(x * 3 + y * 7)) % riverColors.length];
            ctx.beginPath();
            ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#0f1318';
            ctx.lineWidth = 3;
            ctx.stroke();

            bCtx.fillStyle = '#d8e0e8';
            bCtx.beginPath();
            bCtx.ellipse(sx, sy, rx - 1.5, ry - 1.5, 0, 0, Math.PI * 2);
            bCtx.fill();
          }
        }
      } else if (type === 'bright-blue-corrugated-roof') {
        // Vibrant Royal Blue Corrugated Metal Roof (Exact match to Gandaki University aerial drone photos!)
        ctx.fillStyle = '#1a64b5';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#202020';
        bCtx.fillRect(0, 0, 512, 512);
        for (let x = 0; x < 512; x += 14) {
          ctx.fillStyle = '#2e7ecf';
          ctx.fillRect(x, 0, 4, 512);
          ctx.fillStyle = '#114a87';
          ctx.fillRect(x + 4, 0, 10, 512);
          bCtx.fillStyle = '#f1f5f9';
          bCtx.fillRect(x, 0, 4, 512);
        }
      } else if (type === 'terracotta-red-roof') {
        // Vibrant Terracotta-Red Corrugated Metal-Tile Roof (Exact match to IMG_5854 aerial roof!)
        ctx.fillStyle = '#8f2920';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#202020';
        bCtx.fillRect(0, 0, 512, 512);
        rCtx.fillStyle = '#585858';
        rCtx.fillRect(0, 0, 512, 512);
        for (let y = 0; y < 512; y += 24) {
          ctx.fillStyle = '#5c1712';
          ctx.fillRect(0, y + 21, 512, 3);
          bCtx.fillStyle = '#0a0a0a';
          bCtx.fillRect(0, y + 21, 512, 3);
          for (let x = 0; x < 512; x += 16) {
            const isRidge = (x / 16) % 2 === 0;
            ctx.fillStyle = isRidge ? '#b8372c' : '#962b22';
            ctx.fillRect(x + 1, y + 1, 14, 20);
            ctx.fillStyle = 'rgba(255, 185, 165, 0.16)';
            ctx.fillRect(x + 2, y + 2, 4, 18);
            bCtx.fillStyle = isRidge ? '#f1f5f9' : '#94a3b8';
            bCtx.fillRect(x + 1, y + 1, 14, 20);
          }
        }
      } else if (type === 'rotunda-stone-brick') {
        // Fine-Coursed Warm Sandstone / Beige-Grey Thin Stone-Brick Cladding (Exact match to IMG_5835 2.JPG!)
        ctx.fillStyle = '#6e6a63';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#141414';
        bCtx.fillRect(0, 0, 512, 512);
        rCtx.fillStyle = '#888888';
        rCtx.fillRect(0, 0, 512, 512);
        const courseH = 16;
        for (let y = 0; y < 512; y += courseH) {
          const rowIdx = Math.floor(y / courseH);
          const off = (rowIdx % 2) * 24 + ((rowIdx * 11) % 8);
          for (let x = -48; x < 512 + 48; x += 48) {
            const bw = 44 + ((x * 7 + y * 3) % 3);
            const bh = courseH - 2.5;
            const tone = ((x * 13 + y * 19) % 34) - 14;
            const r = Math.min(235, Math.max(135, 188 + tone));
            const g = Math.min(228, Math.max(128, 180 + tone - ((x * 3) % 5)));
            const b = Math.min(215, Math.max(118, 165 + tone - ((y * 5) % 6)));
            ctx.fillStyle = "rgb(" + r + ", " + g + ", " + b + ")";
            ctx.fillRect(x + off + 1.5, y + 1.5, bw, bh);
            ctx.fillStyle = 'rgba(255, 252, 245, 0.18)';
            ctx.fillRect(x + off + 1.5, y + 1.5, bw, 2);
            ctx.fillStyle = 'rgba(30, 28, 25, 0.22)';
            ctx.fillRect(x + off + 1.5, y + bh - 1, bw, 2);
            bCtx.fillStyle = '#e5e7eb';
            bCtx.fillRect(x + off + 2, y + 2, bw - 1, bh - 1);
          }
        }
      } else if (type === 'polished-terrazzo-tile') {
        ctx.fillStyle = '#8b939c';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#303030';
        bCtx.fillRect(0, 0, 512, 512);
        rCtx.fillStyle = '#383838';
        rCtx.fillRect(0, 0, 512, 512);
        const tileS = 64;
        for (let ty = 0; ty < 512; ty += tileS) {
          for (let tx = 0; tx < 512; tx += tileS) {
            const isAlt = ((tx / tileS) + (ty / tileS)) % 2 === 0;
            ctx.fillStyle = isAlt ? '#cfd6de' : '#b2bcc8';
            ctx.fillRect(tx + 2, ty + 2, tileS - 4, tileS - 4);
            bCtx.fillStyle = '#f1f5f9';
            bCtx.fillRect(tx + 2, ty + 2, tileS - 4, tileS - 4);
            for (let sp = 0; sp < 14; sp++) {
              const sx = tx + 6 + ((sp * 19 + tx) % (tileS - 12));
              const sy = ty + 6 + ((sp * 29 + ty) % (tileS - 12));
              ctx.fillStyle = sp % 2 === 0 ? 'rgba(71, 85, 105, 0.35)' : 'rgba(255, 255, 255, 0.45)';
              ctx.fillRect(sx, sy, 3, 3);
            }
          }
        }
      } else if (type === 'pale-campus-stucco') {
        // Modern Gandaki University Prefab Modular Wall Panels (Exact match to aerial drone photos!)
        // Clean pale sage / mint-cream panel field with vertical joint seams and horizontal mid-line
        ctx.fillStyle = '#dce7dd';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#808080';
        bCtx.fillRect(0, 0, 512, 512);

        // Vertical modular panel seams every 64px
        for (let x = 0; x < 512; x += 64) {
          ctx.fillStyle = '#c4d2c5';
          ctx.fillRect(x - 1, 0, 2, 512);
          ctx.fillStyle = '#f0f6f0';
          ctx.fillRect(x + 1, 0, 1, 512);
          bCtx.fillStyle = '#404040';
          bCtx.fillRect(x - 1, 0, 2, 512);
        }

        // Horizontal panel joint seam halfway up
        ctx.fillStyle = '#c4d2c5';
        ctx.fillRect(0, 255, 512, 2);
        ctx.fillStyle = '#f0f6f0';
        ctx.fillRect(0, 257, 512, 1);
        bCtx.fillStyle = '#404040';
        bCtx.fillRect(0, 255, 512, 2);
      } else if (type === 'interlocking-pavers') {
        // Rain-Slicked Nepali Grey Flagstone Courtyard Slabs (Dhunga) with Wet Rain Puddles (Ref Photos 1, 4, 6!)
        ctx.fillStyle = '#1e2530';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#1c1c1c';
        bCtx.fillRect(0, 0, 512, 512);
        rCtx.fillStyle = '#525252';
        rCtx.fillRect(0, 0, 512, 512);

        for (let y = 0; y < 512; y += 42) {
          const rIdx = Math.floor(y / 42);
          const off = (rIdx % 2) * 32;
          for (let x = -32; x < 512 + 32; x += 64) {
            const w = 59 + ((x * 7 + y * 3) % 3);
            const h = 38 + ((x * 5 + y * 11) % 3);
            const seed = Math.abs(x * 13 + y * 19);
            const isWetPuddle = (seed % 7) < 2;
            const baseLum = isWetPuddle ? (54 + (seed % 14)) : (88 + (seed % 24));
            ctx.fillStyle = 'rgb(' + baseLum + ',' + (baseLum + 5) + ',' + (baseLum + 11) + ')';
            ctx.fillRect(x + off + 2, y + 2, w, h);

            // Chiseled stone edge highlight & deep mortar joint shadow
            ctx.fillStyle = 'rgba(203, 213, 225, 0.18)';
            ctx.fillRect(x + off + 2, y + 2, w, 2);
            ctx.fillStyle = 'rgba(10, 15, 24, 0.55)';
            ctx.fillRect(x + off + 2, y + h, w, 2.5);

            bCtx.fillStyle = '#d1d5db';
            bCtx.fillRect(x + off + 2.5, y + 2.5, w - 1, h - 1);

            // Mirror-like low roughness in wet rain puddle patches (Ref Photo 1 & 6!)
            rCtx.fillStyle = isWetPuddle ? '#181818' : '#6e6e6e';
            rCtx.fillRect(x + off + 2, y + 2, w, h);
          }
        }
      } else if (type === 'dachi-appa-brick') {
        // Traditional Nepali Newari Hand-Molded Red/Terracotta Clay Brick (Dachi Appa)
        // Exact match to Reference Photos 1, 2, 3, 4, 5: deep kiln-fired crimson/ochre clay,
        // thin recessed mortar joints, damp rain streaks, and dark soot/moss aging
        ctx.fillStyle = '#3b1c14';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#121212';
        bCtx.fillRect(0, 0, 512, 512);
        rCtx.fillStyle = '#8a8a8a';
        rCtx.fillRect(0, 0, 512, 512);

        const rowH = 16;
        for (let y = 0; y < 512; y += rowH) {
          const rIdx = Math.floor(y / rowH);
          const off = (rIdx % 2) * 26 + ((rIdx * 7) % 6);
          for (let x = -52; x < 512 + 52; x += 52) {
            const bw = 48 + ((x * 5 + y * 3) % 3);
            const bh = rowH - 2.2;
            const seed = Math.abs(x * 17 + y * 31);
            const kilnVar = (seed % 38) - 18;
            const red = Math.min(205, Math.max(98, 156 + kilnVar));
            const green = Math.min(110, Math.max(42, 68 + Math.floor(kilnVar * 0.55) - (seed % 9)));
            const blue = Math.min(82, Math.max(28, 46 + Math.floor(kilnVar * 0.35)));
            ctx.fillStyle = 'rgb(' + red + ',' + green + ',' + blue + ')';
            ctx.fillRect(x + off + 1.2, y + 1.2, bw, bh);

            // Top kiln highlight & bottom shadow bevel on each Dachi Appa brick
            ctx.fillStyle = 'rgba(255, 195, 145, 0.16)';
            ctx.fillRect(x + off + 1.2, y + 1.2, bw, 2);
            ctx.fillStyle = 'rgba(22, 8, 4, 0.34)';
            ctx.fillRect(x + off + 1.2, y + bh - 1.2, bw, 2);

            // Occasional dark soot/moss weathered brick
            if (seed % 11 === 0) {
              ctx.fillStyle = 'rgba(18, 24, 16, 0.32)';
              ctx.fillRect(x + off + 2, y + 2, bw - 2, bh - 2);
              rCtx.fillStyle = '#484848';
              rCtx.fillRect(x + off + 2, y + 2, bw - 2, bh - 2);
            } else {
              rCtx.fillStyle = (seed % 4 === 0) ? '#626262' : '#969696';
              rCtx.fillRect(x + off + 1.5, y + 1.5, bw, bh);
            }

            bCtx.fillStyle = '#e2e8f0';
            bCtx.fillRect(x + off + 1.5, y + 1.5, bw - 1, bh - 1);
          }
        }
      } else if (type === 'carved-sal-wood') {
        // Deep Roasted Ebony / Dark Walnut Carved Nepali Sal Timber (Ref Photos 1, 3, 5, 6)
        ctx.fillStyle = '#1f120b';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#282828';
        bCtx.fillRect(0, 0, 512, 512);
        rCtx.fillStyle = '#5c5c5c';
        rCtx.fillRect(0, 0, 512, 512);

        // Rich vertical hardwood grain + carved relief bands
        for (let x = 0; x < 512; x += 4) {
          const grain = ((x * 23) % 18) - 9;
          ctx.fillStyle = 'rgb(' + (38 + grain) + ',' + (22 + Math.floor(grain * 0.6)) + ',' + (14 + Math.floor(grain * 0.4)) + ')';
          ctx.fillRect(x, 0, 3, 512);
          bCtx.fillStyle = grain > 0 ? '#94a3b8' : '#334155';
          bCtx.fillRect(x, 0, 2, 512);
        }
        // Horizontal carved Newari lotus & dentil relief moldings
        for (let y = 32; y < 512; y += 64) {
          ctx.fillStyle = '#120905';
          ctx.fillRect(0, y, 512, 10);
          ctx.fillStyle = '#3d2417';
          ctx.fillRect(0, y + 10, 512, 6);
          bCtx.fillStyle = '#090909';
          bCtx.fillRect(0, y, 512, 10);
          bCtx.fillStyle = '#f8fafc';
          bCtx.fillRect(0, y + 10, 512, 6);
          for (let lx = 0; lx < 512; lx += 24) {
            ctx.fillStyle = '#4a2c1c';
            ctx.fillRect(lx + 4, y + 2, 16, 8);
            bCtx.fillStyle = '#e2e8f0';
            bCtx.fillRect(lx + 4, y + 2, 16, 8);
          }
        }
      } else if (type === 'tikijhyal-lattice') {
        // Authentic Newari Perforated Geometric Wooden Lattice Screen (Tikijhyal, Ref Photo 3 & 5)
        ctx.fillStyle = '#090604';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#080808';
        bCtx.fillRect(0, 0, 512, 512);
        rCtx.fillStyle = '#505050';
        rCtx.fillRect(0, 0, 512, 512);

        ctx.strokeStyle = '#2d1a10';
        ctx.lineWidth = 7;
        bCtx.strokeStyle = '#f1f5f9';
        bCtx.lineWidth = 7;
        const step = 32;
        for (let i = -512; i < 1024; i += step) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i + 512, 512);
          ctx.stroke();
          bCtx.beginPath();
          bCtx.moveTo(i, 0);
          bCtx.lineTo(i + 512, 512);
          bCtx.stroke();

          ctx.beginPath();
          ctx.moveTo(i + 512, 0);
          ctx.lineTo(i, 512);
          ctx.stroke();
          bCtx.beginPath();
          bCtx.moveTo(i + 512, 0);
          bCtx.lineTo(i, 512);
          bCtx.stroke();
        }
        // Carved rosette bosses at lattice intersections
        for (let y = 0; y <= 512; y += step) {
          for (let x = 0; x <= 512; x += step) {
            ctx.fillStyle = '#3e2416';
            ctx.fillRect(x - 4, y - 4, 8, 8);
            bCtx.fillStyle = '#ffffff';
            bCtx.fillRect(x - 4, y - 4, 8, 8);
          }
        }
      } else if (type === 'jhingati-tile-roof') {
        // Traditional Nepali Interlocking Terracotta Clay Tile Roof (Jhingati, Ref Photos 1, 3, 4, 5)
        ctx.fillStyle = '#5e2218';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#181818';
        bCtx.fillRect(0, 0, 512, 512);
        rCtx.fillStyle = '#686868';
        rCtx.fillRect(0, 0, 512, 512);

        for (let y = 0; y < 512; y += 20) {
          // Horizontal overlapping tile course shadow
          ctx.fillStyle = '#240b07';
          ctx.fillRect(0, y + 17, 512, 3);
          bCtx.fillStyle = '#050505';
          bCtx.fillRect(0, y + 17, 512, 3);
          for (let x = 0; x < 512; x += 14) {
            const seed = (x * 7 + y * 13) % 24;
            const isRoll = (x / 14) % 2 === 0;
            ctx.fillStyle = isRoll
              ? 'rgb(' + (152 + seed) + ',' + (58 + Math.floor(seed * 0.5)) + ',' + (38 + Math.floor(seed * 0.3)) + ')'
              : 'rgb(' + (112 + seed) + ',' + (40 + Math.floor(seed * 0.4)) + ',' + (26 + Math.floor(seed * 0.3)) + ')';
            ctx.fillRect(x + 1, y + 1, 12, 16);
            bCtx.fillStyle = isRoll ? '#f1f5f9' : '#78716c';
            bCtx.fillRect(x + 1, y + 1, 12, 16);
          }
        }
      } else if (type === 'teliya-terracotta-tile') {
        // Traditional Nepali Polished Red-Clay Veranda & Step Floor Tiles (Teliya Inta, Ref Photos 1 & 6)
        ctx.fillStyle = '#471810';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#222222';
        bCtx.fillRect(0, 0, 512, 512);
        rCtx.fillStyle = '#383838'; // Glossy oil-rubbed clay sheen
        rCtx.fillRect(0, 0, 512, 512);

        const ts = 64;
        for (let y = 0; y < 512; y += ts) {
          for (let x = 0; x < 512; x += ts) {
            const v = ((x * 11 + y * 17) % 22) - 11;
            ctx.fillStyle = 'rgb(' + (148 + v) + ',' + (62 + Math.floor(v * 0.5)) + ',' + (42 + Math.floor(v * 0.4)) + ')';
            ctx.fillRect(x + 2, y + 2, ts - 4, ts - 4);
            ctx.fillStyle = 'rgba(255, 190, 150, 0.16)';
            ctx.fillRect(x + 3, y + 3, ts - 6, 3);
            bCtx.fillStyle = '#e5e7eb';
            bCtx.fillRect(x + 2, y + 2, ts - 4, ts - 4);
            rCtx.fillStyle = ((x + y) % 128 === 0) ? '#262626' : '#4a4a4a';
            rCtx.fillRect(x + 2, y + 2, ts - 4, ts - 4);
          }
        }
            } else if (type === 'surveyor-field-grass') {
        // Step 3: Darker, desaturated green-gray grass
        ctx.fillStyle = '#101612';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#404040';
        bCtx.fillRect(0, 0, 512, 512);
        const patches = ['#0b100d', '#141c17', '#111813', '#17201a', '#0e1410'];
        for (let i = 0; i < 5500; i++) {
          ctx.fillStyle = patches[i % patches.length];
          ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 7);
          bCtx.fillStyle = i % 2 === 0 ? '#707070' : '#303030';
          bCtx.fillRect(Math.random() * 512, Math.random() * 512, 2, 6);
        }
      } else if (type === 'scuffed-classroom-floor') {
        // Requirement 4: Scuffed institutional concrete/linoleum tiles with heel marks, chair drag scratches & grime stains
        ctx.fillStyle = '#1e2630';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#787878';
        bCtx.fillRect(0, 0, 512, 512);
        rCtx.fillStyle = '#5c5c5c';
        rCtx.fillRect(0, 0, 512, 512);

        const ts = 64;
        for (let y = 0; y < 512; y += ts) {
          for (let x = 0; x < 512; x += ts) {
            const seed = Math.abs(x * 13 + y * 29);
            const tone = 30 + (seed % 14);
            ctx.fillStyle = 'rgb(' + tone + ',' + (tone + 6) + ',' + (tone + 12) + ')';
            ctx.fillRect(x + 2, y + 2, ts - 3, ts - 3);
            ctx.fillStyle = '#0d1218';
            ctx.fillRect(x, y, ts, 2);
            ctx.fillRect(x, y, 2, ts);
            bCtx.fillStyle = '#222222';
            bCtx.fillRect(x, y, ts, 2);
            bCtx.fillRect(x, y, 2, ts);
            if (seed % 3 === 0) {
              ctx.strokeStyle = 'rgba(8, 11, 15, 0.65)';
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.moveTo(x + 12, y + 18);
              if (ctx.quadraticCurveTo) ctx.quadraticCurveTo(x + 34, y + 28, x + 48, y + 46); else { ctx.lineTo(x + 34, y + 28); ctx.lineTo(x + 48, y + 46); }
              ctx.stroke();
              bCtx.strokeStyle = '#383838';
              bCtx.lineWidth = 2;
              bCtx.beginPath();
              ctx.moveTo(x + 12, y + 18);
              bCtx.lineTo(x + 48, y + 46);
              bCtx.stroke();
            }
            if (seed % 5 === 0) {
              const sg = ctx.createRadialGradient(x + 32, y + 32, 3, x + 32, y + 32, 26);
              sg.addColorStop(0.0, 'rgba(10, 14, 18, 0.58)');
              sg.addColorStop(0.7, 'rgba(18, 26, 22, 0.25)');
              sg.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
              ctx.fillStyle = sg;
              ctx.fillRect(x + 4, y + 4, ts - 8, ts - 8);
              rCtx.fillStyle = '#282828';
              rCtx.fillRect(x + 10, y + 10, 36, 36);
            }
          }
        }
      } else if (type === 'stained-ceiling-tiles') {
        // Requirement 4: Stained acoustic drop-ceiling tiles with brown roof-leak water rings, mold speckles & sagging seams
        ctx.fillStyle = '#6c7378';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#888888';
        bCtx.fillRect(0, 0, 512, 512);
        rCtx.fillStyle = '#989898';
        rCtx.fillRect(0, 0, 512, 512);

        const cw = 64, ch = 128;
        for (let y = 0; y < 512; y += ch) {
          for (let x = 0; x < 512; x += cw) {
            const seed = Math.abs(x * 17 + y * 23);
            const base = 104 + (seed % 18);
            ctx.fillStyle = 'rgb(' + base + ',' + (base + 3) + ',' + (base + 5) + ')';
            ctx.fillRect(x + 3, y + 3, cw - 6, ch - 6);
            ctx.fillStyle = '#22282e';
            ctx.fillRect(x, y, cw, 3);
            ctx.fillRect(x, y, 3, ch);
            bCtx.fillStyle = '#181818';
            bCtx.fillRect(x, y, cw, 3);
            bCtx.fillRect(x, y, 3, ch);

            ctx.fillStyle = 'rgba(20, 26, 30, 0.36)';
            for (let py = y + 8; py < y + ch - 6; py += 10) {
              for (let px = x + 8; px < x + cw - 6; px += 10) {
                ctx.fillRect(px, py, 1.5, 1.5);
                bCtx.fillStyle = '#404040';
                bCtx.fillRect(px, py, 2, 2);
              }
            }

            if (seed % 3 !== 0) {
              const cx = x + 20 + (seed % 24);
              const cy = y + 32 + ((seed * 3) % 64);
              const rad = 18 + (seed % 22);
              const wg = ctx.createRadialGradient(cx, cy, rad * 0.2, cx, cy, rad);
              wg.addColorStop(0.0, 'rgba(54, 42, 26, 0.52)');
              wg.addColorStop(0.68, 'rgba(68, 52, 30, 0.65)');
              wg.addColorStop(0.88, 'rgba(42, 32, 18, 0.38)');
              wg.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
              ctx.fillStyle = wg;
              ctx.fillRect(x + 3, y + 3, cw - 6, ch - 6);
            }
          }
        }
      } else if (type === 'peeling-paint-wall') {
        // Requirement 4: Peeling paint & damp plaster with flaking patches exposing raw dark concrete, cracks & stains
        ctx.fillStyle = '#6e7874';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#909090';
        bCtx.fillRect(0, 0, 512, 512);
        rCtx.fillStyle = '#848484';
        rCtx.fillRect(0, 0, 512, 512);

        for (let i = 0; i < 900; i++) {
          const px = (i * 73) % 512;
          const py = (i * 137) % 512;
          const w = 10 + (i % 26);
          const h = 8 + ((i * 7) % 24);
          ctx.fillStyle = (i % 2 === 0) ? 'rgba(42, 52, 48, 0.16)' : 'rgba(148, 158, 152, 0.12)';
          ctx.fillRect(px, py, w, h);
        }

        for (let p = 0; p < 28; p++) {
          const px = 24 + ((p * 97) % 460);
          const py = 28 + ((p * 163) % 450);
          const rx = 14 + (p % 22);
          const ry = 10 + ((p * 5) % 18);

          ctx.fillStyle = '#9aa6a0';
          ctx.beginPath();
          ctx.ellipse(px, py, rx + 2.5, ry + 2.5, (p * 0.4), 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#323a3c';
          ctx.beginPath();
          ctx.ellipse(px, py, rx, ry, (p * 0.4), 0, Math.PI * 2);
          ctx.fill();

          bCtx.fillStyle = '#ffffff';
          bCtx.beginPath();
          bCtx.ellipse(px, py, rx + 2.5, ry + 2.5, (p * 0.4), 0, Math.PI * 2);
          bCtx.fill();
          bCtx.fillStyle = '#242424';
          bCtx.beginPath();
          bCtx.ellipse(px, py, rx, ry, (p * 0.4), 0, Math.PI * 2);
          bCtx.fill();
        }

        ctx.strokeStyle = 'rgba(18, 24, 26, 0.65)';
        ctx.lineWidth = 1.5;
        bCtx.strokeStyle = '#101010';
        bCtx.lineWidth = 2.0;
        for (let cIdx = 0; cIdx < 8; cIdx++) {
          let cx = 40 + cIdx * 60;
          let cy = (cIdx % 2 === 0) ? 10 : 320;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          bCtx.beginPath();
          bCtx.moveTo(cx, cy);
          for (let seg = 0; seg < 6; seg++) {
            cx += ((seg * 13 + cIdx * 7) % 22) - 10;
            cy += 24 + (seg % 3) * 8;
            ctx.lineTo(cx, cy);
            bCtx.lineTo(cx, cy);
          }
          ctx.stroke();
          bCtx.stroke();
        }
      } else if (type === 'worn-wood-grain') {
        // Requirement 4: Worn wood grain with knots, scratched varnish, ink stains & bump relief
        ctx.fillStyle = '#4e2710';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#606060';
        bCtx.fillRect(0, 0, 512, 512);
        rCtx.fillStyle = '#585858';
        rCtx.fillRect(0, 0, 512, 512);

        for (let y = 0; y < 512; y += 3) {
          const wave = Math.floor(Math.sin(y * 0.08) * 10 + Math.cos(y * 0.03) * 8);
          const r = Math.max(38, Math.min(115, 78 + wave));
          const g = Math.max(18, Math.min(62, 39 + Math.floor(wave * 0.55)));
          const b = Math.max(8, Math.min(34, 16 + Math.floor(wave * 0.3)));
          ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
          ctx.fillRect(0, y, 512, 3);
          bCtx.fillStyle = wave > 0 ? '#989898' : '#424242';
          bCtx.fillRect(0, y, 512, 2);
        }
        for (let py = 0; py < 512; py += 128) {
          ctx.fillStyle = '#1e0d05';
          ctx.fillRect(0, py, 512, 3);
          bCtx.fillStyle = '#121212';
          bCtx.fillRect(0, py, 512, 3);
        }
        for (let k = 0; k < 7; k++) {
          const kx = 48 + ((k * 113) % 420);
          const ky = 36 + ((k * 79) % 440);
          ctx.fillStyle = '#291206';
          ctx.beginPath();
          ctx.ellipse(kx, ky, 16, 7, 0.15, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#633318';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(168, 122, 82, 0.42)';
        ctx.lineWidth = 1.5;
        bCtx.strokeStyle = '#1e1e1e';
        bCtx.lineWidth = 1.5;
        for (let sc = 0; sc < 24; sc++) {
          const sx = (sc * 67) % 480;
          const sy = (sc * 43) % 480;
          const ex = sx + 18 + (sc % 28);
          const ey = sy + ((sc % 3) - 1) * 14;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          bCtx.beginPath();
          bCtx.moveTo(sx, sy);
          bCtx.lineTo(ex, ey);
          bCtx.stroke();
        }
      } else if (type === 'dirty-window-glass') {
        // Requirement 4: Dirty glass texture with rain streaks, dried water spots, corner dust buildup & smudges
        ctx.fillStyle = '#0c1824';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#505050';
        bCtx.fillRect(0, 0, 512, 512);
        rCtx.fillStyle = '#282828';
        rCtx.fillRect(0, 0, 512, 512);

        const edgeGrime = ctx.createRadialGradient(256, 256, 90, 256, 256, 340);
        edgeGrime.addColorStop(0.0, 'rgba(12, 24, 36, 0.0)');
        edgeGrime.addColorStop(0.65, 'rgba(28, 42, 48, 0.38)');
        edgeGrime.addColorStop(1.0, 'rgba(42, 54, 52, 0.78)');
        ctx.fillStyle = edgeGrime;
        ctx.fillRect(0, 0, 512, 512);

        for (let rx = 8; rx < 512; rx += 18) {
          const rw = 3 + (rx % 5);
          ctx.fillStyle = (rx % 36 === 0) ? 'rgba(94, 118, 128, 0.28)' : 'rgba(5, 10, 16, 0.35)';
          ctx.fillRect(rx, 0, rw, 512);
          rCtx.fillStyle = (rx % 36 === 0) ? '#909090' : '#181818';
          rCtx.fillRect(rx, 0, rw, 512);
        }
        for (let sp = 0; sp < 45; sp++) {
          const sx = (sp * 83) % 500;
          const sy = (sp * 59) % 500;
          ctx.fillStyle = 'rgba(110, 130, 138, 0.18)';
          ctx.beginPath();
          ctx.arc(sx, sy, 4 + (sp % 9), 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (type === 'scuffed-board') {
        ctx.fillStyle = '#8b99a6';
        ctx.fillRect(0, 0, 512, 512);
        bCtx.fillStyle = '#707070';
        bCtx.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 18; i++) {
          const sy = 40 + (i * 24);
          ctx.fillStyle = (i % 2 === 0) ? 'rgba(45, 58, 72, 0.18)' : 'rgba(220, 230, 238, 0.15)';
          ctx.fillRect(28, sy, 456, 10);
        }
      }

      // Step 3: Darken wall/roof/brick textures by ~35% and add vertical grime & damp stain gradients (Zero new draw calls!)
      if (type !== 'surveyor-field-grass' && type !== 'interlocking-pavers') {
        const darkMult = (HORROR_CONFIG.grade && HORROR_CONFIG.grade.materialDarknessMultiplier) || 0.64;
        const darkAlpha = Math.max(0.15, Math.min(0.55, 1.0 - darkMult));
        ctx.fillStyle = 'rgba(6, 10, 12, ' + darkAlpha.toFixed(2) + ')';
        ctx.fillRect(0, 0, 512, 512);

        const topGrime = ctx.createLinearGradient(0, 0, 0, 128);
        topGrime.addColorStop(0.0, 'rgba(4, 7, 9, 0.58)');
        topGrime.addColorStop(0.45, 'rgba(10, 16, 14, 0.24)');
        topGrime.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
        ctx.fillStyle = topGrime;
        ctx.fillRect(0, 0, 512, 128);

        const botGrime = ctx.createLinearGradient(0, 350, 0, 512);
        botGrime.addColorStop(0.0, 'rgba(0, 0, 0, 0.0)');
        botGrime.addColorStop(0.55, 'rgba(12, 20, 15, 0.32)');
        botGrime.addColorStop(1.0, 'rgba(5, 9, 7, 0.64)');
        ctx.fillStyle = botGrime;
        ctx.fillRect(0, 350, 512, 162);

        for (let sx = 12; sx < 512; sx += 28) {
          const streakW = 6 + ((sx * 7) % 10);
          const streakH = 140 + ((sx * 19) % 260);
          const sGrad = ctx.createLinearGradient(0, 0, 0, streakH);
          sGrad.addColorStop(0.0, 'rgba(5, 9, 8, 0.32)');
          sGrad.addColorStop(0.7, 'rgba(8, 14, 11, 0.14)');
          sGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
          ctx.fillStyle = sGrad;
          ctx.fillRect(sx, 0, streakW, streakH);
        }
      }

      };

      const map = new THREE.CanvasTexture(c);
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.RepeatWrapping;

      let outBump = null;
      if (dedicatedBumpTypes[type]) {
        outBump = new THREE.CanvasTexture(bumpC);
        outBump.wrapS = THREE.RepeatWrapping;
        outBump.wrapT = THREE.RepeatWrapping;
      } else {
        if (!window.__sharedArchBumpTex && bumpC) {
          const bTex = new THREE.CanvasTexture(bumpC);
          bTex.wrapS = THREE.RepeatWrapping;
          bTex.wrapT = THREE.RepeatWrapping;
          window.__sharedArchBumpTex = bTex;
        }
        outBump = window.__sharedArchBumpTex;
      }

      if (!window.__sharedArchRoughTex && roughC) {
        const rTex = new THREE.CanvasTexture(roughC);
        rTex.wrapS = THREE.RepeatWrapping;
        rTex.wrapT = THREE.RepeatWrapping;
        window.__sharedArchRoughTex = rTex;
      }

      // Requirement 1: Generate procedural textures in chunks across frames behind the loading screen & cache them
      const isHeadlessNode = (typeof navigator !== 'undefined' && navigator.userAgent === 'node');
      if (isHeadlessNode || needsBumpCanvas || needsRoughCanvas) {
        runProceduralDraw();
        map.needsUpdate = true;
        if (outBump) outBump.needsUpdate = true;
      } else {
        window.__TEXTURE_CHUNK_QUEUE__.push(() => {
          runProceduralDraw();
          map.needsUpdate = true;
        });
      }

      const result = {
        map,
        bumpMap: outBump,
        roughnessMap: window.__sharedArchRoughTex,
      };
      window.__PROCEDURAL_TEX_CACHE__.set(type, result);
      return result;
    }

    // Phase A Texture Atlas & Shared Surface Maps:
    const riverStoneTex = createProceduralTextureWithBump('nepali-river-stone');
    riverStoneTex.map.repeat.set(14, 2);

    const blueRoofTex = createProceduralTextureWithBump('bright-blue-corrugated-roof');
    blueRoofTex.map.repeat.set(10, 4);

    const redRoofTex = createProceduralTextureWithBump('terracotta-red-roof');
    redRoofTex.map.repeat.set(10, 5);

    const rotundaBrickTex = createProceduralTextureWithBump('rotunda-stone-brick');
    rotundaBrickTex.map.repeat.set(6, 4);

    const stuccoTex = createProceduralTextureWithBump('pale-campus-stucco');
    stuccoTex.map.repeat.set(5, 2);

    const paverTex = createProceduralTextureWithBump('interlocking-pavers');
    paverTex.map.repeat.set(24, 24);

    const grassTex = createProceduralTextureWithBump('surveyor-field-grass');
    grassTex.map.repeat.set(32, 32);

    const dachiBrickTex = createProceduralTextureWithBump('dachi-appa-brick');
    dachiBrickTex.map.repeat.set(6, 3);

    const carvedSalTex = createProceduralTextureWithBump('carved-sal-wood');
    carvedSalTex.map.repeat.set(3, 2);

    // Requirement 4: New Worn Canvas Textures + Cheap Bump Maps (scuffed floors, stained ceiling tiles, peeling paint, wood grain, dirty glass)
    const scuffedFloorTex = createProceduralTextureWithBump('scuffed-classroom-floor');
    scuffedFloorTex.map.repeat.set(6, 6);
    scuffedFloorTex.bumpMap.repeat.set(6, 6);
    const terrazzoFloorTex = scuffedFloorTex;

    const stainedCeilingTex = createProceduralTextureWithBump('stained-ceiling-tiles');
    stainedCeilingTex.map.repeat.set(5, 5);
    stainedCeilingTex.bumpMap.repeat.set(5, 5);

    const peelingPaintTex = createProceduralTextureWithBump('peeling-paint-wall');
    peelingPaintTex.map.repeat.set(4, 2);
    peelingPaintTex.bumpMap.repeat.set(4, 2);

    const wornWoodTex = createProceduralTextureWithBump('worn-wood-grain');
    wornWoodTex.map.repeat.set(2, 2);
    wornWoodTex.bumpMap.repeat.set(2, 2);

    const dirtyGlassTex = createProceduralTextureWithBump('dirty-window-glass');
    dirtyGlassTex.map.repeat.set(2, 2);

    const scuffedBoardTex = createProceduralTextureWithBump('scuffed-board');

    // Share compatible tile/roof/wood maps to keep GPU texture footprint lean
    const tikijhyalTex = carvedSalTex;
    const jhingatiRoofTex = redRoofTex;
    const teliyaTileTex = dachiBrickTex;

    // Power-of-Two Signage, Poster, Chalkboard & Stupa Eyes Texture Atlas (1024x512 -> 1 single GPU texture!)
    const signageAtlasCanvas = document.createElement('canvas');
    signageAtlasCanvas.width = 1024;
    signageAtlasCanvas.height = 512;
    const sAtlasCtx = signageAtlasCanvas.getContext('2d');
    const signageAtlasTex = new THREE.CanvasTexture(signageAtlasCanvas);
    signageAtlasTex.minFilter = THREE.LinearFilter;
    signageAtlasTex.magFilter = THREE.LinearFilter;

    function createAtlasUvGeo(baseGeo, xPx, yPx, wPx, hPx) {
      const g = baseGeo.clone();
      const uv = g.attributes.uv;
      if (uv) {
        const u0 = xPx / 1024;
        const u1 = (xPx + wPx) / 1024;
        const v0 = 1.0 - (yPx + hPx) / 512;
        const v1 = 1.0 - yPx / 512;
        for (let i = 0; i < uv.count; i++) {
          const u = uv.getX(i);
          const v = uv.getY(i);
          uv.setXY(i, u0 + u * (u1 - u0), v0 + v * (v1 - v0));
        }
        uv.needsUpdate = true;
      }
      return g;
    }
    const sharedSignageAtlasMat = new THREE.MeshBasicMaterial({ map: signageAtlasTex, side: THREE.DoubleSide });

    const materials = {
      nepaliRiverStone: new THREE.MeshStandardMaterial({
        map: riverStoneTex.map,
        bumpMap: riverStoneTex.bumpMap,
        bumpScale: 0.09,
        roughness: 0.78,
      }),
      riverStoneCoping: new THREE.MeshStandardMaterial({
        map: peelingPaintTex.map,
        bumpMap: peelingPaintTex.bumpMap,
        bumpScale: 0.04,
        color: 0x64748b,
        roughness: 0.68,
      }),
      brightBlueRoof: new THREE.MeshStandardMaterial({
        map: blueRoofTex.map,
        bumpMap: blueRoofTex.bumpMap,
        bumpScale: 0.06,
        color: 0x24313d,
        metalness: 0.28,
        roughness: 0.54,
      }),
      weatheredGreyRoof: new THREE.MeshStandardMaterial({
        map: peelingPaintTex.map,
        bumpMap: peelingPaintTex.bumpMap,
        bumpScale: 0.05,
        color: 0x1e2630,
        roughness: 0.68,
        metalness: 0.28,
      }),
      terracottaRoof: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        redRoofTex.map.generateMipmaps = true;
        redRoofTex.map.minFilter = THREE.LinearMipmapLinearFilter;
        redRoofTex.map.anisotropy = mb.windowAnisotropy || 8;
        return new THREE.MeshStandardMaterial({
          map: redRoofTex.map,
          bumpMap: redRoofTex.bumpMap,
          bumpScale: mb.roofNormalScale !== undefined ? mb.roofNormalScale : 0.026,
          color: mb.roofColor || 0xb83e30,
          emissive: mb.roofEmissive || 0x3a120e,
          emissiveIntensity: mb.roofEmissiveIntensity !== undefined ? mb.roofEmissiveIntensity : 0.24,
          roughness: mb.roofRoughness !== undefined ? mb.roofRoughness : 0.44,
          metalness: 0.16,
        });
      })(),
      rotundaRoofRidge: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        return new THREE.MeshStandardMaterial({
          map: redRoofTex.map,
          bumpMap: redRoofTex.bumpMap,
          bumpScale: 0.018,
          color: mb.roofRidgeColor || 0xd65444,
          emissive: mb.roofRidgeEmissive || 0x4c1914,
          emissiveIntensity: mb.roofRidgeEmissiveIntensity !== undefined ? mb.roofRidgeEmissiveIntensity : 0.30,
          roughness: 0.38,
          metalness: 0.24,
        });
      })(),
      rotundaBrick: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        // Fine plaster & subtle masonry texture with vertical damp weathering streaks (no pebble look!)
        const fineWallTex = createProceduralTexture(512, 512, (ctx) => {
          ctx.fillStyle = '#8d96a0';
          ctx.fillRect(0, 0, 512, 512);
          // Fine horizontal plaster/masonry courses
          for (let y = 0; y < 512; y += 16) {
            ctx.fillStyle = (y % 32 === 0) ? 'rgba(218, 226, 234, 0.10)' : 'rgba(30, 40, 50, 0.10)';
            ctx.fillRect(0, y, 512, 1.5);
          }
          // Subtle micro-plaster grain
          for (let i = 0; i < 600; i++) {
            const gx = (i * 79) % 512;
            const gy = (i * 131) % 512;
            ctx.fillStyle = (i % 2 === 0) ? 'rgba(235, 242, 248, 0.06)' : 'rgba(22, 30, 38, 0.07)';
            ctx.fillRect(gx, gy, 3, 3);
          }
          // Realistic vertical rain/moss weathering streaks matching IMG_6033 & IMG_6034
          const topDamp = ctx.createLinearGradient(0, 0, 0, 110);
          topDamp.addColorStop(0.0, 'rgba(18, 26, 30, 0.42)');
          topDamp.addColorStop(0.5, 'rgba(24, 34, 38, 0.16)');
          topDamp.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
          ctx.fillStyle = topDamp;
          ctx.fillRect(0, 0, 512, 110);
          for (let sx = 14; sx < 512; sx += 32) {
            const sw = 5 + ((sx * 7) % 9);
            const sh = 120 + ((sx * 19) % 240);
            const sg = ctx.createLinearGradient(0, 0, 0, sh);
            sg.addColorStop(0.0, 'rgba(20, 28, 26, 0.28)');
            sg.addColorStop(0.65, 'rgba(26, 36, 32, 0.12)');
            sg.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
            ctx.fillStyle = sg;
            ctx.fillRect(sx, 0, sw, sh);
          }
        }, 'main-bldg-fine-wall-plaster');
        fineWallTex.wrapS = THREE.RepeatWrapping;
        fineWallTex.wrapT = THREE.RepeatWrapping;
        fineWallTex.repeat.set(4, 2);
        fineWallTex.generateMipmaps = true;
        fineWallTex.minFilter = THREE.LinearMipmapLinearFilter;
        fineWallTex.anisotropy = mb.windowAnisotropy || 8;
        return new THREE.MeshStandardMaterial({
          map: fineWallTex,
          bumpMap: fineWallTex,
          bumpScale: mb.wallNormalScale !== undefined ? mb.wallNormalScale : 0.016,
          color: mb.wallColor || 0x9ca6b0,
          emissive: mb.wallEmissive || 0x16222e,
          emissiveIntensity: mb.wallEmissiveIntensity !== undefined ? mb.wallEmissiveIntensity : 0.18,
          roughness: mb.wallRoughness !== undefined ? mb.wallRoughness : 0.66,
          side: THREE.DoubleSide,
        });
      })(),
      rotundaWhiteArch: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        // Bright weathered off-white concrete plaster for columns, pilasters, floor bands & cornices (IMG_6033 & IMG_6034!)
        const colPlasterTex = createProceduralTexture(512, 512, (ctx) => {
          ctx.fillStyle = '#d4dde4';
          ctx.fillRect(0, 0, 512, 512);
          for (let i = 0; i < 450; i++) {
            const gx = (i * 83) % 512;
            const gy = (i * 149) % 512;
            ctx.fillStyle = (i % 2 === 0) ? 'rgba(255, 255, 255, 0.08)' : 'rgba(35, 45, 55, 0.07)';
            ctx.fillRect(gx, gy, 3, 4);
          }
          // Vertical dark rain/moss streaks along columns and pilasters (matching IMG_6034!)
          for (let sx = 18; sx < 512; sx += 44) {
            const sw = 6 + ((sx * 11) % 12);
            const sh = 150 + ((sx * 23) % 280);
            const sg = ctx.createLinearGradient(0, 0, 0, sh);
            sg.addColorStop(0.0, 'rgba(22, 30, 28, 0.36)');
            sg.addColorStop(0.55, 'rgba(30, 40, 36, 0.16)');
            sg.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
            ctx.fillStyle = sg;
            ctx.fillRect(sx, 0, sw, sh);
          }
          const baseStain = ctx.createLinearGradient(0, 410, 0, 512);
          baseStain.addColorStop(0.0, 'rgba(0, 0, 0, 0.0)');
          baseStain.addColorStop(1.0, 'rgba(20, 28, 26, 0.34)');
          ctx.fillStyle = baseStain;
          ctx.fillRect(0, 410, 512, 102);
        }, 'main-bldg-col-pilaster-plaster');
        colPlasterTex.wrapS = THREE.RepeatWrapping;
        colPlasterTex.wrapT = THREE.RepeatWrapping;
        colPlasterTex.repeat.set(2, 2);
        colPlasterTex.generateMipmaps = true;
        colPlasterTex.minFilter = THREE.LinearMipmapLinearFilter;
        colPlasterTex.anisotropy = mb.windowAnisotropy || 8;
        return new THREE.MeshStandardMaterial({
          map: colPlasterTex,
          bumpMap: colPlasterTex,
          bumpScale: mb.pilasterNormalScale !== undefined ? mb.pilasterNormalScale : 0.012,
          color: mb.pilasterColor || 0xdce4ec,
          emissive: mb.pilasterEmissive || 0x243444,
          emissiveIntensity: mb.pilasterEmissiveIntensity !== undefined ? mb.pilasterEmissiveIntensity : 0.25,
          roughness: mb.pilasterRoughness !== undefined ? mb.pilasterRoughness : 0.56,
          metalness: 0.06,
        });
      })(),
      rotundaPlinthConcrete: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        return new THREE.MeshStandardMaterial({
          map: scuffedFloorTex.map,
          bumpMap: scuffedFloorTex.bumpMap,
          bumpScale: 0.018,
          color: mb.plinthColor || 0x7e8a94,
          emissive: 0x121c26,
          emissiveIntensity: 0.14,
          roughness: 0.72,
          metalness: 0.08,
        });
      })(),
      rotundaColumnFlutedBase: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        return new THREE.MeshStandardMaterial({
          map: scuffedFloorTex.map,
          bumpMap: scuffedFloorTex.bumpMap,
          bumpScale: 0.018,
          color: mb.columnPedestalColor || 0x66727c,
          emissive: 0x101820,
          emissiveIntensity: 0.14,
          roughness: 0.62,
          metalness: 0.16,
        });
      })(),
      rotundaRedSteel: new THREE.MeshStandardMaterial({
        map: peelingPaintTex.map,
        bumpMap: peelingPaintTex.bumpMap,
        bumpScale: 0.016,
        color: 0xc24030,
        emissive: 0x38100c,
        emissiveIntensity: 0.20,
        roughness: 0.42,
        metalness: 0.48,
      }),
      rotundaCurvedGlass: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        return new THREE.MeshStandardMaterial({
          map: dirtyGlassTex.map,
          bumpMap: dirtyGlassTex.bumpMap,
          bumpScale: 0.008,
          color: mb.rotundaGlassDarkColor || 0x182838,
          emissive: mb.rotundaGlassDarkEmissive || 0x16283a,
          emissiveIntensity: mb.rotundaGlassDarkEmissiveIntensity !== undefined ? mb.rotundaGlassDarkEmissiveIntensity : 0.28,
          roughness: 0.14,
          metalness: 0.84,
          transparent: true,
          opacity: 0.74,
          side: THREE.DoubleSide,
        });
      })(),
      rotundaCurvedGlassWarm: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        return new THREE.MeshStandardMaterial({
          map: dirtyGlassTex.map,
          color: mb.rotundaGlassWarmColor || 0xffcf86,
          emissive: mb.rotundaGlassWarmEmissive || 0xff9636,
          emissiveIntensity: mb.rotundaGlassWarmEmissiveIntensity !== undefined ? mb.rotundaGlassWarmEmissiveIntensity : 0.72,
          roughness: 0.20,
          metalness: 0.35,
          transparent: true,
          opacity: 0.86,
          side: THREE.DoubleSide,
        });
      })(),
      rotundaOrangeRailingMat: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        return new THREE.MeshStandardMaterial({
          color: mb.rotundaRailingColor || 0xf07c24,
          emissive: mb.rotundaRailingEmissive || 0xff6e18,
          emissiveIntensity: mb.rotundaRailingEmissiveIntensity !== undefined ? mb.rotundaRailingEmissiveIntensity : 0.56,
          roughness: 0.34,
          metalness: 0.45,
        });
      })(),
      rotundaWindowWarm: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        const sz = mb.windowTextureSize || 512;
        const winWarmTex = createProceduralTexture(sz, sz, (ctx) => {
          // Warm gradient glass pane (brighter at bottom & center, darker warm amber at top/edges)
          const bg = ctx.createLinearGradient(0, sz, 0, 0);
          bg.addColorStop(0.0, '#fff2b2');
          bg.addColorStop(0.38, '#ffbe58');
          bg.addColorStop(0.75, '#d47624');
          bg.addColorStop(1.0, '#783c12');
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, sz, sz);

          const rad = ctx.createRadialGradient(sz * 0.52, sz * 0.72, sz * 0.04, sz * 0.50, sz * 0.60, sz * 0.58);
          rad.addColorStop(0.0, 'rgba(255, 250, 215, 0.85)');
          rad.addColorStop(0.45, 'rgba(255, 195, 95, 0.35)');
          rad.addColorStop(1.0, 'rgba(40, 16, 4, 0.48)');
          ctx.fillStyle = rad;
          ctx.fillRect(0, 0, sz, sz);

          // Subtle vertical interior curtain/blind shadow on left & bright vertical light slit in center-right (matches IMG_6034!)
          ctx.fillStyle = 'rgba(45, 22, 8, 0.38)';
          ctx.fillRect(0, 0, sz * 0.28, sz);
          ctx.fillStyle = 'rgba(255, 252, 225, 0.72)';
          ctx.fillRect(sz * 0.54, sz * 0.18, sz * 0.11, sz * 0.78);

          // Crisp Dark Frame & Mullions (outer border + upper transom + center vertical mullion)
          const fHex = mb.windowFrameHex || '#151c24';
          ctx.fillStyle = fHex;
          const bW = Math.round(sz * 0.055);
          ctx.fillRect(0, 0, sz, bW);
          ctx.fillRect(0, sz - bW, sz, bW);
          ctx.fillRect(0, 0, bW, sz);
          ctx.fillRect(sz - bW, 0, bW, sz);
          // Center vertical mullion & upper horizontal transom
          const mW = Math.round(sz * 0.036);
          ctx.fillRect(Math.round(sz * 0.5 - mW * 0.5), 0, mW, sz);
          ctx.fillRect(0, Math.round(sz * 0.30), sz, mW);
          ctx.fillRect(0, Math.round(sz * 0.65), sz, Math.round(mW * 0.75));
        }, 'main-bldg-win-warm');
        winWarmTex.generateMipmaps = true;
        winWarmTex.minFilter = THREE.LinearMipmapLinearFilter;
        winWarmTex.magFilter = THREE.LinearFilter;
        winWarmTex.anisotropy = mb.windowAnisotropy || 8;
        return new THREE.MeshStandardMaterial({
          map: winWarmTex,
          emissiveMap: winWarmTex,
          color: mb.windowWarmColor || 0xffe4a0,
          emissive: mb.windowWarmEmissive || 0xffa434,
          emissiveIntensity: mb.windowWarmEmissiveIntensity !== undefined ? mb.windowWarmEmissiveIntensity : 0.94,
          roughness: 0.22,
          metalness: 0.15,
        });
      })(),
      rotundaWindowRed: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        const sz = mb.windowTextureSize || 512;
        const winRedTex = createProceduralTexture(sz, sz, (ctx) => {
          const bg = ctx.createLinearGradient(0, sz, 0, 0);
          bg.addColorStop(0.0, '#ff9d78');
          bg.addColorStop(0.45, '#ea482c');
          bg.addColorStop(0.85, '#9e1f16');
          bg.addColorStop(1.0, '#4f0d0a');
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, sz, sz);

          const rad = ctx.createRadialGradient(sz * 0.5, sz * 0.68, sz * 0.05, sz * 0.5, sz * 0.55, sz * 0.58);
          rad.addColorStop(0.0, 'rgba(255, 190, 155, 0.75)');
          rad.addColorStop(0.55, 'rgba(235, 68, 44, 0.35)');
          rad.addColorStop(1.0, 'rgba(30, 4, 4, 0.52)');
          ctx.fillStyle = rad;
          ctx.fillRect(0, 0, sz, sz);

          const fHex = mb.windowFrameHex || '#151c24';
          ctx.fillStyle = fHex;
          const bW = Math.round(sz * 0.055);
          ctx.fillRect(0, 0, sz, bW);
          ctx.fillRect(0, sz - bW, sz, bW);
          ctx.fillRect(0, 0, bW, sz);
          ctx.fillRect(sz - bW, 0, bW, sz);
          const mW = Math.round(sz * 0.036);
          ctx.fillRect(Math.round(sz * 0.5 - mW * 0.5), 0, mW, sz);
          ctx.fillRect(0, Math.round(sz * 0.30), sz, mW);
          ctx.fillRect(0, Math.round(sz * 0.65), sz, Math.round(mW * 0.75));
        }, 'main-bldg-win-red');
        winRedTex.generateMipmaps = true;
        winRedTex.minFilter = THREE.LinearMipmapLinearFilter;
        winRedTex.magFilter = THREE.LinearFilter;
        winRedTex.anisotropy = mb.windowAnisotropy || 8;
        return new THREE.MeshStandardMaterial({
          map: winRedTex,
          emissiveMap: winRedTex,
          color: mb.windowRedColor || 0xff7e58,
          emissive: mb.windowRedEmissive || 0xe63926,
          emissiveIntensity: mb.windowRedEmissiveIntensity !== undefined ? mb.windowRedEmissiveIntensity : 0.98,
          roughness: 0.22,
          metalness: 0.15,
        });
      })(),
      rotundaWindowDark: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        const sz = mb.windowTextureSize || 512;
        const winDarkTex = createProceduralTexture(sz, sz, (ctx) => {
          // Dark glass pane with faint cool night-sky reflection so dark windows & frames still read clearly!
          const skyRefl = ctx.createLinearGradient(0, 0, sz * 0.65, sz);
          skyRefl.addColorStop(0.0, '#324c66');
          skyRefl.addColorStop(0.38, '#1e3144');
          skyRefl.addColorStop(0.75, '#111d2a');
          skyRefl.addColorStop(1.0, '#0a121a');
          ctx.fillStyle = skyRefl;
          ctx.fillRect(0, 0, sz, sz);

          // Faint cool specular reflection streak on glass panes
          ctx.fillStyle = 'rgba(135, 175, 210, 0.14)';
          ctx.beginPath();
          ctx.moveTo(sz * 0.12, sz * 0.08);
          ctx.lineTo(sz * 0.38, sz * 0.08);
          ctx.lineTo(sz * 0.18, sz * 0.88);
          ctx.lineTo(sz * 0.06, sz * 0.88);
          ctx.closePath();
          ctx.fill();

          // Crisp dark frame & mullions with subtle moonlight bevel highlight so frames read against the dark glass
          const fHex = mb.windowFrameHex || '#151c24';
          const bW = Math.round(sz * 0.055);
          const mW = Math.round(sz * 0.036);
          ctx.fillStyle = fHex;
          ctx.fillRect(0, 0, sz, bW);
          ctx.fillRect(0, sz - bW, sz, bW);
          ctx.fillRect(0, 0, bW, sz);
          ctx.fillRect(sz - bW, 0, bW, sz);
          ctx.fillRect(Math.round(sz * 0.5 - mW * 0.5), 0, mW, sz);
          ctx.fillRect(0, Math.round(sz * 0.30), sz, mW);
          ctx.fillRect(0, Math.round(sz * 0.65), sz, Math.round(mW * 0.75));

          // Subtle moonlit edge highlight along mullions & sill
          ctx.fillStyle = 'rgba(148, 178, 204, 0.26)';
          ctx.fillRect(Math.round(sz * 0.5 - mW * 0.5), bW, 3, sz - bW * 2);
          ctx.fillRect(bW, Math.round(sz * 0.30), sz - bW * 2, 3);
          ctx.fillRect(bW, Math.round(sz * 0.65), sz - bW * 2, 2.5);
          ctx.strokeStyle = 'rgba(165, 192, 214, 0.32)';
          ctx.lineWidth = 4;
          ctx.strokeRect(bW * 0.5, bW * 0.5, sz - bW, sz - bW);
        }, 'main-bldg-win-dark');
        winDarkTex.generateMipmaps = true;
        winDarkTex.minFilter = THREE.LinearMipmapLinearFilter;
        winDarkTex.magFilter = THREE.LinearFilter;
        winDarkTex.anisotropy = mb.windowAnisotropy || 8;
        return new THREE.MeshStandardMaterial({
          map: winDarkTex,
          emissiveMap: winDarkTex,
          color: mb.windowDarkColor || 0x263c52,
          emissive: mb.windowDarkSkyReflectEmissive || 0x1e344a,
          emissiveIntensity: mb.windowDarkEmissiveIntensity !== undefined ? mb.windowDarkEmissiveIntensity : 0.36,
          roughness: mb.windowDarkRoughness !== undefined ? mb.windowDarkRoughness : 0.14,
          metalness: mb.windowDarkMetalness !== undefined ? mb.windowDarkMetalness : 0.78,
        });
      })(),
      rotundaSignMat: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        const sw = mb.signCanvasWidth || 2048;
        const sh = mb.signCanvasHeight || 256;
        const signTex = createProceduralTexture(sw, sh, (ctx) => {
          // Weathered stone entablature plaque background (matching IMG_6033 & IMG_6034!)
          const bg = ctx.createLinearGradient(0, 0, 0, sh);
          bg.addColorStop(0.0, '#7c8790');
          bg.addColorStop(0.18, '#aeb8c0');
          bg.addColorStop(0.82, '#9aa5ae');
          bg.addColorStop(1.0, '#68737c');
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, sw, sh);

          // Recessed inner stone tablet border
          ctx.strokeStyle = '#26323d';
          ctx.lineWidth = 10;
          ctx.strokeRect(18, 18, sw - 36, sh - 36);
          ctx.strokeStyle = 'rgba(235, 242, 248, 0.38)';
          ctx.lineWidth = 4;
          ctx.strokeRect(24, 24, sw - 48, sh - 48);

          // Subtle vertical damp/moss weathering streaks across plaque ends
          for (let sx = 40; sx < sw; sx += 140) {
            const sg = ctx.createLinearGradient(0, 0, 0, sh * 0.85);
            sg.addColorStop(0.0, 'rgba(20, 28, 26, 0.32)');
            sg.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
            ctx.fillStyle = sg;
            ctx.fillRect(sx, 0, 22, sh * 0.85);
          }

          // Chiseled embossed highlight + bold dark-slate "GANDAKI UNIVERSITY" lettering
          ctx.font = '900 112px "Arial Black", Impact, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(240, 246, 252, 0.55)';
          ctx.fillText('GANDAKI UNIVERSITY', sw * 0.5 + 3, sh * 0.54 + 3);
          ctx.fillStyle = '#141c24';
          ctx.fillText('GANDAKI UNIVERSITY', sw * 0.5, sh * 0.54);
        }, 'main-bldg-gandaki-sign-2048');
        signTex.generateMipmaps = true;
        signTex.minFilter = THREE.LinearMipmapLinearFilter;
        signTex.magFilter = THREE.LinearFilter;
        signTex.anisotropy = mb.windowAnisotropy || 8;
        return new THREE.MeshStandardMaterial({
          map: signTex,
          color: mb.signPlaqueColor || 0xc8d2da,
          emissive: mb.signEmissive || 0x2c3a48,
          emissiveIntensity: mb.signEmissiveIntensity !== undefined ? mb.signEmissiveIntensity : 0.30,
          roughness: 0.52,
          metalness: 0.12,
        });
      })(),
      rotundaFacadeUplightMat: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        const upTex = createProceduralTexture(256, 256, (ctx) => {
          const g = ctx.createLinearGradient(0, 256, 0, 0);
          g.addColorStop(0.0, 'rgba(255, 156, 58, 0.92)');
          g.addColorStop(0.45, 'rgba(255, 138, 42, 0.42)');
          g.addColorStop(0.85, 'rgba(255, 120, 30, 0.08)');
          g.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, 256, 256);
        }, 'main-bldg-uplight-grad');
        return new THREE.MeshBasicMaterial({
          map: upTex,
          color: mb.facadeUplightColor || 0xff9436,
          transparent: true,
          opacity: mb.facadeUplightOpacity !== undefined ? mb.facadeUplightOpacity : 0.24,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
      })(),
      rotundaColumnWashMat: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        const cwTex = createProceduralTexture(128, 256, (ctx) => {
          const g = ctx.createLinearGradient(0, 256, 0, 0);
          g.addColorStop(0.0, 'rgba(255, 168, 72, 0.95)');
          g.addColorStop(0.55, 'rgba(255, 142, 48, 0.45)');
          g.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, 128, 256);
        }, 'main-bldg-col-wash-grad');
        return new THREE.MeshBasicMaterial({
          map: cwTex,
          color: mb.facadeUplightColor || 0xff9436,
          transparent: true,
          opacity: mb.porticoColumnWashOpacity !== undefined ? mb.porticoColumnWashOpacity : 0.28,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
      })(),
      rotundaEntranceSpillMat: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        const spTex = createProceduralTexture(256, 256, (ctx) => {
          const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 124);
          g.addColorStop(0.0, 'rgba(255, 182, 88, 0.95)');
          g.addColorStop(0.45, 'rgba(255, 138, 42, 0.48)');
          g.addColorStop(0.82, 'rgba(180, 72, 16, 0.14)');
          g.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, 256, 256);
        }, 'main-bldg-entrance-spill');
        return new THREE.MeshBasicMaterial({
          map: spTex,
          color: mb.entranceGroundSpillColor || 0xff9838,
          transparent: true,
          opacity: mb.entranceGroundSpillOpacity !== undefined ? mb.entranceGroundSpillOpacity : 0.30,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
      })(),
      rotundaBakedAoMat: (function() {
        const mb = HORROR_CONFIG.mainBuilding || {};
        const aoTex = createProceduralTexture(64, 128, (ctx) => {
          const g = ctx.createLinearGradient(0, 0, 0, 128);
          g.addColorStop(0.0, 'rgba(2, 5, 10, 0.92)');
          g.addColorStop(0.45, 'rgba(4, 9, 16, 0.42)');
          g.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, 64, 128);
        }, 'main-bldg-eave-ao-grad');
        return new THREE.MeshBasicMaterial({
          map: aoTex,
          transparent: true,
          opacity: mb.eaveAoOpacity !== undefined ? mb.eaveAoOpacity : 0.64,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
      })(),
      rotundaTerrazzoFloor: new THREE.MeshStandardMaterial({
        map: terrazzoFloorTex.map,
        bumpMap: terrazzoFloorTex.bumpMap,
        bumpScale: 0.025,
        roughness: 0.30,
        metalness: 0.18,
      }),
      rotundaInteriorWall: new THREE.MeshStandardMaterial({
        map: peelingPaintTex.map,
        bumpMap: peelingPaintTex.bumpMap,
        bumpScale: 0.055,
        color: 0xb8c2cc,
        roughness: 0.72,
        side: THREE.DoubleSide,
      }),
      stainedCeilingTiles: new THREE.MeshStandardMaterial({
        map: stainedCeilingTex.map,
        bumpMap: stainedCeilingTex.bumpMap,
        bumpScale: 0.05,
        color: 0x9aa4ad,
        roughness: 0.82,
      }),
      ceilingLightEmissive: new THREE.MeshStandardMaterial({
        color: 0xfff8eb,
        emissive: 0xffd485,
        emissiveIntensity: 1.35,
        roughness: 0.15,
      }),
      fountainPinkTrim: new THREE.MeshStandardMaterial({
        map: peelingPaintTex.map,
        bumpMap: peelingPaintTex.bumpMap,
        bumpScale: 0.05,
        color: 0x283038,
        roughness: 0.68,
        metalness: 0.12,
      }),
      fountainWater: new THREE.MeshStandardMaterial({
        color: 0x09131c,
        emissive: 0x061018,
        emissiveIntensity: 0.14,
        roughness: 0.12,
        metalness: 0.88,
        transparent: true,
        opacity: 0.88,
      }),
      campusStucco: new THREE.MeshStandardMaterial({
        map: peelingPaintTex.map,
        bumpMap: peelingPaintTex.bumpMap,
        bumpScale: 0.06,
        color: 0x626e66,
        roughness: 0.78,
        side: THREE.DoubleSide,
      }),
      classroomFloor: new THREE.MeshStandardMaterial({
        map: scuffedFloorTex.map,
        bumpMap: scuffedFloorTex.bumpMap,
        bumpScale: 0.055,
        color: 0x7a8896,
        roughness: 0.48,
        metalness: 0.14,
      }),
      interlockingPavers: new THREE.MeshStandardMaterial({
        map: paverTex.map,
        bumpMap: paverTex.bumpMap,
        bumpScale: 0.055,
        roughnessMap: paverTex.roughnessMap,
        roughness: 0.35,
        metalness: 0.24,
      }),
      nepalDachiBrick: new THREE.MeshStandardMaterial({
        map: dachiBrickTex.map,
        bumpMap: dachiBrickTex.bumpMap,
        bumpScale: 0.065,
        roughnessMap: dachiBrickTex.roughnessMap,
        roughness: 0.68,
        metalness: 0.06,
        side: THREE.DoubleSide,
      }),
      carvedSalWood: new THREE.MeshStandardMaterial({
        map: carvedSalTex.map,
        bumpMap: carvedSalTex.bumpMap,
        bumpScale: 0.075,
        roughness: 0.52,
        metalness: 0.12,
      }),
      ebonyCarvedWood: new THREE.MeshStandardMaterial({
        map: carvedSalTex.map,
        bumpMap: carvedSalTex.bumpMap,
        bumpScale: 0.085,
        color: 0x1a110b,
        roughness: 0.44,
        metalness: 0.16,
      }),
      tikijhyalLattice: new THREE.MeshStandardMaterial({
        map: tikijhyalTex.map,
        bumpMap: tikijhyalTex.bumpMap,
        bumpScale: 0.08,
        roughness: 0.48,
        metalness: 0.14,
      }),
      jhingatiTerracottaRoof: new THREE.MeshStandardMaterial({
        map: jhingatiRoofTex.map,
        bumpMap: jhingatiRoofTex.bumpMap,
        bumpScale: 0.085,
        roughness: 0.46,
        metalness: 0.15,
      }),
      teliyaFloorTile: new THREE.MeshStandardMaterial({
        map: teliyaTileTex.map,
        bumpMap: teliyaTileTex.bumpMap,
        bumpScale: 0.035,
        roughnessMap: teliyaTileTex.roughnessMap,
        roughness: 0.28,
        metalness: 0.16,
      }),
      nepalOchreDado: new THREE.MeshStandardMaterial({
        map: peelingPaintTex.map,
        bumpMap: peelingPaintTex.bumpMap,
        bumpScale: 0.05,
        color: 0x8c3b26,
        roughness: 0.68,
        side: THREE.DoubleSide,
      }),
      nepalCreamPlaster: new THREE.MeshStandardMaterial({
        map: peelingPaintTex.map,
        bumpMap: peelingPaintTex.bumpMap,
        bumpScale: 0.05,
        color: 0xc2b6a6,
        roughness: 0.68,
        side: THREE.DoubleSide,
      }),
      diyoFlameGlow: new THREE.MeshStandardMaterial({
        color: 0xffc27a,
        emissive: 0xff9b38,
        emissiveIntensity: (activePreset && activePreset.extraDetail)
          ? (HORROR_CONFIG.lighting.diyoUltraEmissiveIntensity || 1.35)
          : 0.65,
        roughness: 0.2,
      }),
      hauntedBlueGlow: new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
      }),
      brassGajur: new THREE.MeshStandardMaterial({
        map: wornWoodTex.map,
        bumpMap: wornWoodTex.bumpMap,
        bumpScale: 0.02,
        color: 0xd99b26,
        roughness: 0.28,
        metalness: 0.84,
      }),
      wetPuddleMirror: new THREE.MeshStandardMaterial({
        color: 0x0b1320,
        roughness: 0.05,
        metalness: 0.88,
        transparent: true,
        opacity: 0.76,
      }),
      surveyorGrass: new THREE.MeshStandardMaterial({
        map: grassTex.map,
        bumpMap: grassTex.bumpMap,
        bumpScale: 0.05,
        roughness: 0.85,
      }),
      lawnStripGreen: new THREE.MeshStandardMaterial({
        map: grassTex.map,
        bumpMap: grassTex.bumpMap,
        bumpScale: 0.04,
        color: 0x16201a,
        roughness: 0.90,
      }),
      castIronDark: new THREE.MeshStandardMaterial({
        map: peelingPaintTex.map,
        bumpMap: peelingPaintTex.bumpMap,
        bumpScale: 0.025,
        color: 0x161c26,
        metalness: 0.82,
        roughness: 0.34,
      }),
      gandakiBluePole: new THREE.MeshStandardMaterial({
        map: peelingPaintTex.map,
        bumpMap: peelingPaintTex.bumpMap,
        bumpScale: 0.03,
        color: 0x1d4ed8,
        metalness: 0.58,
        roughness: 0.42,
      }),
      royalBlueDark: new THREE.MeshStandardMaterial({
        map: peelingPaintTex.map,
        color: 0x0f172a,
        metalness: 0.75,
        roughness: 0.38,
      }),
      whiteTrim: new THREE.MeshStandardMaterial({
        map: peelingPaintTex.map,
        bumpMap: peelingPaintTex.bumpMap,
        bumpScale: 0.045,
        color: 0x8d97a0,
        roughness: 0.64,
      }),
      concretePillar: new THREE.MeshStandardMaterial({
        map: peelingPaintTex.map,
        bumpMap: peelingPaintTex.bumpMap,
        bumpScale: 0.05,
        color: 0x9aa6b2,
        roughness: 0.66,
      }),
      plinthDarkConcrete: new THREE.MeshStandardMaterial({
        map: scuffedFloorTex.map,
        bumpMap: scuffedFloorTex.bumpMap,
        bumpScale: 0.05,
        color: 0x475569,
        roughness: 0.76,
      }),
      windowGlass: new THREE.MeshStandardMaterial({
        map: dirtyGlassTex.map,
        bumpMap: dirtyGlassTex.bumpMap,
        bumpScale: 0.015,
        color: 0x182b3c,
        roughness: 0.18,
        metalness: 0.86,
        transparent: true,
        opacity: 0.72,
      }),
      windowWarmLit: new THREE.MeshStandardMaterial({
        map: dirtyGlassTex.map,
        color: 0xffb35c,
        emissive: HORROR_CONFIG.lighting.windowEmissive || 0xffa84c,
        emissiveIntensity: HORROR_CONFIG.lighting.windowEmissiveIntensity || 0.62,
        roughness: 0.36,
      }),
      deskWoodTop: new THREE.MeshStandardMaterial({
        map: wornWoodTex.map,
        bumpMap: wornWoodTex.bumpMap,
        bumpScale: 0.055,
        color: 0x8c4a1c,
        roughness: 0.56,
      }),
      chairWood: new THREE.MeshStandardMaterial({
        map: wornWoodTex.map,
        bumpMap: wornWoodTex.bumpMap,
        bumpScale: 0.06,
        color: 0x6b3412,
        roughness: 0.64,
      }),
      deskSteelFrame: new THREE.MeshStandardMaterial({
        map: peelingPaintTex.map,
        bumpMap: peelingPaintTex.bumpMap,
        bumpScale: 0.025,
        color: 0x222932,
        metalness: 0.72,
        roughness: 0.42,
      }),
      whiteboardSurface: new THREE.MeshStandardMaterial({
        map: scuffedBoardTex.map,
        bumpMap: scuffedBoardTex.bumpMap,
        bumpScale: 0.015,
        color: 0xb8c4d0,
        roughness: 0.28,
        metalness: 0.1,
      }),
      blackboardGreen: new THREE.MeshStandardMaterial({
        map: scuffedBoardTex.map,
        bumpMap: scuffedBoardTex.bumpMap,
        bumpScale: 0.02,
        color: 0x113d23,
        roughness: 0.62,
      }),
      busAmberPaint: new THREE.MeshStandardMaterial({
        map: peelingPaintTex.map,
        bumpMap: peelingPaintTex.bumpMap,
        bumpScale: 0.025,
        color: 0xf59e0b,
        metalness: 0.22,
        roughness: 0.40,
      }),
      busWindow: new THREE.MeshStandardMaterial({
        map: dirtyGlassTex.map,
        color: 0x0d1622,
        roughness: 0.14,
        metalness: 0.85,
      }),
      busBumper: new THREE.MeshStandardMaterial({
        map: peelingPaintTex.map,
        color: 0x334155,
        roughness: 0.58,
        metalness: 0.4,
      }),
      headlightLit: new THREE.MeshBasicMaterial({ color: 0xfef08a }),
      taillightRed: new THREE.MeshBasicMaterial({ color: 0xdc2626 }),
      wheelRim: new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.3 }),
      carSilver: new THREE.MeshStandardMaterial({
        map: peelingPaintTex.map,
        color: 0xcbd5e1,
        metalness: 0.78,
        roughness: 0.26,
      }),
      carDarkNavy: new THREE.MeshStandardMaterial({
        map: peelingPaintTex.map,
        color: 0x0f172a,
        metalness: 0.78,
        roughness: 0.24,
      }),
      rubberTire: new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.92 }),
      treeBark: new THREE.MeshStandardMaterial({
        map: carvedSalTex.map,
        bumpMap: carvedSalTex.bumpMap,
        bumpScale: 0.08,
        color: 0x261e18,
        roughness: 0.94,
      }),
      foliageGreen: new THREE.MeshStandardMaterial({
        map: grassTex.map,
        color: 0x16221a,
        roughness: 0.86,
      }),
      palmFrondMat: new THREE.MeshStandardMaterial({
        map: grassTex.map,
        color: 0x18241c,
        roughness: 0.86,
        side: THREE.DoubleSide,
      }),
      roofSoffitDark: new THREE.MeshStandardMaterial({
        map: stainedCeilingTex.map,
        color: 0x181e28,
        roughness: 0.88,
        metalness: 0.10,
      }),
      vehicleShadow: new THREE.MeshBasicMaterial({
        map: rectContactShadowTex,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      treeShadowDecal: new THREE.MeshBasicMaterial({
        map: softContactShadowTex,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      pedestalShadowDecal: new THREE.MeshBasicMaterial({
        map: softContactShadowTex,
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      coveredWalkwayShadow: new THREE.MeshBasicMaterial({
        map: corridorDarknessTex,
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      aoUnderDeskDecal: new THREE.MeshBasicMaterial({
        map: rectContactShadowTex,
        transparent: true,
        opacity: 0.76,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      aoCornerStripDecal: new THREE.MeshBasicMaterial({
        map: aoCornerStripTex,
        transparent: true,
        opacity: 0.68,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      windowMoonShaftMat: new THREE.MeshBasicMaterial({
        map: windowLightShaftTex,
        color: 0x8ec5fc,
        transparent: true,
        opacity: 0.20,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      moonFloorGoboMat: new THREE.MeshBasicMaterial({
        map: moonWindowGoboTex,
        color: 0x8ec5fc,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      corridorFogPlaneMat: new THREE.MeshBasicMaterial({
        map: corridorFogTex,
        color: 0x3b5266,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      rareSilhouetteMat: new THREE.MeshBasicMaterial({
        color: 0x050912,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        fog: true,
      }),
    };

    const sharedGeos = {
      lampPlinth: new THREE.BoxGeometry(0.56, 0.44, 0.56),
      lampBase: new THREE.CylinderGeometry(0.16, 0.26, 0.88, 8),
      lampCollar: new THREE.CylinderGeometry(0.18, 0.18, 0.12, 8),
      lampPole: new THREE.CylinderGeometry(0.075, 0.12, 3.6, 8),
      lanternBottomTray: new THREE.CylinderGeometry(0.24, 0.14, 0.14, 4),
      lanternGlassBody: new THREE.CylinderGeometry(0.25, 0.19, 0.58, 4),
      lanternCornerRib: new THREE.BoxGeometry(0.035, 0.62, 0.035),
      lanternRoofCap: new THREE.ConeGeometry(0.38, 0.32, 4),
      lanternFinial: new THREE.ConeGeometry(0.06, 0.28, 6),
      lampCone: new THREE.ConeGeometry(2.8, 4.6, 16, 1, true),
      winPane: new THREE.PlaneGeometry(1.75, 1.28),
      winFrameOuter: new THREE.BoxGeometry(1.92, 1.44, 0.14),
      winSillLedge: new THREE.BoxGeometry(2.06, 0.10, 0.24),
      winMullionV: new THREE.BoxGeometry(0.045, 1.28, 0.16),
      winMullionH: new THREE.BoxGeometry(1.75, 0.045, 0.16),
      winIronBarV: new THREE.CylinderGeometry(0.014, 0.014, 1.32, 6),
      quoinBlock: new THREE.BoxGeometry(0.38, 0.28, 0.38),
      deskTop: new THREE.BoxGeometry(1.3, 0.06, 0.56),
      deskLeg: new THREE.BoxGeometry(0.05, 0.74, 0.5),
      deskModestyPanel: new THREE.BoxGeometry(1.2, 0.32, 0.04),
      chairSeat: new THREE.BoxGeometry(0.42, 0.05, 0.42),
      chairBack: new THREE.BoxGeometry(0.42, 0.42, 0.04),
      whiteboard: new THREE.BoxGeometry(3.4, 1.3, 0.06),
      podiumBody: new THREE.BoxGeometry(0.65, 1.15, 0.5),
      acUnitBox: new THREE.BoxGeometry(0.72, 0.50, 0.28),
      acFanGrille: new THREE.CylinderGeometry(0.18, 0.18, 0.30, 10),
      verandaPost: new THREE.CylinderGeometry(0.09, 0.10, 3.3, 8),
      columnContactShadow: new THREE.PlaneGeometry(1.4, 1.4),
      fencePicket: new THREE.CylinderGeometry(0.02, 0.02, 1.18, 6),
      shrubClump: new THREE.DodecahedronGeometry(0.38, 1),
    };

    // Tag repeated prop geometries so bakeStaticGroup instances them via THREE.InstancedMesh
    sharedGeos.deskTop.userData.instancedCategory = 'desk';
    sharedGeos.deskLeg.userData.instancedCategory = 'desk';
    sharedGeos.deskModestyPanel.userData.instancedCategory = 'desk';
    sharedGeos.chairSeat.userData.instancedCategory = 'chair';
    sharedGeos.chairBack.userData.instancedCategory = 'chair';
    sharedGeos.fencePicket.userData.instancedCategory = 'fence';
    sharedGeos.shrubClump.userData.instancedCategory = 'tree';

    const treeShadowDecals = [];
    const roomVisibilityList = [];
    const lampFlickerMod = new LampFlicker(scene, sharedGeos, materials);
    const particleFieldMod = new ParticleField(scene);
    const rareSilhouetteMod = new RareSilhouetteManager(scene, materials);

    // Pre-merged canonical tree geometries + global InstancedMesh queues for trees, palms, dead trees & shrubs
    const exteriorTreeQueues = {
      campusTrees: [],
      palmTrees: [],
      deadTrees: [],
      shrubs: [],
    };

    // Step 5 & Main Administration Building Shader Tweaks:
    // - Cool moonlit rim light on roof edges, cornices, pilasters & rotunda dome
    // - Reduced fog influence on the Main Administration Building ONLY (Fix 5: global fog untouched!)
    const mbShaderCfg = HORROR_CONFIG.mainBuilding || {};
    const mbFogInfluence = (typeof mbShaderCfg.fogInfluence === 'number') ? mbShaderCfg.fogInfluence : 0.34;
    const mbRimCol = mbShaderCfg.moonRimColor || [0.24, 0.38, 0.52];
    const mbRimInt = (typeof mbShaderCfg.moonRimIntensity === 'number') ? mbShaderCfg.moonRimIntensity : 0.92;
    const mbRimPow = (typeof mbShaderCfg.moonRimPower === 'number') ? mbShaderCfg.moonRimPower : 2.0;

    [
      materials.foliageGreen,
      materials.palmFrondMat,
      materials.brightBlueRoof,
      materials.jhingatiTerracottaRoof,
    ].forEach(mat => {
      if (!mat) return;
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          'float rimDot = 1.0 - max(0.0, dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)));\\n' +
          'float topBias = clamp(vNormal.y * 0.5 + 0.5, 0.0, 1.0);\\n' +
          'gl_FragColor.rgb += vec3(0.09, 0.16, 0.21) * pow(rimDot, 2.2) * topBias * 0.65;\\n' +
          '#include <dithering_fragment>'
        );
      };
    });

    function applyMainBuildingShaderTweaks(mat, rimScale = 1.0) {
      if (!mat) return;
      mat.onBeforeCompile = (shader) => {
        if ( rimScale > 0.0) {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            'float mbRimDot = 1.0 - max(0.0, abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))));\\n' +
            'float mbTopBias = clamp(vNormal.y * 0.55 + 0.45, 0.0, 1.0);\\n' +
            'gl_FragColor.rgb += vec3(' + mbRimCol[0].toFixed(3) + ', ' + mbRimCol[1].toFixed(3) + ', ' + mbRimCol[2].toFixed(3) + ') * pow(mbRimDot, ' + mbRimPow.toFixed(2) + ') * mbTopBias * ' + (mbRimInt * rimScale).toFixed(3) + ';\\n' +
            '#include <dithering_fragment>'
          );
        }
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <fog_fragment>',
          '#ifdef USE_FOG\\n' +
          '  #ifdef FOG_EXP2\\n' +
          '    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );\\n' +
          '  #else\\n' +
          '    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );\\n' +
          '  #endif\\n' +
          '  fogFactor *= ' + mbFogInfluence.toFixed(3) + ';\\n' +
          '  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );\\n' +
          '#endif'
        );
      };
    }

    [
      [materials.terracottaRoof, 1.15],
      [materials.rotundaRoofRidge, 1.30],
      [materials.rotundaRedSteel, 0.85],
      [materials.rotundaWhiteArch, 0.95],
      [materials.rotundaBrick, 0.45],
      [materials.rotundaPlinthConcrete, 0.35],
      [materials.rotundaColumnFlutedBase, 0.55],
      [materials.rotundaCurvedGlass, 1.10],
      [materials.rotundaCurvedGlassWarm, 0.65],
      [materials.rotundaWindowWarm, 0.0],
      [materials.rotundaWindowRed, 0.0],
      [materials.rotundaWindowDark, 0.50],
      [materials.rotundaSignMat, 0.40],
      [materials.rotundaOrangeRailingMat, 0.30],
    ].forEach(([m, rScale]) => applyMainBuildingShaderTweaks(m, rScale));

    const colliders = [];
    const walkableFloors = [];
    const walkableStairRamps = [];
    const interactiveHidingSpots = [];
    const rotundaInteriorLights = [];
    const swingingDoors = [];

    function addColliderBox(box, tag = 'wall') {
      if (!box) return;
      if (box.isBox3) {
        colliders.push({
          type: 'box',
          tag: tag,
          min: box.min,
          max: box.max,
          box: box,
        });
      } else if (box.min && box.max) {
        colliders.push({
          type: 'box',
          tag: tag,
          min: box.min,
          max: box.max,
          box: new THREE.Box3(box.min, box.max),
        });
      }
    }

    function addDoorFrameColliders(doorX, floorY, doorZ, doorW, wallT = 0.26, alongZ = true) {
      const jambThick = 0.10;
      const jambH = 2.45;
      const halfSpan = doorW * 0.5 - jambThick * 0.5;
      if (alongZ) {
        addColliderBox(new THREE.Box3(
          new THREE.Vector3(doorX - wallT * 0.55, floorY, doorZ - halfSpan - jambThick * 0.5),
          new THREE.Vector3(doorX + wallT * 0.55, floorY + jambH, doorZ - halfSpan + jambThick * 0.5)
        ), 'door_frame');
        addColliderBox(new THREE.Box3(
          new THREE.Vector3(doorX - wallT * 0.55, floorY, doorZ + halfSpan - jambThick * 0.5),
          new THREE.Vector3(doorX + wallT * 0.55, floorY + jambH, doorZ + halfSpan + jambThick * 0.5)
        ), 'door_frame');
      } else {
        addColliderBox(new THREE.Box3(
          new THREE.Vector3(doorX - halfSpan - jambThick * 0.5, floorY, doorZ - wallT * 0.55),
          new THREE.Vector3(doorX - halfSpan + jambThick * 0.5, floorY + jambH, doorZ + wallT * 0.55)
        ), 'door_frame');
        addColliderBox(new THREE.Box3(
          new THREE.Vector3(doorX + halfSpan - jambThick * 0.5, floorY, doorZ - wallT * 0.55),
          new THREE.Vector3(doorX + halfSpan + jambThick * 0.5, floorY + jambH, doorZ + wallT * 0.55)
        ), 'door_frame');
      }
    }

    function addColliderCylinder(x, z, radius, minY = 0, maxY = 5.0) {
      colliders.push({
        type: 'cylinder',
        x: x,
        z: z,
        radius: radius,
        minY: minY,
        maxY: maxY,
        min: new THREE.Vector3(x - radius, minY, z - radius),
        max: new THREE.Vector3(x + radius, maxY, z + radius),
      });
    }

    function addColliderOBB(cx, cz, hx, hz, rotY, minY = 0, maxY = 3.2, tag = 'wall', label = '') {
      const cosR = Math.cos(rotY);
      const sinR = Math.sin(rotY);
      const extX = Math.abs(hx * cosR) + Math.abs(hz * sinR);
      const extZ = Math.abs(hx * sinR) + Math.abs(hz * cosR);
      const minV = new THREE.Vector3(cx - extX, minY, cz - extZ);
      const maxV = new THREE.Vector3(cx + extX, maxY, cz + extZ);
      colliders.push({
        type: 'obb',
        tag: tag,
        label: label,
        cx: cx,
        cz: cz,
        hx: hx,
        hz: hz,
        rotY: rotY,
        cosR: cosR,
        sinR: sinR,
        minY: minY,
        maxY: maxY,
        min: minV,
        max: maxV,
        box: new THREE.Box3(minV, maxV),
      });
    }

    function addLocalBusOBBCollider(busX, busZ, rotY, lx, lz, w, d, minY, maxY, tag = 'wall', label = '') {
      const cosR = Math.cos(rotY);
      const sinR = Math.sin(rotY);
      const wx = busX + lx * cosR + lz * sinR;
      const wz = busZ - lx * sinR + lz * cosR;
      addColliderOBB(wx, wz, w * 0.5, d * 0.5, rotY, minY, maxY, tag, label);
    }

    function addWalkableFloor(minX, maxX, minZ, maxZ, floorY) {
      walkableFloors.push({ minX, maxX, minZ, maxZ, floorY });
    }

    function addOrientedWalkableFloor(busX, busZ, rotY, lx, lz, w, d, floorY) {
      const cosR = Math.cos(rotY);
      const sinR = Math.sin(rotY);
      const cx = busX + lx * cosR + lz * sinR;
      const cz = busZ - lx * sinR + lz * cosR;
      const hx = w * 0.5;
      const hz = d * 0.5;
      const extX = Math.abs(hx * cosR) + Math.abs(hz * sinR);
      const extZ = Math.abs(hx * sinR) + Math.abs(hz * cosR);
      walkableFloors.push({
        isOBB: true,
        cx,
        cz,
        hx,
        hz,
        rotY,
        cosR,
        sinR,
        minX: cx - extX,
        maxX: cx + extX,
        minZ: cz - extZ,
        maxZ: cz + extZ,
        floorY,
      });
    }

    function addWalkableStairRamp(minX, maxX, minZ, maxZ, zStart, zEnd, yStart, yEnd) {
      walkableStairRamps.push({ minX, maxX, minZ, maxZ, zStart, zEnd, yStart, yEnd });
    }

    function addOrientedWalkableStairRamp(busX, busZ, rotY, lx, lz, w, d, lxStart, lxEnd, yStart, yEnd) {
      const cosR = Math.cos(rotY);
      const sinR = Math.sin(rotY);
      const cx = busX + lx * cosR + lz * sinR;
      const cz = busZ - lx * sinR + lz * cosR;
      const hx = w * 0.5;
      const hz = d * 0.5;
      const extX = Math.abs(hx * cosR) + Math.abs(hz * sinR);
      const extZ = Math.abs(hx * sinR) + Math.abs(hz * cosR);
      walkableStairRamps.push({
        isOBB: true,
        cx,
        cz,
        hx,
        hz,
        rotY,
        cosR,
        sinR,
        minX: cx - extX,
        maxX: cx + extX,
        minZ: cz - extZ,
        maxZ: cz + extZ,
        lxStart,
        lxEnd,
        yStart,
        yEnd,
      });
    }

    function buildWallSegment(x, y, z, w, h, d, mat) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y + h / 2, z);
      scene.add(mesh);
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(x - w / 2, y, z - d / 2),
        new THREE.Vector3(x + w / 2, y + h, z + d / 2)
      ));
      return mesh;
    }

    function buildFloorSlabSegment(x, topY, z, w, thickness, d, mat) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, thickness, d), mat);
      mesh.position.set(x, topY - thickness / 2, z);
      scene.add(mesh);
      addWalkableFloor(x - w / 2, x + w / 2, z - d / 2, z + d / 2, topY);
      return mesh;
    }

    // Clean Prefab Modular Corner Trim (White vertical post trim matching Gandaki University drone photos)
    function buildCornerQuoins(cornerX, baseY, cornerZ, height) {
      const qb = new THREE.Mesh(new THREE.BoxGeometry(0.18, height, 0.18), materials.whiteTrim);
      qb.position.set(cornerX, baseY + height / 2, cornerZ);
      scene.add(qb);
    }

    // Modern Aluminum Sliding Classroom Window (Exact match to Gandaki University aerial drone photos)
    // Goal 4: Warm Glow on Classroom Doorways & Main Building Entrance (No real PointLights!)
    const doorwayGlowPoolGeo = new THREE.PlaneGeometry(3.2, 3.2);
    const doorwayGlowPoolMat = new THREE.MeshBasicMaterial({
      map: realisticGroundPoolTex,
      color: HORROR_CONFIG.lighting.doorwayGlowColor || 0xffb35c,
      transparent: true,
      opacity: HORROR_CONFIG.lighting.doorwayGlowOpacity || 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    function addWarmDoorwayGlow(dx, floorY, dz, spanW = 1.9, isAlongZ = false) {
      // Warm additive threshold pool just above the floor
      const pool = new THREE.Mesh(doorwayGlowPoolGeo, doorwayGlowPoolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(dx, floorY + 0.025, dz);
      scene.add(pool);

      // Warm emissive transom glow strip at the top of the doorway
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(isAlongZ ? 0.18 : spanW * 0.85, 0.08, isAlongZ ? spanW * 0.85 : 0.18),
        materials.windowWarmLit
      );
      strip.position.set(dx, floorY + 2.52, dz);
      scene.add(strip);
    }

    function buildDetailedWindow(wx, wy, wz, facingZDir = 1, isWarmLit = false, facingXDir = 0) {
      const wGroup = new THREE.Group();
      wGroup.position.set(wx, wy, wz);
      if (facingXDir !== 0) {
        wGroup.rotation.y = facingXDir === 1 ? Math.PI / 2 : -Math.PI / 2;
      } else if (facingZDir === -1) {
        wGroup.rotation.y = Math.PI;
      }

      const frame = new THREE.Mesh(sharedGeos.winFrameOuter, materials.whiteTrim);
      wGroup.add(frame);

      const sill = new THREE.Mesh(sharedGeos.winSillLedge, materials.whiteTrim);
      sill.position.set(0, -0.70, 0.05);
      wGroup.add(sill);

      const pane = new THREE.Mesh(
        sharedGeos.winPane,
        isWarmLit ? materials.windowWarmLit : materials.windowGlass
      );
      pane.position.z = 0.04;
      wGroup.add(pane);

      const mulV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.38, 0.06), materials.whiteTrim);
      mulV.position.set(0, 0, 0.06);
      wGroup.add(mulV);

      scene.add(wGroup);
    }

    // Gnarled Multi-Branch Silhouette Horror Tree — Instanced via ExteriorInstancedPools (2 draw calls for all trees!)
    function spawnCampusTree(x, z, scale = 1.0) {
      exteriorTreeQueues.campusTrees.push({ x, z, scale });

      const shadowMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(5.2 * scale, 5.2 * scale),
        materials.treeShadowDecal
      );
      shadowMesh.rotation.x = -Math.PI / 2;
      shadowMesh.position.set(x, 0.022, z);
      shadowMesh.userData.noMerge = true;
      scene.add(shadowMesh);
      treeShadowDecals.push({ mesh: shadowMesh, baseScale: 5.2 * scale, seed: Math.abs(x * 3.7 + z * 5.9) });

      addColliderCylinder(x, z, 0.42 * scale, 0, 4.5 * scale);
    }

    // Tropical / Campus Palm Tree — Instanced via ExteriorInstancedPools (2 draw calls for all palms!)
    function spawnPalmTree(x, z, scale = 1.0) {
      exteriorTreeQueues.palmTrees.push({ x, z, scale });

      const pShadow = new THREE.Mesh(
        new THREE.PlaneGeometry(3.8 * scale, 3.8 * scale),
        materials.treeShadowDecal
      );
      pShadow.rotation.x = -Math.PI / 2;
      pShadow.position.set(x, 0.022, z);
      pShadow.userData.noMerge = true;
      scene.add(pShadow);
      treeShadowDecals.push({ mesh: pShadow, baseScale: 3.8 * scale, seed: Math.abs(x * 2.1 + z * 4.3) });

      addColliderCylinder(x, z, 0.28 * scale, 0, 5.5 * scale);
    }

    // Roadside Shrubs & Weed Clumps — Instanced via ExteriorInstancedPools (1 draw call for all shrubs!)
    function spawnRoadsideShrubs(x, z, count = 4) {
      for (let i = 0; i < count; i++) {
        const ox = ((i * 7) % 5 - 2) * 0.28;
        const oz = ((i * 11) % 5 - 2) * 0.28;
        exteriorTreeQueues.shrubs.push({
          x: x + ox,
          y: 0.16,
          z: z + oz,
          sx: 1.1 + (i % 2) * 0.4,
          sy: 0.55 + (i % 3) * 0.2,
          sz: 1.1,
        });
      }
    }

    // Wrought-Iron Spiked Fencing along walkways & lawns (Instanced pickets)
    function buildWroughtIronFence(startX, startZ, endX, endZ) {
      const fGroup = new THREE.Group();
      const length = Math.hypot(endX - startX, endZ - startZ);
      const angle = Math.atan2(endX - startX, endZ - startZ);

      const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, length), materials.castIronDark);
      topRail.position.set(0, 1.05, length / 2);
      fGroup.add(topRail);

      const botRail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, length), materials.castIronDark);
      botRail.position.set(0, 0.22, length / 2);
      fGroup.add(botRail);

      const picketCount = Math.max(2, Math.floor(length / 0.44) + 1);
      const instPickets = new THREE.InstancedMesh(sharedGeos.fencePicket, materials.castIronDark, picketCount);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < picketCount; i++) {
        dummy.position.set(0, 0.60, i * 0.44);
        dummy.updateMatrix();
        instPickets.setMatrixAt(i, dummy.matrix);
      }
      instPickets.instanceMatrix.needsUpdate = true;
      fGroup.add(instPickets);

      fGroup.position.set(startX, 0, startZ);
      fGroup.rotation.y = angle;
      scene.add(fGroup);

      const fHeight = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.fenceHeight) || 1.5;
      const fThick = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.fenceThickness) || 0.15;
      const padX = Math.abs(endX - startX) < 0.05 ? fThick / 2 : 0;
      const padZ = Math.abs(endZ - startZ) < 0.05 ? fThick / 2 : 0;
      const minX = Math.min(startX, endX) - padX;
      const maxX = Math.max(startX, endX) + padX;
      const minZ = Math.min(startZ, endZ) - padZ;
      const maxZ = Math.max(startZ, endZ) + padZ;
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(minX, 0, minZ),
        new THREE.Vector3(maxX, fHeight, maxZ)
      ));
    }

    // Dead Leafless Gnarled Horror Tree — Instanced via ExteriorInstancedPools (1 draw call for all dead trees!)
    function spawnDeadTree(x, z, scale = 1.0) {
      exteriorTreeQueues.deadTrees.push({ x, z, scale });

      const shadowMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(4.8 * scale, 4.8 * scale),
        materials.treeShadowDecal
      );
      shadowMesh.rotation.x = -Math.PI / 2;
      shadowMesh.position.set(x, 0.022, z);
      scene.add(shadowMesh);

      addColliderBox(new THREE.Box3(
        new THREE.Vector3(x - 0.4 * scale, 0, z - 0.4 * scale),
        new THREE.Vector3(x + 0.4 * scale, 4.2 * scale, z + 0.4 * scale)
      ));
    }

    /* =========================================================================
       AUTHENTIC NEPALI NEWARI HERITAGE ARCHITECTURAL BUILDERS (REF PHOTOS 1-6)
       - Carved Sal-Wood Pillars (Thamo) with Stone Lotus Bases (Ilohan) & Meth Capitals
       - Angled Carved Deity Roof Struts (Tundal) & Exposed Timber Rafters (Dalin)
       - Projecting 3-Bay & 5-Bay Carved Ebony Lattice Windows (Sanjhyal / Tikijhyal)
       - Carved Deity Tympanum Doorways (Torana) & 10-Panel Khapa Doors
       - Recessed Pointed-Arch Brick Oil-Lamp Niches (Khopa / Diyo)
       - Stepped Stone Chaitya Stupa Shrines & Carved Wooden Falcha / Pati Pavilions
       ========================================================================= */

    // 1. Carved Newari Timber Pillar (Thamo) with Stone Lotus Pedestal (Ilohan) & Bracket Capital (Meth) (Ref Photos 1, 4, 5, 6)
    function buildCarvedNewariPillar(px, baseY, pz, height = 3.35, rotY = 0) {
      const pGroup = new THREE.Group();
      pGroup.position.set(px, baseY, pz);
      pGroup.rotation.y = rotY;

      // Carved Grey-Stone Lotus Base (Ilohan) with corner floral bosses (Ref Photo 1 right column base)
      const stoneBase = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.42), materials.riverStoneCoping);
      stoneBase.position.y = 0.12;
      pGroup.add(stoneBase);
      const lotusRing = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.23, 0.12, 12), materials.riverStoneCoping);
      lotusRing.position.y = 0.30;
      pGroup.add(lotusRing);

      // Lower Square Carved Sal-Wood Shaft (0.36..1.75m)
      const lowerH = height * 0.44;
      const lowerShaft = new THREE.Mesh(new THREE.BoxGeometry(0.26, lowerH, 0.26), materials.carvedSalWood);
      lowerShaft.position.y = 0.36 + lowerH / 2;
      lowerShaft.castShadow = true;
      pGroup.add(lowerShaft);

      // Multi-Tiered Carved Rings & Octagonal Necking (Ref Photo 1 foreground pillar)
      const midBaseY = 0.36 + lowerH;
      for (let r = 0; r < 5; r++) {
        const ringW = (r % 2 === 0) ? 0.30 : 0.23;
        const ring = new THREE.Mesh(new THREE.BoxGeometry(ringW, 0.08, ringW), materials.ebonyCarvedWood);
        ring.position.y = midBaseY + r * 0.085 + 0.04;
        pGroup.add(ring);
      }

      // Upper Tapered Carved Shaft
      const upperBaseY = midBaseY + 0.44;
      const upperH = Math.max(0.35, height - upperBaseY - 0.32);
      const upperShaft = new THREE.Mesh(new THREE.BoxGeometry(0.24, upperH, 0.24), materials.carvedSalWood);
      upperShaft.position.y = upperBaseY + upperH / 2;
      upperShaft.castShadow = true;
      pGroup.add(upperShaft);

      // Wide Double-Bracket Carved Wooden Capital (Meth) with Scroll Corbels (Ref Photo 1 & 6)
      const capY = height - 0.16;
      const methCenter = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.20, 0.34), materials.ebonyCarvedWood);
      methCenter.position.y = capY;
      pGroup.add(methCenter);

      const methWide = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.16, 0.28), materials.carvedSalWood);
      methWide.position.y = capY + 0.12;
      pGroup.add(methWide);

      // Ground contact shadow decal
      const pShadow = new THREE.Mesh(sharedGeos.columnContactShadow, materials.pedestalShadowDecal);
      pShadow.rotation.x = -Math.PI / 2;
      pShadow.position.y = 0.02;
      pGroup.add(pShadow);

      scene.add(pGroup);
    }

    // 2. Angled Carved Wooden Deity Roof Strut (Tundal) Supporting Overhanging Eaves (Ref Photos 1, 3, 5)
    function buildTundalRoofStrut(sx, baseY, sz, outDirX, outDirZ, strutHeight = 1.15, overhangReach = 0.72) {
      const sGroup = new THREE.Group();
      sGroup.position.set(sx, baseY, sz);
      if (Math.abs(outDirX) > 0.5) {
        sGroup.rotation.y = outDirX > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else if (outDirZ < 0) {
        sGroup.rotation.y = Math.PI;
      }

      const len = Math.hypot(strutHeight, overhangReach);
      const tilt = Math.atan2(overhangReach, strutHeight);

      // Main diagonal carved timber strut beam
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.11, len, 0.13), materials.ebonyCarvedWood);
      beam.position.set(0, strutHeight * 0.5, overhangReach * 0.5);
      beam.rotation.x = tilt;
      sGroup.add(beam);

      // Carved deity figure relief blocks along the front face of the Tundal strut (Ref Photo 1 right eave!)
      const figureBody = new THREE.Mesh(new THREE.BoxGeometry(0.14, len * 0.56, 0.08), materials.carvedSalWood);
      figureBody.position.set(0, strutHeight * 0.52, overhangReach * 0.52 + 0.05);
      figureBody.rotation.x = tilt;
      sGroup.add(figureBody);

      // Carved lotus pendant at base of strut against brick wall
      const baseCorbel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), materials.ebonyCarvedWood);
      baseCorbel.position.set(0, 0.05, 0.06);
      sGroup.add(baseCorbel);

      scene.add(sGroup);
    }

    // 3. Projecting Multi-Bay Carved Ebony Newari Window (Sanjhyal / Tikijhyal) + Optional Haunted Blue Spotlight (Ref Photos 3, 4, 5)
    function buildSanjhyalCarvedWindow(wx, wy, wz, outDirX, outDirZ, bays = 3, isWarmLit = true, hasBlueCurseLight = false) {
      const wGroup = new THREE.Group();
      wGroup.position.set(wx, wy, wz);
      if (Math.abs(outDirX) > 0.5) {
        wGroup.rotation.y = outDirX > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else if (outDirZ < 0) {
        wGroup.rotation.y = Math.PI;
      }

      const bayW = 0.74;
      const totalW = bays * bayW + 0.36;
      const winH = 1.48;
      const projD = 0.28;

      // 1. Row of projecting carved wooden beam-ends (Dalin / Nasah lion-face blocks) under sill (Ref Photo 3!)
      const numBlocks = bays * 3 + 2;
      for (let b = 0; b < numBlocks; b++) {
        const bx = -totalW / 2 + 0.10 + (b / (numBlocks - 1)) * (totalW - 0.20);
        const dentil = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, projD + 0.08), materials.ebonyCarvedWood);
        dentil.position.set(bx, -winH / 2 - 0.16, projD / 2);
        wGroup.add(dentil);
      }

      // 2. Stepped Carved Ebony Sill Cornice & Top Overhanging Lintel Cornice
      const sillBeam = new THREE.Mesh(new THREE.BoxGeometry(totalW + 0.18, 0.14, projD + 0.06), materials.ebonyCarvedWood);
      sillBeam.position.set(0, -winH / 2 - 0.04, projD / 2);
      wGroup.add(sillBeam);

      const topCornice = new THREE.Mesh(new THREE.BoxGeometry(totalW + 0.26, 0.16, projD + 0.12), materials.ebonyCarvedWood);
      topCornice.position.set(0, winH / 2 + 0.06, projD / 2 + 0.02);
      wGroup.add(topCornice);

      // 3. Main Projecting Carved Dark-Wood Box Frame
      const boxBack = new THREE.Mesh(new THREE.BoxGeometry(totalW, winH, projD), materials.carvedSalWood);
      boxBack.position.set(0, 0, projD / 2 - 0.02);
      wGroup.add(boxBack);

      // 4. Individual Carved Lattice Bays (Tikijhyal Diamond Grille + Miniature Balusters + Pointed Torana Arch Finials)
      for (let i = 0; i < bays; i++) {
        const cx = (i - (bays - 1) / 2) * bayW;

        // Inner backing glass (warm amber interior glow or dark shadowed glass)
        const backingGlass = new THREE.Mesh(
          new THREE.PlaneGeometry(bayW - 0.14, winH - 0.24),
          isWarmLit ? materials.windowWarmLit : materials.windowGlass
        );
        backingGlass.position.set(cx, 0.02, projD + 0.005);
        wGroup.add(backingGlass);

        // Perforated geometric lattice panel (Tikijhyal)
        const latticePane = new THREE.Mesh(
          new THREE.BoxGeometry(bayW - 0.16, winH * 0.62, 0.04),
          materials.tikijhyalLattice
        );
        latticePane.position.set(cx, 0.12, projD + 0.02);
        wGroup.add(latticePane);

        // Miniature turned wooden balustrade spindles along the lower sill (Ref Photo 3 & 4)
        for (let sp = -2; sp <= 2; sp++) {
          const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.28, 6), materials.ebonyCarvedWood);
          spindle.position.set(cx + sp * 0.11, -winH * 0.34, projD + 0.03);
          wGroup.add(spindle);
        }

        // Carved dividing pilaster column between bays
        const pil = new THREE.Mesh(new THREE.BoxGeometry(0.11, winH + 0.06, projD + 0.08), materials.ebonyCarvedWood);
        pil.position.set(cx - bayW / 2, 0, projD / 2 + 0.02);
        wGroup.add(pil);
        if (i === bays - 1) {
          const pilRight = pil.clone();
          pilRight.position.set(cx + bayW / 2, 0, projD / 2 + 0.02);
          wGroup.add(pilRight);
        }

        // Pointed Ornate Carved Arch Hood & Kirtimukha Finial crowning each bay (Ref Photo 3 & 5!)
        const archCrown = new THREE.Mesh(new THREE.ConeGeometry(bayW * 0.38, 0.34, 4), materials.ebonyCarvedWood);
        archCrown.position.set(cx, winH / 2 + 0.24, projD + 0.02);
        archCrown.rotation.y = Math.PI / 4;
        wGroup.add(archCrown);

        // White/Silver highlight dragon strut on multi-bay Sanjhyal (Ref Photo 5 center window!)
        if (bays >= 3) {
          const dragonStrut = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.42, 0.05), materials.rotundaWhiteArch);
          dragonStrut.position.set(cx - bayW * 0.36, 0.18, projD + 0.06);
          dragonStrut.rotation.x = -0.25;
          wGroup.add(dragonStrut);
        }
      }

      // 5. Sloped Jhingati Terracotta Tile Overhang Hood (Chhajja) above the Sanjhyal window (Ref Photo 5!)
      const hoodSlope = new THREE.Mesh(
        new THREE.BoxGeometry(totalW + 0.48, 0.09, 0.62),
        materials.jhingatiTerracottaRoof
      );
      hoodSlope.position.set(0, winH / 2 + 0.36, projD + 0.12);
      hoodSlope.rotation.x = 0.38;
      wGroup.add(hoodSlope);

      // 6. Optional Cold Cyan-Blue Haunted Spotlight above the central Torana finial (Exact match to Ref Photo 3!)
      if (hasBlueCurseLight) {
        const blueOrb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 10), materials.hauntedBlueGlow);
        blueOrb.position.set(0, winH / 2 + 0.52, projD + 0.18);
        wGroup.add(blueOrb);

        const blueSpriteMat = new THREE.SpriteMaterial({
          map: warmLampBloomTex,
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const blueHalo = new THREE.Sprite(blueSpriteMat);
        blueHalo.position.set(0, winH / 2 + 0.52, projD + 0.22);
        blueHalo.scale.set(1.65, 1.65, 1);
        wGroup.add(blueHalo);
      }

      scene.add(wGroup);
    }

    // 4. Traditional Newari Carved Wood Doorway + Semicircular Deity Torana Tympanum + Paneled Khapa Doors (Ref Photos 2, 3, 5, 6)
    function buildNewariToranaDoorway(dx, baseY, dz, outDirX, outDirZ, doorW = 1.90, doorH = 2.55) {
      const dGroup = new THREE.Group();
      dGroup.position.set(dx, baseY, dz);
      if (Math.abs(outDirX) > 0.5) {
        dGroup.rotation.y = outDirX > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else if (outDirZ < 0) {
        dGroup.rotation.y = Math.PI;
      }

      // Stepped Triple-Jamb Carved Dark Sal-Wood Doorframe (Ref Photo 5 & 6)
      const jambW = 0.24;
      [-doorW / 2 - jambW / 2, doorW / 2 + jambW / 2].forEach(jx => {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(jambW, doorH + 0.18, 0.34), materials.ebonyCarvedWood);
        jamb.position.set(jx, doorH / 2, 0);
        dGroup.add(jamb);
      });

      // Heavy Projecting Carved Wooden Lintel Beam with Winged Ends (Nino)
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.96, 0.24, 0.38), materials.ebonyCarvedWood);
      lintel.position.set(0, doorH + 0.08, 0);
      dGroup.add(lintel);

      // Ornate Semicircular/Triangular Carved Deity Tympanum (Torana) tilted forward above doorway (Ref Photo 3 & 5!)
      const toranaGroup = new THREE.Group();
      toranaGroup.position.set(0, doorH + 0.22, 0.16);
      toranaGroup.rotation.x = 0.18; // Authentic forward tilt of Nepali Toranas!

      const toranaArch = new THREE.Mesh(
        new THREE.CylinderGeometry(doorW * 0.48, doorW * 0.54, 0.10, 16, 1, false, 0, Math.PI),
        materials.ebonyCarvedWood
      );
      toranaArch.rotation.z = -Math.PI / 2;
      toranaArch.rotation.y = Math.PI / 2;
      toranaGroup.add(toranaArch);

      // Central Kirtimukha / Deity Relief Medallion inside the Torana
      const deityRelief = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.14, 12), materials.carvedSalWood);
      deityRelief.rotation.x = Math.PI / 2;
      deityRelief.position.set(0, 0.28, 0.02);
      toranaGroup.add(deityRelief);

      const topSpire = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.28, 8), materials.ebonyCarvedWood);
      topSpire.position.set(0, doorW * 0.48 + 0.10, 0);
      toranaGroup.add(topSpire);
      dGroup.add(toranaGroup);

      // Open 10-Panel Carved Dark-Wood Double Doors (Khapa, Ref Photo 6) swung inward
      [-1, 1].forEach(side => {
        const leafW = doorW * 0.46;
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, doorH - 0.08, 0.06), materials.carvedSalWood);
        leaf.position.set(side * (doorW / 2 - 0.08), (doorH - 0.08) / 2, -leafW * 0.48);
        leaf.rotation.y = side * 1.38;
        dGroup.add(leaf);
      });

      scene.add(dGroup);
    }

    // 5. Recessed Pointed-Arch Brick Wall Niche (Khopa) with Flickering Warm Diyo Clay Oil Lamp (Ref Photo 5!)
    function buildDiyoBrickNiche(nx, ny, nz, outDirX, outDirZ) {
      const nGroup = new THREE.Group();
      nGroup.position.set(nx, ny, nz);
      if (Math.abs(outDirX) > 0.5) {
        nGroup.rotation.y = outDirX > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else if (outDirZ < 0) {
        nGroup.rotation.y = Math.PI;
      }

      // Dark recessed niche backing + stepped brick corbel arch
      const recess = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.38, 0.08), materials.ebonyCarvedWood);
      recess.position.set(0, 0, 0.02);
      nGroup.add(recess);

      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.14), materials.nepalDachiBrick);
      sill.position.set(0, -0.20, 0.05);
      nGroup.add(sill);

      // Clay Diyo oil lamp bowl + glowing warm flame core
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.04, 8), materials.teliyaFloorTile);
      bowl.position.set(0, -0.15, 0.06);
      nGroup.add(bowl);

      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.075, 6), materials.diyoFlameGlow);
      flame.position.set(0, -0.10, 0.06);
      nGroup.add(flame);

      // Soft warm amber Diyo halo sprite on the brick wall
      const diyoHaloMat = new THREE.SpriteMaterial({
        map: warmLampBloomTex,
        color: 0xff922b,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const diyoHalo = new THREE.Sprite(diyoHaloMat);
      diyoHalo.position.set(0, -0.08, 0.10);
      diyoHalo.scale.set(0.75, 0.75, 1);
      nGroup.add(diyoHalo);

      scene.add(nGroup);
    }

    // 6. Cascading Creeping Courtyard Vines & Terracotta Clay Urns (Ghyampo, Ref Photos 1, 2, 4)
    function buildBalconyHangingVines(vx, vy, vz, spanLen = 4.0, alongZ = true) {
      const vGroup = new THREE.Group();
      vGroup.position.set(vx, vy, vz);
      const count = Math.max(3, Math.floor(spanLen / 0.85));
      for (let i = 0; i < count; i++) {
        const offset = (i - (count - 1) / 2) * 0.82;
        const px = alongZ ? 0 : offset;
        const pz = alongZ ? offset : 0;

        // Terracotta clay flower pot on balcony ledge
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.11, 0.24, 10), materials.teliyaFloorTile);
        pot.position.set(px, 0.12, pz);
        vGroup.add(pot);

        // Trailing vine strands hanging down over the carved wooden beam (Ref Photo 2!)
        const strandCount = 2 + (i % 2);
        for (let s = 0; s < strandCount; s++) {
          const dropLen = 0.65 + ((i * 3 + s * 5) % 5) * 0.22;
          const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.015, dropLen, 5), materials.foliageGreen);
          vine.position.set(px + (s - 0.5) * 0.12, -dropLen / 2 + 0.08, pz + (s % 2 === 0 ? 0.05 : -0.05));
          vine.rotation.z = (s - 0.5) * 0.15;
          vGroup.add(vine);
        }
      }
      scene.add(vGroup);
    }

    // Procedural Harmika Buddha Wisdom Eyes drawn into Signage Texture Atlas (0, 0, 256, 128)
    if (sAtlasCtx) {
      sAtlasCtx.fillStyle = '#d9b338';
      sAtlasCtx.fillRect(0, 0, 256, 128);
      sAtlasCtx.strokeStyle = '#7c2d12';
      sAtlasCtx.lineWidth = 6;
      sAtlasCtx.strokeRect(4, 4, 248, 120);
      [68, 188].forEach(ex => {
        sAtlasCtx.fillStyle = '#f8fafc';
        sAtlasCtx.beginPath();
        sAtlasCtx.ellipse(ex, 62, 34, 15, 0, 0, Math.PI * 2);
        sAtlasCtx.fill();
        sAtlasCtx.lineWidth = 3.5;
        sAtlasCtx.strokeStyle = '#090d16';
        sAtlasCtx.stroke();
        sAtlasCtx.fillStyle = '#0f172a';
        sAtlasCtx.beginPath();
        sAtlasCtx.arc(ex, 62, 11, 0, Math.PI * 2);
        sAtlasCtx.fill();
      });
      sAtlasCtx.fillStyle = '#991b1b';
      sAtlasCtx.beginPath();
      sAtlasCtx.arc(128, 30, 8, 0, Math.PI * 2);
      sAtlasCtx.fill();
    }
    const harmikaEyesMat = new THREE.MeshStandardMaterial({
      map: signageAtlasTex,
      roughness: 0.45,
      metalness: 0.25,
    });
    const sharedHarmikaBoxGeo = createAtlasUvGeo(new THREE.BoxGeometry(0.46, 0.30, 0.46), 0, 0, 256, 128);
    const sharedPrayerWheelGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.24, 10);

    // TASK 3: Stupa with Harmika Buddha Eyes, Tiered Spire Rings, Pinnacle & Prayer Wheels Around Base
    function buildStoneChaityaShrine(cx, cz, labelName = 'Courtyard Stone Chaitya Shrine') {
      const cGroup = new THREE.Group();
      cGroup.position.set(cx, 0, cz);

      // 4 Stepped Square Grey-Stone Plinth Tiers
      const tiers = [
        { w: 2.55, h: 0.20, y: 0.10 },
        { w: 2.10, h: 0.28, y: 0.34 },
        { w: 1.68, h: 0.30, y: 0.63 },
        { w: 1.28, h: 0.24, y: 0.90 },
      ];
      tiers.forEach(t => {
        const tierMesh = new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h, t.w), materials.riverStoneCoping);
        tierMesh.position.y = t.y;
        cGroup.add(tierMesh);
      });

      // 12 Instanced Copper/Brass Prayer Wheels (Mani Khorlo) mounted around the 2nd plinth tier!
      const wheelOffsets = [
        [-0.92, -0.60], [-0.92, 0.0], [-0.92, 0.60],
        [ 0.92, -0.60], [ 0.92, 0.0], [ 0.92, 0.60],
        [-0.60, -0.92], [ 0.0, -0.92], [ 0.60, -0.92],
        [-0.60,  0.92], [ 0.0,  0.92], [ 0.60,  0.92],
      ];
      const instWheels = new THREE.InstancedMesh(sharedPrayerWheelGeo, materials.brassGajur, wheelOffsets.length);
      const dummy = new THREE.Object3D();
      wheelOffsets.forEach(([wx, wz], idx) => {
        dummy.position.set(wx, 0.63, wz);
        dummy.updateMatrix();
        instWheels.setMatrixAt(idx, dummy.matrix);
      });
      instWheels.instanceMatrix.needsUpdate = true;
      cGroup.add(instWheels);

      // Carved Lotus Drum & Hemispherical Garbhagriha Dome
      const lotusDrum = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.62, 0.22, 14), materials.rotundaColumnFlutedBase);
      lotusDrum.position.y = 1.12;
      cGroup.add(lotusDrum);

      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.54, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), materials.rotundaWhiteArch);
      dome.position.y = 1.20;
      cGroup.add(dome);

      // Harmika Cube with Painted Buddha Wisdom Eyes on all 4 sides!
      const harmika = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.30, 0.46), harmikaEyesMat);
      harmika.position.y = 1.78;
      cGroup.add(harmika);

      // Tiered Conical Spire (Chudamani) with 7 visible concentric rings + Small Pinnacle Umbrella (Chhatra)
      for (let r = 0; r < 7; r++) {
        const rt = r / 7;
        const rad = 0.28 * (1 - rt * 0.65);
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.92, rad, 0.09, 10), materials.brassGajur);
        ring.position.y = 1.98 + r * 0.10;
        cGroup.add(ring);
      }

      const pinnacle = new THREE.Mesh(new THREE.ConeGeometry(0.20, 0.24, 10), materials.brassGajur);
      pinnacle.position.y = 2.76;
      cGroup.add(pinnacle);

      // Blob contact shadow under Stupa
      const stupaShadow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), materials.treeShadowDecal);
      stupaShadow.rotation.x = -Math.PI / 2;
      stupaShadow.position.y = 0.022;
      cGroup.add(stupaShadow);

      scene.add(cGroup);

      addColliderBox(new THREE.Box3(
        new THREE.Vector3(cx - 1.25, 0, cz - 1.25),
        new THREE.Vector3(cx + 1.25, 2.8, cz + 1.25)
      ));

      interactiveHidingSpots.push({
        id: 'chaitya-' + Math.round(cx) + '-' + Math.round(cz),
        name: labelName,
        x: cx,
        y: 0,
        z: cz + 1.45,
        zone: 'Newari Heritage Courtyard',
      });
    }

    // 8. Traditional Open Carved-Wood Newari Rest Pavilion (Falcha / Pati, Exact match to Ref Photo 4 Foreground-Left!)
    function buildNewariFalchaPavilion(fx, fz, width = 5.8, depth = 3.8, labelName = 'Newari Carved-Wood Falcha Pavilion') {
      const fGroup = new THREE.Group();
      fGroup.position.set(fx, 0, fz);

      const plinthH = 0.42;
      // Stepped stone & brick plinth base
      const outerStep = new THREE.Mesh(new THREE.BoxGeometry(width + 0.55, 0.18, depth + 0.55), materials.riverStoneCoping);
      outerStep.position.y = 0.09;
      fGroup.add(outerStep);

      const mainPlinth = new THREE.Mesh(new THREE.BoxGeometry(width, plinthH, depth), materials.nepalDachiBrick);
      mainPlinth.position.y = plinthH / 2;
      fGroup.add(mainPlinth);

      // Polished Teliya Inta terracotta tile deck on top of plinth
      const tileDeck = new THREE.Mesh(new THREE.BoxGeometry(width - 0.08, 0.05, depth - 0.08), materials.teliyaFloorTile);
      tileDeck.position.y = plinthH + 0.02;
      fGroup.add(tileDeck);

      addWalkableFloor(fx - width / 2 - 0.3, fx + width / 2 + 0.3, fz - depth / 2 - 0.3, fz + depth / 2 + 0.3, plinthH);

      // Rear Dachi Appa Brick Shrine Wall with Wooden Dado Paneling (Ref Photo 4 left pavilion!)
      const backZ = -depth / 2 + 0.16;
      const backWall = new THREE.Mesh(new THREE.BoxGeometry(width - 0.2, 2.95, 0.26), materials.nepalDachiBrick);
      backWall.position.set(0, plinthH + 1.48, backZ);
      fGroup.add(backWall);
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(fx - width / 2, 0, fz + backZ - 0.18),
        new THREE.Vector3(fx + width / 2, plinthH + 3.1, fz + backZ + 0.18)
      ));

      const woodWainscot = new THREE.Mesh(new THREE.BoxGeometry(width - 0.4, 1.05, 0.30), materials.carvedSalWood);
      woodWainscot.position.set(0, plinthH + 0.52, backZ + 0.03);
      fGroup.add(woodWainscot);

      // 3 Front Carved Sal-Wood Pillars + 2 Side Pillars + Waist-High Wooden Bench Backrests (Ref Photo 4!)
      [-width / 2 + 0.32, 0, width / 2 - 0.32].forEach(px => {
        buildCarvedNewariPillar(fx + px, plinthH, fz + depth / 2 - 0.28, 2.95, 0);
      });

      // Low carved wooden bench & wainscot rail along left and right sides of the Falcha
      [-width / 2 + 0.28, width / 2 - 0.28].forEach(sx => {
        const sideBench = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.45, depth - 0.8), materials.carvedSalWood);
        sideBench.position.set(sx, plinthH + 0.22, 0.1);
        fGroup.add(sideBench);
      });

      // Warm under-eave fairy/spot lights along the front timber beam (Ref Photo 4!)
      for (let lx = -width / 2 + 0.5; lx <= width / 2 - 0.5; lx += 0.85) {
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), materials.diyoFlameGlow);
        bulb.position.set(lx, plinthH + 2.88, depth / 2 + 0.18);
        fGroup.add(bulb);
      }

      scene.add(fGroup);

      // Traditional Jhingati Terracotta Pitched Roof with Exposed Rafters & Angled Tundal Struts
      buildPitchedGableRoof(fx, plinthH + 2.95, fz, width + 0.8, depth + 0.8, 1.28, materials.jhingatiTerracottaRoof, false);

      // Recessed Diyo niches on the rear brick shrine wall
      [-1.4, 0, 1.4].forEach(nx => {
        buildDiyoBrickNiche(fx + nx, plinthH + 1.75, fz + backZ + 0.14, 0, 1);
      });

      interactiveHidingSpots.push({
        id: 'falcha-pavilion-' + Math.round(fx),
        name: labelName,
        x: fx,
        y: plinthH,
        z: fz,
        zone: 'Newari Heritage Courtyard',
      });
    }

    // 9. Parked Courtyard Scooter / Motorcycle (Exact match to Ref Photo 4 Right Courtyard!)
    function buildCourtyardScooter(sx, sz, rotY = 0.6) {
      const sGroup = new THREE.Group();
      sGroup.position.set(sx, 0, sz);
      sGroup.rotation.y = rotY;

      // Front & rear wheels
      [-0.58, 0.58].forEach(wz => {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.12, 12), materials.rubberTire);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(0, 0.24, wz);
        sGroup.add(wheel);
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.14, 8), materials.wheelRim);
        rim.rotation.z = Math.PI / 2;
        rim.position.set(0, 0.24, wz);
        sGroup.add(rim);
      });

      // Scooter body chassis, leg shield, seat & handlebars
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 1.15), materials.rotundaRedSteel);
      body.position.set(0, 0.46, 0.08);
      sGroup.add(body);

      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.68), materials.rubberTire);
      seat.position.set(0, 0.72, 0.18);
      sGroup.add(seat);

      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.68, 0.16), materials.castIronDark);
      stem.position.set(0, 0.68, -0.42);
      stem.rotation.x = 0.22;
      sGroup.add(stem);

      const handlebar = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.05, 0.06), materials.wheelRim);
      handlebar.position.set(0, 1.02, -0.36);
      sGroup.add(handlebar);

      const headlight = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), materials.headlightLit);
      headlight.position.set(0, 1.02, -0.41);
      sGroup.add(headlight);

      scene.add(sGroup);
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(sx - 0.45, 0, sz - 0.75),
        new THREE.Vector3(sx + 0.45, 1.15, sz + 0.75)
      ));
    }

    /* =========================================================================
       CULTURAL DETAILS, CONCRETE FOOTPATHS, DRY LEAVES & PRAYER FLAGS
       - Colorful 5-Color Nepali Lungta Prayer Flags (Blue, White, Red, Green, Yellow)
       - Raised Brushed-Concrete Footpaths with Curbs mixed with Natural Grass
       - Scattered Fallen Dry Autumn Leaves along Footpaths & Under Trees
       ========================================================================= */
    // TASK 3 & 4: GPU Vertex-Shader Sine-Wave Cloth Prayer Flags on a Sagging Catenary String (Zero CPU per-frame loop!)
    const prayerFlagUniforms = { uTime: { value: 0.0 } };
    const sharedFlagGeo = new THREE.PlaneGeometry(0.28, 0.34, 3, 2);
    const sharedFlagMat = new THREE.MeshBasicMaterial({
      vertexColors: false,
      side: THREE.DoubleSide,
    });
    sharedFlagMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = prayerFlagUniforms.uTime;
      shader.vertexShader = 'uniform float uTime;\\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\\n' +
        'float clothWave = sin(uTime * 3.8 + position.x * 9.0 + position.y * 5.0) * 0.065 * (0.5 - position.y);\\n' +
        'transformed.z += clothWave;'
      );
    };
    const flagPaletteColors = [
      new THREE.Color(0x2563eb), // Blue
      new THREE.Color(0xe2e8f0), // White
      new THREE.Color(0xb91c1c), // Red
      new THREE.Color(0x15803d), // Green
      new THREE.Color(0xca8a04), // Yellow
    ];
    const stringCordMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });

    function buildPrayerFlagString(x1, y1, z1, x2, y2, z2, sag = 0.55, numFlags = 14) {
      const fGroup = new THREE.Group();
      const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
      const spanLen = Math.hypot(dx, dy, dz);
      const yaw = Math.atan2(dx, dz);

      // 1. Sagging Catenary Cord Segments (4 low-poly cylinder links along the catenary curve)
      const cordSegs = 4;
      for (let s = 0; s < cordSegs; s++) {
        const t0 = s / cordSegs, t1 = (s + 1) / cordSegs;
        const p0x = x1 + dx * t0, p0y = y1 + dy * t0 - Math.sin(t0 * Math.PI) * sag, p0z = z1 + dz * t0;
        const p1x = x1 + dx * t1, p1y = y1 + dy * t1 - Math.sin(t1 * Math.PI) * sag, p1z = z1 + dz * t1;
        const segLen = Math.hypot(p1x - p0x, p1y - p0y, p1z - p0z);
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, segLen, 4), stringCordMat);
        cord.position.set((p0x + p1x) * 0.5, (p0y + p1y) * 0.5, (p0z + p1z) * 0.5);
        cord.lookAt(p1x, p1y, p1z);
        cord.rotateX(Math.PI / 2);
        fGroup.add(cord);
      }

      // 2. Single THREE.InstancedMesh for all cloth flags along the string (1 draw call!)
      const instFlags = new THREE.InstancedMesh(sharedFlagGeo, sharedFlagMat, numFlags - 1);
      const dummy = new THREE.Object3D();
      for (let i = 1; i < numFlags; i++) {
        const t = i / numFlags;
        const dip = Math.sin(t * Math.PI) * sag;
        dummy.position.set(x1 + dx * t, y1 + dy * t - dip - 0.17, z1 + dz * t);
        dummy.rotation.set(0, yaw + ((i % 2 === 0) ? 0.06 : -0.06), ((i % 3) - 1) * 0.05);
        dummy.updateMatrix();
        instFlags.setMatrixAt(i - 1, dummy.matrix);
        instFlags.setColorAt(i - 1, flagPaletteColors[i % 5]);
      }
      instFlags.instanceMatrix.needsUpdate = true;
      if (instFlags.instanceColor) instFlags.instanceColor.needsUpdate = true;
      fGroup.add(instFlags);
      scene.add(fGroup);
    }

    // 2. Raised Brushed-Concrete Footpath with Stone Curb Edges (Mixed with Natural Grass!)
    function buildConcreteFootpath(cx, cz, width, length, isEastWest = false) {
      const pathGroup = new THREE.Group();
      const w = isEastWest ? length : width;
      const d = isEastWest ? width : length;

      const concreteSlab = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.07, d),
        materials.interlockingPavers
      );
      concreteSlab.position.set(cx, 0.035, cz);
      pathGroup.add(concreteSlab);

      if (isEastWest) {
        [-width / 2 - 0.08, width / 2 + 0.08].forEach(oz => {
          const curb = new THREE.Mesh(new THREE.BoxGeometry(length, 0.11, 0.16), materials.riverStoneCoping);
          curb.position.set(cx, 0.055, cz + oz);
          pathGroup.add(curb);
        });
      } else {
        [-width / 2 - 0.08, width / 2 + 0.08].forEach(ox => {
          const curb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, length), materials.riverStoneCoping);
          curb.position.set(cx + ox, 0.055, cz);
          pathGroup.add(curb);
        });
      }
      scene.add(pathGroup);
    }

    // 3. Instanced Fallen Dry Autumn Leaf Clusters (1 draw call per cluster!)
    const sharedDryLeafGeo = new THREE.PlaneGeometry(0.24, 0.15);
    const sharedDryLeafMat = new THREE.MeshBasicMaterial({ color: 0x854d0e, side: THREE.DoubleSide });
    const leafColors = [new THREE.Color(0x7c2d12), new THREE.Color(0x9a3412), new THREE.Color(0x713f12)];

    function spawnDryLeafClusters(cx, cz, radius = 2.4, count = 12) {
      const instLeaves = new THREE.InstancedMesh(sharedDryLeafGeo, sharedDryLeafMat, count);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        const ang = (i * 2.39996) % (Math.PI * 2);
        const dist = ((i * 7 + 3) % 10) * 0.1 * radius;
        dummy.position.set(cx + Math.cos(ang) * dist, 0.076 + (i % 3) * 0.002, cz + Math.sin(ang) * dist);
        dummy.rotation.set(-Math.PI / 2, 0, (i * 1.7) % 6.28);
        dummy.updateMatrix();
        instLeaves.setMatrixAt(i, dummy.matrix);
        instLeaves.setColorAt(i, leafColors[i % 3]);
      }
      instLeaves.instanceMatrix.needsUpdate = true;
      if (instLeaves.instanceColor) instLeaves.instanceColor.needsUpdate = true;
      scene.add(instLeaves);
    }

    // 4. TASK 3 PROPS: Wooden Campus Benches, Weathered Old Wall Posters & Mandala Street Signboard Archway
    function buildCampusBench(bx, bz, rotY = 0) {
      const bGroup = new THREE.Group();
      bGroup.position.set(bx, 0, bz);
      bGroup.rotation.y = rotY;

      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.06, 0.48), materials.carvedSalWood);
      seat.position.set(0, 0.46, 0);
      bGroup.add(seat);

      const back = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.36, 0.05), materials.carvedSalWood);
      back.position.set(0, 0.72, -0.22);
      back.rotation.x = -0.12;
      bGroup.add(back);

      [-0.75, 0.75].forEach(lx => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.46, 0.44), materials.castIronDark);
        leg.position.set(lx, 0.23, 0);
        bGroup.add(leg);
      });

      const bShadow = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.85), materials.pedestalShadowDecal);
      bShadow.rotation.x = -Math.PI / 2;
      bShadow.position.y = 0.022;
      bGroup.add(bShadow);

      scene.add(bGroup);
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(bx - 0.95, 0, bz - 0.35),
        new THREE.Vector3(bx + 0.95, 0.9, bz + 0.35)
      ));
    }

    if (sAtlasCtx) {
      // Poster 1 (256, 0, 128, 160): Weathered Curfew Notice with torn corner & water stain
      sAtlasCtx.fillStyle = '#b8c2b0';
      sAtlasCtx.fillRect(256, 0, 128, 160);
      sAtlasCtx.fillStyle = 'rgba(42, 34, 22, 0.32)';
      sAtlasCtx.beginPath();
      sAtlasCtx.arc(356, 130, 34, 0, Math.PI * 2);
      sAtlasCtx.fill();
      sAtlasCtx.fillStyle = '#334155';
      sAtlasCtx.fillRect(264, 10, 112, 26);
      sAtlasCtx.fillStyle = '#991b1b';
      sAtlasCtx.font = 'bold 13px serif';
      sAtlasCtx.fillText('CURFEW NOTICE', 268, 28);
      sAtlasCtx.fillStyle = '#1e293b';
      sAtlasCtx.font = '10px monospace';
      sAtlasCtx.fillText('NO ENTRY AFTER', 270, 56);
      sAtlasCtx.fillText('22:00 HRS', 282, 72);
      sAtlasCtx.fillText('BY ORDER: WARDEN', 266, 102);

      // Poster 2 (384, 0, 128, 160): Faded Exam & Missing Scholar Bulletin
      sAtlasCtx.fillStyle = '#c4b89b';
      sAtlasCtx.fillRect(384, 0, 128, 160);
      sAtlasCtx.fillStyle = '#7c2d12';
      sAtlasCtx.fillRect(392, 10, 112, 24);
      sAtlasCtx.fillStyle = '#fef3c7';
      sAtlasCtx.font = 'bold 12px sans-serif';
      sAtlasCtx.fillText('CAMPUS ALERT', 402, 26);
      sAtlasCtx.fillStyle = '#292524';
      sAtlasCtx.fillRect(416, 42, 64, 54);
      sAtlasCtx.fillStyle = '#78716c';
      sAtlasCtx.beginPath();
      sAtlasCtx.arc(448, 62, 12, 0, Math.PI * 2);
      sAtlasCtx.fill();
      sAtlasCtx.fillStyle = '#1c1917';
      sAtlasCtx.font = 'bold 10px monospace';
      sAtlasCtx.fillText('REPORT UNUSUAL', 398, 114);
      sAtlasCtx.fillText('NIGHT SOUNDS', 404, 128);

      // Poster 3 (256, 160, 128, 120): Stained Science / Lab Safety Chart
      sAtlasCtx.fillStyle = '#a8b8c0';
      sAtlasCtx.fillRect(256, 160, 128, 120);
      sAtlasCtx.strokeStyle = '#1e3a5f';
      sAtlasCtx.lineWidth = 3;
      sAtlasCtx.strokeRect(262, 166, 116, 108);
      sAtlasCtx.fillStyle = '#0f172a';
      sAtlasCtx.font = 'bold 11px sans-serif';
      sAtlasCtx.fillText('LAB SAFETY RULES', 268, 184);
      for (let ly = 198; ly < 262; ly += 14) {
        sAtlasCtx.fillStyle = '#334155';
        sAtlasCtx.fillRect(270, ly, 96, 4);
      }

      // Poster 4 (384, 160, 128, 120): Torn Cultural Fest Poster
      sAtlasCtx.fillStyle = '#451a03';
      sAtlasCtx.fillRect(384, 160, 128, 120);
      sAtlasCtx.strokeStyle = '#d97706';
      sAtlasCtx.lineWidth = 2;
      sAtlasCtx.strokeRect(390, 166, 116, 108);
      sAtlasCtx.fillStyle = '#fde68a';
      sAtlasCtx.font = 'bold 12px Georgia, serif';
      sAtlasCtx.fillText('GANDAKI FEST', 398, 192);
      sAtlasCtx.fillStyle = '#f59e0b';
      sAtlasCtx.font = '10px serif';
      sAtlasCtx.fillText('AUTUMN NIGHT', 406, 214);

      sAtlasCtx.fillStyle = '#1a120b';
      sAtlasCtx.fillRect(512, 0, 512, 96);
      sAtlasCtx.strokeStyle = '#d99b26';
      sAtlasCtx.lineWidth = 4;
      sAtlasCtx.strokeRect(518, 6, 500, 84);
      sAtlasCtx.fillStyle = '#f8fafc';
      sAtlasCtx.font = 'bold 28px Georgia, serif';
      sAtlasCtx.textAlign = 'center';
      sAtlasCtx.fillText('GANDAKI HERITAGE ALLEY', 768, 44);
      sAtlasCtx.textAlign = 'left';
    }
    const oldPosterMat = sharedSignageAtlasMat;
    const sharedPosterGeo = createAtlasUvGeo(new THREE.PlaneGeometry(0.65, 0.82), 256, 0, 128, 160);
    const posterGeoVariants = [
      sharedPosterGeo,
      createAtlasUvGeo(new THREE.PlaneGeometry(0.62, 0.78), 384, 0, 128, 160),
      createAtlasUvGeo(new THREE.PlaneGeometry(0.68, 0.64), 256, 160, 128, 120),
      createAtlasUvGeo(new THREE.PlaneGeometry(0.58, 0.56), 384, 160, 128, 120),
    ];

    function spawnOldWallPoster(px, py, pz, rotY = 0, tiltZ = 0.06, variantIdx = 0) {
      const pGeo = posterGeoVariants[Math.abs(variantIdx) % posterGeoVariants.length] || sharedPosterGeo;
      const poster = new THREE.Mesh(pGeo, oldPosterMat);
      poster.position.set(px, py, pz);
      poster.rotation.set(0, rotY, tiltZ);
      scene.add(poster);
    }

    function buildMandalaStreetArchway(ax, az, spanW = 6.2) {
      const aGroup = new THREE.Group();
      aGroup.position.set(ax, 0, az);

      const postRadius = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.mandalaPostRadius) || 0.20;
      [-spanW / 2, spanW / 2].forEach(px => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.24, 4.1, 0.24), materials.ebonyCarvedWood);
        post.position.set(px, 2.05, 0);
        aGroup.add(post);
        addColliderCylinder(ax + px, az, postRadius, 0, 4.1);
      });

      const signBoard = new THREE.Mesh(
        createAtlasUvGeo(new THREE.BoxGeometry(spanW + 0.2, 0.78, 0.16), 512, 0, 512, 96),
        sharedSignageAtlasMat
      );
      signBoard.position.set(0, 3.75, 0);
      aGroup.add(signBoard);

      scene.add(aGroup);
    }

    /* =========================================================================
       STEP 2: REALISTIC UNIVERSITY INTERIOR LAYOUT SYSTEM
       Shared Geometries & Materials + Modular Builders for:
       - Reference Wing L1 & Distinct Classrooms (Desks, Benches, Bags, Books,
         Teacher Desk, Whiteboard, Wall-Mounted Fans, Curtains, Shelves, Notice
         Boards, Swinging Doors)
       - Corridors & Verandas (Lockers, Notice Boards, Water Dispenser, Fire
         Extinguisher, Wall Lamps, Floor Mats, Framed Photos, Potted Plants)
       - Staff Room & Admin Offices (Office Desks, Chairs, Filing Cabinets,
         Computers, Paper Stacks, Sofa Lounge)
       - Library Rooms (Tall Bookshelves in Rows with Gaps, Reading Tables, Lamps)
       - Computer Labs (Rows of Monitors & Chairs, Cable Trays, Server Racks)
       - Toilets, Canteen (Counter, Dining, Kitchen) & Store Rooms
       ========================================================================= */
    /* =========================================================================
       MAIN BUILDING INTERIOR UPGRADE:
       1. Power-of-Two Shared Atlased Interior Canvas Textures + Bump Map (1024x512)
          (wood grain, scuffed painted wall, cracked floor tile, rusted metal,
           dusty glass, chalkboard with faded writing — muted & desaturated)
       2. Believably Constructed Beveled Furniture Geometries (legs with thickness,
          cross-braces, drawers with handles, hinges, bolts — low triangle count,
          tagged for InstancedMesh / static room merging)
       ========================================================================= */
    const interiorAtlasCanvas = document.createElement('canvas');
    interiorAtlasCanvas.width = 1024;
    interiorAtlasCanvas.height = 512;
    const iCtx = interiorAtlasCanvas.getContext('2d');

    const interiorBumpCanvas = document.createElement('canvas');
    interiorBumpCanvas.width = 1024;
    interiorBumpCanvas.height = 512;
    const ibCtx = interiorBumpCanvas.getContext('2d');

    if (iCtx && ibCtx) {
      // 1. Tile (0,0,256,256): Weathered Muted Wood Grain & Recessed Wainscoting
      iCtx.fillStyle = '#342216';
      iCtx.fillRect(0, 0, 256, 256);
      ibCtx.fillStyle = '#787878';
      ibCtx.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 256; y += 3) {
        const tone = ((y * 17) % 18) - 9;
        iCtx.fillStyle = 'rgb(' + (54 + tone) + ',' + (36 + Math.floor(tone * 0.6)) + ',' + (24 + Math.floor(tone * 0.4)) + ')';
        iCtx.fillRect(0, y, 256, 2);
        ibCtx.fillStyle = tone > 0 ? '#989898' : '#585858';
        ibCtx.fillRect(0, y, 256, 2);
      }
      for (let px = 64; px < 256; px += 64) {
        iCtx.fillStyle = 'rgba(12, 7, 3, 0.58)';
        iCtx.fillRect(px, 0, 2, 256);
        ibCtx.fillStyle = '#202020';
        ibCtx.fillRect(px, 0, 2, 256);
      }

      // 2. Tile (256,0,256,256): Scuffed Painted Institutional Wall (Muted Liminal Ochre-Grey / Slate)
      iCtx.fillStyle = '#585f5a';
      iCtx.fillRect(256, 0, 256, 256);
      ibCtx.fillStyle = '#808080';
      ibCtx.fillRect(256, 0, 256, 256);
      for (let vx = 264; vx < 512; vx += 16) {
        iCtx.fillStyle = 'rgba(38, 44, 38, 0.14)';
        iCtx.fillRect(vx, 0, 2, 256);
      }
      for (let s = 0; s < 52; s++) {
        const sx = 262 + ((s * 37) % 238);
        const sy = 10 + ((s * 53) % 232);
        iCtx.fillStyle = (s % 3 === 0) ? 'rgba(24, 30, 28, 0.38)' : 'rgba(112, 120, 114, 0.20)';
        iCtx.fillRect(sx, sy, 14 + (s % 18), 4 + (s % 9));
        ibCtx.fillStyle = (s % 2 === 0) ? '#505050' : '#a8a8a8';
        ibCtx.fillRect(sx, sy, 12, 4);
      }
      const dampGrad = iCtx.createLinearGradient(256, 165, 256, 256);
      dampGrad.addColorStop(0, 'rgba(16, 22, 18, 0.0)');
      dampGrad.addColorStop(1, 'rgba(10, 15, 12, 0.72)');
      iCtx.fillStyle = dampGrad;
      iCtx.fillRect(256, 165, 256, 91);

      // 3. Tile (512,0,256,256): Cracked Institutional Terrazzo & Liminal Carpet-Tile Floor
      iCtx.fillStyle = '#3d454c';
      iCtx.fillRect(512, 0, 256, 256);
      ibCtx.fillStyle = '#909090';
      ibCtx.fillRect(512, 0, 256, 256);
      for (let ty = 0; ty < 256; ty += 64) {
        for (let tx = 512; tx < 768; tx += 64) {
          const alt = ((tx / 64) + (ty / 64)) % 2 === 0;
          iCtx.fillStyle = alt ? '#4d565e' : '#434b53';
          iCtx.fillRect(tx + 2, ty + 2, 60, 60);
          ibCtx.fillStyle = '#b8b8b8';
          ibCtx.fillRect(tx + 2, ty + 2, 60, 60);
        }
      }
      iCtx.strokeStyle = 'rgba(12, 16, 20, 0.82)';
      iCtx.lineWidth = 2;
      ibCtx.strokeStyle = '#181818';
      ibCtx.lineWidth = 2.5;
      [[528, 16, 594, 88, 642, 168], [658, 38, 712, 120, 688, 214], [548, 180, 612, 210, 668, 242]].forEach(pts => {
        iCtx.beginPath(); iCtx.moveTo(pts[0], pts[1]); iCtx.lineTo(pts[2], pts[3]); iCtx.lineTo(pts[4], pts[5]); iCtx.stroke();
        ibCtx.beginPath(); ibCtx.moveTo(pts[0], pts[1]); ibCtx.lineTo(pts[2], pts[3]); ibCtx.lineTo(pts[4], pts[5]); ibCtx.stroke();
      });

      // 4. Tile (768,0,256,256): Rusted Dark Gunmetal / Locker & Server Steel
      iCtx.fillStyle = '#232b32';
      iCtx.fillRect(768, 0, 256, 256);
      ibCtx.fillStyle = '#707070';
      ibCtx.fillRect(768, 0, 256, 256);
      for (let r = 0; r < 40; r++) {
        const rx = 774 + ((r * 43) % 234);
        const ry = 8 + ((r * 61) % 234);
        iCtx.fillStyle = (r % 2 === 0) ? 'rgba(88, 42, 22, 0.44)' : 'rgba(14, 18, 22, 0.52)';
        iCtx.fillRect(rx, ry, 10 + (r % 16), 8 + (r % 14));
        ibCtx.fillStyle = '#383838';
        ibCtx.fillRect(rx, ry, 10, 8);
      }

      // 5. Tile (0,256,256,256): Dusty Glass with Cracks (top half) + Acoustic Drop-Ceiling Grid (bottom half, Ref 1/2/5)
      iCtx.fillStyle = '#192733';
      iCtx.fillRect(0, 256, 256, 128);
      const glassGrad = iCtx.createRadialGradient(128, 320, 14, 128, 320, 120);
      glassGrad.addColorStop(0, 'rgba(44, 64, 78, 0.24)');
      glassGrad.addColorStop(1, 'rgba(10, 16, 22, 0.88)');
      iCtx.fillStyle = glassGrad;
      iCtx.fillRect(0, 256, 256, 128);
      iCtx.strokeStyle = 'rgba(168, 184, 196, 0.48)';
      iCtx.lineWidth = 1.5;
      iCtx.beginPath();
      iCtx.moveTo(36, 268); iCtx.lineTo(96, 318); iCtx.lineTo(154, 304);
      iCtx.moveTo(96, 318); iCtx.lineTo(72, 372);
      iCtx.stroke();
      // Acoustic tile drop-ceiling grid (0,384,256,128) with dark T-bar seams & water stains (Ref 1 & Ref 5)
      iCtx.fillStyle = '#4e544e';
      iCtx.fillRect(0, 384, 256, 128);
      ibCtx.fillStyle = '#888888';
      ibCtx.fillRect(0, 384, 256, 128);
      for (let cy = 384; cy < 512; cy += 32) {
        for (let cx = 0; cx < 256; cx += 64) {
          iCtx.strokeStyle = '#222624';
          iCtx.lineWidth = 3;
          iCtx.strokeRect(cx + 1, cy + 1, 62, 30);
          ibCtx.strokeStyle = '#282828';
          ibCtx.lineWidth = 3;
          ibCtx.strokeRect(cx + 1, cy + 1, 62, 30);
        }
      }
      iCtx.fillStyle = 'rgba(26, 24, 18, 0.38)';
      iCtx.beginPath(); iCtx.arc(92, 442, 26, 0, Math.PI * 2); iCtx.fill();
      iCtx.beginPath(); iCtx.arc(198, 476, 22, 0, Math.PI * 2); iCtx.fill();

      // 6. Tile (256,256,512,256): Faded Slate Chalkboard with Equations & University-Safe Eerie Scribbles
      iCtx.fillStyle = '#15271f';
      iCtx.fillRect(256, 256, 512, 256);
      ibCtx.fillStyle = '#686868';
      ibCtx.fillRect(256, 256, 512, 256);
      for (let c = 0; c < 16; c++) {
        iCtx.fillStyle = 'rgba(210, 222, 216, 0.06)';
        iCtx.fillRect(272 + ((c * 61) % 440), 272 + ((c * 43) % 190), 58, 32);
      }
      iCtx.fillStyle = 'rgba(212, 224, 218, 0.62)';
      iCtx.font = 'bold 16px Georgia, serif';
      iCtx.fillText('GANDAKI UNIVERSITY — NIGHT ARCHIVE & MECHANICS', 274, 296);
      iCtx.font = '14px monospace';
      iCtx.fillStyle = 'rgba(190, 204, 196, 0.48)';
      iCtx.fillText('1. Damped Wave:  x(t) = A·e^(-γt)·cos(ωt + φ)', 276, 330);
      iCtx.fillText('2. Dome Stress:  σ_θ = (p·R)/(2·t)   [CURFEW 22:00]', 276, 358);
      iCtx.fillStyle = 'rgba(218, 178, 134, 0.72)';
      iCtx.font = 'bold 14px monospace';
      iCtx.fillText('>> RESTORE 4 FUSE BOXES TO UNLOCK SOUTH GATE <<', 276, 398);
      iCtx.fillText('>> DO NOT LOOK UP AT THE SKYLIGHT — HOLD BREATH <<', 276, 428);
      iCtx.fillStyle = 'rgba(186, 196, 190, 0.36)';
      iCtx.fillText('...why are the chairs facing the wall?...', 276, 466);

      // 7. Tile (768,256,256,256): Dark Landscape Painting (top) & Safe Eerie Archway Lintel Stencil (bottom, Ref 3)
      iCtx.fillStyle = '#162028';
      iCtx.fillRect(768, 256, 256, 128);
      const skyG = iCtx.createLinearGradient(768, 256, 768, 340);
      skyG.addColorStop(0, '#1c2d3d');
      skyG.addColorStop(1, '#4a3b32');
      iCtx.fillStyle = skyG;
      iCtx.fillRect(774, 262, 244, 78);
      iCtx.fillStyle = '#121c18';
      iCtx.beginPath();
      iCtx.moveTo(774, 340); iCtx.lineTo(825, 288); iCtx.lineTo(878, 322); iCtx.lineTo(942, 278); iCtx.lineTo(1018, 340);
      iCtx.closePath(); iCtx.fill();
      iCtx.fillStyle = '#182830';
      iCtx.fillRect(774, 340, 244, 38);
      // Bottom half (768,384,256,128): Weathered plaster lintel with safe red warning (Ref 3)
      iCtx.fillStyle = '#4e483e';
      iCtx.fillRect(768, 384, 256, 128);
      iCtx.strokeStyle = 'rgba(32, 28, 22, 0.55)';
      iCtx.lineWidth = 2;
      for (let lx = 768; lx < 1024; lx += 32) {
        iCtx.strokeRect(lx, 384, 32, 128);
      }
      iCtx.fillStyle = 'rgba(128, 28, 24, 0.86)';
      iCtx.font = 'bold 20px Georgia, serif';
      iCtx.fillText('CURFEW ENFORCED', 792, 442);
      iCtx.font = 'bold 16px monospace';
      iCtx.fillText('DO NOT ENTER AFTER DARK', 782, 474);
    }

    const interiorSurfaceAtlasTex = new THREE.CanvasTexture(interiorAtlasCanvas);
    const interiorSurfaceBumpTex = new THREE.CanvasTexture(interiorBumpCanvas);
    const dustyGlassTex = interiorSurfaceAtlasTex;

    // Helper to remap any BufferGeometry UVs into a sub-rectangle of the shared 1024x512 interiorSurfaceAtlasTex
    function remapInteriorAtlasUVs(geo, xPx, yPx, wPx, hPx) {
      if (!geo || !geo.attributes || !geo.attributes.uv) return geo;
      const uv = geo.attributes.uv;
      const u0 = (xPx + 2) / 1024;
      const uSpan = (wPx - 4) / 1024;
      const v0 = 1.0 - (yPx + hPx - 2) / 512;
      const vSpan = (hPx - 4) / 512;
      for (let i = 0; i < uv.count; i++) {
        const u = ((uv.getX(i) % 1) + 1) % 1;
        const v = ((uv.getY(i) % 1) + 1) % 1;
        uv.setXY(i, u0 + u * uSpan, v0 + v * vSpan);
      }
      uv.needsUpdate = true;
      return geo;
    }

    // Apply shared power-of-two interiorSurfaceAtlasTex + interiorSurfaceBumpTex across all interior materials
    materials.deskWoodTop.map = interiorSurfaceAtlasTex;
    materials.deskWoodTop.bumpMap = interiorSurfaceBumpTex;
    materials.deskWoodTop.bumpScale = 0.028;
    materials.deskWoodTop.color.setHex(0x886b54);
    materials.deskWoodTop.roughness = 0.54;

    materials.chairWood.map = interiorSurfaceAtlasTex;
    materials.chairWood.bumpMap = interiorSurfaceBumpTex;
    materials.chairWood.bumpScale = 0.028;
    materials.chairWood.color.setHex(0x684d3a);
    materials.chairWood.roughness = 0.60;

    materials.deskSteelFrame.map = interiorSurfaceAtlasTex;
    materials.deskSteelFrame.bumpMap = interiorSurfaceBumpTex;
    materials.deskSteelFrame.bumpScale = 0.032;
    materials.deskSteelFrame.color.setHex(0x46505a);
    materials.deskSteelFrame.roughness = 0.42;
    materials.deskSteelFrame.metalness = 0.68;

    materials.rotundaInteriorWall.map = interiorSurfaceAtlasTex;
    materials.rotundaInteriorWall.bumpMap = interiorSurfaceBumpTex;
    materials.rotundaInteriorWall.bumpScale = 0.032;
    materials.rotundaInteriorWall.color.setHex(0x788078);
    materials.rotundaInteriorWall.roughness = 0.74;

    materials.rotundaTerrazzoFloor.map = interiorSurfaceAtlasTex;
    materials.rotundaTerrazzoFloor.bumpMap = interiorSurfaceBumpTex;
    materials.rotundaTerrazzoFloor.bumpScale = 0.018;
    materials.rotundaTerrazzoFloor.roughness = 0.20; // Faked floor reflections with low roughness & baked environment tint
    materials.rotundaTerrazzoFloor.metalness = 0.30;
    materials.rotundaTerrazzoFloor.color.setHex(0x6e7880);

    materials.stainedCeilingTiles.map = interiorSurfaceAtlasTex;
    materials.stainedCeilingTiles.bumpMap = interiorSurfaceBumpTex;
    materials.stainedCeilingTiles.bumpScale = 0.026;
    materials.stainedCeilingTiles.color.setHex(0x767c74);
    materials.stainedCeilingTiles.roughness = 0.82;

    materials.blackboardGreen.map = interiorSurfaceAtlasTex;
    materials.blackboardGreen.bumpMap = interiorSurfaceBumpTex;
    materials.blackboardGreen.bumpScale = 0.018;
    materials.blackboardGreen.color.setHex(0x8fa398);
    materials.blackboardGreen.roughness = 0.62;

    materials.windowGlass.map = interiorSurfaceAtlasTex;
    materials.windowGlass.bumpMap = interiorSurfaceBumpTex;
    materials.windowGlass.bumpScale = 0.010;
    materials.windowGlass.color.setHex(0x334858);
    materials.windowGlass.roughness = 0.22;

    const step2Mats = {
      curtainFabric: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, bumpMap: interiorSurfaceBumpTex, bumpScale: 0.015, color: 0x35424f, roughness: 0.88, side: THREE.DoubleSide }),
      curtainGold: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, bumpMap: interiorSurfaceBumpTex, bumpScale: 0.015, color: 0x5c432e, roughness: 0.84, side: THREE.DoubleSide }),
      lockerSteel: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, bumpMap: interiorSurfaceBumpTex, bumpScale: 0.028, color: 0x3d4852, roughness: 0.48, metalness: 0.62 }),
      rustedLockerMetal: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, bumpMap: interiorSurfaceBumpTex, bumpScale: 0.032, color: 0x3a322d, roughness: 0.66, metalness: 0.48 }),
      lockerDoorBlue: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, bumpMap: interiorSurfaceBumpTex, bumpScale: 0.026, color: 0x2c3e50, roughness: 0.46, metalness: 0.56 }),
      fireRed: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, color: 0x7f2929, roughness: 0.42, metalness: 0.40 }),
      waterJugBlue: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, color: 0x2b546e, roughness: 0.20, metalness: 0.22, transparent: true, opacity: 0.78 }),
      matRubber: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, bumpMap: interiorSurfaceBumpTex, bumpScale: 0.02, color: 0x1a1f24, roughness: 0.94 }),
      corkBoard: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, bumpMap: interiorSurfaceBumpTex, bumpScale: 0.028, color: 0x6e4e34, roughness: 0.88 }),
      paperSheet: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, color: 0xc4ccd4, roughness: 0.82 }),
      bagNavy: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, color: 0x263242, roughness: 0.88 }),
      bagOlive: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, color: 0x2b362c, roughness: 0.88 }),
      bagMaroon: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, color: 0x3e2428, roughness: 0.86 }),
      sofaLeather: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, bumpMap: interiorSurfaceBumpTex, bumpScale: 0.02, color: 0x252c28, roughness: 0.54, metalness: 0.12 }),
      greenMarbleTop: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, bumpMap: interiorSurfaceBumpTex, bumpScale: 0.015, color: 0x2e4a3e, roughness: 0.24, metalness: 0.28 }),
      monitorScreenOn: new THREE.MeshStandardMaterial({ color: 0x0c1824, emissive: 0x2b5b84, emissiveIntensity: 0.42, roughness: 0.22 }),
      monitorScreenOff: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, color: 0x121820, roughness: 0.24, metalness: 0.42 }),
      serverLedGreen: new THREE.MeshBasicMaterial({ color: 0x4d8c57 }),
      serverLedAmber: new THREE.MeshBasicMaterial({ color: 0xc27d2c }),
      exitSignGreenMat: new THREE.MeshStandardMaterial({ color: 0x166534, emissive: 0x22c55e, emissiveIntensity: 1.55, roughness: 0.25 }),
      recessedPanelWarmMat: new THREE.MeshStandardMaterial({ color: 0xfef3c7, emissive: 0xeab308, emissiveIntensity: 1.15, roughness: 0.22 }),
      lampShadeGreen: new THREE.MeshStandardMaterial({ color: 0x1f3d2b, emissive: 0xd99242, emissiveIntensity: 0.65, roughness: 0.34 }),
      ceramicWhite: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, color: 0x9aa4ad, roughness: 0.30, metalness: 0.12 }),
      mirrorGlass: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, color: 0x4e5d6c, roughness: 0.16, metalness: 0.84 }),
      stainlessSteel: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, bumpMap: interiorSurfaceBumpTex, bumpScale: 0.018, color: 0x6c7882, roughness: 0.36, metalness: 0.74 }),
      cardboardCrate: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, bumpMap: interiorSurfaceBumpTex, bumpScale: 0.022, color: 0x6b5038, roughness: 0.88 }),
      vineGreen: new THREE.MeshStandardMaterial({ color: 0x1c2b20, roughness: 0.84, side: THREE.DoubleSide }),
      terrazzoInlayGold: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, color: 0x786238, roughness: 0.34, metalness: 0.36 }),
      terrazzoInlayDark: new THREE.MeshStandardMaterial({ map: interiorSurfaceAtlasTex, color: 0x1b222b, roughness: 0.30, metalness: 0.24 }),
      wallStainDecal: new THREE.MeshBasicMaterial({ map: softContactShadowTex, color: 0x05080c, transparent: true, opacity: 0.64, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      cobwebMat: new THREE.MeshBasicMaterial({ color: 0x7c868f, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false }),
      moonlightShaftMat: new THREE.MeshBasicMaterial({ map: windowLightShaftTex, color: 0x8cc2f5, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
      corridorMistMat: new THREE.MeshBasicMaterial({ map: corridorFogTex, color: 0x5c768f, transparent: true, opacity: 0.14, depthWrite: false }),
    };

    // Helper: Build Low-Triangle Beveled/Constructed Composite BufferGeometry
    function buildConstructedFurnitureGeo(parts, atlasRect = null) {
      const dummy = new THREE.Object3D();
      const geos = [];
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const g = (p.geo || new THREE.BoxGeometry(p.w, p.h, p.d)).clone();
        dummy.position.set(p.x || 0, p.y || 0, p.z || 0);
        dummy.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
        dummy.scale.set(p.sx || 1, p.sy || 1, p.sz || 1);
        dummy.updateMatrix();
        g.applyMatrix4(dummy.matrix);
        geos.push(g);
      }
      return THREE.BufferGeometryUtils.mergeBufferGeometries(geos);
    }

    // Upgrade sharedGeos.deskTop, deskLeg, chairSeat, chairBack to beveled/constructed shapes!
    sharedGeos.deskTop = buildConstructedFurnitureGeo([
      { w: 1.32, h: 0.040, d: 0.58, y: 0.0 },               // Main desktop plank
      { w: 1.28, h: 0.056, d: 0.54, y: 0.0 },               // Beveled top/bottom chamfer core
      { w: 0.48, h: 0.12,  d: 0.46, x: -0.34, y: -0.08 },   // Left under-desk drawer box
      { w: 0.48, h: 0.12,  d: 0.46, x:  0.34, y: -0.08 },   // Right under-desk drawer box
      { w: 0.10, h: 0.022, d: 0.03, x: -0.34, y: -0.08, z: -0.24 }, // Left drawer pull handle
      { w: 0.10, h: 0.022, d: 0.03, x:  0.34, y: -0.08, z: -0.24 }, // Right drawer pull handle
      { w: 0.022, h: 0.015, d: 0.022, x: -0.58, y: 0.025, z: -0.22 }, // Top corner carriage bolts
      { w: 0.022, h: 0.015, d: 0.022, x:  0.58, y: 0.025, z: -0.22 },
    ]);
    sharedGeos.deskTop.userData.instancedCategory = 'desk';

    sharedGeos.deskLeg = buildConstructedFurnitureGeo([
      { w: 0.048, h: 0.72, d: 0.048, x: 0, y: 0.0, z: -0.22 },   // Front tubular leg
      { w: 0.048, h: 0.72, d: 0.048, x: 0, y: 0.0, z:  0.22 },   // Rear tubular leg
      { w: 0.042, h: 0.042, d: 0.48, x: 0, y: -0.24, z: 0.0 },   // Lower side stretcher bar
      { w: 0.042, h: 0.042, d: 0.48, x: 0, y:  0.32, z: 0.0 },   // Upper mounting bracket
      { w: 0.068, h: 0.068, d: 0.02, x: 0, y:  0.28, z: -0.22 }, // Corner gusset bolt plate
      { w: 0.064, h: 0.024, d: 0.064, x: 0, y: -0.35, z: -0.22 }, // Rubber floor leveling feet
      { w: 0.064, h: 0.024, d: 0.064, x: 0, y: -0.35, z:  0.22 },
    ]);
    sharedGeos.deskLeg.userData.instancedCategory = 'desk';

    sharedGeos.chairSeat = buildConstructedFurnitureGeo([
      { w: 0.44, h: 0.038, d: 0.42, y: 0.0 },                    // Beveled seat outer
      { w: 0.40, h: 0.052, d: 0.38, y: 0.0 },                    // Beveled seat core
      { w: 0.042, h: 0.44, d: 0.042, x: -0.18, y: -0.22, z: -0.17, rx:  0.04 }, // Front-left leg
      { w: 0.042, h: 0.44, d: 0.042, x:  0.18, y: -0.22, z: -0.17, rx:  0.04 }, // Front-right leg
      { w: 0.042, h: 0.44, d: 0.042, x: -0.18, y: -0.22, z:  0.17, rx: -0.05 }, // Rear-left leg
      { w: 0.042, h: 0.44, d: 0.042, x:  0.18, y: -0.22, z:  0.17, rx: -0.05 }, // Rear-right leg
      { w: 0.36, h: 0.028, d: 0.028, x: 0, y: -0.28, z: -0.17 }, // Front cross-brace
      { w: 0.36, h: 0.028, d: 0.028, x: 0, y: -0.28, z:  0.17 }, // Rear cross-brace
      { w: 0.028, h: 0.028, d: 0.34, x: -0.18, y: -0.26, z: 0 }, // Left cross-brace
      { w: 0.028, h: 0.028, d: 0.34, x:  0.18, y: -0.26, z: 0 }, // Right cross-brace
      { w: 0.038, h: 0.42, d: 0.038, x: -0.17, y: 0.21, z: 0.18, rx: -0.08 }, // Backrest left upright
      { w: 0.038, h: 0.42, d: 0.038, x:  0.17, y: 0.21, z: 0.18, rx: -0.08 }, // Backrest right upright
      { w: 0.42, h: 0.18, d: 0.034, x: 0, y: 0.30, z: 0.19, rx: -0.08 },      // Beveled backrest slat
    ]);
    sharedGeos.chairSeat.userData.instancedCategory = 'chair';
    sharedGeos.chairBack = buildConstructedFurnitureGeo([
      { w: 0.42, h: 0.24, d: 0.036, y: 0.0 },
      { w: 0.38, h: 0.28, d: 0.046, y: 0.0 },
    ]);
    sharedGeos.chairBack.userData.instancedCategory = 'chair';
    sharedGeos.benchSeat = new THREE.BoxGeometry(2.10, 0.46, 0.58);

    const step2Geos = {
      doorLeaf: buildConstructedFurnitureGeo([
        { w: 0.92, h: 2.26, d: 0.052, y: 0 },
        { w: 0.72, h: 0.82, d: 0.068, y: 0.55 }, // Upper recessed molding panel
        { w: 0.72, h: 0.82, d: 0.068, y: -0.55 }, // Lower recessed molding panel
        { w: 0.025, h: 0.14, d: 0.08, x: -0.45, y:  0.75 }, // Top hinge barrel
        { w: 0.025, h: 0.14, d: 0.08, x: -0.45, y: -0.75 }, // Bottom hinge barrel
      ], [0, 0, 256, 256]),
      doorHandle: buildConstructedFurnitureGeo([
        { w: 0.04, h: 0.14, d: 0.09, y: 0 },      // Escutcheon lock plate
        { w: 0.14, h: 0.028, d: 0.13, x: -0.04, y: 0.02 }, // Lever handle both sides
      ], [768, 0, 256, 256]),
      roomPlaque: new THREE.BoxGeometry(0.46, 0.22, 0.03),
      curtainRod: new THREE.CylinderGeometry(0.016, 0.016, 2.05, 6),
      curtainPanel: new THREE.BoxGeometry(0.52, 1.52, 0.045),
      venetianBlinds: buildConstructedFurnitureGeo([
        { w: 1.72, h: 0.05, d: 0.06, y: 0.62 },   // Top blind header valence
        { w: 1.68, h: 0.025, d: 0.04, y:  0.42, rx: 0.35 }, // Slatted blind strips (Ref 4 & Ref 5)
        { w: 1.68, h: 0.025, d: 0.04, y:  0.22, rx: 0.35 },
        { w: 1.68, h: 0.025, d: 0.04, y:  0.02, rx: 0.35 },
        { w: 1.68, h: 0.025, d: 0.04, y: -0.18, rx: 0.35 },
        { w: 1.68, h: 0.025, d: 0.04, y: -0.38, rx: 0.35 },
      ], [768, 0, 256, 256]),
      wallFanMount: new THREE.BoxGeometry(0.12, 0.16, 0.18),
      wallFanCage: new THREE.CylinderGeometry(0.24, 0.24, 0.10, 10),
      lockerBank: buildConstructedFurnitureGeo([
        { w: 0.48, h: 1.90, d: 1.78, y: 0 },
        { w: 0.51, h: 0.05, d: 1.82, y: 0.94 },   // Beveled top cap
        { w: 0.46, h: 0.08, d: 0.08, x: 0, y: -0.92, z: -0.82 }, // Left foot leg
        { w: 0.46, h: 0.08, d: 0.08, x: 0, y: -0.92, z:  0.82 }, // Right foot leg
      ], [768, 0, 256, 256]),
      lockerDoor: buildConstructedFurnitureGeo([
        { w: 0.03, h: 0.84, d: 0.52, y: 0 },
        { w: 0.045, h: 0.14, d: 0.32, y: 0.26 },  // Louver vent slot block
        { w: 0.055, h: 0.09, d: 0.035, y: 0.0, z: 0.20 }, // Recessed handle & padlock latch
        { w: 0.045, h: 0.06, d: 0.025, y:  0.34, z: -0.24 }, // Upper hinge
        { w: 0.045, h: 0.06, d: 0.025, y: -0.34, z: -0.24 }, // Lower hinge
      ], [768, 0, 256, 256]),
      woodenCupboard: buildConstructedFurnitureGeo([
        { w: 0.56, h: 1.92, d: 1.24, y: 0 },      // Main cupboard cabinet body (Ref 2 corridor & rooms)
        { w: 0.60, h: 0.06, d: 1.30, y: 0.95 },   // Beveled top crown overhang
        { w: 0.04, h: 1.68, d: 0.54, x: 0.28, y: 0.02, z: -0.29 }, // Left door panel
        { w: 0.04, h: 1.68, d: 0.54, x: 0.28, y: 0.02, z:  0.29 }, // Right door panel
        { w: 0.05, h: 0.14, d: 0.025, x: 0.30, y: 0.06, z: -0.06 }, // Left pull handle
        { w: 0.05, h: 0.14, d: 0.025, x: 0.30, y: 0.06, z:  0.06 }, // Right pull handle
        { w: 0.04, h: 0.08, d: 0.02, x: 0.29, y:  0.65, z: -0.55 }, // Door hinges
        { w: 0.04, h: 0.08, d: 0.02, x: 0.29, y: -0.65, z: -0.55 },
        { w: 0.08, h: 0.10, d: 0.08, x: -0.22, y: -0.96, z: -0.54 }, // 4 thick corner legs
        { w: 0.08, h: 0.10, d: 0.08, x:  0.22, y: -0.96, z: -0.54 },
        { w: 0.08, h: 0.10, d: 0.08, x: -0.22, y: -0.96, z:  0.54 },
        { w: 0.08, h: 0.10, d: 0.08, x:  0.22, y: -0.96, z:  0.54 },
      ], [0, 0, 256, 256]),
      noticeBoard: new THREE.BoxGeometry(0.06, 0.96, 1.65),
      noticeCork: new THREE.BoxGeometry(0.07, 0.84, 1.52),
      noticeNote: new THREE.BoxGeometry(0.08, 0.24, 0.18),
      waterDispenser: buildConstructedFurnitureGeo([
        { w: 0.38, h: 0.98, d: 0.38, y: -0.02 },  // Main dispenser stand (Ref 1 & Ref 2)
        { w: 0.40, h: 0.04, d: 0.40, y:  0.48 },  // Top bottle collar rim
        { w: 0.06, h: 0.04, d: 0.26, x:  0.20, y: 0.12, z: 0 }, // Drip tray ledge
        { w: 0.05, h: 0.06, d: 0.03, x:  0.20, y: 0.24, z: -0.06 }, // Hot tap spigot
        { w: 0.05, h: 0.06, d: 0.03, x:  0.20, y: 0.24, z:  0.06 }, // Cold tap spigot
      ], [256, 0, 256, 256]),
      waterBottle: new THREE.CylinderGeometry(0.15, 0.15, 0.42, 10),
      fireExtBody: new THREE.CylinderGeometry(0.09, 0.09, 0.54, 10),
      fireExtTop: new THREE.BoxGeometry(0.12, 0.10, 0.14),
      floorMat: new THREE.BoxGeometry(1.15, 0.02, 0.72),
      photoFrame: new THREE.BoxGeometry(0.05, 0.64, 0.86),
      photoCanvas: createAtlasUvGeo(new THREE.BoxGeometry(0.06, 0.52, 0.74), 768, 256, 256, 128),
      plantPot: new THREE.CylinderGeometry(0.22, 0.16, 0.36, 8),
      plantBush: new THREE.DodecahedronGeometry(0.28, 1),
      wallLampBack: new THREE.BoxGeometry(0.06, 0.28, 0.18),
      wallLampBulb: new THREE.BoxGeometry(0.12, 0.18, 0.12),
      pendantTubeFixture: buildConstructedFurnitureGeo([
        { w: 1.44, h: 0.06, d: 0.26, y: 0.0 },    // Beveled sheet-metal reflector hood (Ref 4)
        { w: 1.38, h: 0.04, d: 0.30, y: -0.02 },
        { w: 0.02, h: 0.46, d: 0.02, x: -0.54, y: 0.23, z: 0 }, // Left suspension cord rod
        { w: 0.02, h: 0.46, d: 0.02, x:  0.54, y: 0.23, z: 0 }, // Right suspension cord rod
      ], [768, 0, 256, 256]),
      recessedCeilingPanel: new THREE.BoxGeometry(0.68, 0.03, 0.68),
      exitSignBox: buildConstructedFurnitureGeo([
        { w: 0.46, h: 0.20, d: 0.06, y: 0.0 },    // Glowing green EXIT sign housing (Ref 2 & Ref 5)
        { w: 0.50, h: 0.03, d: 0.08, y: 0.11 },   // Top ceiling mount bracket
      ], [768, 0, 256, 256]),
      wallMagazineRack: buildConstructedFurnitureGeo([
        { w: 0.08, h: 0.86, d: 0.52, y: 0.0 },    // Wooden 4-tier wall magazine rack (Ref 5)
        { w: 0.12, h: 0.14, d: 0.48, x: 0.03, y:  0.26, rz: -0.18 },
        { w: 0.12, h: 0.14, d: 0.48, x: 0.03, y:  0.04, rz: -0.18 },
        { w: 0.12, h: 0.14, d: 0.48, x: 0.03, y: -0.18, rz: -0.18 },
      ], [0, 0, 256, 256]),
      loungeArmchair: buildConstructedFurnitureGeo([
        { w: 0.72, h: 0.34, d: 0.68, y: 0.22 },   // Upholstered armchair cushion (Ref 3)
        { w: 0.72, h: 0.48, d: 0.16, y: 0.54, z: -0.26, rx: -0.10 }, // Tilted backrest
        { w: 0.08, h: 0.46, d: 0.66, x: -0.34, y: 0.32, z: 0 }, // Left curved wood armrest & leg frame
        { w: 0.08, h: 0.46, d: 0.66, x:  0.34, y: 0.32, z: 0 }, // Right curved wood armrest & leg frame
      ], [0, 0, 256, 256]),
      coffeeTable: buildConstructedFurnitureGeo([
        { w: 1.24, h: 0.05, d: 0.68, y: 0.40 },   // Beveled low coffee table top (Ref 3)
        { w: 1.18, h: 0.06, d: 0.62, y: 0.40 },
        { w: 0.06, h: 0.40, d: 0.06, x: -0.54, y: 0.20, z: -0.28 }, // 4 legs
        { w: 0.06, h: 0.40, d: 0.06, x:  0.54, y: 0.20, z: -0.28 },
        { w: 0.06, h: 0.40, d: 0.06, x: -0.54, y: 0.20, z:  0.28 },
        { w: 0.06, h: 0.40, d: 0.06, x:  0.54, y: 0.20, z:  0.28 },
        { w: 1.04, h: 0.03, d: 0.48, x: 0, y: 0.12, z: 0 }, // Lower magazine shelf
      ], [0, 0, 256, 256]),
      desktopPhone: buildConstructedFurnitureGeo([
        { w: 0.22, h: 0.07, d: 0.18, y: 0.035, rx: 0.15 }, // Vintage office phone base (Ref 5)
        { w: 0.24, h: 0.04, d: 0.06, y: 0.08, z: -0.02 },  // Handset receiver on cradle
      ], [768, 0, 256, 256]),
      wallShelf: buildConstructedFurnitureGeo([
        { w: 0.32, h: 0.04, d: 1.85, y: 0 },
        { w: 0.28, h: 0.18, d: 0.04, x: 0.02, y: -0.10, z: -0.72 }, // Left iron support bracket
        { w: 0.28, h: 0.18, d: 0.04, x: 0.02, y: -0.10, z:  0.72 }, // Right iron support bracket
      ], [0, 0, 256, 256]),
      backpack: new THREE.BoxGeometry(0.32, 0.38, 0.22),
      bookStack: new THREE.BoxGeometry(0.26, 0.12, 0.20),
      openBook: new THREE.BoxGeometry(0.32, 0.025, 0.22),
      benchLongSeat: buildConstructedFurnitureGeo([
        { w: 1.38, h: 0.045, d: 0.36, y: 0 },
        { w: 1.34, h: 0.058, d: 0.32, y: 0 },     // Beveled plank core
        { w: 0.05, h: 0.42, d: 0.05, x: -0.58, y: -0.22, z: -0.13 }, // 4 thick bench legs
        { w: 0.05, h: 0.42, d: 0.05, x:  0.58, y: -0.22, z: -0.13 },
        { w: 0.05, h: 0.42, d: 0.05, x: -0.58, y: -0.22, z:  0.13 },
        { w: 0.05, h: 0.42, d: 0.05, x:  0.58, y: -0.22, z:  0.13 },
        { w: 1.18, h: 0.035, d: 0.035, x: 0, y: -0.26, z: 0 },       // Long cross-brace tie bar
      ], [0, 0, 256, 256]),
      benchLongBack: buildConstructedFurnitureGeo([
        { w: 1.38, h: 0.28, d: 0.038, y: 0 },
        { w: 0.045, h: 0.38, d: 0.045, x: -0.56, y: -0.06, z: -0.01 }, // Left backrest post + bolts
        { w: 0.045, h: 0.38, d: 0.045, x:  0.56, y: -0.06, z: -0.01 }, // Right backrest post + bolts
      ], [0, 0, 256, 256]),
      benchLeg: new THREE.BoxGeometry(0.05, 0.44, 0.32),
      officeDesk: buildConstructedFurnitureGeo([
        { w: 1.52, h: 0.055, d: 0.80, y: 0.35 },  // Beveled top overhang
        { w: 1.46, h: 0.07,  d: 0.74, y: 0.35 },  // Chamfered core
        { w: 0.44, h: 0.68,  d: 0.72, x: -0.48, y: 0.0 }, // Left 3-drawer pedestal
        { w: 0.44, h: 0.68,  d: 0.72, x:  0.48, y: 0.0 }, // Right cupboard pedestal
        { w: 0.56, h: 0.46,  d: 0.04, x:  0.0,  y: 0.08, z: -0.32 }, // Modesty panel
        { w: 0.12, h: 0.025, d: 0.03, x: -0.48, y: 0.20, z: 0.37 },  // Drawer handle 1
        { w: 0.12, h: 0.025, d: 0.03, x: -0.48, y: 0.02, z: 0.37 },  // Drawer handle 2
        { w: 0.12, h: 0.025, d: 0.03, x:  0.34, y: 0.05, z: 0.37 },  // Cupboard handle
      ], [0, 0, 256, 256]),
      filingCabinet: buildConstructedFurnitureGeo([
        { w: 0.52, h: 1.36, d: 0.62, y: 0 },
        { w: 0.46, h: 0.28, d: 0.64, y:  0.48 },  // Top drawer face
        { w: 0.46, h: 0.28, d: 0.64, y:  0.16 },  // Mid-upper drawer face
        { w: 0.46, h: 0.28, d: 0.64, y: -0.16 },  // Mid-lower drawer face
        { w: 0.46, h: 0.28, d: 0.64, y: -0.48 },  // Bottom drawer face
        { w: 0.14, h: 0.03, d: 0.04, y:  0.48, z: 0.33 }, // Drawer handles
        { w: 0.14, h: 0.03, d: 0.04, y:  0.16, z: 0.33 },
        { w: 0.14, h: 0.03, d: 0.04, y: -0.16, z: 0.33 },
        { w: 0.14, h: 0.03, d: 0.04, y: -0.48, z: 0.33 },
      ], [768, 0, 256, 256]),
      monitorPanel: new THREE.BoxGeometry(0.52, 0.34, 0.035),
      monitorStand: new THREE.BoxGeometry(0.16, 0.14, 0.16),
      keyboard: new THREE.BoxGeometry(0.38, 0.02, 0.14),
      paperStack: new THREE.BoxGeometry(0.24, 0.16, 0.30),
      sofaBase: new THREE.BoxGeometry(1.95, 0.42, 0.82),
      sofaBack: new THREE.BoxGeometry(1.95, 0.48, 0.22),
      sofaArm: new THREE.BoxGeometry(0.22, 0.56, 0.82),
      tallBookshelf: buildConstructedFurnitureGeo([
        { w: 0.54, h: 2.26, d: 0.06, z: -1.26 },  // Left upright side wall
        { w: 0.54, h: 2.26, d: 0.06, z:  1.26 },  // Right upright side wall
        { w: 0.04, h: 2.26, d: 2.58, x: -0.24 },  // Back spine board
        { w: 0.58, h: 0.07, d: 2.64, y:  1.12 },  // Beveled crown cornice
        { w: 0.52, h: 0.045, d: 2.52, y:  0.65 }, // Shelf 4
        { w: 0.52, h: 0.045, d: 2.52, y:  0.18 }, // Shelf 3
        { w: 0.52, h: 0.045, d: 2.52, y: -0.32 }, // Shelf 2
        { w: 0.52, h: 0.045, d: 2.52, y: -0.82 }, // Shelf 1
      ], [0, 0, 256, 256]),
      bookRowSpan: new THREE.BoxGeometry(0.42, 0.26, 2.38),
      readingTable: buildConstructedFurnitureGeo([
        { w: 1.66, h: 0.06, d: 1.06, y: 0.35 },   // Beveled tabletop
        { w: 0.07, h: 0.72, d: 0.07, x: -0.74, y: -0.02, z: -0.44 }, // 4 heavy timber legs
        { w: 0.07, h: 0.72, d: 0.07, x:  0.74, y: -0.02, z: -0.44 },
        { w: 0.07, h: 0.72, d: 0.07, x: -0.74, y: -0.02, z:  0.44 },
        { w: 0.07, h: 0.72, d: 0.07, x:  0.74, y: -0.02, z:  0.44 },
        { w: 1.48, h: 0.05, d: 0.05, x: 0, y: -0.22, z: 0 },         // Central H-stretcher cross-brace
      ], [0, 0, 256, 256]),
      readingLampStand: new THREE.CylinderGeometry(0.08, 0.12, 0.34, 8),
      readingLampShade: new THREE.BoxGeometry(0.26, 0.10, 0.16),
      serverRack: buildConstructedFurnitureGeo([
        { w: 0.78, h: 2.15, d: 0.86, y: 0 },
        { w: 0.82, h: 0.06, d: 0.90, y: 1.06 },   // Top ventilation bezel
        { w: 0.04, h: 1.95, d: 0.04, x: -0.38, y: 0, z:  0.42 }, // Corner rack rails with bolts
        { w: 0.04, h: 1.95, d: 0.04, x:  0.38, y: 0, z:  0.42 },
      ], [768, 0, 256, 256]),
      cableTray: new THREE.BoxGeometry(1.30, 0.06, 0.08),
      stallWall: new THREE.BoxGeometry(1.45, 1.95, 0.06),
      stallDoor: new THREE.BoxGeometry(0.05, 1.82, 0.78),
      toiletBase: new THREE.CylinderGeometry(0.20, 0.16, 0.42, 10),
      toiletTank: new THREE.BoxGeometry(0.22, 0.38, 0.42),
      sinkCounter: new THREE.BoxGeometry(0.58, 0.84, 2.40),
      sinkBasin: new THREE.BoxGeometry(0.38, 0.06, 0.48),
      wallMirror: new THREE.BoxGeometry(0.04, 1.05, 2.20),
      canteenCounter: new THREE.BoxGeometry(0.85, 0.98, 4.20),
      snackCase: new THREE.BoxGeometry(0.52, 0.48, 1.45),
      storageShelf: buildConstructedFurnitureGeo([
        { w: 0.58, h: 2.10, d: 0.05, z: -1.06 },  // Left upright frame
        { w: 0.58, h: 2.10, d: 0.05, z:  1.06 },  // Right upright frame
        { w: 0.56, h: 0.04, d: 2.18, y:  0.92 },  // 4 steel shelves
        { w: 0.56, h: 0.04, d: 2.18, y:  0.32 },
        { w: 0.56, h: 0.04, d: 2.18, y: -0.28 },
        { w: 0.56, h: 0.04, d: 2.18, y: -0.88 },
        { w: 0.03, h: 2.15, d: 0.05, x: -0.27, y: 0, z: 0, rx: 0.78 }, // Diagonal X cross-brace
        { w: 0.03, h: 2.15, d: 0.05, x: -0.27, y: 0, z: 0, rx: -0.78 },
      ], [768, 0, 256, 256]),
      crateBox: new THREE.BoxGeometry(0.46, 0.38, 0.46),
      vineCluster: new THREE.BoxGeometry(0.14, 1.65, 0.38),
    };
    // Tag repeated Step 2 interior prop geometries for automatic InstancedMesh batching
    step2Geos.lockerBank.userData.instancedCategory = 'locker';
    step2Geos.lockerDoor.userData.instancedCategory = 'locker';
    step2Geos.woodenCupboard.userData.instancedCategory = 'locker';
    step2Geos.pendantTubeFixture.userData.instancedCategory = 'fixture';
    step2Geos.venetianBlinds.userData.instancedCategory = 'fixture';
    step2Geos.bookStack.userData.instancedCategory = 'book';
    step2Geos.openBook.userData.instancedCategory = 'book';
    step2Geos.bookRowSpan.userData.instancedCategory = 'book';
    step2Geos.benchLongSeat.userData.instancedCategory = 'chair';
    step2Geos.benchLongBack.userData.instancedCategory = 'chair';
    step2Geos.officeDesk.userData.instancedCategory = 'desk';
    step2Geos.filingCabinet.userData.instancedCategory = 'locker';
    step2Geos.monitorPanel.userData.instancedCategory = 'desk';
    step2Geos.keyboard.userData.instancedCategory = 'desk';
    step2Geos.backpack.userData.instancedCategory = 'book';

    // Pre-merge door leaf + handle into 1 geometry so each articulated door is 1 draw call
    const mergedDoorLeafGeo = (function() {
      const g1 = step2Geos.doorLeaf.clone();
      const m1 = new THREE.Matrix4().makeTranslation(0.46, 1.13, 0);
      g1.applyMatrix4(m1);
      const g2 = step2Geos.doorHandle.clone();
      const m2 = new THREE.Matrix4().makeTranslation(0.82, 1.02, 0);
      g2.applyMatrix4(m2);
      return THREE.BufferGeometryUtils.mergeBufferGeometries([g1, g2]);
    })();

    // Helper: Swinging Wooden Door with Frame, Brass Handle & Room Code Plaque
    function buildSwingingDoor(parent, x, y, z, openAngleY = 1.05, plaqueMat = materials.gandakiBluePole, doorId = '') {
      const dPivot = new THREE.Group();
      dPivot.userData.noMerge = true;
      dPivot.userData.isSwingingDoor = true;
      const initAngle = openAngleY * 0.42;
      dPivot.position.set(x, y, z);
      dPivot.rotation.y = initAngle;

      const leaf = new THREE.Mesh(mergedDoorLeafGeo, materials.deskWoodTop);
      leaf.userData.noMerge = true;
      leaf.castShadow = false;
      leaf.receiveShadow = true;
      dPivot.add(leaf);

      parent.add(dPivot);

      const plaque = new THREE.Mesh(step2Geos.roomPlaque, plaqueMat);
      plaque.position.set(x, y + 2.05, z);
      parent.add(plaque);

      swingingDoors.push({
        id: doorId || ('door-' + (swingingDoors.length + 1)),
        pivot: dPivot,
        x: x,
        y: y,
        z: z,
        closedAngleY: openAngleY * 0.15,
        ajarAngleY: initAngle,
        openAngleY: openAngleY,
        currentAngleY: initAngle,
        targetAngleY: initAngle,
        isOpen: false,
        holdTimer: 0,
      });
    }

    // Helper: Window with Rod & Pleated Fabric Curtains
    function buildInteriorWindowCurtains(parent, x, y, z, rotY = 0, isGold = false) {
      const cGrp = new THREE.Group();
      cGrp.position.set(x, y, z);
      cGrp.rotation.y = rotY;

      const rod = new THREE.Mesh(step2Geos.curtainRod, materials.castIronDark);
      rod.rotation.z = Math.PI / 2;
      rod.position.set(0, 0.74, 0);
      cGrp.add(rod);

      const cMat = isGold ? step2Mats.curtainGold : step2Mats.curtainFabric;
      const leftPanel = new THREE.Mesh(step2Geos.curtainPanel, cMat);
      leftPanel.position.set(-0.66, -0.02, 0.02);
      cGrp.add(leftPanel);

      const rightPanel = new THREE.Mesh(step2Geos.curtainPanel, cMat);
      rightPanel.position.set(0.66, -0.02, 0.02);
      cGrp.add(rightPanel);

      parent.add(cGrp);
    }

    // Helper: Wall-Mounted Oscillating Fan
    function buildWallMountedFan(parent, x, y, z, rotY = 0) {
      const fGrp = new THREE.Group();
      fGrp.position.set(x, y, z);
      fGrp.rotation.y = rotY;

      const mount = new THREE.Mesh(step2Geos.wallFanMount, materials.deskSteelFrame);
      fGrp.add(mount);

      const cage = new THREE.Mesh(step2Geos.wallFanCage, materials.whiteTrim);
      cage.rotation.x = Math.PI / 2 + 0.22;
      cage.position.set(0, 0.06, 0.16);
      fGrp.add(cage);

      parent.add(fGrp);
    }

    /* =========================================================================
       REQUIREMENTS 2, 3 & 4:
       - Baked Ambient Occlusion Decals (corners, baseboards, coving, under-desk & furniture contact points)
       - Window Light Shafts + Floating Dust Particles in Beams + Corridor Fog
       - Small Clutter (scattered papers, upright/fallen bottles, overturned chairs, draped jackets, crooked posters)
       - Room Light Mood Controller & Fixtures (dark, dying_tube, moonlight, warm_lamp, emergency_red)
       ========================================================================= */
    const aoSharedPlaneGeo = new THREE.PlaneGeometry(1.0, 1.0);
    const clutterPaperGeo = new THREE.BoxGeometry(0.24, 0.006, 0.31);
    const clutterCrumpledGeo = new THREE.DodecahedronGeometry(0.055, 0);
    const clutterBottleBodyGeo = new THREE.CylinderGeometry(0.036, 0.038, 0.22, 8);
    const clutterBottleNeckGeo = new THREE.CylinderGeometry(0.014, 0.022, 0.07, 6);
    const clutterJacketGeo = buildConstructedFurnitureGeo([
      { w: 0.44, h: 0.38, d: 0.07, y: 0.0 },
      { w: 0.12, h: 0.34, d: 0.06, x: -0.24, y: -0.04, rz: 0.24 },
      { w: 0.12, h: 0.34, d: 0.06, x:  0.24, y: -0.04, rz: -0.24 },
    ]);
    const clutterBottleGeo = buildConstructedFurnitureGeo([
      { geo: clutterBottleBodyGeo, y: 0.0 },
      { geo: clutterBottleNeckGeo, y: 0.14 },
    ]);
    const fallenChairGeo = buildConstructedFurnitureGeo([
      { geo: sharedGeos.chairSeat, y: 0.0 },
      { geo: sharedGeos.chairBack, y: 0.22, z: 0.19 },
    ]);
    clutterPaperGeo.userData.instancedCategory = 'clutter';
    clutterCrumpledGeo.userData.instancedCategory = 'clutter';
    clutterBottleGeo.userData.instancedCategory = 'clutter';
    clutterJacketGeo.userData.instancedCategory = 'clutter';
    fallenChairGeo.userData.instancedCategory = 'clutter';

    step2Mats.deadTubeMat = new THREE.MeshStandardMaterial({
      map: peelingPaintTex.map,
      color: 0x182028,
      roughness: 0.72,
      metalness: 0.35,
    });
    step2Mats.dyingTubeMat = new THREE.MeshStandardMaterial({
      color: 0xdcfce7,
      emissive: 0x99f6e4,
      emissiveIntensity: 1.35,
      roughness: 0.20,
    });
    step2Mats.warmDeskLampBulbMat = new THREE.MeshStandardMaterial({
      color: 0xffe8c2,
      emissive: 0xff9838,
      emissiveIntensity: 1.45,
      roughness: 0.18,
    });
    step2Mats.emergencyRedBulbMat = new THREE.MeshStandardMaterial({
      color: 0xfca5a5,
      emissive: 0xff1e1e,
      emissiveIntensity: 1.65,
      roughness: 0.18,
    });
    step2Mats.bottleGreenGlass = new THREE.MeshStandardMaterial({
      map: dirtyGlassTex.map,
      color: 0x14532d,
      roughness: 0.16,
      metalness: 0.35,
      transparent: true,
      opacity: 0.84,
    });
    step2Mats.bottleClearPlastic = new THREE.MeshStandardMaterial({
      map: dirtyGlassTex.map,
      color: 0x38bdf8,
      roughness: 0.18,
      metalness: 0.22,
      transparent: true,
      opacity: 0.76,
    });
    step2Mats.jacketDenim = new THREE.MeshStandardMaterial({
      map: peelingPaintTex.map,
      bumpMap: peelingPaintTex.bumpMap,
      bumpScale: 0.04,
      color: 0x1e3a5f,
      roughness: 0.88,
    });
    step2Mats.jacketBurgundy = new THREE.MeshStandardMaterial({
      map: peelingPaintTex.map,
      bumpMap: peelingPaintTex.bumpMap,
      bumpScale: 0.04,
      color: 0x4c1d24,
      roughness: 0.88,
    });
    step2Mats.jacketOlive = new THREE.MeshStandardMaterial({
      map: peelingPaintTex.map,
      bumpMap: peelingPaintTex.bumpMap,
      bumpScale: 0.04,
      color: 0x2d3a2e,
      roughness: 0.88,
    });

    function addUnderFurnitureAO(parent, x, z, w, d, rotY = 0, yOff = 0.016) {
      const decal = new THREE.Mesh(aoSharedPlaneGeo, materials.aoUnderDeskDecal);
      decal.rotation.x = -Math.PI / 2;
      decal.rotation.z = -rotY;
      decal.position.set(x, yOff, z);
      decal.scale.set(w * 1.22, d * 1.22, 1.0);
      parent.add(decal);
    }

    function addRoomBakedAO(parent, roomW, roomD, roomH = 3.38, behindDoorCoords = null) {
      const hw = roomW * 0.5 - 0.04;
      const hd = roomD * 0.5 - 0.04;
      const stripW = 0.72;

      // 1. Floor-Wall Perimeter Baseboard AO Strips & Ceiling-Wall Coving AO Strips (8 edges total)
      [-hd, hd].forEach(zPos => {
        const s = new THREE.Mesh(aoSharedPlaneGeo, materials.aoCornerStripDecal);
        s.rotation.x = -Math.PI / 2;
        s.rotation.z = zPos < 0 ? Math.PI / 2 : -Math.PI / 2;
        s.position.set(0, 0.015, zPos + (zPos < 0 ? stripW * 0.45 : -stripW * 0.45));
        s.scale.set(stripW, roomW, 1);
        parent.add(s);

        const cStrip = new THREE.Mesh(aoSharedPlaneGeo, materials.aoCornerStripDecal);
        cStrip.rotation.x = Math.PI / 2;
        cStrip.rotation.z = zPos < 0 ? -Math.PI / 2 : Math.PI / 2;
        cStrip.position.set(0, roomH - 0.018, zPos + (zPos < 0 ? stripW * 0.45 : -stripW * 0.45));
        cStrip.scale.set(stripW * 1.1, roomW, 1);
        parent.add(cStrip);
      });
      [-hw, hw].forEach(xPos => {
        const s = new THREE.Mesh(aoSharedPlaneGeo, materials.aoCornerStripDecal);
        s.rotation.x = -Math.PI / 2;
        s.rotation.z = xPos < 0 ? 0 : Math.PI;
        s.position.set(xPos + (xPos < 0 ? stripW * 0.45 : -stripW * 0.45), 0.015, 0);
        s.scale.set(stripW, roomD, 1);
        parent.add(s);

        const cStrip = new THREE.Mesh(aoSharedPlaneGeo, materials.aoCornerStripDecal);
        cStrip.rotation.x = Math.PI / 2;
        cStrip.rotation.z = xPos < 0 ? 0 : Math.PI;
        cStrip.position.set(xPos + (xPos < 0 ? stripW * 0.45 : -stripW * 0.45), roomH - 0.018, 0);
        cStrip.scale.set(stripW * 1.1, roomD, 1);
        parent.add(cStrip);
      });

      // 2. Vertical Wall-Wall Corner AO Strips + Floor & Ceiling Corner Pockets
      [
        { x: -hw + 0.18, z: -hd + 0.18, ry: Math.PI * 0.25 },
        { x:  hw - 0.18, z: -hd + 0.18, ry: -Math.PI * 0.25 },
        { x: -hw + 0.18, z:  hd - 0.18, ry: Math.PI * 0.75 },
        { x:  hw - 0.18, z:  hd - 0.18, ry: -Math.PI * 0.75 },
      ].forEach(c => {
        const vStrip = new THREE.Mesh(aoSharedPlaneGeo, materials.aoCornerStripDecal);
        vStrip.position.set(c.x, roomH * 0.5, c.z);
        vStrip.rotation.y = c.ry;
        vStrip.scale.set(0.68, roomH - 0.06, 1);
        parent.add(vStrip);

        const cFloor = new THREE.Mesh(aoSharedPlaneGeo, materials.aoUnderDeskDecal);
        cFloor.rotation.x = -Math.PI / 2;
        cFloor.position.set(c.x * 0.90, 0.018, c.z * 0.90);
        cFloor.scale.set(1.55, 1.55, 1);
        parent.add(cFloor);
      });

      // 3. Behind-Door Baked AO Pockets (Requirement 3: behind doors & around contact points)
      const doorList = behindDoorCoords || [
        { x: hw - 0.55, z: -hd + 1.85 },
        { x: -hw + 0.55, z: -hd + 1.85 },
      ];
      doorList.forEach(dc => {
        const dDecal = new THREE.Mesh(aoSharedPlaneGeo, materials.aoUnderDeskDecal);
        dDecal.rotation.x = -Math.PI / 2;
        dDecal.position.set(dc.x, 0.017, dc.z);
        dDecal.scale.set(1.25, 1.25, 1);
        parent.add(dDecal);
      });
    }

    const corridorFogPlanes = [];
    const roomBeamDustSystems = [];
    const roomMoodFixtures = [];

    const roomShaftGroups = [];
    function spawnCorridorFogPlanes(parent, corridorX, floorY, corridorZ, length) {
      const numPlanes = Math.max(2, Math.min(5, Math.floor(length / 6.5)));
      const fogGeo = new THREE.PlaneGeometry(2.6, 5.2);
      const isRootScene = (parent === scene);
      for (let i = 0; i < numPlanes; i++) {
        const oz = -length * 0.36 + (i / Math.max(1, numPlanes - 1)) * (length * 0.72);
        const fogMesh = new THREE.Mesh(fogGeo, materials.corridorFogPlaneMat);
        fogMesh.rotation.x = -Math.PI / 2;
        const bx = isRootScene ? corridorX : 0;
        const by = (isRootScene ? floorY : 0) + 0.24 + (i % 2) * 0.18;
        const bz = (isRootScene ? corridorZ : 0) + oz;
        fogMesh.position.set(bx, by, bz);
        fogMesh.userData.noMerge = true;
        parent.add(fogMesh);
        corridorFogPlanes.push({
          mesh: fogMesh,
          baseX: bx,
          baseY: by,
          baseZ: bz,
          worldX: corridorX,
          floorY,
          worldZ: corridorZ,
          isRootScene,
          speed: 0.38,
          phase: i * 1.57 + corridorX * 0.3,
        });
      }
    }

    const sharedMoonShaftConeGeo = new THREE.ConeGeometry(1.18, 4.2, 12, 1, true);
    const sharedBeamDustPointsMat = new THREE.PointsMaterial({
      map: softRoundParticleTex,
      color: 0xc8e4ff,
      size: 0.06,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    function buildWindowLightShaftWithDust(parent, wx, wy, wz, inDirX, inDirZ, length = 3.8, width = 1.55) {
      const shaftGrp = new THREE.Group();
      shaftGrp.userData.noMerge = true;
      shaftGrp.position.set(wx, wy, wz);

      // Requirement 5: Moonlight through windows as a visible volumetric shaft (additive cone mesh with soft alpha)
      const coneMesh = new THREE.Mesh(sharedMoonShaftConeGeo, step2Mats.moonlightShaftMat);
      coneMesh.position.set(inDirX * (length * 0.42), -length * 0.34, inDirZ * (length * 0.42));
      if (Math.abs(inDirX) > 0.5) {
        coneMesh.rotation.z = inDirX > 0 ? 0.74 : -0.74;
      } else {
        coneMesh.rotation.x = inDirZ > 0 ? -0.74 : 0.74;
      }
      coneMesh.scale.set(width / 1.55, length / 4.2, width / 1.55);
      coneMesh.userData.noMerge = true;
      shaftGrp.add(coneMesh);

      // Slanted Venetian-blind ray plane inside the cone for crisp blind-slat light streaks (Ref 4 & Ref 5)
      const sGeo = new THREE.PlaneGeometry(width, length);
      const shaft1 = new THREE.Mesh(sGeo, materials.windowMoonShaftMat);
      shaft1.position.set(inDirX * (length * 0.38), -length * 0.32, inDirZ * (length * 0.38));
      if (Math.abs(inDirX) > 0.5) {
        shaft1.rotation.y = inDirX > 0 ? Math.PI / 2 : -Math.PI / 2;
        shaft1.rotation.x = 0.68;
      } else {
        if (inDirZ < 0) shaft1.rotation.y = Math.PI;
        shaft1.rotation.x = 0.68;
      }
      shaft1.userData.noMerge = true;
      shaftGrp.add(shaft1);

      // Projected window-frame & Venetian-blind slat moonlight patch on the floor where the shaft lands
      const gobo = new THREE.Mesh(aoSharedPlaneGeo, materials.moonFloorGoboMat);
      gobo.rotation.x = -Math.PI / 2;
      gobo.position.set(inDirX * (length * 0.66), -wy + 0.024, inDirZ * (length * 0.66));
      gobo.scale.set(width * 1.35, width * 1.65, 1.0);
      gobo.userData.noMerge = true;
      shaftGrp.add(gobo);

      // Floating dust motes suspended inside the window light shaft
      const dCount = 14;
      const dGeo = new THREE.BufferGeometry();
      const dPos = new Float32Array(dCount * 3);
      const dMeta = [];
      for (let i = 0; i < dCount; i++) {
        const t = 0.15 + Math.random() * 0.78;
        const spread = (Math.random() - 0.5) * width * 0.75;
        dPos[i * 3]     = inDirX * (length * 0.72 * t) + (Math.abs(inDirZ) > 0.5 ? spread : 0);
        dPos[i * 3 + 1] = -t * (wy - 0.25) + (Math.random() - 0.5) * 0.35;
        dPos[i * 3 + 2] = inDirZ * (length * 0.72 * t) + (Math.abs(inDirX) > 0.5 ? spread : 0);
        dMeta.push({
          baseX: dPos[i * 3],
          baseY: dPos[i * 3 + 1],
          baseZ: dPos[i * 3 + 2],
          phase: Math.random() * 6.28,
        });
      }
      dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
      const dPoints = new THREE.Points(dGeo, sharedBeamDustPointsMat);
      dPoints.userData.noMerge = true;
      shaftGrp.add(dPoints);
      roomBeamDustSystems.push({ points: dPoints, geo: dGeo, pos: dPos, meta: dMeta, roomGroup: parent });
      shaftGrp.userData.goboMesh = gobo;
      shaftGrp.userData.dustPoints = dPoints;
      shaftGrp.userData.coneMesh = coneMesh;
      shaftGrp.userData.rayMesh = shaft1;
      roomShaftGroups.push({ group: shaftGrp, roomGroup: parent, gobo, dPoints, coneMesh, shaft1 });

      parent.add(shaftGrp);
      return shaftGrp;
    }

    function populateRoomClutterAndAsymmetry(parent, roomW, roomD, seed = 1, isCorridor = false) {
      const s = Math.abs(Math.round(seed * 17 + roomW * 7 + roomD * 13));
      const hw = roomW * 0.38;
      const hd = roomD * 0.38;
      const jacketMats = [step2Mats.jacketDenim, step2Mats.jacketBurgundy, step2Mats.jacketOlive];

      // 1. Scattered loose papers & crumpled paper balls on the floor
      const paperCount = isCorridor ? 4 : 7;
      for (let i = 0; i < paperCount; i++) {
        const px = (((s + i * 37) % 100) / 50 - 1) * hw;
        const pz = (((s + i * 61) % 100) / 50 - 1) * hd;
        if (i % 3 === 2) {
          const ball = new THREE.Mesh(clutterCrumpledGeo, step2Mats.paperSheet);
          ball.position.set(px, 0.045, pz);
          ball.rotation.set(i * 0.7, i * 1.3, 0.4);
          parent.add(ball);
        } else {
          const sheet = new THREE.Mesh(clutterPaperGeo, step2Mats.paperSheet);
          sheet.position.set(px, 0.012 + (i % 2) * 0.003, pz);
          sheet.rotation.y = ((s + i * 29) % 628) * 0.01;
          parent.add(sheet);
        }
      }

      // 2. Upright & fallen water/glass bottles near walls & desks
      const bottleCount = isCorridor ? 2 : 4;
      for (let b = 0; b < bottleCount; b++) {
        const bx = (((s + b * 43) % 100) / 50 - 1) * hw * 0.92;
        const bz = (((s + b * 71) % 100) / 50 - 1) * hd * 0.92;
        const bMat = (b % 2 === 0) ? step2Mats.bottleClearPlastic : step2Mats.bottleGreenGlass;
        const bMesh = new THREE.Mesh(clutterBottleGeo, bMat);
        if (b % 2 === 1) {
          // Fallen bottle rolled onto its side
          bMesh.position.set(bx, 0.04, bz);
          bMesh.rotation.set(Math.PI / 2, (s + b * 1.9) % 6.28, 0);
        } else {
          bMesh.position.set(bx, 0.11, bz);
          bMesh.rotation.y = b * 1.1;
        }
        parent.add(bMesh);
      }

      if (!isCorridor) {
        // 3. Fallen / overturned chair lying on its side to break symmetry (visual only, no collider block)
        const fcX = ((s % 2 === 0) ? -1 : 1) * (hw * 0.52);
        const fcZ = (((s * 3) % 2 === 0) ? -1 : 1) * (hd * 0.46);
        const fChair = new THREE.Mesh(fallenChairGeo, materials.chairWood);
        fChair.position.set(fcX, 0.22, fcZ);
        fChair.rotation.set(Math.PI / 2, 0.45 + (s % 5) * 0.5, 0.12);
        parent.add(fChair);
        addUnderFurnitureAO(parent, fcX, fcZ, 0.65, 0.65, fChair.rotation.y);

        // 4. Forgotten student jacket / hoodie crumpled on floor or bench corner
        const jkX = -fcX * 0.78;
        const jkZ = -fcZ * 0.65;
        const jacket = new THREE.Mesh(clutterJacketGeo, jacketMats[s % jacketMats.length]);
        jacket.position.set(jkX, 0.05, jkZ);
        jacket.rotation.set(Math.PI / 2, (s * 0.8) % 6.28, 0);
        parent.add(jacket);

        // 5. Crooked peeling posters on interior walls
        const pGeo1 = posterGeoVariants[s % posterGeoVariants.length];
        const pGeo2 = posterGeoVariants[(s + 2) % posterGeoVariants.length];
        const p1 = new THREE.Mesh(pGeo1, oldPosterMat);
        p1.position.set(-roomW * 0.48 + 0.03, 1.62, -roomD * 0.22);
        p1.rotation.set(0, Math.PI / 2, 0.09);
        parent.add(p1);

        const p2 = new THREE.Mesh(pGeo2, oldPosterMat);
        p2.position.set(roomW * 0.48 - 0.03, 1.54, roomD * 0.26);
        p2.rotation.set(0, -Math.PI / 2, -0.07);
        parent.add(p2);
      }
    }

    // Helper: Populate Corridor / Veranda Strip with Lockers, Notice Boards, Water Dispenser, Fire Extinguisher, Wall Lamps, Floor Mats, Framed Photos, AO & Corridor Fog
    function populateCorridorProps(corridorX, corridorZ, floorY, length, wallSignX = 1, doorZList = [], zoneName = 'Corridor') {
      const cGroup = new THREE.Group();
      cGroup.position.set(corridorX, floorY, corridorZ);
      scene.add(cGroup);

      // Requirement 3: Corridor Fog + Baked Baseboard AO + Clutter
      spawnCorridorFogPlanes(cGroup, corridorX, floorY, corridorZ, length);
      populateRoomClutterAndAsymmetry(cGroup, 1.6, length * 0.85, Math.abs(corridorX + corridorZ), true);

      // 1. Floor Mats at each doorway + Wall Lamp Sconces & Framed Photos beside doors
      doorZList.forEach((dz, idx) => {
        const localZ = dz - corridorZ;
        const mat = new THREE.Mesh(step2Geos.floorMat, step2Mats.matRubber);
        mat.position.set(-wallSignX * 0.58, 0.012, localZ);
        mat.rotation.y = Math.PI / 2;
        cGroup.add(mat);

        const lampBack = new THREE.Mesh(step2Geos.wallLampBack, materials.castIronDark);
        lampBack.position.set(-wallSignX * 0.04, 2.38, localZ + 1.25);
        cGroup.add(lampBack);
        const lampBulb = new THREE.Mesh(step2Geos.wallLampBulb, idx % 2 === 0 ? step2Mats.dyingTubeMat : step2Mats.deadTubeMat);
        lampBulb.position.set(-wallSignX * 0.10, 2.38, localZ + 1.25);
        cGroup.add(lampBulb);

        const frame = new THREE.Mesh(step2Geos.photoFrame, materials.chairWood);
        frame.position.set(-wallSignX * 0.04, 1.78, localZ - 1.35);
        cGroup.add(frame);
        const photo = new THREE.Mesh(step2Geos.photoCanvas, materials.gandakiBluePole);
        photo.position.set(-wallSignX * 0.05, 1.78, localZ - 1.35);
        cGroup.add(photo);

        // Crooked wall poster beside corridor door
        const corrPoster = new THREE.Mesh(posterGeoVariants[(idx + 1) % posterGeoVariants.length], oldPosterMat);
        corrPoster.position.set(-wallSignX * 0.03, 1.56, localZ - 2.25);
        corrPoster.rotation.set(0, wallSignX > 0 ? -Math.PI / 2 : Math.PI / 2, (idx % 2 === 0 ? 0.08 : -0.06));
        cGroup.add(corrPoster);

        if (idx % 2 === 0) {
          const pot = new THREE.Mesh(step2Geos.plantPot, materials.nepalOchreDado);
          pot.position.set(-wallSignX * 0.36, 0.18, localZ + 1.45);
          cGroup.add(pot);
          const bush = new THREE.Mesh(step2Geos.plantBush, materials.foliageGreen);
          bush.position.set(-wallSignX * 0.36, 0.48, localZ + 1.45);
          cGroup.add(bush);
          addUnderFurnitureAO(cGroup, -wallSignX * 0.36, localZ + 1.45, 0.55, 0.55);
        }
      });

      // 2. Corridor Steel Locker Bank between Room 1 & Room 2
      const lockerZ = -length * 0.16;
      const lockerMesh = new THREE.Mesh(step2Geos.lockerBank, step2Mats.lockerSteel);
      lockerMesh.position.set(-wallSignX * 0.28, 0.96, lockerZ);
      cGroup.add(lockerMesh);
      addUnderFurnitureAO(cGroup, -wallSignX * 0.28, lockerZ, 0.72, 2.05);
      [-0.56, 0, 0.56].forEach(lz => {
        const lDoor = new THREE.Mesh(step2Geos.lockerDoor, step2Mats.lockerDoorBlue);
        lDoor.position.set(-wallSignX * 0.52, 1.05, lockerZ + lz);
        cGroup.add(lDoor);
      });

      // 3. Corridor Cork Notice Board with Pinned Schedules
      const nbZ = length * 0.16;
      const nbFrame = new THREE.Mesh(step2Geos.noticeBoard, materials.chairWood);
      nbFrame.position.set(-wallSignX * 0.04, 1.65, nbZ);
      cGroup.add(nbFrame);
      const nbCork = new THREE.Mesh(step2Geos.noticeCork, step2Mats.corkBoard);
      nbCork.position.set(-wallSignX * 0.05, 1.65, nbZ);
      cGroup.add(nbCork);
      [-0.45, 0.0, 0.42].forEach((nz, nIdx) => {
        const note = new THREE.Mesh(step2Geos.noticeNote, step2Mats.paperSheet);
        note.position.set(-wallSignX * 0.06, 1.68 + (nIdx - 1) * 0.08, nbZ + nz);
        note.rotation.x = (nIdx - 1) * 0.09;
        cGroup.add(note);
      });

      // 4. Hot/Cold Water Dispenser with Blue Water Jug
      const wdZ = lockerZ + 1.35;
      const wdBody = new THREE.Mesh(step2Geos.waterDispenser, materials.rotundaWhiteArch);
      wdBody.position.set(-wallSignX * 0.24, 0.51, wdZ);
      cGroup.add(wdBody);
      const wdJug = new THREE.Mesh(step2Geos.waterBottle, step2Mats.waterJugBlue);
      wdJug.position.set(-wallSignX * 0.24, 1.22, wdZ);
      cGroup.add(wdJug);
      addUnderFurnitureAO(cGroup, -wallSignX * 0.24, wdZ, 0.58, 0.58);

      const colCenterX = corridorX - wallSignX * 0.26;
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(colCenterX - 0.22, floorY, corridorZ + lockerZ - 0.92),
        new THREE.Vector3(colCenterX + 0.22, floorY + 1.95, corridorZ + wdZ + 0.26)
      ), 'furniture');

      // 5. Red Wall-Mounted Fire Extinguisher
      const feZ = nbZ - 1.25;
      const feBody = new THREE.Mesh(step2Geos.fireExtBody, step2Mats.fireRed);
      feBody.position.set(-wallSignX * 0.12, 1.22, feZ);
      cGroup.add(feBody);
      const feTop = new THREE.Mesh(step2Geos.fireExtTop, materials.castIronDark);
      feTop.position.set(-wallSignX * 0.12, 1.52, feZ);
      cGroup.add(feTop);

      cGroup.userData.isRoomGroup = true;
      bakeStaticGroup(cGroup, true);
      roomVisibilityList.push({
        id: zoneName,
        type: 'corridor',
        group: cGroup,
        x: corridorX,
        y: floorY,
        z: corridorZ,
        floorY,
        radius: Math.max(6.0, length * 0.52),
      });
    }

    // Helper: Standard / Seminar Classroom Interior
    function buildDetailedClassroomInterior(cGroup, unitCenterX, unitCenterZ, floorY, facingDirZ, unitTitle, isNewariStyle = false, layoutVariant = 0) {
      // 1. Teaching Wall Dado Band + Raised Dais Platform + Whiteboard & Chalkboard
      const boardZ = facingDirZ * -3.1;
      const dadoBand = new THREE.Mesh(
        new THREE.BoxGeometry(6.8, 1.02, 0.04),
        isNewariStyle ? materials.nepalOchreDado : materials.plinthDarkConcrete
      );
      dadoBand.position.set(0, 0.51, boardZ + facingDirZ * 0.02);
      cGroup.add(dadoBand);

      const dais = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.12, 1.4), materials.rotundaPlinthConcrete);
      dais.position.set(0, 0.06, boardZ + facingDirZ * 0.82);
      cGroup.add(dais);
      addUnderFurnitureAO(cGroup, 0, boardZ + facingDirZ * 0.82, 5.85, 1.65);

      const wbMesh = new THREE.Mesh(sharedGeos.whiteboard, materials.whiteboardSurface);
      wbMesh.position.set(-1.1, 1.85, boardZ);
      cGroup.add(wbMesh);

      const bbMesh = new THREE.Mesh(sharedGeos.whiteboard, materials.blackboardGreen);
      bbMesh.position.set(2.2, 1.85, boardZ);
      cGroup.add(bbMesh);

      // Rear Wall Notice Board with pinned notes
      const rearNotice = new THREE.Mesh(step2Geos.noticeBoard, materials.chairWood);
      rearNotice.rotation.y = Math.PI / 2;
      rearNotice.position.set(0, 1.75, facingDirZ * 3.15);
      cGroup.add(rearNotice);
      const rearCork = new THREE.Mesh(step2Geos.noticeCork, step2Mats.corkBoard);
      rearCork.rotation.y = Math.PI / 2;
      rearCork.position.set(0, 1.75, facingDirZ * 3.12);
      cGroup.add(rearCork);

      // Side Wall Wooden Bookshelf + Upper Wall Shelves with Books + Simplified Box Collider + Under-Bookcase AO
      const bookcase = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.95, 2.1), materials.chairWood);
      bookcase.position.set(-3.15, 0.98, 0.4);
      cGroup.add(bookcase);
      addUnderFurnitureAO(cGroup, -3.12, 0.4, 0.72, 2.35);
      const bookRow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 1.85), materials.gandakiBluePole);
      bookRow.position.set(-3.10, 1.35, 0.4);
      cGroup.add(bookRow);
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(unitCenterX - 3.38, floorY, unitCenterZ + 0.4 - 1.05),
        new THREE.Vector3(unitCenterX - 2.92, floorY + 1.95, unitCenterZ + 0.4 + 1.05)
      ), 'furniture');

      [1.45, 2.05].forEach((sy, sIdx) => {
        const wShelf = new THREE.Mesh(step2Geos.wallShelf, materials.chairWood);
        wShelf.position.set(3.18, sy, -0.8 + sIdx * 0.4);
        cGroup.add(wShelf);
        const sBooks = new THREE.Mesh(step2Geos.bookStack, sIdx === 0 ? materials.rotundaRedSteel : materials.gandakiBluePole);
        sBooks.position.set(3.14, sy + 0.08, -0.8 + sIdx * 0.4);
        cGroup.add(sBooks);
      });

      // Wall-Mounted Oscillating Fans on both side walls + Window Curtains
      buildWallMountedFan(cGroup, -3.28, 2.55, -1.5, Math.PI / 2);
      buildWallMountedFan(cGroup, 3.28, 2.55, 1.2, -Math.PI / 2);
      buildInteriorWindowCurtains(cGroup, 3.26, 1.92, -1.6, -Math.PI / 2, isNewariStyle);
      buildInteriorWindowCurtains(cGroup, 3.26, 1.92, 1.8, -Math.PI / 2, isNewariStyle);

      // Teacher Podium & Lecture Desk with Simplified Box Colliders + Under-Furniture AO
      const podiumZ = facingDirZ * -2.1;
      const podium = new THREE.Mesh(sharedGeos.podiumBody, materials.chairWood);
      podium.position.set(-2.6, 0.64, podiumZ);
      cGroup.add(podium);
      addUnderFurnitureAO(cGroup, -2.6, podiumZ, 0.85, 0.85);
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(unitCenterX - 2.95, floorY, unitCenterZ + podiumZ - 0.30),
        new THREE.Vector3(unitCenterX - 2.25, floorY + 1.25, unitCenterZ + podiumZ + 0.30)
      ), 'furniture');

      const tDesk = new THREE.Mesh(sharedGeos.deskTop, materials.deskWoodTop);
      tDesk.position.set(0.4, 0.82, podiumZ);
      cGroup.add(tDesk);
      addUnderFurnitureAO(cGroup, 0.4, podiumZ, 1.55, 0.95);
      const tBook = new THREE.Mesh(step2Geos.openBook, step2Mats.paperSheet);
      tBook.position.set(0.35, 0.86, podiumZ);
      cGroup.add(tBook);
      const tChair = new THREE.Mesh(sharedGeos.chairSeat, materials.chairWood);
      tChair.position.set(0.4, 0.50, podiumZ - facingDirZ * 0.5);
      tChair.rotation.y = 0.14;
      cGroup.add(tChair);
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(unitCenterX + 0.4 - 0.62, floorY, unitCenterZ + podiumZ - 0.34),
        new THREE.Vector3(unitCenterX + 0.4 + 0.62, floorY + 0.88, unitCenterZ + podiumZ + 0.34)
      ), 'furniture');

      interactiveHidingSpots.push({
        id: 'podium-' + unitTitle,
        name: unitTitle + ' (Teacher Desk & Lectern)',
        x: unitCenterX + 0.4,
        y: floorY,
        z: unitCenterZ + podiumZ + facingDirZ * 0.58,
        zone: unitTitle,
      });

      // Student Desks & Benches with Organic Asymmetry, Under-Desk AO Decals, Bags, Books & Jackets
      const rowOffsetsZ = layoutVariant === 1
        ? [facingDirZ * -0.65, facingDirZ * 0.65, facingDirZ * 1.95]
        : [facingDirZ * -0.45, facingDirZ * 0.85, facingDirZ * 2.10];
      const colOffsetsX = [-2.35, 0.0, 2.35];
      const bagMats = [step2Mats.bagNavy, step2Mats.bagOlive, step2Mats.bagMaroon];
      const roomSeed = Math.abs(Math.round(unitCenterX * 13 + unitCenterZ * 7));

      rowOffsetsZ.forEach((rz, rIdx) => {
        colOffsetsX.forEach((cx, cIdx) => {
          if (layoutVariant === 1 && rIdx === 0 && cIdx === 1) return;

          const deskSeed = roomSeed + rIdx * 11 + cIdx * 19;
          const jitterX = ((deskSeed % 7) - 3) * 0.018;
          const jitterZ = (((deskSeed * 3) % 7) - 3) * 0.016;
          const jitterYaw = (((deskSeed * 5) % 9) - 4) * 0.022;

          // Baked contact AO decal directly under desk & bench footprint
          addUnderFurnitureAO(cGroup, cx + jitterX, rz + jitterZ + facingDirZ * 0.18, 1.52, 1.12, jitterYaw);

          const deskGroup = new THREE.Group();
          deskGroup.position.set(cx + jitterX, 0, rz + jitterZ);
          deskGroup.rotation.y = jitterYaw;

          const topMesh = new THREE.Mesh(sharedGeos.deskTop, materials.deskWoodTop);
          topMesh.position.y = 0.75;
          deskGroup.add(topMesh);

          const panelMesh = new THREE.Mesh(sharedGeos.deskModestyPanel, materials.chairWood);
          panelMesh.position.set(0, 0.56, -facingDirZ * 0.24);
          deskGroup.add(panelMesh);

          const legL = new THREE.Mesh(sharedGeos.deskLeg, materials.deskSteelFrame);
          legL.position.set(-0.58, 0.37, 0);
          deskGroup.add(legL);
          const legR = new THREE.Mesh(sharedGeos.deskLeg, materials.deskSteelFrame);
          legR.position.set(0.58, 0.37, 0);
          deskGroup.add(legR);

          const benchZ = facingDirZ * 0.44 + ((deskSeed % 5) - 2) * 0.025;
          const benchYaw = (((deskSeed * 7) % 7) - 3) * 0.028;
          const bSeat = new THREE.Mesh(step2Geos.benchLongSeat, materials.chairWood);
          bSeat.position.set(0, 0.44, benchZ);
          bSeat.rotation.y = benchYaw;
          deskGroup.add(bSeat);
          const bBack = new THREE.Mesh(step2Geos.benchLongBack, materials.chairWood);
          bBack.position.set(0, 0.62, benchZ + facingDirZ * 0.16);
          bBack.rotation.y = benchYaw;
          deskGroup.add(bBack);

          if ((rIdx + cIdx) % 2 === 0) {
            const openBk = new THREE.Mesh(step2Geos.openBook, step2Mats.paperSheet);
            openBk.position.set(0.22, 0.79, 0.02);
            openBk.rotation.y = 0.18 * (cIdx - 1);
            deskGroup.add(openBk);
          } else {
            const stackBk = new THREE.Mesh(step2Geos.bookStack, materials.gandakiBluePole);
            stackBk.position.set(-0.28, 0.83, -0.04);
            stackBk.rotation.y = -0.14;
            deskGroup.add(stackBk);
          }

          if ((rIdx * 3 + cIdx) % 2 === 1) {
            const bag = new THREE.Mesh(step2Geos.backpack, bagMats[(rIdx + cIdx) % 3]);
            bag.position.set(-0.36, 0.64, benchZ);
            bag.rotation.y = 0.25;
            deskGroup.add(bag);
          } else if (rIdx === 1 && cIdx === 2) {
            // Draped jacket over bench corner to break symmetry
            const jk = new THREE.Mesh(clutterJacketGeo, step2Mats.jacketBurgundy);
            jk.position.set(0.38, 0.52, benchZ);
            jk.rotation.set(0.25, 0.4, 0.15);
            deskGroup.add(jk);
          }

          cGroup.add(deskGroup);

          const worldDeskX = unitCenterX + cx;
          const worldDeskZ = unitCenterZ + rz;
          const zMin = Math.min(worldDeskZ - 0.26, worldDeskZ + benchZ - 0.18);
          const zMax = Math.max(worldDeskZ + 0.26, worldDeskZ + benchZ + 0.18);

          addColliderBox(new THREE.Box3(
            new THREE.Vector3(worldDeskX - 0.58, floorY, zMin),
            new THREE.Vector3(worldDeskX + 0.58, floorY + 0.78, zMax)
          ), 'furniture');

          if ((rIdx + cIdx) % 2 === 0) {
            interactiveHidingSpots.push({
              id: 'desk-' + unitTitle + '-' + rIdx + '-' + cIdx,
              name: unitTitle + ' Desk #' + (rIdx * 3 + cIdx + 1),
              x: worldDeskX,
              y: floorY,
              z: worldDeskZ + facingDirZ * 0.68,
              zone: unitTitle,
            });
          }
        });
      });
    }

    // Specialized Builder: Computer Lab (Rows of Monitors & Chairs, Cable Raceways, Server Rack with LEDs)
    function buildComputerLabInterior(cGroup, unitCenterX, unitCenterZ, floorY, facingDirZ, unitTitle) {
      const boardZ = facingDirZ * -3.1;
      const wbMesh = new THREE.Mesh(sharedGeos.whiteboard, materials.whiteboardSurface);
      wbMesh.position.set(0, 1.85, boardZ);
      cGroup.add(wbMesh);

      buildWallMountedFan(cGroup, -3.28, 2.55, 0, Math.PI / 2);
      buildWallMountedFan(cGroup, 3.28, 2.55, 0, -Math.PI / 2);
      buildInteriorWindowCurtains(cGroup, -3.26, 1.92, -1.5, Math.PI / 2, false);
      buildInteriorWindowCurtains(cGroup, -3.26, 1.92, 1.5, Math.PI / 2, false);

      const srvX = 2.65, srvZ = facingDirZ * -2.35;
      const srvRack = new THREE.Mesh(step2Geos.serverRack, materials.castIronDark);
      srvRack.position.set(srvX, 1.08, srvZ);
      cGroup.add(srvRack);
      addUnderFurnitureAO(cGroup, srvX, srvZ, 1.15, 1.15);
      [-0.4, 0.0, 0.4, 0.75].forEach((ly, lIdx) => {
        const led = new THREE.Mesh(
          new THREE.BoxGeometry(0.48, 0.035, 0.04),
          lIdx % 2 === 0 ? step2Mats.serverLedGreen : step2Mats.serverLedAmber
        );
        led.position.set(srvX, 1.15 + ly, srvZ + facingDirZ * 0.43);
        cGroup.add(led);
      });
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(unitCenterX + srvX - 0.42, floorY, unitCenterZ + srvZ - 0.45),
        new THREE.Vector3(unitCenterX + srvX + 0.42, floorY + 2.15, unitCenterZ + srvZ + 0.45)
      ), 'furniture');
      interactiveHidingSpots.push({
        id: 'server-rack-' + unitTitle,
        name: unitTitle + ' (Behind Server Rack)',
        x: unitCenterX + srvX - 0.78,
        y: floorY,
        z: unitCenterZ + srvZ,
        zone: unitTitle,
      });

      const rowsZ = [facingDirZ * -1.1, facingDirZ * 0.35, facingDirZ * 1.80];
      const colsX = [-1.85, 1.45];
      rowsZ.forEach((rz, rIdx) => {
        colsX.forEach((cx, cIdx) => {
          addUnderFurnitureAO(cGroup, cx, rz + facingDirZ * 0.16, 1.50, 1.08, (rIdx - cIdx) * 0.02);
          const wGrp = new THREE.Group();
          wGrp.position.set(cx, 0, rz);
          wGrp.rotation.y = (rIdx - cIdx) * 0.018;

          const desk = new THREE.Mesh(sharedGeos.deskTop, materials.deskSteelFrame);
          desk.position.y = 0.75;
          wGrp.add(desk);

          const cableRun = new THREE.Mesh(step2Geos.cableTray, materials.castIronDark);
          cableRun.position.set(0, 0.52, -facingDirZ * 0.22);
          wGrp.add(cableRun);

          [-0.32, 0.32].forEach((mx, mIdx) => {
            const isOn = (rIdx + cIdx + mIdx) % 2 === 0;
            const mon = new THREE.Mesh(step2Geos.monitorPanel, isOn ? step2Mats.monitorScreenOn : step2Mats.monitorScreenOff);
            mon.position.set(mx, 0.98, -facingDirZ * 0.10);
            mon.rotation.y = (mIdx === 0 ? 0.08 : -0.06);
            wGrp.add(mon);
            const stand = new THREE.Mesh(step2Geos.monitorStand, materials.castIronDark);
            stand.position.set(mx, 0.82, -facingDirZ * 0.12);
            wGrp.add(stand);
            const kb = new THREE.Mesh(step2Geos.keyboard, materials.deskSteelFrame);
            kb.position.set(mx, 0.79, facingDirZ * 0.12);
            kb.rotation.y = (mIdx === 0 ? -0.05 : 0.09);
            wGrp.add(kb);

            const chairYaw = ((rIdx * 3 + cIdx + mIdx) % 5 - 2) * 0.11;
            const chSeat = new THREE.Mesh(sharedGeos.chairSeat, materials.castIronDark);
            chSeat.position.set(mx, 0.46, facingDirZ * 0.44);
            chSeat.rotation.y = chairYaw;
            wGrp.add(chSeat);
            const chBack = new THREE.Mesh(sharedGeos.chairBack, materials.castIronDark);
            chBack.position.set(mx, 0.68, facingDirZ * 0.62);
            chBack.rotation.y = chairYaw;
            wGrp.add(chBack);
          });

          cGroup.add(wGrp);
          const wx = unitCenterX + cx;
          const wz = unitCenterZ + rz;
          const zMin = Math.min(wz - 0.26, wz + facingDirZ * 0.56);
          const zMax = Math.max(wz + 0.26, wz + facingDirZ * 0.56);
          addColliderBox(new THREE.Box3(
            new THREE.Vector3(wx - 0.60, floorY, zMin),
            new THREE.Vector3(wx + 0.60, floorY + 0.86, zMax)
          ), 'furniture');
          if ((rIdx + cIdx) % 2 === 0) {
            interactiveHidingSpots.push({
              id: 'lab-desk-' + unitTitle + '-' + rIdx + '-' + cIdx,
              name: unitTitle + ' Workstation #' + (rIdx * 2 + cIdx + 1),
              x: wx,
              y: floorY,
              z: wz + facingDirZ * 0.72,
              zone: unitTitle,
            });
          }
        });
      });
    }

    // Specialized Builder: Library Room (Tall Bookshelves in Rows with Walkable Gaps, Reading Tables, Desk Lamps)
    function buildLibraryRoomInterior(cGroup, unitCenterX, unitCenterZ, floorY, facingDirZ, unitTitle) {
      buildWallMountedFan(cGroup, -3.28, 2.55, 0, Math.PI / 2);
      buildWallMountedFan(cGroup, 3.28, 2.55, 0, -Math.PI / 2);
      buildInteriorWindowCurtains(cGroup, -3.26, 1.92, -1.6, Math.PI / 2, true);
      buildInteriorWindowCurtains(cGroup, -3.26, 1.92, 1.6, Math.PI / 2, true);

      const stackZList = [-2.2, 0.0, 2.2];
      stackZList.forEach((sz, sIdx) => {
        const shelfX = -1.65;
        const shelf = new THREE.Mesh(step2Geos.tallBookshelf, materials.chairWood);
        shelf.rotation.y = Math.PI / 2;
        shelf.position.set(shelfX, 1.14, sz);
        cGroup.add(shelf);
        addUnderFurnitureAO(cGroup, shelfX, sz, 2.75, 0.85);

        [0.48, 0.96, 1.44, 1.92].forEach((by, bIdx) => {
          const books = new THREE.Mesh(
            step2Geos.bookRowSpan,
            (sIdx + bIdx) % 2 === 0 ? materials.gandakiBluePole : materials.rotundaRedSteel
          );
          books.rotation.y = Math.PI / 2;
          books.position.set(shelfX, by, sz);
          cGroup.add(books);
        });

        const wx = unitCenterX + shelfX;
        const wz = unitCenterZ + sz;
        addColliderBox(new THREE.Box3(
          new THREE.Vector3(wx - 1.30, floorY, wz - 0.30),
          new THREE.Vector3(wx + 1.30, floorY + 2.28, wz + 0.30)
        ), 'furniture');

        interactiveHidingSpots.push({
          id: 'lib-stack-' + unitTitle + '-' + sIdx,
          name: unitTitle + ' Bookshelf Aisle #' + (sIdx + 1),
          x: wx,
          y: floorY,
          z: wz + 0.72,
          zone: unitTitle,
        });
      });

      [-1.35, 1.35].forEach((tz, tIdx) => {
        const tx = 1.75;
        const rTable = new THREE.Mesh(step2Geos.readingTable, materials.deskWoodTop);
        rTable.position.set(tx, 0.38, tz);
        cGroup.add(rTable);
        addUnderFurnitureAO(cGroup, tx, tz, 1.85, 1.55);

        const lampStand = new THREE.Mesh(step2Geos.readingLampStand, materials.brassGajur);
        lampStand.position.set(tx, 0.92, tz);
        cGroup.add(lampStand);
        const lampShade = new THREE.Mesh(step2Geos.readingLampShade, step2Mats.lampShadeGreen);
        lampShade.position.set(tx, 1.10, tz);
        cGroup.add(lampShade);

        const openBk = new THREE.Mesh(step2Geos.openBook, step2Mats.paperSheet);
        openBk.position.set(tx - 0.38, 0.78, tz + 0.22);
        openBk.rotation.y = (tIdx === 0 ? 0.22 : -0.31);
        cGroup.add(openBk);

        [-0.45, 0.45].forEach((chZ, chIdx) => {
          const ch = new THREE.Mesh(sharedGeos.chairSeat, materials.chairWood);
          ch.position.set(tx + (chIdx === 0 ? -0.06 : 0.08), 0.45, tz + chZ * 1.45);
          ch.rotation.y = (chIdx === 0 ? 0.16 : -0.22);
          cGroup.add(ch);
        });

        const wx = unitCenterX + tx;
        const wz = unitCenterZ + tz;
        addColliderBox(new THREE.Box3(
          new THREE.Vector3(wx - 0.82, floorY, wz - 0.65),
          new THREE.Vector3(wx + 0.82, floorY + 0.80, wz + 0.65)
        ), 'furniture');
      });
    }

    // Specialized Builder: Staff Room & Admin Offices
    function buildStaffAdminOfficeInterior(cGroup, unitCenterX, unitCenterZ, floorY, facingDirZ, unitTitle) {
      buildWallMountedFan(cGroup, -3.28, 2.55, 0, Math.PI / 2);
      buildInteriorWindowCurtains(cGroup, 3.26, 1.92, -1.4, -Math.PI / 2, true);
      buildInteriorWindowCurtains(cGroup, 3.26, 1.92, 1.4, -Math.PI / 2, true);

      [-2.1, -1.4, -0.7, 0.0].forEach((fx, fIdx) => {
        const cab = new THREE.Mesh(step2Geos.filingCabinet, step2Mats.lockerSteel);
        cab.position.set(fx, 0.69, -2.75);
        cGroup.add(cab);
        if (fIdx % 2 === 0) {
          const pStack = new THREE.Mesh(step2Geos.paperStack, step2Mats.paperSheet);
          pStack.position.set(fx, 1.46, -2.75);
          pStack.rotation.y = 0.14;
          cGroup.add(pStack);
        }
      });
      addUnderFurnitureAO(cGroup, -1.05, -2.75, 2.95, 0.90);
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(unitCenterX - 2.45, floorY, unitCenterZ - 3.10),
        new THREE.Vector3(unitCenterX + 0.35, floorY + 1.42, unitCenterZ - 2.40)
      ), 'furniture');

      const sofaX = 2.15, sofaZ = 1.85;
      const sBase = new THREE.Mesh(step2Geos.sofaBase, step2Mats.sofaLeather);
      sBase.position.set(sofaX, 0.21, sofaZ);
      cGroup.add(sBase);
      addUnderFurnitureAO(cGroup, sofaX, sofaZ, 2.15, 1.10);
      const sBack = new THREE.Mesh(step2Geos.sofaBack, step2Mats.sofaLeather);
      sBack.position.set(sofaX, 0.56, sofaZ + 0.30);
      cGroup.add(sBack);
      [-0.88, 0.88].forEach(ax => {
        const sArm = new THREE.Mesh(step2Geos.sofaArm, step2Mats.sofaLeather);
        sArm.position.set(sofaX + ax, 0.28, sofaZ);
        cGroup.add(sArm);
      });
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(unitCenterX + sofaX - 1.0, floorY, unitCenterZ + sofaZ - 0.44),
        new THREE.Vector3(unitCenterX + sofaX + 1.0, floorY + 0.85, unitCenterZ + sofaZ + 0.44)
      ), 'furniture');

      const deskCoords = [
        [-1.65, -0.85], [1.65, -0.85],
        [-1.65,  1.25],
      ];
      deskCoords.forEach(([dx, dz], dIdx) => {
        const oDesk = new THREE.Mesh(step2Geos.officeDesk, materials.deskWoodTop);
        oDesk.position.set(dx, 0.38, dz);
        oDesk.rotation.y = (dIdx - 1) * 0.025;
        cGroup.add(oDesk);
        addUnderFurnitureAO(cGroup, dx, dz + 0.10, 1.72, 1.18, oDesk.rotation.y);

        const mon = new THREE.Mesh(step2Geos.monitorPanel, dIdx === 0 ? step2Mats.monitorScreenOn : step2Mats.monitorScreenOff);
        mon.position.set(dx - 0.28, 0.94, dz - 0.12);
        mon.rotation.y = 0.12;
        cGroup.add(mon);

        const papers = new THREE.Mesh(step2Geos.paperStack, step2Mats.paperSheet);
        papers.position.set(dx + 0.36, 0.84, dz + 0.08);
        papers.rotation.y = -0.18;
        cGroup.add(papers);

        const chair = new THREE.Mesh(sharedGeos.chairSeat, materials.castIronDark);
        chair.position.set(dx + (dIdx === 1 ? 0.10 : -0.06), 0.46, dz + 0.56);
        chair.rotation.y = (dIdx === 1 ? -0.28 : 0.19);
        cGroup.add(chair);

        const wx = unitCenterX + dx;
        const wz = unitCenterZ + dz;
        addColliderBox(new THREE.Box3(
          new THREE.Vector3(wx - 0.76, floorY, wz - 0.42),
          new THREE.Vector3(wx + 0.76, floorY + 0.82, wz + 0.62)
        ), 'furniture');
        interactiveHidingSpots.push({
          id: 'office-desk-' + unitTitle + '-' + dIdx,
          name: unitTitle + ' Office Desk #' + (dIdx + 1),
          x: wx,
          y: floorY,
          z: wz + 0.84,
          zone: unitTitle,
        });
      });
    }

    // Specialized Builder: Campus Toilets / Washroom Block (Walkable Stalls with Partition & Bowl Colliders, Washbasins, Mirrors)
    function buildToiletsRoomInterior(cGroup, unitCenterX, unitCenterZ, floorY, unitTitle) {
      [-1.8, -0.2, 1.4].forEach((sz, sIdx) => {
        const pWall = new THREE.Mesh(step2Geos.stallWall, materials.rotundaWhiteArch);
        pWall.position.set(2.15, 0.98, sz - 0.75);
        cGroup.add(pWall);

        // Stall partition wall collider (slim 0.12m Z thickness so stall interiors remain walkable!)
        addColliderBox(new THREE.Box3(
          new THREE.Vector3(unitCenterX + 1.42, floorY, unitCenterZ + sz - 0.81),
          new THREE.Vector3(unitCenterX + 3.15, floorY + 1.95, unitCenterZ + sz - 0.69)
        ), 'furniture');

        const sDoor = new THREE.Mesh(step2Geos.stallDoor, materials.chairWood);
        sDoor.position.set(1.42, 0.96, sz);
        sDoor.rotation.y = sIdx === 1 ? 0.65 : 0.18;
        cGroup.add(sDoor);

        const bowl = new THREE.Mesh(step2Geos.toiletBase, step2Mats.ceramicWhite);
        bowl.position.set(2.45, 0.21, sz);
        cGroup.add(bowl);
        addUnderFurnitureAO(cGroup, 2.45, sz, 0.68, 0.68);
        const tank = new THREE.Mesh(step2Geos.toiletTank, step2Mats.ceramicWhite);
        tank.position.set(2.75, 0.58, sz);
        cGroup.add(tank);

        // Individual ceramic toilet fixture box collider inside stall
        addColliderBox(new THREE.Box3(
          new THREE.Vector3(unitCenterX + 2.22, floorY, unitCenterZ + sz - 0.24),
          new THREE.Vector3(unitCenterX + 2.95, floorY + 0.82, unitCenterZ + sz + 0.24)
        ), 'furniture');

        interactiveHidingSpots.push({
          id: 'toilet-stall-' + unitTitle + '-' + sIdx,
          name: unitTitle + ' Stall #' + (sIdx + 1),
          x: unitCenterX + 1.75,
          y: floorY,
          z: unitCenterZ + sz,
          zone: unitTitle,
        });
      });

      // End stall partition wall collider
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(unitCenterX + 1.42, floorY, unitCenterZ + 2.12),
        new THREE.Vector3(unitCenterX + 3.15, floorY + 1.95, unitCenterZ + 2.24)
      ), 'furniture');

      const vanity = new THREE.Mesh(step2Geos.sinkCounter, materials.rotundaPlinthConcrete);
      vanity.position.set(-1.65, 0.42, -1.2);
      cGroup.add(vanity);
      addUnderFurnitureAO(cGroup, -1.65, -1.2, 0.95, 2.65);
      [-1.9, -1.2, -0.5].forEach(bz => {
        const basin = new THREE.Mesh(step2Geos.sinkBasin, step2Mats.ceramicWhite);
        basin.position.set(-1.65, 0.86, bz);
        cGroup.add(basin);
      });
      const mirror = new THREE.Mesh(step2Geos.wallMirror, step2Mats.mirrorGlass);
      mirror.position.set(-2.02, 1.52, -1.2);
      cGroup.add(mirror);

      addColliderBox(new THREE.Box3(
        new THREE.Vector3(unitCenterX - 2.05, floorY, unitCenterZ - 2.45),
        new THREE.Vector3(unitCenterX - 1.25, floorY + 0.90, unitCenterZ + 0.05)
      ), 'furniture');
    }

    // Specialized Builder: Campus Canteen (Serving Counter, Snack Case, Dining Tables, Kitchen Stove & Pantry)
    function buildCanteenRoomInterior(cGroup, unitCenterX, unitCenterZ, floorY, unitTitle, isKitchen = false) {
      buildWallMountedFan(cGroup, 3.28, 2.55, 0, -Math.PI / 2);
      buildInteriorWindowCurtains(cGroup, 3.26, 1.92, -1.5, -Math.PI / 2, true);

      if (isKitchen) {
        const prep = new THREE.Mesh(step2Geos.canteenCounter, step2Mats.stainlessSteel);
        prep.position.set(1.85, 0.49, 0);
        cGroup.add(prep);
        addUnderFurnitureAO(cGroup, 1.85, 0, 1.15, 4.45);
        const hood = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.55, 2.60), step2Mats.stainlessSteel);
        hood.position.set(2.45, 2.25, -0.4);
        cGroup.add(hood);

        const rack = new THREE.Mesh(step2Geos.storageShelf, materials.deskSteelFrame);
        rack.position.set(-1.85, 1.05, -1.4);
        cGroup.add(rack);
        addUnderFurnitureAO(cGroup, -1.85, -1.4, 0.92, 2.45);
        [-2.1, -1.4, -0.7].forEach(cz => {
          const crate = new THREE.Mesh(step2Geos.crateBox, step2Mats.cardboardCrate);
          crate.position.set(-1.85, 0.72, cz);
          cGroup.add(crate);
        });

        addColliderBox(new THREE.Box3(
          new THREE.Vector3(unitCenterX + 1.38, floorY, unitCenterZ - 2.15),
          new THREE.Vector3(unitCenterX + 2.35, floorY + 1.02, unitCenterZ + 2.15)
        ), 'furniture');
        // West storage shelf & crate rack box collider
        addColliderBox(new THREE.Box3(
          new THREE.Vector3(unitCenterX - 1.85 - 0.34, floorY, unitCenterZ - 1.4 - 1.15),
          new THREE.Vector3(unitCenterX - 1.85 + 0.34, floorY + 2.10, unitCenterZ - 1.4 + 1.15)
        ), 'furniture');

        interactiveHidingSpots.push({
          id: 'canteen-kitchen-' + unitTitle,
          name: unitTitle + ' (Canteen Kitchen Prep Counter)',
          x: unitCenterX + 0.65,
          y: floorY,
          z: unitCenterZ,
          zone: unitTitle,
        });
      } else {
        const counter = new THREE.Mesh(step2Geos.canteenCounter, materials.chairWood);
        counter.position.set(1.95, 0.49, -0.6);
        cGroup.add(counter);
        addUnderFurnitureAO(cGroup, 1.95, -0.6, 1.15, 4.45);
        const sCase = new THREE.Mesh(step2Geos.snackCase, materials.windowWarmLit);
        sCase.position.set(1.95, 1.22, -1.2);
        cGroup.add(sCase);

        addColliderBox(new THREE.Box3(
          new THREE.Vector3(unitCenterX + 1.48, floorY, unitCenterZ - 2.75),
          new THREE.Vector3(unitCenterX + 2.42, floorY + 1.10, unitCenterZ + 1.55)
        ), 'furniture');

        [-1.45, 1.25].forEach((tz, tIdx) => {
          const tx = -1.25;
          const tbl = new THREE.Mesh(step2Geos.readingTable, materials.deskWoodTop);
          tbl.position.set(tx, 0.38, tz);
          tbl.rotation.y = (tIdx === 0 ? 0.03 : -0.025);
          cGroup.add(tbl);
          addUnderFurnitureAO(cGroup, tx, tz, 1.85, 1.65, tbl.rotation.y);
          [-0.65, 0.65].forEach((bz, bIdx) => {
            const bnc = new THREE.Mesh(step2Geos.benchLongSeat, materials.chairWood);
            bnc.position.set(tx + (bIdx === 0 ? 0.04 : -0.05), 0.44, tz + bz);
            bnc.rotation.y = (bIdx === 0 ? 0.05 : -0.04);
            cGroup.add(bnc);
          });
          const wx = unitCenterX + tx;
          const wz = unitCenterZ + tz;
          addColliderBox(new THREE.Box3(
            new THREE.Vector3(wx - 0.82, floorY, wz - 0.72),
            new THREE.Vector3(wx + 0.82, floorY + 0.80, wz + 0.72)
          ), 'furniture');
          interactiveHidingSpots.push({
            id: 'canteen-table-' + unitTitle + '-' + tIdx,
            name: unitTitle + ' Dining Table #' + (tIdx + 1),
            x: wx,
            y: floorY,
            z: wz + 0.96,
            zone: unitTitle,
          });
        });
      }
    }

    // Specialized Builder: Store Room (Heavy Shelving Racks, Crates, Spare Furniture, Supply Cabinets)
    function buildStoreRoomInterior(cGroup, unitCenterX, unitCenterZ, floorY, unitTitle) {
      [-1.75, 1.75].forEach((sx, sIdx) => {
        const rack = new THREE.Mesh(step2Geos.storageShelf, materials.deskSteelFrame);
        rack.position.set(sx, 1.05, -0.8);
        cGroup.add(rack);
        addUnderFurnitureAO(cGroup, sx, -0.8, 0.92, 2.45);

        [0.42, 1.05, 1.62].forEach((cy, cIdx) => {
          const box = new THREE.Mesh(step2Geos.crateBox, step2Mats.cardboardCrate);
          box.position.set(sx + ((cIdx - 1) * 0.04), cy, -1.2 + cIdx * 0.55);
          box.rotation.y = (cIdx - 1) * 0.16;
          cGroup.add(box);
        });

        const wx = unitCenterX + sx;
        const wz = unitCenterZ - 0.8;
        addColliderBox(new THREE.Box3(
          new THREE.Vector3(wx - 0.34, floorY, wz - 1.15),
          new THREE.Vector3(wx + 0.34, floorY + 2.10, wz + 1.15)
        ), 'furniture');
        interactiveHidingSpots.push({
          id: 'store-rack-' + unitTitle + '-' + sIdx,
          name: unitTitle + ' Storage Rack #' + (sIdx + 1),
          x: wx + (sIdx === 0 ? 0.72 : -0.72),
          y: floorY,
          z: wz,
          zone: unitTitle,
        });
      });

      const cab = new THREE.Mesh(step2Geos.lockerBank, step2Mats.lockerSteel);
      cab.rotation.y = Math.PI / 2;
      cab.position.set(0, 0.96, 2.45);
      cGroup.add(cab);
      addUnderFurnitureAO(cGroup, 0, 2.45, 2.05, 0.75);
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(unitCenterX - 0.92, floorY, unitCenterZ + 2.45 - 0.28),
        new THREE.Vector3(unitCenterX + 0.92, floorY + 1.95, unitCenterZ + 2.45 + 0.28)
      ), 'furniture');
    }

    /* =========================================================================
       PHASE B.1 & REQUIREMENT 2: DATA-DRIVEN ROOM DEFINITION TABLE WITH PER-ROOM LIGHT MOODS
       Each room has an explicit lightMood from the 5 atmospheric archetypes:
       'dark' | 'dying_tube' | 'moonlight' | 'warm_lamp' | 'emergency_red'
       ========================================================================= */
    const ROOM_DEFINITIONS = {
      'West Wing L1 Room 1': {
        id: 'West Wing L1 Room 1', building: 'L1', archetype: 'classroom_standard', lightMood: 'dying_tube',
        bounds: { minX: -10.3, maxX: -2.7, minZ: -33.0, maxZ: -23.0, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['teacher_podium', 'teacher_desk', 'student_desks_3x3', 'side_bookshelf', 'wall_shelves', 'ceiling_fan'],
        hidingSpots: ['podium', 'student_desks'],
        waypoints: [{ id: 'wp-l1-r1-door', x: -10.6, y: 0.18, z: -28.0, kind: 'door' }, { id: 'wp-l1-r1-in', x: -7.5, y: 0.18, z: -28.0, kind: 'interior' }],
      },
      'West Wing L1 Room 2': {
        id: 'West Wing L1 Room 2', building: 'L1', archetype: 'classroom_seminar', lightMood: 'moonlight',
        bounds: { minX: -10.3, maxX: -2.7, minZ: -23.0, maxZ: -13.0, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['teacher_podium', 'teacher_desk', 'seminar_desks_u', 'side_bookshelf', 'wall_shelves', 'ceiling_fan'],
        hidingSpots: ['podium', 'student_desks'],
        waypoints: [{ id: 'wp-l1-r2-door', x: -10.6, y: 0.18, z: -18.0, kind: 'door' }, { id: 'wp-l1-r2-in', x: -6.5, y: 0.18, z: -18.6, kind: 'interior' }],
      },
      'West Wing L1 Room 3': {
        id: 'West Wing L1 Room 3', building: 'L1', archetype: 'classroom_standard', lightMood: 'dark',
        bounds: { minX: -10.3, maxX: -2.7, minZ: -13.0, maxZ: -3.0, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['teacher_podium', 'teacher_desk', 'student_desks_3x3', 'side_bookshelf', 'wall_shelves', 'ceiling_fan'],
        hidingSpots: ['podium', 'student_desks'],
        waypoints: [{ id: 'wp-l1-r3-door', x: -10.6, y: 0.18, z: -8.0, kind: 'door' }, { id: 'wp-l1-r3-in', x: -7.5, y: 0.18, z: -8.0, kind: 'interior' }],
      },
      'West Wing L2 Room 1': {
        id: 'West Wing L2 Room 1', building: 'L2', archetype: 'computer_lab', lightMood: 'dying_tube',
        bounds: { minX: -21.3, maxX: -13.7, minZ: -26.0, maxZ: -16.67, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['server_rack_leds', 'dual_monitor_workstations_3x2', 'cable_raceways', 'whiteboard', 'wall_fans'],
        hidingSpots: ['server_rack', 'workstation_desks'],
        waypoints: [{ id: 'wp-l2-r1-door', x: -13.4, y: 0.18, z: -21.33, kind: 'door' }, { id: 'wp-l2-r1-in', x: -17.7, y: 0.18, z: -21.33, kind: 'interior' }],
      },
      'West Wing L2 Room 2': {
        id: 'West Wing L2 Room 2', building: 'L2', archetype: 'computer_lab', lightMood: 'dark',
        bounds: { minX: -21.3, maxX: -13.7, minZ: -16.67, maxZ: -7.33, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['server_rack_leds', 'dual_monitor_workstations_3x2', 'cable_raceways', 'whiteboard', 'wall_fans'],
        hidingSpots: ['server_rack', 'workstation_desks'],
        waypoints: [{ id: 'wp-l2-r2-door', x: -13.4, y: 0.18, z: -12.0, kind: 'door' }, { id: 'wp-l2-r2-in', x: -17.7, y: 0.18, z: -12.0, kind: 'interior' }],
      },
      'West Wing L2 Room 3': {
        id: 'West Wing L2 Room 3', building: 'L2', archetype: 'storeroom', lightMood: 'emergency_red',
        bounds: { minX: -21.3, maxX: -13.7, minZ: -7.33, maxZ: 2.0, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['storage_racks_x2', 'cardboard_crates', 'supply_locker_bank'],
        hidingSpots: ['storage_rack_1', 'storage_rack_2'],
        waypoints: [{ id: 'wp-l2-r3-door', x: -13.4, y: 0.18, z: -2.67, kind: 'door' }, { id: 'wp-l2-r3-in', x: -17.5, y: 0.18, z: -2.67, kind: 'interior' }],
      },
      'West Wing L3 Room 1': {
        id: 'West Wing L3 Room 1', building: 'L3', archetype: 'library', lightMood: 'warm_lamp',
        bounds: { minX: -21.3, maxX: -13.7, minZ: 9.0, maxZ: 20.0, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['tall_bookshelves_x3', 'reading_tables_x2', 'banker_lamps', 'curtains'],
        hidingSpots: ['bookshelf_aisle_1', 'bookshelf_aisle_2', 'bookshelf_aisle_3'],
        waypoints: [{ id: 'wp-l3-r1-door', x: -13.4, y: 0.18, z: 14.5, kind: 'door' }, { id: 'wp-l3-r1-in', x: -17.2, y: 0.18, z: 13.4, kind: 'interior' }],
      },
      'West Wing L3 Room 2': {
        id: 'West Wing L3 Room 2', building: 'L3', archetype: 'library', lightMood: 'moonlight',
        bounds: { minX: -21.3, maxX: -13.7, minZ: 20.0, maxZ: 31.0, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['tall_bookshelves_x3', 'reading_tables_x2', 'banker_lamps', 'curtains'],
        hidingSpots: ['bookshelf_aisle_1', 'bookshelf_aisle_2', 'bookshelf_aisle_3'],
        waypoints: [{ id: 'wp-l3-r2-door', x: -13.4, y: 0.18, z: 25.5, kind: 'door' }, { id: 'wp-l3-r2-in', x: -17.2, y: 0.18, z: 24.4, kind: 'interior' }],
      },
      'East Wing R1 Room 1': {
        id: 'East Wing R1 Room 1', building: 'R1', archetype: 'staff_office', lightMood: 'warm_lamp',
        bounds: { minX: 10.7, maxX: 18.3, minZ: -37.0, maxZ: -28.33, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['filing_cabinets_x4', 'faculty_lounge_sofa', 'office_desks_x3', 'monitors'],
        hidingSpots: ['office_desk_1', 'office_desk_2', 'office_desk_3'],
        waypoints: [{ id: 'wp-r1-r1-door', x: 10.4, y: 0.18, z: -32.67, kind: 'door' }, { id: 'wp-r1-r1-in', x: 14.5, y: 0.18, z: -32.67, kind: 'interior' }],
      },
      'East Wing R1 Room 2': {
        id: 'East Wing R1 Room 2', building: 'R1', archetype: 'staff_office', lightMood: 'dying_tube',
        bounds: { minX: 10.7, maxX: 18.3, minZ: -28.33, maxZ: -19.67, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['filing_cabinets_x4', 'faculty_lounge_sofa', 'office_desks_x3', 'monitors'],
        hidingSpots: ['office_desk_1', 'office_desk_2', 'office_desk_3'],
        waypoints: [{ id: 'wp-r1-r2-door', x: 10.4, y: 0.18, z: -24.0, kind: 'door' }, { id: 'wp-r1-r2-in', x: 14.5, y: 0.18, z: -24.0, kind: 'interior' }],
      },
      'East Wing R1 Room 3': {
        id: 'East Wing R1 Room 3', building: 'R1', archetype: 'staff_office', lightMood: 'moonlight',
        bounds: { minX: 10.7, maxX: 18.3, minZ: -19.67, maxZ: -11.0, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['filing_cabinets_x4', 'faculty_lounge_sofa', 'office_desks_x3', 'monitors'],
        hidingSpots: ['office_desk_1', 'office_desk_2', 'office_desk_3'],
        waypoints: [{ id: 'wp-r1-r3-door', x: 10.4, y: 0.18, z: -15.33, kind: 'door' }, { id: 'wp-r1-r3-in', x: 14.5, y: 0.18, z: -15.33, kind: 'interior' }],
      },
      'East Wing R2 Room 1': {
        id: 'East Wing R2 Room 1', building: 'R2', archetype: 'classroom_standard', lightMood: 'dark',
        bounds: { minX: 21.7, maxX: 29.3, minZ: -27.0, maxZ: -18.33, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['teacher_podium', 'teacher_desk', 'student_desks_3x3', 'side_bookshelf', 'ceiling_fan'],
        hidingSpots: ['podium', 'student_desks'],
        waypoints: [{ id: 'wp-r2-r1-door', x: 21.4, y: 0.18, z: -22.67, kind: 'door' }, { id: 'wp-r2-r1-in', x: 24.5, y: 0.18, z: -22.67, kind: 'interior' }],
      },
      'East Wing R2 Room 2': {
        id: 'East Wing R2 Room 2', building: 'R2', archetype: 'classroom_seminar', lightMood: 'moonlight',
        bounds: { minX: 21.7, maxX: 29.3, minZ: -18.33, maxZ: -9.67, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['teacher_podium', 'teacher_desk', 'seminar_desks_u', 'side_bookshelf', 'ceiling_fan'],
        hidingSpots: ['podium', 'student_desks'],
        waypoints: [{ id: 'wp-r2-r2-door', x: 21.4, y: 0.18, z: -14.0, kind: 'door' }, { id: 'wp-r2-r2-in', x: 25.5, y: 0.18, z: -14.6, kind: 'interior' }],
      },
      'East Wing R2 Room 3': {
        id: 'East Wing R2 Room 3', building: 'R2', archetype: 'toilets', lightMood: 'dying_tube',
        bounds: { minX: 21.7, maxX: 29.3, minZ: -9.67, maxZ: -1.0, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['toilet_stalls_x3', 'vanity_sink_counter', 'wall_mirror'],
        hidingSpots: ['toilet_stall_1', 'toilet_stall_2', 'toilet_stall_3'],
        waypoints: [{ id: 'wp-r2-r3-door', x: 21.4, y: 0.18, z: -5.33, kind: 'door' }, { id: 'wp-r2-r3-in', x: 25.5, y: 0.18, z: -5.33, kind: 'interior' }],
      },
      'East Wing R4 Room 1': {
        id: 'East Wing R4 Room 1', building: 'R4', archetype: 'canteen_dining', lightMood: 'warm_lamp',
        bounds: { minX: 21.7, maxX: 29.3, minZ: 6.0, maxZ: 15.33, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['serving_counter', 'glass_snack_case', 'dining_tables_x2', 'benches'],
        hidingSpots: ['dining_table_1', 'dining_table_2'],
        waypoints: [{ id: 'wp-r4-r1-door', x: 21.4, y: 0.18, z: 10.67, kind: 'door' }, { id: 'wp-r4-r1-in', x: 25.5, y: 0.18, z: 10.67, kind: 'interior' }],
      },
      'East Wing R4 Room 2': {
        id: 'East Wing R4 Room 2', building: 'R4', archetype: 'canteen_dining', lightMood: 'dark',
        bounds: { minX: 21.7, maxX: 29.3, minZ: 15.33, maxZ: 24.67, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['serving_counter', 'glass_snack_case', 'dining_tables_x2', 'benches'],
        hidingSpots: ['dining_table_1', 'dining_table_2'],
        waypoints: [{ id: 'wp-r4-r2-door', x: 21.4, y: 0.18, z: 20.0, kind: 'door' }, { id: 'wp-r4-r2-in', x: 25.5, y: 0.18, z: 20.0, kind: 'interior' }],
      },
      'East Wing R4 Room 3': {
        id: 'East Wing R4 Room 3', building: 'R4', archetype: 'canteen_kitchen', lightMood: 'emergency_red',
        bounds: { minX: 21.7, maxX: 29.3, minZ: 24.67, maxZ: 34.0, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['stainless_prep_counter', 'exhaust_hood', 'pantry_storage_shelf', 'crates'],
        hidingSpots: ['kitchen_prep_counter'],
        waypoints: [{ id: 'wp-r4-r3-door', x: 21.4, y: 0.18, z: 29.33, kind: 'door' }, { id: 'wp-r4-r3-in', x: 25.5, y: 0.18, z: 29.33, kind: 'interior' }],
      },
      'Newari Heritage Block W1 Room 1': {
        id: 'Newari Heritage Block W1 Room 1', building: 'W1', archetype: 'classroom_standard', lightMood: 'warm_lamp',
        bounds: { minX: -38.75, maxX: -34.0, minZ: -49.0, maxZ: -35.0, floorY: 0.22, ceilingY: 3.60 },
        furniture: ['teacher_podium', 'teacher_desk', 'student_desks_3x3', 'side_bookshelf'],
        hidingSpots: ['podium', 'student_desks'],
        waypoints: [{ id: 'wp-w1-r1-door', x: -36.38, y: 0.22, z: -34.6, kind: 'door' }, { id: 'wp-w1-r1-in', x: -35.2, y: 0.22, z: -42.0, kind: 'interior' }],
      },
      'Newari Heritage Block W1 Room 2': {
        id: 'Newari Heritage Block W1 Room 2', building: 'W1', archetype: 'classroom_seminar', lightMood: 'moonlight',
        bounds: { minX: -34.0, maxX: -29.25, minZ: -49.0, maxZ: -35.0, floorY: 0.22, ceilingY: 3.60 },
        furniture: ['teacher_podium', 'teacher_desk', 'seminar_desks_u', 'side_bookshelf'],
        hidingSpots: ['podium', 'student_desks'],
        waypoints: [{ id: 'wp-w1-r2-door', x: -31.63, y: 0.22, z: -34.6, kind: 'door' }, { id: 'wp-w1-r2-in', x: -31.63, y: 0.22, z: -42.6, kind: 'interior' }],
      },
      'Newari Cultural Hall W2 South': {
        id: 'Newari Cultural Hall W2 South', building: 'W2', archetype: 'classroom_standard', lightMood: 'dark',
        bounds: { minX: -39.5, maxX: -28.5, minZ: -30.0, maxZ: -22.0, floorY: 0.22, ceilingY: 3.60 },
        furniture: ['teacher_podium', 'teacher_desk', 'student_desks_3x3', 'side_bookshelf'],
        hidingSpots: ['podium', 'student_desks'],
        waypoints: [{ id: 'wp-w2-door', x: -28.1, y: 0.22, z: -22.0, kind: 'door' }, { id: 'wp-w2-south-in', x: -32.8, y: 0.22, z: -25.6, kind: 'interior' }],
      },
      'West Wing L3 Heritage Library W2': {
        id: 'West Wing L3 Heritage Library W2', building: 'W2', archetype: 'library', lightMood: 'warm_lamp',
        bounds: { minX: -39.5, maxX: -28.5, minZ: -22.0, maxZ: -14.0, floorY: 0.22, ceilingY: 3.60 },
        furniture: ['tall_bookshelves_x3', 'reading_tables_x2', 'banker_lamps'],
        hidingSpots: ['bookshelf_aisle_1', 'bookshelf_aisle_2', 'bookshelf_aisle_3'],
        waypoints: [{ id: 'wp-w2-north-in', x: -33.6, y: 0.22, z: -19.5, kind: 'interior' }],
      },
      'Building W3 West Wing Room 1': {
        id: 'Building W3 West Wing Room 1', building: 'W3', archetype: 'computer_lab', lightMood: 'dying_tube',
        bounds: { minX: -38.75, maxX: -34.0, minZ: -9.0, maxZ: 5.0, floorY: 0.22, ceilingY: 3.60 },
        furniture: ['server_rack_leds', 'dual_monitor_workstations_3x2', 'cable_raceways'],
        hidingSpots: ['server_rack', 'workstation_desks'],
        waypoints: [{ id: 'wp-w3-r1-door', x: -36.38, y: 0.22, z: 5.4, kind: 'door' }, { id: 'wp-w3-r1-in', x: -36.5, y: 0.22, z: -2.0, kind: 'interior' }],
      },
      'Building W3 West Wing Room 2': {
        id: 'Building W3 West Wing Room 2', building: 'W3', archetype: 'staff_office', lightMood: 'warm_lamp',
        bounds: { minX: -34.0, maxX: -29.25, minZ: -9.0, maxZ: 5.0, floorY: 0.22, ceilingY: 3.60 },
        furniture: ['filing_cabinets_x4', 'faculty_lounge_sofa', 'office_desks_x3'],
        hidingSpots: ['office_desk_1', 'office_desk_2', 'office_desk_3'],
        waypoints: [{ id: 'wp-w3-r2-door', x: -31.63, y: 0.22, z: 5.4, kind: 'door' }, { id: 'wp-w3-r2-in', x: -31.63, y: 0.22, z: -2.0, kind: 'interior' }],
      },
      'Building W4 West Wing Room 1': {
        id: 'Building W4 West Wing Room 1', building: 'W4', archetype: 'classroom_standard', lightMood: 'moonlight',
        bounds: { minX: -38.75, maxX: -34.0, minZ: 11.0, maxZ: 25.0, floorY: 0.22, ceilingY: 3.60 },
        furniture: ['teacher_podium', 'teacher_desk', 'student_desks_3x3', 'side_bookshelf'],
        hidingSpots: ['podium', 'student_desks'],
        waypoints: [{ id: 'wp-w4-r1-door', x: -36.38, y: 0.22, z: 25.4, kind: 'door' }, { id: 'wp-w4-r1-in', x: -35.2, y: 0.22, z: 18.0, kind: 'interior' }],
      },
      'Building W4 West Wing Room 2': {
        id: 'Building W4 West Wing Room 2', building: 'W4', archetype: 'storeroom', lightMood: 'emergency_red',
        bounds: { minX: -34.0, maxX: -29.25, minZ: 11.0, maxZ: 25.0, floorY: 0.22, ceilingY: 3.60 },
        furniture: ['storage_racks_x2', 'cardboard_crates', 'supply_locker_bank'],
        hidingSpots: ['storage_rack_1', 'storage_rack_2'],
        waypoints: [{ id: 'wp-w4-r2-door', x: -31.63, y: 0.22, z: 25.4, kind: 'door' }, { id: 'wp-w4-r2-in', x: -31.63, y: 0.22, z: 18.0, kind: 'interior' }],
      },
      'Security Guardhouse': {
        id: 'Security Guardhouse', building: 'GUARDHOUSE', archetype: 'guardhouse', lightMood: 'warm_lamp',
        bounds: { minX: 3.7, maxX: 8.3, minZ: -60.3, maxZ: -55.7, floorY: 0.16, ceilingY: 3.20 },
        furniture: ['cctv_desk', 'cctv_monitor', 'steel_locker'],
        hidingSpots: ['guardhouse_desk'],
        waypoints: [{ id: 'wp-gh-door', x: 3.4, y: 0.16, z: -58.0, kind: 'door' }, { id: 'wp-gh-in', x: 5.2, y: 0.16, z: -58.0, kind: 'interior' }],
      },
      'Rotunda Ground West Hall 101': {
        id: 'Rotunda Ground West Hall 101', roomCode: '101', building: 'ROTUNDA', archetype: 'rotunda_lecture', lightMood: 'dying_tube',
        bounds: { minX: -12.8, maxX: 1.4, minZ: 57.2, maxZ: 70.8, floorY: 0.48, ceilingY: 3.86 },
        furniture: ['teaching_dais', 'prof_desk', 'lectern_podium', 'student_desks_4x3', 'side_bookcase', 'locker_cabinet'],
        hidingSpots: ['prof_desk', 'student_desks'],
        waypoints: [{ id: 'wp-rot-101-door', x: 1.6, y: 0.48, z: 59.0, kind: 'door' }, { id: 'wp-rot-101-in', x: -4.0, y: 0.48, z: 63.2, kind: 'interior' }],
      },
      'Rotunda Ground East Hall 102': {
        id: 'Rotunda Ground East Hall 102', roomCode: '102', building: 'ROTUNDA', archetype: 'staff_office', lightMood: 'warm_lamp',
        bounds: { minX: 10.6, maxX: 24.8, minZ: 57.2, maxZ: 70.8, floorY: 0.48, ceilingY: 3.86 },
        furniture: ['filing_cabinets_x4', 'faculty_lounge_sofa', 'office_desks_x3', 'side_bookcase'],
        hidingSpots: ['office_desk_1', 'office_desk_2', 'office_desk_3'],
        waypoints: [{ id: 'wp-rot-102-door', x: 10.4, y: 0.48, z: 59.0, kind: 'door' }, { id: 'wp-rot-102-in', x: 17.7, y: 0.48, z: 64.0, kind: 'interior' }],
      },
      'Rotunda 1st-Floor West Class 201': {
        id: 'Rotunda 1st-Floor West Class 201', roomCode: '201', building: 'ROTUNDA', archetype: 'rotunda_lecture', lightMood: 'moonlight',
        bounds: { minX: -12.8, maxX: 1.4, minZ: 57.2, maxZ: 70.8, floorY: 4.08, ceilingY: 7.46 },
        furniture: ['teaching_dais', 'prof_desk', 'lectern_podium', 'student_desks_4x3', 'side_bookcase', 'locker_cabinet'],
        hidingSpots: ['prof_desk', 'student_desks'],
        waypoints: [{ id: 'wp-rot-201-door', x: 1.6, y: 4.08, z: 69.2, kind: 'door' }, { id: 'wp-rot-201-in', x: -4.0, y: 4.08, z: 63.2, kind: 'interior' }],
      },
      'Rotunda 1st-Floor East Class 202': {
        id: 'Rotunda 1st-Floor East Class 202', roomCode: '202', building: 'ROTUNDA', archetype: 'library', lightMood: 'warm_lamp',
        bounds: { minX: 10.6, maxX: 24.8, minZ: 57.2, maxZ: 70.8, floorY: 4.08, ceilingY: 7.46 },
        furniture: ['tall_bookshelves_x3', 'reading_tables_x2', 'banker_lamps', 'side_bookcase'],
        hidingSpots: ['bookshelf_aisle_1', 'bookshelf_aisle_2', 'bookshelf_aisle_3'],
        waypoints: [{ id: 'wp-rot-202-door', x: 10.4, y: 4.08, z: 69.2, kind: 'door' }, { id: 'wp-rot-202-in', x: 18.0, y: 4.08, z: 62.9, kind: 'interior' }],
      },
      'Rotunda 2nd-Floor West Seminar 301': {
        id: 'Rotunda 2nd-Floor West Seminar 301', roomCode: '301', building: 'ROTUNDA', archetype: 'rotunda_seminar', lightMood: 'dark',
        bounds: { minX: -12.8, maxX: 1.4, minZ: 57.2, maxZ: 70.8, floorY: 7.68, ceilingY: 11.06 },
        furniture: ['teaching_dais', 'prof_desk', 'lectern_podium', 'seminar_laptops_4x3', 'side_bookcase'],
        hidingSpots: ['prof_desk', 'student_desks'],
        waypoints: [{ id: 'wp-rot-301-door', x: 1.6, y: 7.68, z: 59.0, kind: 'door' }, { id: 'wp-rot-301-in', x: -4.0, y: 7.68, z: 63.2, kind: 'interior' }],
      },
      'Rotunda 2nd-Floor East Lab 302': {
        id: 'Rotunda 2nd-Floor East Lab 302', roomCode: '302', building: 'ROTUNDA', archetype: 'rotunda_lab', lightMood: 'emergency_red',
        bounds: { minX: 10.6, maxX: 24.8, minZ: 57.2, maxZ: 70.8, floorY: 7.68, ceilingY: 11.06 },
        furniture: ['teaching_dais', 'prof_desk', 'twin_server_racks', 'dual_monitor_desks_4x3', 'side_bookcase'],
        hidingSpots: ['prof_desk', 'workstation_desks'],
        waypoints: [{ id: 'wp-rot-302-door', x: 10.4, y: 7.68, z: 59.0, kind: 'door' }, { id: 'wp-rot-302-in', x: 16.0, y: 7.68, z: 63.2, kind: 'interior' }],
      },
    };
    window.__ROOM_DEFINITIONS__ = ROOM_DEFINITIONS;

    function normalizeRoomLightMood(rawMood) {
      if (!rawMood) return 'dying_tube';
      if (rawMood === 'moonlit_window' || rawMood === 'moonlit') return 'moonlight';
      if (rawMood === 'warm_desk_lamp' || rawMood === 'dim_amber') return 'warm_lamp';
      if (rawMood === 'flickering_tube' || rawMood === 'cold_monitor_glow') return 'dying_tube';
      return rawMood;
    }

    const FALLBACK_MOOD_CYCLE = ['dark', 'dying_tube', 'moonlight', 'warm_lamp', 'emergency_red'];
    let fallbackMoodCounter = 0;

    function getOrRegisterRoomDefinition(roomId, cx, cz, floorY, halfW = 3.8, halfD = 4.6, building = 'OTHER', archetype = 'classroom_standard') {
      if (ROOM_DEFINITIONS[roomId]) {
        ROOM_DEFINITIONS[roomId].lightMood = normalizeRoomLightMood(ROOM_DEFINITIONS[roomId].lightMood);
        return ROOM_DEFINITIONS[roomId];
      }
      const mood = FALLBACK_MOOD_CYCLE[(fallbackMoodCounter++) % FALLBACK_MOOD_CYCLE.length];
      const def = {
        id: roomId,
        building: building,
        archetype: archetype,
        lightMood: mood,
        bounds: { minX: cx - halfW, maxX: cx + halfW, minZ: cz - halfD, maxZ: cz + halfD, floorY: floorY, ceilingY: floorY + 3.4 },
        furniture: ['teacher_podium', 'teacher_desk', 'student_desks_3x3'],
        hidingSpots: ['podium', 'student_desks'],
        waypoints: [{ id: 'wp-' + roomId, x: cx, y: floorY, z: cz, kind: 'interior' }],
      };
      ROOM_DEFINITIONS[roomId] = def;
      return def;
    }

    // Requirement 5 & Phase A Light Budget: Zero extra PointLights created here!
    // Indoor rooms claim 1 pooled light from lampFlickerMod.lightPool (strictly <= 3 pooled lights total)
    // ONLY when the player is inside the room!
    function applyRoomLightMoodFixtures(cGroup, roomDef, unitCenterX, floorY, unitCenterZ, roomW = 6.8, roomD = 8.2, windowSideSignX = 1) {
      const softRadialGlowTex = (typeof atmosphere !== 'undefined' && atmosphere && atmosphere.lampGlowTexture) || null;
      const mood = normalizeRoomLightMood(roomDef && roomDef.lightMood);
      roomDef.lightMood = mood;
      const moodsCfg = HORROR_CONFIG.roomLightMoods || {};
      const mCfg = moodsCfg[mood] || {
        color: 0xb4f0e4,
        intensity: 3.6,
        distance: 10.5,
        ambientScale: 0.48,
      };
      const seed = Math.abs(unitCenterX * 1.7 + unitCenterZ * 2.3 + floorY * 3.1);
      const halfW = roomW * 0.5;
      const halfD = roomD * 0.5;

      // 1. Moonlight through windows as a visible volumetric cone shaft + Venetian blind gobo + dust motes
      // Added to Main Building rooms & moonlit rooms so exterior windows cast eerie shafts into the dark room (Ref 4 & Ref 5)
      const isMainBldg = (roomDef && roomDef.building === 'ROTUNDA');
      if (mood === 'moonlight' || (isMainBldg && mood !== 'emergency_red')) {
        const winX = windowSideSignX * (roomW * 0.46);
        const inDirX = -windowSideSignX;
        buildWindowLightShaftWithDust(cGroup, winX, 2.05, -roomD * 0.22, inDirX, 0, Math.min(4.6, roomW * 0.60), 1.55);
        if (mood === 'moonlight') {
          buildWindowLightShaftWithDust(cGroup, winX, 2.05, roomD * 0.22, inDirX, 0, Math.min(4.6, roomW * 0.60), 1.55);
        }
      }

      if (mood === 'dark') {
        roomMoodFixtures.push({
          roomId: roomDef.id,
          mood: 'dark',
          group: cGroup,
          worldX: unitCenterX,
          worldY: floorY + 2.5,
          worldZ: unitCenterZ,
          floorY,
          halfW,
          halfD,
          color: mCfg.color || 0x0a1420,
          baseIntensity: 0.0,
          distance: 7.0,
          seed,
        });
      } else if (mood === 'dying_tube') {
        // DYING TUBE MOOD: Stuttering, buzzing fluorescent tube + ceiling/floor light pool (Ref 1, Ref 2, Ref 4)
        const tubeMat = step2Mats.dyingTubeMat.clone();
        const liveTube = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.05, 0.28), tubeMat);
        liveTube.position.set(roomW * 0.14, isMainBldg ? 2.86 : 3.32, roomD * 0.12);
        liveTube.userData.noMerge = true;
        cGroup.add(liveTube);

        const poolMat = new THREE.MeshBasicMaterial({
          map: softRadialGlowTex,
          color: mCfg.color || 0xb4f0e4,
          transparent: true,
          opacity: 0.24,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const floorPool = new THREE.Mesh(aoSharedPlaneGeo, poolMat);
        floorPool.rotation.x = -Math.PI / 2;
        floorPool.position.set(roomW * 0.14, 0.02, roomD * 0.12);
        floorPool.scale.set(5.2, 5.2, 1.0);
        floorPool.userData.noMerge = true;
        cGroup.add(floorPool);

        roomMoodFixtures.push({
          roomId: roomDef.id,
          mood: 'dying_tube',
          group: cGroup,
          bulbMat: tubeMat,
          poolMat,
          worldX: unitCenterX + roomW * 0.14,
          worldY: floorY + 2.82,
          worldZ: unitCenterZ + roomD * 0.12,
          floorY,
          halfW,
          halfD,
          color: mCfg.color || 0xb4f0e4,
          baseIntensity: mCfg.intensity || 3.6,
          distance: mCfg.distance || 10.5,
          seed,
        });
      } else if (mood === 'moonlight') {
        roomMoodFixtures.push({
          roomId: roomDef.id,
          mood: 'moonlight',
          group: cGroup,
          worldX: unitCenterX + windowSideSignX * (roomW * 0.22),
          worldY: floorY + 2.15,
          worldZ: unitCenterZ,
          floorY,
          halfW,
          halfD,
          color: mCfg.color || 0x84b6e6,
          baseIntensity: mCfg.intensity || 2.6,
          distance: mCfg.distance || 11.5,
          seed,
        });
      } else if (mood === 'warm_lamp') {
        // WARM DESK LAMP MOOD: Isolated warm tungsten banker/desk lamp pool on wooden desk (Ref 4)
        const lampX = (roomDef.archetype === 'library') ? 1.75 : -2.15;
        const lampZ = (roomDef.archetype === 'library') ? -1.35 : 4.85;
        const lampY = 0.88;

        const bulbMat = step2Mats.warmDeskLampBulbMat.clone();
        const shade = new THREE.Mesh(step2Geos.readingLampShade, bulbMat);
        shade.position.set(lampX, lampY + 0.30, lampZ);
        shade.userData.noMerge = true;
        cGroup.add(shade);

        const poolMat = new THREE.MeshBasicMaterial({
          map: softRadialGlowTex,
          color: mCfg.color || 0xff9838,
          transparent: true,
          opacity: 0.32,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const deskPool = new THREE.Mesh(aoSharedPlaneGeo, poolMat);
        deskPool.rotation.x = -Math.PI / 2;
        deskPool.position.set(lampX, 0.022, lampZ);
        deskPool.scale.set(4.6, 4.6, 1.0);
        deskPool.userData.noMerge = true;
        cGroup.add(deskPool);

        roomMoodFixtures.push({
          roomId: roomDef.id,
          mood: 'warm_lamp',
          group: cGroup,
          bulbMat,
          poolMat,
          worldX: unitCenterX + lampX,
          worldY: floorY + lampY + 0.42,
          worldZ: unitCenterZ + lampZ,
          floorY,
          halfW,
          halfD,
          color: mCfg.color || 0xff9838,
          baseIntensity: mCfg.intensity || 3.8,
          distance: mCfg.distance || 9.8,
          seed,
        });
      } else if (mood === 'emergency_red') {
        const cageMat = step2Mats.emergencyRedBulbMat.clone();
        const beaconCage = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.22, 10), cageMat);
        beaconCage.position.set(0, 3.24, 0);
        beaconCage.userData.noMerge = true;
        cGroup.add(beaconCage);

        const poolMat = new THREE.MeshBasicMaterial({
          map: softRadialGlowTex,
          color: mCfg.color || 0xff2218,
          transparent: true,
          opacity: 0.28,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const redPool = new THREE.Mesh(aoSharedPlaneGeo, poolMat);
        redPool.rotation.x = -Math.PI / 2;
        redPool.position.set(0, 0.022, 0);
        redPool.scale.set(5.6, 5.6, 1.0);
        redPool.userData.noMerge = true;
        cGroup.add(redPool);

        roomMoodFixtures.push({
          roomId: roomDef.id,
          mood: 'emergency_red',
          group: cGroup,
          bulbMat: cageMat,
          poolMat,
          worldX: unitCenterX,
          worldY: floorY + 3.05,
          worldZ: unitCenterZ,
          floorY,
          halfW,
          halfD,
          color: mCfg.color || 0xff2218,
          baseIntensity: mCfg.intensity || 3.8,
          distance: mCfg.distance || 10.5,
          seed,
        });
      }
    }

    function setRoomLightMood(roomId, nextMood) {
      const m = normalizeRoomLightMood(nextMood);
      if (ROOM_DEFINITIONS[roomId]) {
        ROOM_DEFINITIONS[roomId].lightMood = m;
      }
      for (let i = 0; i < roomVisibilityList.length; i++) {
        if (roomVisibilityList[i].id === roomId) {
          roomVisibilityList[i].lightMood = m;
        }
      }
      const moodsCfg = HORROR_CONFIG.roomLightMoods || {};
      const mCfg = moodsCfg[m] || { color: 0xb4f0e4, intensity: 3.6, distance: 10.5 };
      for (let i = 0; i < roomMoodFixtures.length; i++) {
        const rf = roomMoodFixtures[i];
        if (rf.roomId === roomId) {
          rf.mood = m;
          rf.color = mCfg.color || 0xb4f0e4;
          rf.baseIntensity = (m === 'dark') ? 0.0 : (mCfg.intensity || 3.4);
          rf.distance = mCfg.distance || 10.5;
          if (rf.bulbMat && rf.bulbMat.emissive) {
            rf.bulbMat.emissive.setHex(rf.color);
          }
          if (rf.poolMat && rf.poolMat.color) {
            rf.poolMat.color.setHex(rf.color);
          }
        }
      }
    }

    function updateRoomMoodLighting(delta, timeSec, playerPos) {
      // Requirement 5: Cheap emissive flicker PLUS one pooled light ONLY when the player is inside the room!
      let insideFixture = null;
      const safeFlicker = !!(accessibilitySettings && accessibilitySettings.flickerReduction);
      const calmTube = !!EXPLORE_FLAGS.CALM_DYING_TUBE_FLICKER;
      const steadyRed = !!EXPLORE_FLAGS.STEADY_EMERGENCY_RED;

      for (let i = 0; i < roomMoodFixtures.length; i++) {
        const rf = roomMoodFixtures[i];
        if (!rf.group || !rf.group.visible) continue;

        let mult = 1.0;
        if (rf.mood === 'dying_tube') {
          if (calmTube) {
            // Explore Mode: gentle slow wave at ~1.25 Hz (7.85 rad/s) with small 0.90..1.00 swing, zero strobing/dropouts
            mult = 0.95 + 0.05 * Math.sin(timeSec * 7.85 + rf.seed);
          } else if (safeFlicker) {
            // Requirement 4 (Light Safety): <= 2 flashes/sec (omega <= 12.56 rad/s) & smaller brightness swing
            mult = 0.84 + 0.10 * Math.sin(timeSec * 10.2 + rf.seed);
          } else {
            const w1 = Math.sin(timeSec * 19.5 + rf.seed * 3.1);
            const w2 = Math.sin(timeSec * 43.0 + rf.seed * 7.4);
            const dropout = (Math.sin(timeSec * 2.3 + rf.seed) > 0.72) ? 0.06 : 1.0;
            mult = (w1 > -0.25 ? (0.75 + 0.25 * w2) : 0.12) * dropout;
          }
          if (rf.bulbMat) rf.bulbMat.emissiveIntensity = 1.25 * mult;
          if (rf.poolMat) rf.poolMat.opacity = 0.24 * mult;
        } else if (rf.mood === 'emergency_red') {
          // Explore Mode: steady red glow with zero pulsing
          const pulse = steadyRed
            ? 1.0
            : (safeFlicker
              ? (0.80 + 0.12 * Math.sin(timeSec * 2.2 + rf.seed))
              : (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(timeSec * 3.4 + rf.seed))));
          mult = pulse;
          if (rf.bulbMat) rf.bulbMat.emissiveIntensity = (steadyRed ? 1.55 : (safeFlicker ? 1.35 : 1.85)) * pulse;
          if (rf.poolMat) rf.poolMat.opacity = (steadyRed ? 0.26 : (safeFlicker ? 0.22 : 0.30)) * pulse;
        } else if (rf.mood === 'warm_lamp') {
          mult = 0.96 + 0.04 * Math.sin(timeSec * 3.2 + rf.seed);
          if (rf.bulbMat) rf.bulbMat.emissiveIntensity = 1.45 * mult;
          if (rf.poolMat) rf.poolMat.opacity = 0.32 * mult;
        } else if (rf.mood === 'moonlight') {
          mult = 0.98 + 0.02 * Math.sin(timeSec * 1.1 + rf.seed);
        } else {
          mult = 0.0;
        }
        rf.currentMult = mult;

        // Check if player is physically inside this room's bounds
        if (rf.baseIntensity > 0.01 && Math.abs(playerPos.y - rf.floorY) < 2.2) {
          const hw = rf.halfW || 7.0;
          const hd = rf.halfD || 6.8;
          if (Math.abs(playerPos.x - rf.worldX) <= hw + 1.5 && Math.abs(playerPos.z - rf.worldZ) <= hd + 1.5) {
            insideFixture = rf;
            if (!calmTube && !safeFlicker && rf.mood === 'dying_tube' && mult < 0.20 && Math.random() < 0.03) {
              soundEngine.playTubeFlickerBuzzSfx();
            }
          }
        }
      }

      if (lampFlickerMod) {
        if (insideFixture && powerCutDarkBuilding !== 'ROTUNDA') {
          lampFlickerMod.indoorOverrideLight = {
            x: insideFixture.worldX,
            y: insideFixture.worldY,
            z: insideFixture.worldZ,
            color: insideFixture.color,
            distance: insideFixture.distance,
            intensity: insideFixture.baseIntensity * (insideFixture.currentMult || 1.0),
          };
        } else {
          lampFlickerMod.indoorOverrideLight = null;
        }
      }
    }

    const ROOM_ARCHETYPE_BUILDERS = {
      classroom_standard: (cGroup, cx, cz, fy, dirZ, title, isNewari) => buildDetailedClassroomInterior(cGroup, cx, cz, fy, dirZ, title, isNewari, 0),
      classroom_seminar:  (cGroup, cx, cz, fy, dirZ, title, isNewari) => buildDetailedClassroomInterior(cGroup, cx, cz, fy, dirZ, title, isNewari, 1),
      computer_lab:       (cGroup, cx, cz, fy, dirZ, title) => buildComputerLabInterior(cGroup, cx, cz, fy, dirZ, title),
      library:            (cGroup, cx, cz, fy, dirZ, title) => buildLibraryRoomInterior(cGroup, cx, cz, fy, dirZ, title),
      staff_office:       (cGroup, cx, cz, fy, dirZ, title) => buildStaffAdminOfficeInterior(cGroup, cx, cz, fy, dirZ, title),
      toilets:            (cGroup, cx, cz, fy, dirZ, title) => buildToiletsRoomInterior(cGroup, cx, cz, fy, title),
      canteen_dining:     (cGroup, cx, cz, fy, dirZ, title) => buildCanteenRoomInterior(cGroup, cx, cz, fy, title, false),
      canteen_kitchen:    (cGroup, cx, cz, fy, dirZ, title) => buildCanteenRoomInterior(cGroup, cx, cz, fy, title, true),
      storeroom:          (cGroup, cx, cz, fy, dirZ, title) => buildStoreRoomInterior(cGroup, cx, cz, fy, title),
    };

    function populateClassroomUnit(unitCenterX, unitCenterZ, floorY, facingDirZ, unitTitle, isNewariStyle = false) {
      const cGroup = new THREE.Group();
      cGroup.position.set(unitCenterX, floorY, unitCenterZ);
      scene.add(cGroup);

      // 1. Stained Acoustic Tile Ceiling Panel (or Carved Sal Wood in Newari Wing) + 3-Blade Fan
      const ceilPanel = new THREE.Mesh(
        new THREE.BoxGeometry(6.8, 0.06, 8.2),
        isNewariStyle ? materials.carvedSalWood : materials.stainedCeilingTiles
      );
      ceilPanel.position.set(0, 3.38, 0);
      cGroup.add(ceilPanel);

      const fanRod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.38, 6), materials.whiteTrim);
      fanRod.position.set(0, 3.16, -0.4);
      cGroup.add(fanRod);
      for (let b = 0; b < 3; b++) {
        const ang = (b * Math.PI * 2) / 3;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.015, 0.78), materials.whiteTrim);
        blade.position.set(Math.sin(ang) * 0.44, 2.96, -0.4 + Math.cos(ang) * 0.44);
        blade.rotation.y = ang;
        cGroup.add(blade);
      }

      // 2. Data-Driven Archetype Dispatch via ROOM_DEFINITIONS
      const roomDef = getOrRegisterRoomDefinition(unitTitle, unitCenterX, unitCenterZ, floorY);
      const builderFn = ROOM_ARCHETYPE_BUILDERS[roomDef.archetype] || ROOM_ARCHETYPE_BUILDERS.classroom_standard;
      builderFn(cGroup, unitCenterX, unitCenterZ, floorY, facingDirZ, unitTitle, isNewariStyle, roomDef);

      // 3. Baked Room Corner/Baseboard/Ceiling AO Decals + Small Clutter & Asymmetry (Papers, Bottles, Fallen Chair, Jacket, Posters)
      addRoomBakedAO(cGroup, 6.8, 8.2, 3.38);
      populateRoomClutterAndAsymmetry(cGroup, 6.6, 7.8, unitCenterX * 3.1 + unitCenterZ * 7.3, false);

      cGroup.userData.isRoomGroup = true;
      bakeStaticGroup(cGroup, true);

      // 4. Per-Room Light Mood Fixtures, Window Light Shafts & Dust Motes (added after static merge so animated meshes stay unmerged)
      const windowSideSignX = unitCenterX < 0 ? -1 : 1;
      applyRoomLightMoodFixtures(cGroup, roomDef, unitCenterX, floorY, unitCenterZ, 6.8, 8.2, windowSideSignX);

      cGroup.userData.roomDef = roomDef;
      roomVisibilityList.push({
        id: unitTitle,
        type: 'room',
        group: cGroup,
        x: unitCenterX,
        y: floorY,
        z: unitCenterZ,
        floorY,
        radius: 5.4,
        bKey: roomDef.building,
        lightMood: roomDef.lightMood,
      });
    }

    /* =========================================================================
       OPTIMIZED PITCHED GABLE ROOF BUILDER
       Supports BOTH Actual Gandaki University Blue Corrugated Roofs AND
       Optional Traditional Newari Jhingati Terracotta Roofs (Low Draw Calls for iPhone 17!)
       ========================================================================= */
    function buildPitchedGableRoof(cx, yBase, cz, width, depth, ridgeH = 1.40, roofMat = materials.brightBlueRoof, isLongitudinal = false) {
      const rGroup = new THREE.Group();
      rGroup.position.set(cx, yBase, cz);

      const isNewari = (roofMat === materials.jhingatiTerracottaRoof);
      const overhang = isNewari ? 0.76 : 0.55;
      const totalW = width + overhang * 2;
      const totalD = depth + overhang * 2;
      const trimMat = isNewari ? materials.ebonyCarvedWood : materials.whiteTrim;
      const gableWallMat = isNewari ? materials.nepalDachiBrick : materials.campusStucco;

      const cornice = new THREE.Mesh(new THREE.BoxGeometry(totalW, 0.16, totalD), trimMat);
      cornice.position.set(0, -0.05, 0);
      rGroup.add(cornice);

      const soffit = new THREE.Mesh(
        new THREE.BoxGeometry(totalW - 0.06, 0.04, totalD - 0.06),
        isNewari ? materials.carvedSalWood : materials.roofSoffitDark
      );
      soffit.position.set(0, -0.14, 0);
      rGroup.add(soffit);

      if (!isLongitudinal) {
        const halfD = totalD / 2;
        const slopeLen = Math.hypot(halfD, ridgeH);
        const slopeAngle = Math.atan2(ridgeH, halfD);

        const frontSlope = new THREE.Mesh(new THREE.BoxGeometry(totalW, 0.12, slopeLen), roofMat);
        frontSlope.position.set(0, ridgeH / 2, halfD / 2);
        frontSlope.rotation.x = slopeAngle;
        rGroup.add(frontSlope);

        const backSlope = new THREE.Mesh(new THREE.BoxGeometry(totalW, 0.12, slopeLen), roofMat);
        backSlope.position.set(0, ridgeH / 2, -halfD / 2);
        backSlope.rotation.x = -slopeAngle;
        rGroup.add(backSlope);

        const ridgeCap = new THREE.Mesh(
          new THREE.BoxGeometry(totalW + 0.1, 0.16, 0.32),
          isNewari ? materials.ebonyCarvedWood : materials.gandakiBluePole
        );
        ridgeCap.position.set(0, ridgeH + 0.05, 0);
        rGroup.add(ridgeCap);

        if (isNewari) {
          [-totalW / 2 + 0.25, totalW / 2 - 0.25].forEach(gx => {
            const gajur = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.38, 8), materials.brassGajur);
            gajur.position.set(gx, ridgeH + 0.32, 0);
            rGroup.add(gajur);
          });
        }

        [-width / 2, width / 2].forEach(gx => {
          const gableGeom = new THREE.BufferGeometry();
          const d2 = depth / 2;
          const vertices = new Float32Array([
            0, 0, -d2,  0, 0, d2,  0, ridgeH, 0,
            0, ridgeH, 0,  0, d2, 0,  0, -d2, 0
          ]);
          gableGeom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
          gableGeom.computeVertexNormals();
          const gableMesh = new THREE.Mesh(gableGeom, gableWallMat);
          gableMesh.position.set(gx, 0, 0);
          rGroup.add(gableMesh);
        });
      } else {
        const halfW = totalW / 2;
        const slopeLen = Math.hypot(halfW, ridgeH);
        const slopeAngle = Math.atan2(ridgeH, halfW);

        const leftSlope = new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.12, totalD), roofMat);
        leftSlope.position.set(-halfW / 2, ridgeH / 2, 0);
        leftSlope.rotation.z = slopeAngle;
        rGroup.add(leftSlope);

        const rightSlope = new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.12, totalD), roofMat);
        rightSlope.position.set(halfW / 2, ridgeH / 2, 0);
        rightSlope.rotation.z = -slopeAngle;
        rGroup.add(rightSlope);

        const ridgeCap = new THREE.Mesh(
          new THREE.BoxGeometry(0.32, 0.16, totalD + 0.1),
          isNewari ? materials.ebonyCarvedWood : materials.gandakiBluePole
        );
        ridgeCap.position.set(0, ridgeH + 0.05, 0);
        rGroup.add(ridgeCap);

        [-depth / 2, depth / 2].forEach(gz => {
          const gableGeom = new THREE.BufferGeometry();
          const w2 = width / 2;
          const vertices = new Float32Array([
            -w2, 0, 0,  w2, 0, 0,  0, ridgeH, 0,
             0, ridgeH, 0,  w2, 0, 0, -w2, 0, 0
          ]);
          gableGeom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
          gableGeom.computeVertexNormals();
          const gableMesh = new THREE.Mesh(gableGeom, gableWallMat);
          gableMesh.position.set(0, 0, gz);
          rGroup.add(gableMesh);

          const louver = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 0.34, 0.12),
            isNewari ? materials.tikijhyalLattice : materials.whiteTrim
          );
          louver.position.set(0, ridgeH * 0.56, gz + (gz > 0 ? 0.05 : -0.05));
          rGroup.add(louver);
        });
      }

      scene.add(rGroup);
    }

    /* =========================================================================
       MAIN BUILDINGS: ACTUAL GANDAKI UNIVERSITY CLASSROOM WINGS (L1-L3, R1, R2, R4)
       + OPTIONAL TRADITIONAL NEWARI STRUCTURES (W1, W2, FALCHA, CHAITYA, GATE)
       ========================================================================= */
    function buildLongitudinalClassroomWing(
      cx, cz,
      width = 7.6,
      length = 30.0,
      doorSideX = -1,
      hasVeranda = false,
      hasSouthEntry = false,
      hasRaisedRoof = false,
      blockLabel = 'Wing'
    ) {
      const floorH = 0.18;
      const wallH = 3.55;
      const wallT = 0.24;
      const verandaW = hasVeranda ? 2.4 : 0.7;

      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(width + verandaW, floorH, length + 0.8),
        materials.classroomFloor
      );
      slab.position.set(cx + doorSideX * (verandaW / 2 - 0.2), floorH / 2, cz);
      scene.add(slab);

      addWalkableFloor(
        cx - width / 2 - (doorSideX === -1 ? verandaW : 0.4),
        cx + width / 2 + (doorSideX === 1 ? verandaW : 0.4),
        cz - length / 2 - 0.5,
        cz + length / 2 + 0.5,
        floorH
      );

      buildCornerQuoins(cx - width / 2, floorH, cz - length / 2, wallH);
      buildCornerQuoins(cx + width / 2, floorH, cz - length / 2, wallH);
      buildCornerQuoins(cx - width / 2, floorH, cz + length / 2, wallH);
      buildCornerQuoins(cx + width / 2, floorH, cz + length / 2, wallH);

      // North End Wall
      buildWallSegment(cx, floorH, cz + length / 2, width, wallH, wallT, materials.campusStucco);
      buildDetailedWindow(cx, floorH + 1.9, cz + length / 2 + 0.14, 1, false);

      // South End Wall
      if (hasSouthEntry) {
        const doorW = 2.0;
        const flankW = (width - doorW) / 2;
        buildWallSegment(cx - doorW / 2 - flankW / 2, floorH, cz - length / 2, flankW, wallH, wallT, materials.campusStucco);
        buildWallSegment(cx + doorW / 2 + flankW / 2, floorH, cz - length / 2, flankW, wallH, wallT, materials.campusStucco);

        const transom = new THREE.Mesh(new THREE.BoxGeometry(doorW, 0.9, wallT), materials.campusStucco);
        transom.position.set(cx, floorH + wallH - 0.45, cz - length / 2);
        scene.add(transom);

        const doorArch = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.24, 0.14, wallT + 0.08), materials.whiteTrim);
        doorArch.position.set(cx, floorH + wallH - 0.92, cz - length / 2);
        scene.add(doorArch);

        const step = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.6, 0.14, 1.0), materials.riverStoneCoping);
        step.position.set(cx, 0.07, cz - length / 2 - 0.5);
        scene.add(step);
      } else {
        buildWallSegment(cx, floorH, cz - length / 2, width, wallH, wallT, materials.campusStucco);
        buildDetailedWindow(cx, floorH + 1.9, cz - length / 2 - 0.14, -1, true);
      }

      // Solid / Window Wall
      const solidX = cx - doorSideX * (width / 2);
      buildWallSegment(solidX, floorH, cz, wallT, wallH, length, materials.campusStucco);

      let winIdx = 0;
      for (let wz = cz - length / 2 + 4.2; wz <= cz + length / 2 - 4.2; wz += 6.2) {
        const isWarmWindow = (winIdx + Math.abs(Math.round(cx))) % 2 === 0;
        buildDetailedWindow(solidX - doorSideX * 0.14, floorH + 1.9, wz, 0, isWarmWindow, -doorSideX);

        const ac = new THREE.Mesh(sharedGeos.acUnitBox, materials.whiteTrim);
        ac.position.set(solidX - doorSideX * 0.24, floorH + 2.55, wz + 1.35);
        scene.add(ac);
        winIdx++;
      }

      // Enterable Classrooms along doorSideX
      const doorWallX = cx + doorSideX * (width / 2);
      const numRooms = length >= 26 ? 3 : 2;
      const roomLen = length / numRooms;
      const doorW = 1.9;
      const doorZCoords = [];

      for (let i = 1; i < numRooms; i++) {
        const pZ = cz - length / 2 + roomLen * i;
        buildWallSegment(cx, floorH, pZ, width - 0.2, wallH, wallT, materials.campusStucco);
      }

      for (let rIdx = 0; rIdx < numRooms; rIdx++) {
        const rCenterZ = cz - length / 2 + roomLen * (rIdx + 0.5);
        doorZCoords.push(rCenterZ);
        const flankLen = (roomLen - doorW) / 2;

        buildWallSegment(doorWallX, floorH, rCenterZ - doorW / 2 - flankLen / 2, wallT, wallH, flankLen, materials.campusStucco);
        buildWallSegment(doorWallX, floorH, rCenterZ + doorW / 2 + flankLen / 2, wallT, wallH, flankLen, materials.campusStucco);

        const transom = new THREE.Mesh(new THREE.BoxGeometry(wallT, 0.9, doorW), materials.campusStucco);
        transom.position.set(doorWallX, floorH + wallH - 0.45, rCenterZ);
        scene.add(transom);

        const doorArch = new THREE.Mesh(new THREE.BoxGeometry(wallT + 0.08, 0.14, doorW + 0.24), materials.whiteTrim);
        doorArch.position.set(doorWallX, floorH + wallH - 0.92, rCenterZ);
        scene.add(doorArch);
        addWarmDoorwayGlow(doorWallX, floorH, rCenterZ, doorW, true);

        // Door frame jamb colliders (leaves 1.66m clear walkable opening)
        addDoorFrameColliders(doorWallX, floorH, rCenterZ, doorW, wallT, true);

        // Swinging wooden door leaf opened into the room with brass handle & room plaque
        buildSwingingDoor(
          scene,
          doorWallX - doorSideX * 0.16,
          floorH,
          rCenterZ - doorW * 0.46,
          doorSideX === -1 ? 0.35 : (Math.PI - 0.35),
          materials.gandakiBluePole,
          'door-' + blockLabel + '-r' + (rIdx + 1)
        );

        if (flankLen > 1.8) {
          buildDetailedWindow(doorWallX + doorSideX * 0.14, floorH + 1.9, rCenterZ - doorW / 2 - flankLen / 2, 0, rIdx === 0, doorSideX);
          buildDetailedWindow(doorWallX + doorSideX * 0.14, floorH + 1.9, rCenterZ + doorW / 2 + flankLen / 2, 0, false, doorSideX);
        }

        populateClassroomUnit(cx, rCenterZ, floorH, 1, blockLabel + ' Room ' + (rIdx + 1), false);
      }

      // Populate Corridor / Exterior Veranda Strip with Lockers, Notice Boards, Water Dispenser, Fire Extinguisher, Wall Lamps, Mats, Photos & Plants
      populateCorridorProps(doorWallX, cz, floorH, length, -doorSideX, doorZCoords, blockLabel + ' Corridor');

      if (hasVeranda) {
        const verandaColX = doorWallX + doorSideX * (verandaW - 0.25);
        for (let pz = cz - length / 2 + 1.4; pz <= cz + length / 2 - 1.0; pz += 4.6) {
          const post = new THREE.Mesh(sharedGeos.verandaPost, materials.whiteTrim);
          post.position.set(verandaColX, floorH + 1.65, pz);
          scene.add(post);
          const pBase = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.28, 0.32), materials.whiteTrim);
          pBase.position.set(verandaColX, floorH + 0.14, pz);
          scene.add(pBase);
        }

        const verandahRoof = new THREE.Mesh(
          new THREE.BoxGeometry(verandaW + 0.4, 0.16, length + 0.6),
          materials.brightBlueRoof
        );
        verandahRoof.position.set(doorWallX + doorSideX * (verandaW / 2), floorH + 3.25, cz);
        verandahRoof.rotation.z = -doorSideX * 0.12;
        scene.add(verandahRoof);

        const walkwayAODecal = new THREE.Mesh(
          new THREE.PlaneGeometry(verandaW - 0.1, length + 0.4),
          materials.coveredWalkwayShadow
        );
        walkwayAODecal.rotation.x = -Math.PI / 2;
        walkwayAODecal.position.set(doorWallX + doorSideX * (verandaW / 2), floorH + 0.02, cz);
        scene.add(walkwayAODecal);
      }

      // Actual Gandaki University Bright Blue Corrugated Pitched Gable Roof
      buildPitchedGableRoof(cx, floorH + wallH, cz, width + 0.9, length + 1.1, 1.42, materials.brightBlueRoof, true);

      if (hasRaisedRoof) {
        buildPitchedGableRoof(cx, floorH + wallH + 0.55, cz, (width + 0.9) * 0.58, (length + 1.1) * 0.88, 0.92, materials.brightBlueRoof, true);
      }
    }

    // Enterable Classroom Wing — supports BOTH Actual Gandaki University style AND Optional Traditional Newari Brick & Timber style!
    function buildEnterableClassroomWing(cx, cz, width = 26, depth = 7.6, doorSide = -1, hasVeranda = false, blockLabel = 'Wing', isNewariHeritage = false) {
      const floorH = 0.22;
      const wallH = 3.55;
      const wallT = 0.25;
      const wallMat = isNewariHeritage ? materials.nepalDachiBrick : materials.campusStucco;
      const floorMat = isNewariHeritage ? materials.teliyaFloorTile : materials.classroomFloor;
      const roofMat = isNewariHeritage ? materials.jhingatiTerracottaRoof : materials.brightBlueRoof;

      const verandaDepth = hasVeranda ? 2.4 : 0.9;
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.5, floorH, depth + verandaDepth),
        floorMat
      );
      slab.position.set(cx, floorH / 2, cz + doorSide * (verandaDepth / 2 - 0.2));
      scene.add(slab);
      addWalkableFloor(
        cx - width / 2 - 0.4,
        cx + width / 2 + 0.4,
        cz - depth / 2 - (doorSide === -1 ? verandaDepth : 0.4),
        cz + depth / 2 + (doorSide === 1 ? verandaDepth : 0.4),
        floorH
      );

      if (!isNewariHeritage) {
        buildCornerQuoins(cx - width / 2, floorH, cz - depth / 2, wallH);
        buildCornerQuoins(cx + width / 2, floorH, cz - depth / 2, wallH);
        buildCornerQuoins(cx - width / 2, floorH, cz + depth / 2, wallH);
        buildCornerQuoins(cx + width / 2, floorH, cz + depth / 2, wallH);
      }

      const backZ = cz - doorSide * (depth / 2);
      buildWallSegment(cx, floorH, backZ, width, wallH, wallT, wallMat);

      let winIdx = 0;
      for (let wx = cx - width / 2 + 3.2; wx <= cx + width / 2 - 3.2; wx += 5.2) {
        const isWarmWindow = (winIdx + Math.abs(Math.round(cz))) % 2 === 0;
        if (isNewariHeritage) {
          buildSanjhyalCarvedWindow(wx, floorH + 1.9, backZ - doorSide * 0.12, 0, -doorSide, 3, isWarmWindow, false);
        } else {
          buildDetailedWindow(wx, floorH + 1.9, backZ - doorSide * 0.14, -doorSide, isWarmWindow);
        }
        winIdx++;
      }

      buildWallSegment(cx - width / 2, floorH, cz, wallT, wallH, depth, wallMat);
      buildWallSegment(cx + width / 2, floorH, cz, wallT, wallH, depth, wallMat);
      buildWallSegment(cx, floorH, cz, wallT, wallH, depth - 0.2, wallMat);

      const frontZ = cz + doorSide * (depth / 2);
      const halfW = width / 2;
      const doorW = 1.95;
      const sideSegW = (halfW - doorW) / 2;

      [-halfW / 2, halfW / 2].forEach((roomOffset, roomIdx) => {
        const roomCenterX = cx + roomOffset;

        buildWallSegment(roomCenterX - doorW / 2 - sideSegW / 2, floorH, frontZ, sideSegW, wallH, wallT, wallMat);
        buildWallSegment(roomCenterX + doorW / 2 + sideSegW / 2, floorH, frontZ, sideSegW, wallH, wallT, wallMat);

        const transom = new THREE.Mesh(new THREE.BoxGeometry(doorW, 0.9, wallT), wallMat);
        transom.position.set(roomCenterX, floorH + wallH - 0.45, frontZ);
        scene.add(transom);

        if (isNewariHeritage) {
          buildNewariToranaDoorway(roomCenterX, floorH, frontZ + doorSide * 0.04, 0, doorSide, doorW, 2.55);
          buildDiyoBrickNiche(roomCenterX - 1.5, floorH + 1.55, frontZ + doorSide * 0.14, 0, doorSide);
        } else {
          const doorArch = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.24, 0.14, wallT + 0.08), materials.whiteTrim);
          doorArch.position.set(roomCenterX, floorH + wallH - 0.92, frontZ);
          scene.add(doorArch);
        }

        // Door frame jamb colliders (leaves 1.71m clear walkable opening)
        addDoorFrameColliders(roomCenterX, floorH, frontZ, doorW, wallT, false);

        // Swinging wooden door + entrance floor mat
        buildSwingingDoor(
          scene,
          roomCenterX - doorW * 0.45,
          floorH,
          frontZ - doorSide * 0.16,
          doorSide === 1 ? -1.15 : 1.15,
          isNewariHeritage ? materials.ebonyCarvedWood : materials.gandakiBluePole,
          'door-' + blockLabel + '-r' + (roomIdx + 1)
        );
        const dMat = new THREE.Mesh(step2Geos.floorMat, step2Mats.matRubber);
        dMat.position.set(roomCenterX, floorH + 0.012, frontZ + doorSide * 0.46);
        scene.add(dMat);

        addWarmDoorwayGlow(roomCenterX, floorH, frontZ, doorW, false);
        populateClassroomUnit(
          roomCenterX,
          cz,
          floorH,
          doorSide,
          blockLabel + ' Room ' + (roomIdx + 1),
          isNewariHeritage
        );
      });

      buildPitchedGableRoof(cx, floorH + wallH, cz, width + 0.9, depth + 1.1, 1.38, roofMat, false);
    }

    /* =========================================================================
       1. GROUND: NATURAL GRASS MIXED WITH CONCRETE FOOTPATHS & DRY LEAVES
       ========================================================================= */
    // Natural Green & Weathered Campus Grass Field across the entire ground plane
    const terrainMesh = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), materials.surveyorGrass);
    terrainMesh.rotation.x = -Math.PI / 2;
    scene.add(terrainMesh);

    // Concrete Parking Apron & Bus Staging Bay at Southern Entrance (z = -62..-36)
    const southParkingApron = new THREE.Mesh(new THREE.PlaneGeometry(68, 28), materials.interlockingPavers);
    southParkingApron.rotation.x = -Math.PI / 2;
    southParkingApron.position.set(-6, 0.02, -49);
    scene.add(southParkingApron);

    // Network of Concrete Footpaths with Raised Stone Curbs mixed with Natural Grass Lawns!
    buildConcreteFootpath(0.8, -5.0, 5.6, 68.0, false);   // Main Central Spine Concrete Avenue (z = -39..+29)
    buildConcreteFootpath(-12.0, -4.0, 3.2, 62.0, false); // West Courtyard Concrete Footpath between L1 & L2/L3
    buildConcreteFootpath(19.8, -2.0, 3.2, 60.0, false);  // East Courtyard Concrete Footpath between R1 & R2/R4
    buildConcreteFootpath(-27.2, -12.0, 2.8, 66.0, false);// West Cultural & Academic Cluster Footpath (W1-W4)
    buildConcreteFootpath(-13.0, -34.5, 2.8, 28.0, true); // South Cross-Walkway connecting W1, L1 & Spine Road
    buildConcreteFootpath(-6.0, 4.0, 2.8, 14.0, true);    // Cross-Walkway to Traditional Newari Falcha Pavilion
    buildConcreteFootpath(10.5, 3.0, 2.8, 18.0, true);    // Cross-Walkway to East Stone Chaitya Shrine
    buildConcreteFootpath(-8.0, 32.5, 3.0, 42.0, true);   // Northern Terrace Cross-Walkway below Grand Rotunda

    // "PARKING" Stencil & Gate Signboard drawn into Signage Texture Atlas
    if (sAtlasCtx) {
      sAtlasCtx.fillStyle = '#1e2530';
      sAtlasCtx.fillRect(0, 160, 512, 128);
      sAtlasCtx.fillStyle = 'rgba(203, 213, 225, 0.65)';
      sAtlasCtx.fillRect(40, 168, 432, 5);
      sAtlasCtx.fillRect(40, 275, 432, 5);
      sAtlasCtx.font = '900 54px sans-serif';
      sAtlasCtx.textAlign = 'center';
      sAtlasCtx.fillText('P A R K I N G', 256, 240);

      sAtlasCtx.fillStyle = '#1d4ed8';
      sAtlasCtx.fillRect(512, 96, 512, 96);
      sAtlasCtx.strokeStyle = '#ffffff';
      sAtlasCtx.lineWidth = 4;
      sAtlasCtx.strokeRect(518, 102, 500, 84);
      sAtlasCtx.fillStyle = '#ffffff';
      sAtlasCtx.font = 'bold 38px sans-serif';
      sAtlasCtx.textAlign = 'center';
      sAtlasCtx.fillText('GANDAKI UNIVERSITY', 768, 156);
    }
    const pStencil = new THREE.Mesh(createAtlasUvGeo(new THREE.PlaneGeometry(9.5, 2.4), 0, 160, 512, 128), sharedSignageAtlasMat);
    pStencil.rotation.x = -Math.PI / 2;
    pStencil.position.set(-1.5, 0.035, -56);
    scene.add(pStencil);

    /* =========================================================================
       2. ENTRANCE GATE, GANDAKI UNIVERSITY GUARDHOUSE & TRADITIONAL NEWARI ARCH
       ========================================================================= */
    const gateX = 1.5, gateZ = -64;
    buildWallSegment(gateX - 3.6, 0, gateZ, 1.0, 4.6, 1.0, materials.whiteTrim);
    buildWallSegment(gateX + 3.6, 0, gateZ, 1.0, 4.6, 1.0, materials.whiteTrim);
    const gateTopBeam = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.72, 0.95), materials.gandakiBluePole);
    gateTopBeam.position.set(gateX, 4.35, gateZ);
    scene.add(gateTopBeam);

    const gSignMesh = new THREE.Mesh(createAtlasUvGeo(new THREE.PlaneGeometry(6.4, 0.62), 512, 96, 512, 96), sharedSignageAtlasMat);
    gSignMesh.position.set(gateX, 4.35, gateZ - 0.49);
    scene.add(gSignMesh);

    const gateLeafL = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.2, 0.12), materials.castIronDark);
    gateLeafL.position.set(gateX - 1.9, 1.1, gateZ);
    scene.add(gateLeafL);

    // Enterable Blue-Roofed Security Guardhouse immediately to the right of the gate
    const ghX = 6.0, ghZ = -58.0, ghW = 4.6, ghD = 4.6, ghFloorY = 0.16;
    const ghSlab = new THREE.Mesh(new THREE.BoxGeometry(ghW + 0.4, ghFloorY, ghD + 0.4), materials.classroomFloor);
    ghSlab.position.set(ghX, ghFloorY / 2, ghZ);
    scene.add(ghSlab);
    addWalkableFloor(ghX - ghW / 2 - 0.4, ghX + ghW / 2 + 0.4, ghZ - ghD / 2 - 0.4, ghZ + ghD / 2 + 0.4, ghFloorY);
    buildWallSegment(ghX, ghFloorY, ghZ - ghD / 2, ghW, 3.04, 0.22, materials.campusStucco);
    buildWallSegment(ghX, ghFloorY, ghZ + ghD / 2, ghW, 3.04, 0.22, materials.campusStucco);
    buildWallSegment(ghX + ghW / 2, ghFloorY, ghZ, 0.22, 3.04, ghD, materials.campusStucco);
    buildWallSegment(ghX - ghW / 2, ghFloorY, ghZ - 1.55, 0.22, 3.04, 1.5, materials.campusStucco);
    buildWallSegment(ghX - ghW / 2, ghFloorY, ghZ + 1.55, 0.22, 3.04, 1.5, materials.campusStucco);
    addDoorFrameColliders(ghX - ghW / 2, ghFloorY, ghZ, 1.60, 0.22, true);
    buildSwingingDoor(scene, ghX - ghW / 2 + 0.15, ghFloorY, ghZ - 0.75, 0.42, materials.gandakiBluePole, 'door-guardhouse');
    const ghGroup = new THREE.Group();
    ghGroup.position.set(ghX, ghFloorY, ghZ);
    scene.add(ghGroup);
    const ghDesk = new THREE.Mesh(step2Geos.officeDesk, materials.deskWoodTop);
    ghDesk.position.set(0.65, 0.38, 0);
    ghDesk.rotation.y = Math.PI / 2;
    ghGroup.add(ghDesk);
    const ghMon = new THREE.Mesh(step2Geos.monitorPanel, step2Mats.monitorScreenOn);
    ghMon.position.set(0.72, 0.94, -0.25);
    ghMon.rotation.y = -Math.PI / 2;
    ghGroup.add(ghMon);
    const ghLocker = new THREE.Mesh(step2Geos.filingCabinet, step2Mats.lockerSteel);
    ghLocker.position.set(1.45, 0.69, 1.45);
    ghGroup.add(ghLocker);
    bakeStaticGroup(ghGroup, true);
    ghGroup.userData.isRoomGroup = true;
    ghGroup.userData.roomDef = ROOM_DEFINITIONS['Security Guardhouse'];
    roomVisibilityList.push({
      id: 'Security Guardhouse',
      type: 'room',
      group: ghGroup,
      x: ghX,
      y: ghFloorY,
      z: ghZ,
      floorY: ghFloorY,
      radius: 3.6,
      bKey: 'GUARDHOUSE',
      lightMood: 'cold_monitor_glow',
    });
    addColliderBox(new THREE.Box3(new THREE.Vector3(ghX + 0.20, ghFloorY, ghZ - 0.80), new THREE.Vector3(ghX + 1.10, ghFloorY + 0.82, ghZ + 0.80)), 'furniture');
    addColliderBox(new THREE.Box3(new THREE.Vector3(ghX + 1.12, ghFloorY, ghZ + 1.12), new THREE.Vector3(ghX + 1.78, ghFloorY + 1.42, ghZ + 1.78)), 'furniture');
    interactiveHidingSpots.push({ id: 'guardhouse-desk', name: 'Security Guardhouse CCTV Desk', x: ghX - 0.35, y: ghFloorY, z: ghZ, zone: 'Security Guardhouse' });
    buildCornerQuoins(ghX - ghW / 2, 0, ghZ - ghD / 2, 3.2);
    buildCornerQuoins(ghX + ghW / 2, 0, ghZ - ghD / 2, 3.2);
    buildDetailedWindow(ghX - 0.4, 1.7, ghZ - ghD / 2 - 0.12, -1, true);
    buildPitchedGableRoof(ghX, 3.2, ghZ, ghW + 1.2, ghD + 1.2, 1.15, materials.brightBlueRoof, true);

    // Perimeter Nepali River-Stone Walls flanking the Southern Boundary
    buildWallSegment(-26, 0, -64, 48, 2.1, 0.45, materials.nepaliRiverStone);
    buildWallSegment(22.0, 0, -50, 0.45, 2.1, 30, materials.whiteTrim);
    buildWallSegment(34, 0, -35, 25, 2.1, 0.45, materials.nepaliRiverStone);

    /* =========================================================================
       3. 2 ENTERABLE GANDAKI UNIVERSITY BUSES, 5 PARKED CARS & COURTYARD SCOOTER
       ========================================================================= */
    const busConfig = (HORROR_CONFIG && HORROR_CONFIG.buses) || {
      length: 10.5,
      width: 2.5,
      height: 3.1,
      floorY: 0.54,
      stepHeights: [0.18, 0.36],
      interiorCutoffDistance: 25.0,
      mossAmountA: 0.65,
      mossAmountB: 0.92,
      glassBreakageA: 0.35,
      glassBreakageB: 0.72,
      vineCountUltra: 14,
      plateNumberA: 'ग १ ख ९४९१',
      plateNumberB: 'ग १ ख ७२६२',
      routeSignDevanagari: 'पोखरा',
      fleetCodeA: 'GP62',
      fleetCodeB: 'GP64',
      doorOpenAngleA: 0.78,
      doorOpenAngleB: 0.42,
    };

    // ── 1:1 PHOTO-ACCURATE ASHOK LEYLAND HORROR COACH TEXTURE SUITE (IMG_6025 3.JPG) ──
    // Dedicated UV-mapped procedural textures so every panel, decal, shattered pane, and vine matches the reference photo.
    function createBusMasterAtlasTex() {
      const canvas = document.createElement('canvas');
      canvas.width = 2048;
      canvas.height = 1024;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Base weathered ochre-yellow coach paint (#b9851e)
        ctx.fillStyle = '#b9851e';
        ctx.fillRect(0, 0, 2048, 1024);

        // ── BAND 1 (Y: 0..420): FULL SIDE WAIST LIVERY ("GANDAKI [Crest] UNIVERSITY", Navy Stripes, Riveted Seams, Access Hatches, Yellow Notice Boards) ──
        const sideGrad = ctx.createLinearGradient(0, 0, 0, 420);
        sideGrad.addColorStop(0.0, '#8f6312');
        sideGrad.addColorStop(0.12, '#c48f24');
        sideGrad.addColorStop(0.68, '#a67418');
        sideGrad.addColorStop(0.88, '#6e490c');
        sideGrad.addColorStop(1.0, '#2e1d08');
        ctx.fillStyle = sideGrad;
        ctx.fillRect(0, 0, 2048, 420);

        // Vertical sheet-metal panel seams & rivet lines along the side body
        ctx.strokeStyle = 'rgba(32, 20, 8, 0.65)';
        ctx.lineWidth = 3;
        for (let px = 120; px < 2048; px += 240) {
          ctx.beginPath();
          ctx.moveTo(px, 6);
          ctx.lineTo(px, 415);
          ctx.stroke();
          ctx.fillStyle = 'rgba(45, 28, 10, 0.55)';
          for (let ry = 18; ry < 410; ry += 22) {
            ctx.fillRect(px - 5, ry, 3, 3);
            ctx.fillRect(px + 3, ry, 3, 3);
          }
        }

        // 2 Lower hinged battery/luggage access hatch doors (matching photo lower side panels)
        [[620, 210, 220, 175], [1160, 225, 195, 160]].forEach(([hx, hy, hw, hh]) => {
          ctx.strokeStyle = '#2b1b08';
          ctx.lineWidth = 4;
          ctx.strokeRect(hx, hy, hw, hh);
          ctx.fillStyle = '#1f1406';
          ctx.fillRect(hx + hw * 0.5 - 14, hy + 18, 28, 10); // T-latch handle
          ctx.fillRect(hx + 16, hy - 4, 22, 8); // left hinge
          ctx.fillRect(hx + hw - 38, hy - 4, 22, 8); // right hinge
        });

        // Twin horizontal dark navy-slate stripes flanking the center GANDAKI UNIVERSITY banner
        ctx.fillStyle = '#1b2838';
        // Left stripe segments (between front door & GANDAKI)
        ctx.fillRect(40, 108, 490, 20);
        ctx.fillRect(40, 140, 490, 26);
        // Right stripe segments (between UNIVERSITY & rear door)
        ctx.fillRect(1520, 108, 490, 20);
        ctx.fillRect(1520, 140, 490, 26);

        // Bold Weathered "GANDAKI" [Circular Mountain Crest] "UNIVERSITY" across center waist
        ctx.save();
        ctx.font = '900 92px "Arial Narrow", Impact, sans-serif';
        ctx.fillStyle = '#263849';
        ctx.strokeStyle = 'rgba(218, 182, 110, 0.45)';
        ctx.lineWidth = 3;
        ctx.textAlign = 'right';
        ctx.fillText('GANDAKI', 935, 168);
        if (ctx.strokeText) ctx.strokeText('GANDAKI', 935, 168);
        ctx.textAlign = 'left';
        ctx.fillText('UNIVERSITY', 1115, 168);
        if (ctx.strokeText) ctx.strokeText('UNIVERSITY', 1115, 168);
        ctx.restore();

        // Exact Circular Gandaki University Crest at (1024, 136)
        ctx.save();
        ctx.beginPath();
        ctx.arc(1024, 136, 68, 0, Math.PI * 2);
        ctx.fillStyle = '#f1f5f9';
        ctx.fill();
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#1e3a5f';
        ctx.stroke();
        // Inner navy ring
        ctx.beginPath();
        ctx.arc(1024, 136, 54, 0, Math.PI * 2);
        ctx.fillStyle = '#1e3a5f';
        ctx.fill();
        // Upper crimson-red hemisphere
        ctx.beginPath();
        ctx.arc(1024, 136, 48, Math.PI, 0, false);
        ctx.fillStyle = '#b91c1c';
        ctx.fill();
        // White Machhapuchhre fishtail twin peaks
        ctx.beginPath();
        ctx.moveTo(982, 142);
        ctx.lineTo(1008, 98);
        ctx.lineTo(1021, 116);
        ctx.lineTo(1034, 92);
        ctx.lineTo(1066, 142);
        ctx.closePath();
        ctx.fillStyle = '#f8fafc';
        ctx.fill();
        // Open book & rays at bottom of emblem
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(996, 147, 56, 14);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;
        ctx.strokeRect(996, 147, 56, 14);
        ctx.restore();

        // Yellow Front Side Notice Board & "BEECT" Sticker (at X: 140..390, Y: 52..215 matching photo)
        ctx.fillStyle = '#d4a72c';
        ctx.fillRect(145, 52, 235, 92);
        ctx.strokeStyle = '#291d06';
        ctx.lineWidth = 3;
        ctx.strokeRect(145, 52, 235, 92);
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('गण्डकी बस सेवा', 245, 82);
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('POKHARA UNIVERSITY ROUTE', 245, 104);
        ctx.fillText('REG NO: GP-62 / CAMPUS', 245, 124);
        // Red stamp on right of yellow placard
        ctx.fillStyle = '#991b1b';
        ctx.fillRect(344, 64, 24, 34);
        // Black & yellow "BEECT" sticker below placard
        ctx.fillStyle = '#111827';
        ctx.fillRect(148, 152, 78, 22);
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText('BEECT', 187, 168);

        // Rear Side Yellow Placard (at X: 1760..1930, Y: 58..136 matching photo)
        ctx.fillStyle = '#d4a72c';
        ctx.fillRect(1760, 58, 165, 76);
        ctx.strokeStyle = '#291d06';
        ctx.strokeRect(1760, 58, 165, 76);
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText('पोखरा', 1842, 92);
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('CAMPUS SHUTTLE', 1842, 118);

        // Heavy rain-runoff grime streaks, rust patches, and green moss stains across Band 1
        for (let i = 0; i < 260; i++) {
          const rx = (i * 89) % 2048;
          const ry = (i * 53) % 400;
          const rw = 6 + (i % 34);
          const rh = 14 + (i % 65);
          if (i % 3 === 0) {
            ctx.fillStyle = 'rgba(42, 64, 20, 0.52)'; // green moss/algae patch
          } else if (i % 3 === 1) {
            ctx.fillStyle = 'rgba(72, 34, 10, 0.44)'; // rust patch
          } else {
            ctx.fillStyle = 'rgba(22, 16, 10, 0.36)'; // vertical soot/grime streak
          }
          ctx.fillRect(rx, ry, rw, rh);
        }

        // ── BAND 2 (Y: 430..740): GENERAL WEATHERED YELLOW PAINT (Left: 0..1024) & SIGNAGE / PLATES (Right: 1024..2048) ──
        const bodyGrad = ctx.createLinearGradient(0, 430, 0, 740);
        bodyGrad.addColorStop(0.0, '#7c5813');
        bodyGrad.addColorStop(0.25, '#bd8920');
        bodyGrad.addColorStop(0.75, '#9b6c15');
        bodyGrad.addColorStop(1.0, '#4f3409');
        ctx.fillStyle = bodyGrad;
        ctx.fillRect(0, 430, 1024, 310);
        for (let i = 0; i < 160; i++) {
          ctx.fillStyle = i % 2 === 0 ? 'rgba(48, 68, 22, 0.45)' : 'rgba(64, 32, 10, 0.42)';
          ctx.fillRect((i * 67) % 1000, 435 + ((i * 39) % 290), 12 + (i % 28), 10 + (i % 32));
        }

        // Top Destination Board (X: 1040..1820, Y: 440..545): "GP62 | GANDAKI UNIVERSITY"
        ctx.fillStyle = '#22262c';
        ctx.fillRect(1040, 440, 780, 105);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 6;
        ctx.strokeRect(1044, 444, 772, 97);
        ctx.fillStyle = '#cbd5e1';
        ctx.font = 'bold 54px "Arial Narrow", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText((busConfig.fleetCodeA || 'GP62') + '  |  GANDAKI UNIVERSITY', 1068, 512);
        // Moss stain over left GP62 corner
        ctx.fillStyle = 'rgba(48, 72, 22, 0.58)';
        ctx.fillRect(1048, 446, 175, 48);

        // Roof Cant-Rail Fleet Stencil "GP62" (X: 1840..2030, Y: 445..535)
        ctx.fillStyle = '#b07e1b';
        ctx.fillRect(1840, 445, 190, 90);
        ctx.fillStyle = '#f1f5f9';
        ctx.font = 'bold 46px "Arial Narrow", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(busConfig.fleetCodeA || 'GP62', 1935, 506);

        // "LANKA ASHOK LEYLAND" Front Badge Plate (X: 1040..1620, Y: 560..625)
        ctx.fillStyle = '#14181f';
        ctx.fillRect(1040, 560, 580, 62);
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 3;
        ctx.strokeRect(1043, 563, 574, 56);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 34px serif';
        ctx.textAlign = 'center';
        ctx.fillText('LANKA ASHOK LEYLAND', 1330, 603);

        // Yellow Windshield Route Sign ("पोखरा / POKHARA" at X: 1640..2030, Y: 555..650)
        ctx.fillStyle = '#c89d28';
        ctx.fillRect(1640, 555, 390, 95);
        ctx.strokeStyle = '#3b2808';
        ctx.lineWidth = 4;
        ctx.strokeRect(1640, 555, 390, 95);
        ctx.fillStyle = '#991b1b';
        ctx.font = 'bold 34px sans-serif';
        ctx.fillText(busConfig.routeSignDevanagari || 'पोखरा', 1835, 596);
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 28px serif';
        ctx.fillText('POKHARA', 1835, 636);

        // Front Bumper 3 Plaques (Y: 660..735): Left License Plate, Center Emblem Square, Right Devanagari Town Plaque
        // 1) Left License Plate (X: 1040..1420, Y: 660..735)
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(1040, 660, 380, 74);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 5;
        ctx.strokeRect(1044, 664, 372, 66);
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 38px "Arial Narrow", monospace';
        ctx.fillText(busConfig.plateNumberA || 'ग १ ख ९४९१', 1230, 711);

        // 2) Center Decorative Square Plaque (X: 1440..1610, Y: 656..738)
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(1440, 656, 170, 82);
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 4;
        ctx.strokeRect(1444, 660, 162, 74);
        ctx.fillStyle = '#1d4ed8';
        ctx.font = 'italic bold 22px serif';
        ctx.fillText('Gandaki', 1525, 696);
        ctx.fillText('Express', 1525, 722);

        // 3) Right Devanagari Plaque (X: 1630..2030, Y: 660..735)
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(1630, 660, 400, 74);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 5;
        ctx.strokeRect(1634, 664, 392, 66);
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 36px sans-serif';
        ctx.fillText('गण्डकी • पोखरा', 1830, 710);

        // ── BAND 3 (Y: 750..1024): INTERIOR TORN BLUE-GREEN SEAT VINYL (Left) & RIBBED RUBBER FLOOR MAT (Right) ──
        ctx.fillStyle = '#2b474b';
        ctx.fillRect(0, 750, 1024, 274);
        for (let i = 0; i < 120; i++) {
          ctx.fillStyle = i % 2 === 0 ? 'rgba(148, 136, 114, 0.36)' : 'rgba(16, 26, 28, 0.48)';
          ctx.fillRect((i * 53) % 990, 755 + ((i * 29) % 250), 18 + (i % 24), 12 + (i % 18));
        }
        // Exposed yellow foam gashes on torn seats
        ctx.fillStyle = '#8c7248';
        ctx.fillRect(180, 810, 22, 95);
        ctx.fillRect(640, 835, 28, 84);

        // Ribbed dark rubber floor mat (X: 1024..2048, Y: 750..1024)
        ctx.fillStyle = '#1c1e21';
        ctx.fillRect(1024, 750, 1024, 274);
        ctx.fillStyle = '#2d3136';
        for (let rx = 1032; rx < 2040; rx += 12) {
          ctx.fillRect(rx, 750, 5, 274);
        }
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      return tex;
    }

    // Dedicated Shattered Windshield & Broken Side Window Texture with Alpha Cutout Holes
    function createBusShatteredGlassTex() {
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 1024, 512);
        // Base dirty smoky glass fill
        ctx.fillStyle = 'rgba(44, 50, 56, 0.82)';
        ctx.fillRect(0, 0, 1024, 512);

        // Grime streaks & dust mottling on glass
        for (let i = 0; i < 180; i++) {
          ctx.fillStyle = i % 2 === 0 ? 'rgba(96, 88, 74, 0.34)' : 'rgba(18, 22, 26, 0.42)';
          ctx.fillRect((i * 47) % 1024, (i * 31) % 512, 16 + (i % 36), 24 + (i % 48));
        }

        // Left Windshield Pane (X: 0..320, Y: 0..512): Top "GANDAKI" Stencil + Bottom Sinhala/Nepali Stencil + Jagged Center Hole
        ctx.fillStyle = 'rgba(226, 232, 240, 0.86)';
        ctx.font = 'bold 48px "Arial Narrow", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('GANDAKI', 160, 74);
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText('गण्डकी विश्वविद्यालय - १२००', 160, 478);

        // Right Windshield Pane (X: 320..640, Y: 0..512): Top "UNIVERSITY" Stencil + Jagged Center Hole
        ctx.font = 'bold 46px "Arial Narrow", sans-serif';
        ctx.fillText('UNIVERSITY', 480, 74);

        // Punch out jagged shattered holes (alpha = 0) in Left Windshield, Right Windshield, and Broken Side Window Pane (X: 640..832)
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,1)';
        [
          // Left windshield jagged hole
          [[58, 130], [115, 108], [185, 122], [255, 112], [272, 210], [248, 340], [268, 420], [190, 438], [112, 425], [48, 390], [66, 260]],
          // Right windshield jagged hole
          [[368, 126], [440, 104], [528, 118], [595, 135], [582, 265], [602, 395], [535, 432], [445, 418], [362, 405], [380, 275]],
          // Broken side window pane hole (X: 640..832)
          [[675, 150], [735, 115], [798, 155], [812, 275], [785, 395], [720, 415], [668, 365], [658, 245]],
        ].forEach(poly => {
          ctx.beginPath();
          poly.forEach(([px, py], idx) => {
            if (idx === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.fill();
        });
        ctx.restore();

        // Draw bright fracture crack lines around the jagged hole perimeters
        ctx.strokeStyle = 'rgba(203, 213, 225, 0.75)';
        ctx.lineWidth = 2.5;
        [
          [[58, 130], [115, 108], [185, 122], [255, 112], [272, 210], [248, 340], [268, 420], [190, 438], [112, 425], [48, 390], [66, 260]],
          [[368, 126], [440, 104], [528, 118], [595, 135], [582, 265], [602, 395], [535, 432], [445, 418], [362, 405], [380, 275]],
          [[675, 150], [735, 115], [798, 155], [812, 275], [785, 395], [720, 415], [668, 365], [658, 245]],
        ].forEach(poly => {
          ctx.beginPath();
          poly.forEach(([px, py], idx) => {
            if (idx === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.stroke();
        });
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      return tex;
    }

    // Dedicated Alpha-Cutout Creeping Ivy Vines & Spongy Moss Texture (512x512)
    function createBusFoliageVineTex() {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 512, 512);
        // Top half (Y: 0..260): Dense moss mat with irregular organic lower fringe
        for (let i = 0; i < 420; i++) {
          const mx = (i * 37) % 512;
          const my = (i * 19) % 210;
          const mr = 8 + (i % 18);
          ctx.fillStyle = i % 3 === 0 ? '#2d4418' : (i % 3 === 1 ? '#3f5c22' : '#1e2f0f');
          ctx.beginPath();
          ctx.arc(mx, my, mr, 0, Math.PI * 2);
          ctx.fill();
        }
        // Hanging vine stems & pointed ivy/creeper leaves (Y: 40..500)
        for (let s = 0; s < 18; s++) {
          const baseX = 14 + s * 28;
          const maxLen = 220 + ((s * 67) % 260);
          ctx.strokeStyle = '#263814';
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.moveTo(baseX, 20);
          for (let y = 40; y <= maxLen; y += 24) {
            const sway = Math.sin(y * 0.04 + s) * 10;
            ctx.lineTo(baseX + sway, y);
          }
          ctx.stroke();

          // Pointed creeper leaves along each stem
          for (let y = 36; y <= maxLen; y += 16) {
            const sway = Math.sin(y * 0.04 + s) * 10;
            const lx = baseX + sway + ((y % 32 === 0) ? -9 : 9);
            const lw = 11 + ((s + y) % 9);
            const lh = 15 + ((s * 3 + y) % 10);
            ctx.fillStyle = (y + s) % 3 === 0 ? '#3a571f' : ((y + s) % 3 === 1 ? '#4d6b28' : '#243812');
            ctx.beginPath();
            ctx.ellipse(lx, y, lw * 0.55, lh * 0.55, ((y % 32 === 0) ? -0.45 : 0.45), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      return tex;
    }

    // Procedural Sheet-Metal Dent, Rivet & Rust-Pit Bump/Roughness Map (512x256)
    function createBusDentBumpTex() {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, 512, 256);
        // Vertical panel seams & raised rivet rows
        for (let x = 32; x < 512; x += 64) {
          ctx.fillStyle = '#383838';
          ctx.fillRect(x, 0, 2, 256);
          ctx.fillStyle = '#d8d8d8';
          for (let y = 8; y < 256; y += 14) {
            ctx.fillRect(x - 3, y, 2, 2);
            ctx.fillRect(x + 2, y, 2, 2);
          }
        }
        // Concave sheet-metal dents, impact creases & rust pitting
        for (let i = 0; i < 95; i++) {
          const dx = (i * 59) % 490;
          const dy = (i * 41) % 240;
          const dw = 10 + (i % 28);
          const dh = 6 + (i % 22);
          ctx.fillStyle = i % 2 === 0 ? 'rgba(28,28,28,0.55)' : 'rgba(215,215,215,0.45)';
          ctx.fillRect(dx, dy, dw, dh);
        }
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
      return tex;
    }

    const busMasterAtlasTex = createBusMasterAtlasTex();
    const busShatteredGlassTex = createBusShatteredGlassTex();
    const busFoliageVineTex = createBusFoliageVineTex();
    const busDentBumpTex = createBusDentBumpTex();

    // Shared Bus Materials (with real bump-mapped sheet-metal dents & rivets)
    const busExteriorPaintMat = new THREE.MeshStandardMaterial({
      color: 0xd8a63a,
      map: busMasterAtlasTex,
      bumpMap: busDentBumpTex,
      bumpScale: 0.046,
      roughness: 0.74,
      metalness: 0.22,
    });
    const busDarkTrimMat = new THREE.MeshStandardMaterial({
      color: 0x1a2028,
      bumpMap: busDentBumpTex,
      bumpScale: 0.025,
      roughness: 0.64,
      metalness: 0.42,
    });
    const busChromeTrimMat = new THREE.MeshStandardMaterial({
      color: 0xc8d2dc,
      roughness: 0.26,
      metalness: 0.84,
    });
    const busDirtyGlassMat = new THREE.MeshStandardMaterial({
      color: 0xdbe4ee,
      map: busShatteredGlassTex,
      roughness: 0.22,
      metalness: 0.18,
      transparent: true,
      alphaTest: 0.18,
      opacity: 0.86,
      side: THREE.DoubleSide,
    });
    const busMossVineMat = new THREE.MeshStandardMaterial({
      color: 0x84a955,
      map: busFoliageVineTex,
      bumpMap: busFoliageVineTex,
      bumpScale: 0.035,
      roughness: 0.92,
      metalness: 0.04,
      alphaTest: 0.24,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const busHeadlightEmissiveMat = new THREE.MeshStandardMaterial({
      color: 0xfff3c4,
      emissive: 0xf5b041,
      emissiveIntensity: 1.25,
      roughness: 0.20,
    });
    const busAmberIndicatorMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      emissive: 0xb45309,
      emissiveIntensity: 0.55,
      roughness: 0.32,
    });
    // Blinking Warm Amber & Blood-Red Horror Ceiling Tube Materials
    const busWarmTubeBaseMat = new THREE.MeshStandardMaterial({
      color: 0xffe4b5,
      emissive: 0xff9922,
      emissiveIntensity: 1.35,
      roughness: 0.25,
    });
    const busRedTubeBaseMat = new THREE.MeshStandardMaterial({
      color: 0xffb4b4,
      emissive: 0xff1e1e,
      emissiveIntensity: 1.45,
      roughness: 0.25,
    });
    const busWarmGlowBaseMat = new THREE.MeshBasicMaterial({
      color: 0xff9922,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const busRedGlowBaseMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const busDustMat = new THREE.PointsMaterial({
      color: 0xd97706,
      size: 0.048,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });

    const mergeBufferGeometries = THREE.BufferGeometryUtils.mergeBufferGeometries;

    function setGeoUVRect(geo, u0, v0, u1, v1) {
      const uvAttr = geo.attributes && geo.attributes.uv;
      if (!uvAttr) return geo;
      for (let i = 0; i < uvAttr.count; i++) {
        const u = uvAttr.getX(i);
        const v = uvAttr.getY(i);
        uvAttr.setXY(i, u0 + u * (u1 - u0), v0 + v * (v1 - v0));
      }
      uvAttr.needsUpdate = true;
      return geo;
    }

    function pushBusUvBoxGeo(targetArr, w, h, d, tx, ty, tz, rx = 0, ry = 0, rz = 0, u0 = 0.02, v0 = 0.28, u1 = 0.48, v1 = 0.56) {
      const g = new THREE.BoxGeometry(w, h, d).clone();
      setGeoUVRect(g, u0, v0, u1, v1);
      if (rx !== 0) g.rotateX(rx);
      if (ry !== 0) g.rotateY(ry);
      if (rz !== 0) g.rotateZ(rz);
      g.translate(tx, ty, tz);
      targetArr.push(g);
    }

    function pushBusBoxGeo(targetArr, w, h, d, tx, ty, tz, rx = 0, ry = 0, rz = 0) {
      pushBusUvBoxGeo(targetArr, w, h, d, tx, ty, tz, rx, ry, rz, 0.02, 0.28, 0.48, 0.56);
    }

    function pushBusCylGeo(targetArr, rTop, rBot, h, segs, tx, ty, tz, rx = 0, ry = 0, rz = 0, u0 = 0.05, v0 = 0.30, u1 = 0.45, v1 = 0.54) {
      const g = new THREE.CylinderGeometry(rTop, rBot, h, segs).clone();
      setGeoUVRect(g, u0, v0, u1, v1);
      if (rx !== 0) g.rotateX(rx);
      if (ry !== 0) g.rotateY(ry);
      if (rz !== 0) g.rotateZ(rz);
      g.translate(tx, ty, tz);
      targetArr.push(g);
    }

    // Shared geometries for instanced interior seats (facing -Z towards the front windshield & South Main Gate!)
    const sharedBusSeatBenchGeo = (function () {
      const seatParts = [];
      pushBusUvBoxGeo(seatParts, 0.78, 0.12, 0.44, 0, 0.40, 0, 0, 0, 0, 0.02, 0.02, 0.48, 0.24);
      pushBusUvBoxGeo(seatParts, 0.78, 0.52, 0.09, 0, 0.68, 0.18, 0, 0, 0, 0.02, 0.02, 0.48, 0.24);
      pushBusUvBoxGeo(seatParts, 0.76, 0.035, 0.035, 0, 0.96, 0.18, 0, 0, 0, 0.05, 0.05, 0.25, 0.15);
      pushBusUvBoxGeo(seatParts, 0.04, 0.36, 0.04, -0.34, 0.18, -0.14, 0, 0, 0, 0.05, 0.05, 0.25, 0.15);
      pushBusUvBoxGeo(seatParts, 0.04, 0.36, 0.04, 0.34, 0.18, -0.14, 0, 0, 0, 0.05, 0.05, 0.25, 0.15);
      return mergeBufferGeometries(seatParts);
    })();

    const sharedBusStanchionGeo = new THREE.CylinderGeometry(0.022, 0.022, 2.24, 6);

    const enterableBuses = [];
    window.__ENTERABLE_BUSES__ = enterableBuses;

    function buildEnterableUniversityBus(busSpec) {
      const {
        id,
        label,
        bx,
        bz,
        rotY = 0,
        mossAmount = 0.75,
        glassBreakage = 0.45,
        doorOpenAngle = 0.75,
        isBusB = false,
      } = busSpec;

      const bLen = busConfig.length || 10.5;
      const bWid = busConfig.width || 2.5;
      const bH = busConfig.height || 3.1;
      const halfL = bLen * 0.5; // 5.25
      const halfW = bWid * 0.5; // 1.25
      const floorY = busConfig.floorY || 0.54;

      // ORIENTATION: Front Fascia is at -Z (-halfL = -5.25), facing directly towards the South Main Gate (Z = -60)!
      // Passenger Door & Livery Side is at -X (-halfW = -1.25), facing West towards the Main Gate & Parking Plaza!
      // Front passenger door: z in [-3.95, -2.75] (center -3.35, right behind front cab)
      // Rear passenger door:  z in [+2.75, +3.95] (center +3.35, near rear tail)
      const fDoorMinZ = -3.95;
      const fDoorMaxZ = -2.75;
      const fDoorCenterZ = -3.35;
      const rDoorMinZ = 2.75;
      const rDoorMaxZ = 3.95;
      const rDoorCenterZ = 3.35;

      const busGroup = new THREE.Group();
      busGroup.name = id;
      busGroup.userData.noMerge = true;
      busGroup.position.set(bx, 0, bz);
      busGroup.rotation.y = rotY;

      // ── EXTERIOR MERGED GEOMETRY BUCKETS (8 draw calls total for exterior) ──
      const yellowGeos = [];
      const darkTrimGeos = [];
      const chromeGeos = [];
      const glassGeos = [];
      const headlightGeos = [];
      const amberGeos = [];
      const mossGeos = [];
      const vineGeos = [];

      // 1. Underbody Chassis Frame & Raised Floor Slab
      pushBusBoxGeo(darkTrimGeos, 2.02, 0.14, bLen - 0.16, 0.19, floorY - 0.07, 0);
      pushBusBoxGeo(darkTrimGeos, 0.42, 0.14, 5.46, -1.03, floorY - 0.07, 0);
      pushBusBoxGeo(darkTrimGeos, 0.42, 0.14, 1.22, -1.03, floorY - 0.07, -4.56);
      pushBusBoxGeo(darkTrimGeos, 0.42, 0.14, 1.22, -1.03, floorY - 0.07, 4.56);

      // 2. Smoothly Rounded Vertical Cab & Rear Corner Pillars (12-seg Cylinders eliminating sharp 90-degree box edges!)
      [[-halfW + 0.09, -halfL + 0.09], [halfW - 0.09, -halfL + 0.09], [-halfW + 0.09, halfL - 0.09], [halfW - 0.09, halfL - 0.09]].forEach(([cx, cz]) => {
        pushBusCylGeo(yellowGeos, 0.095, 0.095, 2.28, 12, cx, 1.68, cz, 0, 0, 0, 0.06, 0.32, 0.38, 0.54);
      });

      // 3. Deep Recessed Front & Rear Door Stepwells (2 low steps: y=0.18, y=0.36) + Curved Chrome Entry Grab Rails
      [fDoorCenterZ, rDoorCenterZ].forEach(dcz => {
        pushBusBoxGeo(darkTrimGeos, 0.24, 0.18, 1.14, -1.12, 0.09, dcz);
        pushBusBoxGeo(darkTrimGeos, 0.24, 0.36, 1.14, -0.92, 0.18, dcz);
        pushBusBoxGeo(darkTrimGeos, 0.46, 2.25, 0.05, -1.02, 1.14, dcz - 0.58);
        pushBusBoxGeo(darkTrimGeos, 0.46, 2.25, 0.05, -1.02, 1.14, dcz + 0.58);
        pushBusBoxGeo(darkTrimGeos, 0.09, 2.38, 0.06, -halfW + 0.02, 1.28, dcz - 0.58);
        pushBusBoxGeo(darkTrimGeos, 0.09, 2.38, 0.06, -halfW + 0.02, 1.28, dcz + 0.58);
        pushBusBoxGeo(darkTrimGeos, 0.09, 0.08, 1.22, -halfW + 0.02, 2.45, dcz);
        pushBusCylGeo(chromeGeos, 0.018, 0.018, 1.45, 8, -1.08, 1.18, dcz - 0.44, 0, 0, 0);
        pushBusCylGeo(chromeGeos, 0.018, 0.018, 0.38, 8, -0.96, 1.52, dcz - 0.44, 0, 0, -0.68);
      });

      // 4. Left Side Body (-X = -1.21, facing Plaza/Gate) with Exact Livery UV Mapping & Physical Sheet-Metal Dents
      // Center Waist Panel between Front Door (-2.75) and Rear Door (+2.75): "GANDAKI [Crest] UNIVERSITY" + Yellow Notice Board + BEECT
      pushBusUvBoxGeo(yellowGeos, 0.08, 1.16, 5.50, -halfW + 0.04, 1.12, 0.0, 0, 0, 0, 0.04, 0.59, 0.84, 0.99);
      // Front Cab Corner Waist Panel ahead of Front Door (z = -5.16 .. -3.95)
      pushBusUvBoxGeo(yellowGeos, 0.08, 1.16, 1.21, -halfW + 0.04, 1.12, -4.555, 0, 0, 0, 0.02, 0.30, 0.18, 0.55);
      // Rear Corner Waist Panel behind Rear Door (z = +3.95 .. +5.16, with Rear Yellow Placard)
      pushBusUvBoxGeo(yellowGeos, 0.08, 1.16, 1.21, -halfW + 0.04, 1.12, 4.555, 0, 0, 0, 0.84, 0.59, 0.98, 0.99);
      // Physical 3D dented/buckled lower access hatch door & dented skirt panel (tilted out slightly like aged sheet metal)
      pushBusUvBoxGeo(yellowGeos, 0.03, 0.46, 0.92, -halfW - 0.008, 0.84, -0.62, 0.03, 0.02, -0.04, 0.28, 0.62, 0.42, 0.82);
      pushBusUvBoxGeo(yellowGeos, 0.03, 0.42, 0.84, -halfW - 0.006, 0.82, 0.74, -0.025, -0.015, 0.03, 0.54, 0.62, 0.66, 0.82);
      // Upper Window Cant Rail & Header (y = 2.48..2.82)
      pushBusUvBoxGeo(yellowGeos, 0.08, 0.34, bLen - 0.12, -halfW + 0.04, 2.65, 0, 0, 0, 0, 0.02, 0.42, 0.48, 0.56);
      // White "GP62" Fleet Stencil Plaque above 3rd Side Window (z = -0.10, y = 2.66, matching photo)
      pushBusUvBoxGeo(yellowGeos, 0.025, 0.22, 0.48, -halfW - 0.006, 2.66, -0.12, 0, 0, 0, 0.90, 0.475, 0.99, 0.565);

      // 5. Right Side Body (+X = +1.21) with Full Livery UV Mapping
      pushBusUvBoxGeo(yellowGeos, 0.08, 1.16, bLen - 0.14, halfW - 0.04, 1.12, 0.0, 0, 0, 0, 0.02, 0.59, 0.98, 0.99);
      pushBusUvBoxGeo(yellowGeos, 0.08, 0.34, bLen - 0.12, halfW - 0.04, 2.65, 0.0, 0, 0, 0, 0.02, 0.42, 0.48, 0.56);

      // 6. Left & Right Sliding Window Bays with 3D Jagged Broken Glass Shards Sticking Out of Frames
      const leftPillars = [-5.12, -3.98, -2.72, -1.62, -0.52, 0.58, 1.68, 2.72, 3.98, 5.12];
      leftPillars.forEach(pz => {
        pushBusUvBoxGeo(yellowGeos, 0.09, 0.78, 0.10, -halfW + 0.04, 2.10, pz, 0, 0, 0, 0.10, 0.34, 0.22, 0.54);
      });
      const leftWinBays = [-4.55, -2.17, -1.07, 0.03, 1.13, 2.20, 4.55];
      leftWinBays.forEach((wz, idx) => {
        const bw = (idx === 0 || idx === 6) ? 1.02 : 1.00;
        pushBusBoxGeo(darkTrimGeos, 0.055, 0.04, bw, -halfW + 0.025, 2.46, wz);
        pushBusBoxGeo(darkTrimGeos, 0.055, 0.04, bw, -halfW + 0.025, 1.74, wz);
        pushBusBoxGeo(darkTrimGeos, 0.055, 0.032, bw, -halfW + 0.025, 2.30, wz); // upper transom bar
        pushBusBoxGeo(darkTrimGeos, 0.055, 0.72, 0.03, -halfW + 0.025, 2.10, wz); // center sliding mullion
        const isShatteredBay = isBusB ? (idx === 1 || idx === 2 || idx === 4) : (idx === 2 || idx === 3);
        const gu0 = isShatteredBay ? 0.63 : 0.82;
        const gu1 = isShatteredBay ? 0.81 : 0.98;
        pushBusUvBoxGeo(glassGeos, 0.018, 0.70, bw - 0.04, -halfW + 0.025, 2.10, wz, 0, 0, 0, gu0, 0.05, gu1, 0.95);
        if (isShatteredBay) {
          // 3D jagged glass shards jutting at angles around the broken window hole
          pushBusUvBoxGeo(glassGeos, 0.02, 0.22, 0.28, -halfW + 0.03, 2.24, wz - 0.22, 0.38, 0.06, 0, 0.82, 0.10, 0.95, 0.45);
          pushBusUvBoxGeo(glassGeos, 0.02, 0.19, 0.24, -halfW + 0.03, 1.90, wz + 0.20, -0.42, -0.05, 0, 0.82, 0.50, 0.95, 0.85);
        }
      });

      for (let i = 0; i <= 7; i++) {
        const pz = -4.90 + i * 1.40;
        pushBusUvBoxGeo(yellowGeos, 0.09, 0.78, 0.10, halfW - 0.04, 2.10, pz, 0, 0, 0, 0.10, 0.34, 0.22, 0.54);
        if (i < 7) {
          const wz = pz + 0.70;
          pushBusBoxGeo(darkTrimGeos, 0.055, 0.04, 1.28, halfW - 0.025, 2.46, wz);
          pushBusBoxGeo(darkTrimGeos, 0.055, 0.04, 1.28, halfW - 0.025, 1.74, wz);
          pushBusBoxGeo(darkTrimGeos, 0.055, 0.032, 1.28, halfW - 0.025, 2.30, wz);
          pushBusBoxGeo(darkTrimGeos, 0.055, 0.72, 0.03, halfW - 0.025, 2.10, wz);
          const isShatteredR = isBusB ? (i === 1 || i === 3 || i === 5) : (i === 2 || i === 4);
          pushBusUvBoxGeo(glassGeos, 0.018, 0.70, 1.24, halfW - 0.025, 2.10, wz, 0, 0, 0, isShatteredR ? 0.63 : 0.82, 0.05, isShatteredR ? 0.81 : 0.98, 0.95);
        }
      }

      // Bi-fold passenger doors folded inward inside doorways
      pushBusBoxGeo(darkTrimGeos, 0.045, 2.18, 0.48, -halfW + 0.14, 1.40, fDoorMinZ + 0.15, 0, -doorOpenAngle, 0);
      pushBusBoxGeo(darkTrimGeos, 0.045, 2.18, 0.48, -halfW + 0.14, 1.40, rDoorMaxZ - 0.15, 0, doorOpenAngle * 0.85, 0);

      // 7. Smoothly Curved 7-Strip Domed Roof + Cylindrical Cant-Rail Fillets & Sloped Front Destination Brow
      pushBusUvBoxGeo(yellowGeos, 1.28, 0.12, bLen - 0.28, 0, 3.06, 0, 0, 0, 0, 0.04, 0.44, 0.46, 0.56);
      pushBusUvBoxGeo(yellowGeos, 0.32, 0.12, bLen - 0.24, -0.76, 3.02, 0, 0, 0, 0.18, 0.04, 0.42, 0.46, 0.55);
      pushBusUvBoxGeo(yellowGeos, 0.32, 0.12, bLen - 0.24, 0.76, 3.02, 0, 0, 0, -0.18, 0.04, 0.42, 0.46, 0.55);
      pushBusUvBoxGeo(yellowGeos, 0.28, 0.12, bLen - 0.20, -1.00, 2.95, 0, 0, 0, 0.38, 0.04, 0.40, 0.46, 0.54);
      pushBusUvBoxGeo(yellowGeos, 0.28, 0.12, bLen - 0.20, 1.00, 2.95, 0, 0, 0, -0.38, 0.04, 0.40, 0.46, 0.54);
      // Smooth cylindrical roof cant-rail side curves along full bus length
      pushBusCylGeo(yellowGeos, 0.14, 0.14, bLen - 0.22, 12, -halfW + 0.13, 2.84, 0, Math.PI / 2, 0, 0, 0.04, 0.40, 0.46, 0.54);
      pushBusCylGeo(yellowGeos, 0.14, 0.14, bLen - 0.22, 12, halfW - 0.13, 2.84, 0, Math.PI / 2, 0, 0, 0.04, 0.40, 0.46, 0.54);
      // Smooth cylindrical front & rear roof crown domes
      pushBusCylGeo(yellowGeos, 0.18, 0.18, bWid - 0.24, 12, 0, 2.88, -halfL + 0.18, 0, 0, Math.PI / 2, 0.04, 0.40, 0.46, 0.54);
      pushBusCylGeo(yellowGeos, 0.18, 0.18, bWid - 0.24, 12, 0, 2.88, halfL - 0.18, 0, 0, Math.PI / 2, 0.04, 0.40, 0.46, 0.54);
      // Rain gutter molding along roof edge above windows
      pushBusBoxGeo(darkTrimGeos, 0.035, 0.03, bLen - 0.08, -halfW - 0.01, 2.81, 0);
      pushBusBoxGeo(darkTrimGeos, 0.035, 0.03, bLen - 0.08, halfW + 0.01, 2.81, 0);

      // Raised Front Destination Brow Housing at -Z (Facing South Main Gate!) & Recessed "GP62 | GANDAKI UNIVERSITY" Sign Board
      pushBusUvBoxGeo(yellowGeos, 2.16, 0.34, 0.32, 0, 2.94, -halfL + 0.16, -0.10, 0, 0, 0.05, 0.38, 0.45, 0.55);
      // Rounded side bolsters of the destination housing
      pushBusCylGeo(yellowGeos, 0.15, 0.15, 0.32, 10, -0.96, 2.93, -halfL + 0.16, Math.PI / 2, 0, 0, 0.05, 0.38, 0.45, 0.55);
      pushBusCylGeo(yellowGeos, 0.15, 0.15, 0.32, 10, 0.96, 2.93, -halfL + 0.16, Math.PI / 2, 0, 0, 0.05, 0.38, 0.45, 0.55);
      // Chrome bezel & recessed Destination Board face at -Z
      pushBusBoxGeo(chromeGeos, 1.84, 0.29, 0.04, 0, 2.93, -halfL + 0.005, -0.08, 0, 0);
      pushBusUvBoxGeo(yellowGeos, 1.78, 0.24, 0.045, 0, 2.93, -halfL - 0.002, -0.08, 0, 0, 0.508, 0.468, 0.888, 0.570);

      // 8. Front Fascia at -Z (lz = -5.20, Facing South Main Gate): Split Windshield, Wipers, Ribbed Chrome Trim, "LANKA ASHOK LEYLAND", T-Grille, 4 Round Headlights, Dented Bumper & 3 Plaques
      pushBusUvBoxGeo(yellowGeos, bWid - 0.08, 1.14, 0.10, 0, 1.15, -halfL + 0.05, 0, 0, 0, 0.04, 0.28, 0.46, 0.55);
      // Windshield A-pillars, center divider bar, and upper header
      pushBusUvBoxGeo(yellowGeos, 0.10, 0.86, 0.10, 0, 2.15, -halfL + 0.04, 0, 0, 0, 0.12, 0.35, 0.22, 0.54);
      pushBusUvBoxGeo(yellowGeos, 0.14, 0.86, 0.10, -halfW + 0.07, 2.15, -halfL + 0.04, 0, 0, 0, 0.12, 0.35, 0.22, 0.54);
      pushBusUvBoxGeo(yellowGeos, 0.14, 0.86, 0.10, halfW - 0.07, 2.15, -halfL + 0.04, 0, 0, 0, 0.12, 0.35, 0.22, 0.54);
      pushBusUvBoxGeo(yellowGeos, bWid - 0.06, 0.24, 0.12, 0, 2.68, -halfL + 0.05, 0, 0, 0, 0.04, 0.40, 0.46, 0.55);

      // Black rubber gasket frames around Left (-X) & Right (+X) Windshields
      [-0.57, 0.57].forEach(wx => {
        pushBusBoxGeo(darkTrimGeos, 1.02, 0.045, 0.04, wx, 2.54, -halfL - 0.005);
        pushBusBoxGeo(darkTrimGeos, 1.02, 0.045, 0.04, wx, 1.76, -halfL - 0.005);
        pushBusBoxGeo(darkTrimGeos, 0.045, 0.80, 0.04, wx - 0.49, 2.15, -halfL - 0.005);
        pushBusBoxGeo(darkTrimGeos, 0.045, 0.80, 0.04, wx + 0.49, 2.15, -halfL - 0.005);
      });
      // Left Windshield Glass ("GANDAKI" + shattered hole) & Right Windshield Glass ("UNIVERSITY" + shattered hole)
      pushBusUvBoxGeo(glassGeos, 0.96, 0.74, 0.018, -0.57, 2.15, -halfL + 0.01, 0, 0, 0, 0.0, 0.0, 0.3125, 1.0);
      pushBusUvBoxGeo(glassGeos, 0.96, 0.74, 0.018, 0.57, 2.15, -halfL + 0.01, 0, 0, 0, 0.3125, 0.0, 0.625, 1.0);
      // 3D Jagged Shattered Glass Shards jutting from the broken windshield edges
      pushBusUvBoxGeo(glassGeos, 0.22, 0.18, 0.02, -0.82, 2.32, -halfL + 0.015, 0.08, 0.12, -0.38, 0.82, 0.15, 0.96, 0.45);
      pushBusUvBoxGeo(glassGeos, 0.24, 0.16, 0.02, -0.28, 1.92, -halfL + 0.015, -0.06, -0.10, 0.42, 0.82, 0.50, 0.96, 0.82);
      pushBusUvBoxGeo(glassGeos, 0.25, 0.19, 0.02, 0.32, 2.34, -halfL + 0.015, 0.08, -0.12, 0.35, 0.82, 0.15, 0.96, 0.45);
      pushBusUvBoxGeo(glassGeos, 0.22, 0.17, 0.02, 0.84, 2.02, -halfL + 0.015, -0.05, 0.10, -0.44, 0.82, 0.50, 0.96, 0.82);
      // Yellow Route Placard ("पोखरा / POKHARA") tucked inside bottom-right windshield corner
      pushBusUvBoxGeo(yellowGeos, 0.38, 0.17, 0.015, 0.52, 1.88, -halfL + 0.025, 0.06, 0, 0, 0.801, 0.365, 0.991, 0.458);

      // 2 Articulated Black Windshield Wipers (one slightly bent/crooked for horror realism)
      [-0.56, 0.56].forEach((wpx, wIdx) => {
        const tilt = wIdx === 0 ? -0.14 : 0.05;
        pushBusBoxGeo(darkTrimGeos, 0.03, 0.03, 0.05, wpx - 0.12, 1.75, -halfL - 0.025);
        pushBusBoxGeo(darkTrimGeos, 0.46, 0.018, 0.02, wpx + 0.04, 1.83, -halfL - 0.025, 0, 0, 0.24 + tilt);
        pushBusBoxGeo(darkTrimGeos, 0.48, 0.022, 0.02, wpx + 0.10, 1.88, -halfL - 0.03, 0, 0, 0.05 + tilt);
      });

      // 3-Ribbed Brushed Chrome Beltline Molding across Front & Sides (y = 1.63..1.73)
      pushBusBoxGeo(darkTrimGeos, bWid + 0.03, 0.11, 0.03, 0, 1.68, -halfL - 0.008);
      [1.715, 1.68, 1.645].forEach(cy => {
        pushBusBoxGeo(chromeGeos, bWid + 0.045, 0.022, 0.04, 0, cy, -halfL - 0.014);
        pushBusBoxGeo(chromeGeos, 0.035, 0.022, 1.24, -halfW - 0.008, cy, -4.56);
        pushBusBoxGeo(chromeGeos, 0.035, 0.022, 5.50, -halfW - 0.008, cy, 0.0);
        pushBusBoxGeo(chromeGeos, 0.035, 0.022, 1.24, -halfW - 0.008, cy, 4.56);
        pushBusBoxGeo(chromeGeos, 0.035, 0.022, bLen - 0.04, halfW + 0.008, cy, 0.0);
      });

      // "LANKA ASHOK LEYLAND" Front Badge Plate centered below chrome molding
      pushBusUvBoxGeo(yellowGeos, 0.86, 0.095, 0.035, 0, 1.54, -halfL - 0.012, 0, 0, 0, 0.508, 0.390, 0.791, 0.453);

      // 3-Part Recessed Black Slatted Front Grille (Left bay, Stepped T-shaped Center bay, Right bay)
      [-0.78, 0.78].forEach(gx => {
        pushBusBoxGeo(darkTrimGeos, 0.66, 0.38, 0.045, gx, 1.26, -halfL - 0.008);
        for (let s = 0; s < 8; s++) {
          pushBusBoxGeo(chromeGeos, 0.60, 0.014, 0.055, gx, 1.11 + s * 0.042, -halfL - 0.012);
        }
      });
      pushBusBoxGeo(darkTrimGeos, 0.82, 0.38, 0.05, 0, 1.26, -halfL - 0.01);
      pushBusBoxGeo(darkTrimGeos, 0.72, 0.24, 0.05, 0, 1.02, -halfL - 0.01);
      for (let s = 0; s < 12; s++) {
        const sy = 0.93 + s * 0.042;
        const sw = sy < 1.10 ? 0.66 : 0.76;
        pushBusBoxGeo(chromeGeos, sw, 0.015, 0.06, 0, sy, -halfL - 0.015);
      }

      // Recessed Dual Headlight Pockets + 4 Round Headlights with Chrome Bezels + Corner Amber Turn Signals
      [-0.78, 0.78].forEach(px => {
        pushBusBoxGeo(darkTrimGeos, 0.62, 0.26, 0.035, px, 0.82, -halfL - 0.006);
      });
      [-0.91, -0.65, 0.65, 0.91].forEach(hlx => {
        pushBusCylGeo(chromeGeos, 0.088, 0.088, 0.045, 16, hlx, 0.82, -halfL - 0.018, Math.PI / 2, 0, 0);
        pushBusCylGeo(headlightGeos, 0.072, 0.072, 0.052, 16, hlx, 0.82, -halfL - 0.022, Math.PI / 2, 0, 0);
      });
      [-1.14, 1.14].forEach(ax => {
        pushBusBoxGeo(amberGeos, 0.075, 0.16, 0.04, ax, 0.82, -halfL - 0.015);
        pushBusBoxGeo(amberGeos, 0.05, 0.08, 0.04, ax, 2.66, -halfL - 0.015);
      });

      // Heavy Black Steel Front Bumper (with slight impact dent/tilt on corner) + 3 Authentic Plaques
      pushBusBoxGeo(darkTrimGeos, bWid + 0.10, 0.26, 0.24, 0, 0.48, -halfL - 0.09, 0, 0, -0.008);
      // Left License Plate (slightly bent/tilted for weathered realism)
      pushBusUvBoxGeo(yellowGeos, 0.54, 0.13, 0.025, -0.58, 0.48, -halfL - 0.21, 0, 0, -0.045, 0.508, 0.282, 0.693, 0.355);
      // Center Square Decorative Emblem Plaque
      pushBusUvBoxGeo(yellowGeos, 0.24, 0.16, 0.028, 0.0, 0.48, -halfL - 0.212, 0, 0, 0.015, 0.703, 0.279, 0.786, 0.359);
      // Right Devanagari Town Plaque
      pushBusUvBoxGeo(yellowGeos, 0.54, 0.13, 0.025, 0.58, 0.48, -halfL - 0.21, 0, 0, 0.025, 0.796, 0.282, 0.991, 0.355);

      // Cantilevered Side Mirrors on Cab Corners (-Z front)
      [-1, 1].forEach(ms => {
        pushBusBoxGeo(darkTrimGeos, 0.22, 0.028, 0.028, ms * (halfW + 0.09), 2.38, -halfL + 0.22);
        pushBusBoxGeo(darkTrimGeos, 0.22, 0.028, 0.028, ms * (halfW + 0.09), 1.98, -halfL + 0.22);
        pushBusBoxGeo(darkTrimGeos, 0.025, 0.42, 0.025, ms * (halfW + 0.19), 2.18, -halfL + 0.22);
        pushBusBoxGeo(darkTrimGeos, 0.07, 0.34, 0.15, ms * (halfW + 0.19), 2.18, -halfL + 0.22);
      });

      // 9. Rear Face at +Z (lz = +5.20)
      pushBusUvBoxGeo(yellowGeos, bWid - 0.08, 1.18, 0.10, 0, 1.13, halfL - 0.05, 0, 0, 0, 0.04, 0.28, 0.46, 0.55);
      pushBusUvBoxGeo(yellowGeos, 0.16, 0.82, 0.10, 0, 2.12, halfL - 0.05, 0, 0, 0, 0.10, 0.35, 0.22, 0.54);
      pushBusUvBoxGeo(yellowGeos, 0.22, 0.82, 0.10, -halfW + 0.11, 2.12, halfL - 0.05, 0, 0, 0, 0.10, 0.35, 0.22, 0.54);
      pushBusUvBoxGeo(yellowGeos, 0.22, 0.82, 0.10, halfW - 0.11, 2.12, halfL - 0.05, 0, 0, 0, 0.10, 0.35, 0.22, 0.54);
      pushBusUvBoxGeo(yellowGeos, bWid - 0.06, 0.42, 0.12, 0, 2.74, halfL - 0.05, 0, 0, 0, 0.04, 0.40, 0.46, 0.55);
      pushBusBoxGeo(darkTrimGeos, bWid + 0.06, 0.24, 0.20, 0, 0.50, halfL + 0.06);
      pushBusUvBoxGeo(glassGeos, 0.88, 0.68, 0.02, -0.54, 2.12, halfL - 0.03, 0, 0, 0, 0.82, 0.10, 0.98, 0.90);
      pushBusUvBoxGeo(glassGeos, 0.88, 0.68, 0.02, 0.54, 2.12, halfL - 0.03, 0, 0, 0, 0.63, 0.10, 0.81, 0.90);

      // 10. 3-Bar Tubular Side Underrun Skirt Guard Rail & Detailed 6-Lug Artillery Wheels with Curved Cylindrical Wheel Arch Flares
      [-halfW - 0.02, halfW + 0.02].forEach(sx => {
        [0.43, 0.33, 0.23].forEach(ry => {
          pushBusBoxGeo(darkTrimGeos, 0.028, 0.032, 2.62, sx, ry, 0.0);
        });
        [-1.18, -0.40, 0.40, 1.18].forEach(sz => {
          pushBusBoxGeo(darkTrimGeos, 0.03, 0.32, 0.038, sx, 0.36, sz);
        });
      });

      [-1.95, 1.95].forEach(az => {
        pushBusCylGeo(darkTrimGeos, 0.07, 0.07, bWid - 0.12, 8, 0, 0.49, az, 0, 0, Math.PI / 2);
        [-halfW + 0.06, halfW - 0.06].forEach(wx => {
          const signX = wx < 0 ? -1 : 1;
          // Smooth curved cylindrical wheel arch flare (7 segments forming a true curved arch over the tyre)
          for (let aSeg = 0; aSeg < 7; aSeg++) {
            const ang = -1.15 + (aSeg / 6) * 2.30;
            const archR = 0.58;
            pushBusBoxGeo(
              darkTrimGeos,
              0.14,
              0.06,
              0.24,
              wx + signX * 0.04,
              0.49 + Math.cos(ang) * archR,
              az + Math.sin(ang) * archR,
              ang,
              0,
              0
            );
          }
          pushBusBoxGeo(darkTrimGeos, 0.12, 0.46, 0.04, wx + signX * 0.03, 0.50, az + 0.58); // rear mudflap
          pushBusCylGeo(darkTrimGeos, 0.49, 0.49, 0.36, 18, wx, 0.49, az, 0, 0, Math.PI / 2);
          pushBusCylGeo(darkTrimGeos, 0.29, 0.29, 0.375, 14, wx, 0.49, az, 0, 0, Math.PI / 2);
          pushBusCylGeo(chromeGeos, 0.11, 0.13, 0.41, 12, wx + signX * 0.02, 0.49, az, 0, 0, Math.PI / 2);
          for (let lb = 0; lb < 6; lb++) {
            const lang = (lb * Math.PI * 2) / 6;
            pushBusCylGeo(
              chromeGeos,
              0.022,
              0.022,
              0.39,
              6,
              wx + signX * 0.01,
              0.49 + Math.sin(lang) * 0.19,
              az + Math.cos(lang) * 0.19,
              0,
              0,
              Math.PI / 2
            );
          }
        });
      });

      // 11. Lush 3D Overgrown Moss Cushions & Layered Hanging Leafy Vine Curtains (Facing -Z Gate & -X Plaza)
      const mossPads = [
        [1.15, 0.09, 0.65, -0.48, 3.12, -halfL + 0.24, -0.12, 0, 0.08],
        [0.95, 0.07, 0.52, 0.38, 3.11, -halfL + 0.22, -0.10, 0, -0.05],
        [0.85, 0.10, 2.45, -0.82, 3.03, -1.65, 0, 0, 0.22],
        [0.85, 0.10, 2.65, -0.82, 3.03, 2.15, 0, 0, 0.22],
        [0.85, 0.09, 2.35, 0.82, 3.03, -0.85, 0, 0, -0.22],
        [0.85, 0.09, 2.35, 0.82, 3.03, 2.45, 0, 0, -0.22],
        [1.12, 0.07, 0.14, -0.56, 1.74, -halfL - 0.025, -0.15, 0, 0],
        [0.92, 0.07, 0.14, 0.54, 1.74, -halfL - 0.025, -0.15, 0, 0],
        [0.65, 0.04, 0.18, -0.62, 0.61, -halfL - 0.10, 0, 0, 0],
        [0.58, 0.04, 0.18, 0.58, 0.61, -halfL - 0.10, 0, 0, 0],
        [0.22, 0.03, 0.92, -1.12, 0.19, fDoorCenterZ, 0, 0, 0],
        [0.22, 0.03, 0.88, -1.12, 0.19, rDoorCenterZ, 0, 0, 0],
        [0.05, 0.14, 0.85, -halfW - 0.015, 1.72, -0.55, 0, 0, 0],
        [0.05, 0.14, 0.75, -halfW - 0.015, 1.72, 1.25, 0, 0, 0],
      ];
      mossPads.forEach(([mw, mh, md, mx, my, mz, mrx, mry, mrz]) => {
        pushBusUvBoxGeo(mossGeos, mw, mh, md, mx, my, mz, mrx, mry, mrz, 0.05, 0.55, 0.95, 0.98);
      });

      const vineCurtains = [
        // Front brow vine curtains draping over "GP62" and upper-left "GANDAKI" windshield (-Z front)
        [0.88, 0.68, 0.02, -0.62, 2.76, -halfL - 0.04, 0.06, 0, 0.04],
        [0.64, 0.54, 0.02, -0.82, 2.64, -halfL - 0.045, 0.08, -0.12, 0.08],
        // Windshield sill vines hanging down over "LANKA ASHOK LEYLAND" & grille
        [0.52, 0.56, 0.02, 0.44, 1.50, -halfL - 0.045, 0.04, 0, -0.04],
        [0.68, 0.36, 0.02, -0.58, 1.58, -halfL - 0.045, 0.04, 0, 0.02],
        // Cascading vine curtains over 1st & 2nd left side windows (behind front door, z = -1.68, -1.45)
        [0.02, 0.96, 1.48, -halfW - 0.032, 2.48, -1.68, 0, 0, -0.07],
        [0.02, 0.78, 1.15, -halfW - 0.048, 2.56, -1.45, 0, -0.08, -0.11],
        // Cascading vine curtains over 4th & 5th left side windows & rear door brow (z = +2.05, +4.25)
        [0.02, 0.88, 1.52, -halfW - 0.032, 2.52, 2.05, 0, 0, -0.07],
        [0.02, 0.82, 1.18, -halfW - 0.035, 2.50, 4.25, 0, 0, -0.06],
        // Right side roof-edge vine curtains
        [0.02, 0.86, 1.55, halfW + 0.032, 2.52, -1.20, 0, 0, 0.07],
        [0.02, 0.84, 1.45, halfW + 0.032, 2.52, 2.20, 0, 0, 0.07],
      ];
      vineCurtains.forEach(([vw, vh, vd, vx, vy, vz, vrx, vry, vrz]) => {
        pushBusUvBoxGeo(vineGeos, vw, vh, vd, vx, vy, vz, vrx, vry, vrz, 0.02, 0.02, 0.98, 0.96);
      });

      const extBodyMesh = new THREE.Mesh(mergeBufferGeometries(yellowGeos), busExteriorPaintMat);
      extBodyMesh.castShadow = true;
      extBodyMesh.receiveShadow = true;
      extBodyMesh.userData.noMerge = true;
      busGroup.add(extBodyMesh);

      const extDarkMesh = new THREE.Mesh(mergeBufferGeometries(darkTrimGeos), busDarkTrimMat);
      extDarkMesh.castShadow = true;
      extDarkMesh.receiveShadow = true;
      extDarkMesh.userData.noMerge = true;
      busGroup.add(extDarkMesh);

      const extChromeMesh = new THREE.Mesh(mergeBufferGeometries(chromeGeos), busChromeTrimMat);
      extChromeMesh.userData.noMerge = true;
      busGroup.add(extChromeMesh);

      const extGlassMesh = new THREE.Mesh(mergeBufferGeometries(glassGeos), busDirtyGlassMat);
      extGlassMesh.userData.noMerge = true;
      busGroup.add(extGlassMesh);

      const extHeadlightMesh = new THREE.Mesh(mergeBufferGeometries(headlightGeos), busHeadlightEmissiveMat);
      extHeadlightMesh.userData.noMerge = true;
      busGroup.add(extHeadlightMesh);

      const extAmberMesh = new THREE.Mesh(mergeBufferGeometries(amberGeos), busAmberIndicatorMat);
      extAmberMesh.userData.noMerge = true;
      busGroup.add(extAmberMesh);

      const extMossMesh = new THREE.Mesh(mergeBufferGeometries(mossGeos), busMossVineMat);
      extMossMesh.userData.noMerge = true;
      busGroup.add(extMossMesh);

      const vineGroup = new THREE.Group();
      vineGroup.name = id + '_vines';
      vineGroup.userData.noMerge = true;
      if (vineGeos.length > 0) {
        const vineMesh = new THREE.Mesh(mergeBufferGeometries(vineGeos), busMossVineMat);
        vineMesh.userData.noMerge = true;
        vineGroup.add(vineMesh);
      }
      vineGroup.visible = true;
      busGroup.add(vineGroup);

      // ── WALK-IN INTERIOR GROUP (Distance-culled at 25m, Instanced Seats & Poles, Blinking Warm + Red Horror Tubes) ──
      const interiorGroup = new THREE.Group();
      interiorGroup.name = id + '_interior';
      interiorGroup.userData.noMerge = true;
      busGroup.add(interiorGroup);

      const intStructGeos = [];
      const intTrimGeos = [];

      // Ribbed rubber floor mat
      pushBusUvBoxGeo(intStructGeos, bWid - 0.22, 0.03, bLen - 0.28, 0.04, floorY + 0.015, 0, 0, 0, 0, 0.52, 0.02, 0.98, 0.24);
      // Front dashboard console, instrument cluster, steering column & wheel, driver seat & partition at -Z (facing South Gate!)
      pushBusBoxGeo(intTrimGeos, 1.48, 0.72, 0.54, 0.40, floorY + 0.36, -4.76);
      pushBusBoxGeo(intTrimGeos, 0.56, 0.18, 0.28, 0.62, floorY + 0.80, -4.72);
      pushBusCylGeo(intTrimGeos, 0.03, 0.03, 0.62, 6, 0.62, floorY + 0.74, -4.46, 0.45, 0, 0);
      pushBusCylGeo(intTrimGeos, 0.24, 0.24, 0.035, 10, 0.62, floorY + 0.98, -4.34, -1.12, 0, 0);
      pushBusBoxGeo(intTrimGeos, 0.56, 0.42, 0.52, 0.62, floorY + 0.24, -3.88);
      pushBusBoxGeo(intTrimGeos, 0.56, 0.58, 0.10, 0.62, floorY + 0.68, -3.66);
      pushBusBoxGeo(intTrimGeos, 0.76, 1.35, 0.04, 0.72, floorY + 0.68, -3.42);
      // Rear full-width bench at +Z (z = +4.76..+4.96)
      pushBusUvBoxGeo(intStructGeos, bWid - 0.28, 0.42, 0.56, 0, floorY + 0.24, 4.76, 0, 0, 0, 0.02, 0.02, 0.48, 0.24);
      pushBusUvBoxGeo(intStructGeos, bWid - 0.28, 0.54, 0.12, 0, floorY + 0.68, 4.96, 0, 0, 0, 0.02, 0.02, 0.48, 0.24);
      // 2 longitudinal overhead handrails + hanging grab straps
      pushBusCylGeo(intTrimGeos, 0.018, 0.018, 8.6, 6, -0.42, floorY + 2.18, 0, Math.PI / 2, 0, 0);
      pushBusCylGeo(intTrimGeos, 0.018, 0.018, 8.6, 6, 0.42, floorY + 2.18, 0, Math.PI / 2, 0, 0);

      const intFloorAndRearMesh = new THREE.Mesh(mergeBufferGeometries(intStructGeos), busExteriorPaintMat);
      intFloorAndRearMesh.receiveShadow = true;
      intFloorAndRearMesh.userData.noMerge = true;
      interiorGroup.add(intFloorAndRearMesh);

      const intCabMesh = new THREE.Mesh(mergeBufferGeometries(intTrimGeos), busDarkTrimMat);
      intCabMesh.userData.noMerge = true;
      interiorGroup.add(intCabMesh);

      // Instanced Passenger Bench Seats (5 left + 6 right = 11 benches facing -Z Front)
      const leftSeatZs = [-2.10, -1.05, 0.0, 1.05, 2.10];
      const rightSeatZs = [-2.10, -1.05, 0.0, 1.05, 2.10, 3.15];
      const totalSeats = leftSeatZs.length + rightSeatZs.length;
      const seatInstMesh = new THREE.InstancedMesh(sharedBusSeatBenchGeo, busExteriorPaintMat, totalSeats);
      seatInstMesh.castShadow = true;
      seatInstMesh.receiveShadow = true;
      seatInstMesh.userData.noMerge = true;
      const dummyMat = new THREE.Matrix4();
      const dummyPos = new THREE.Vector3();
      const dummyQuat = new THREE.Quaternion();
      const dummyScale = new THREE.Vector3(1, 1, 1);
      let seatIdx = 0;
      leftSeatZs.forEach((sz, idx) => {
        dummyPos.set(-0.78, floorY, sz);
        dummyQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (idx % 2 === 0 ? 0.025 : -0.03));
        dummyMat.compose(dummyPos, dummyQuat, dummyScale);
        seatInstMesh.setMatrixAt(seatIdx++, dummyMat);
      });
      rightSeatZs.forEach((sz, idx) => {
        dummyPos.set(0.78, floorY, sz);
        dummyQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (idx % 2 === 0 ? -0.025 : 0.03));
        dummyMat.compose(dummyPos, dummyQuat, dummyScale);
        seatInstMesh.setMatrixAt(seatIdx++, dummyMat);
      });
      seatInstMesh.instanceMatrix.needsUpdate = true;
      interiorGroup.add(seatInstMesh);

      // Instanced Vertical Handrail Stanchion Poles (8 poles, 1 draw call)
      const poleCoords = [
        [-0.41, -2.65],
        [-0.41, -0.52],
        [-0.41, 1.58],
        [-0.41, 2.65],
        [0.41, -3.35],
        [0.41, -1.05],
        [0.41, 1.05],
        [0.41, 3.15],
      ];
      const poleInstMesh = new THREE.InstancedMesh(sharedBusStanchionGeo, busChromeTrimMat, poleCoords.length);
      poleInstMesh.userData.noMerge = true;
      poleCoords.forEach(([px, pz], idx) => {
        dummyPos.set(px, floorY + 1.12, pz);
        dummyQuat.identity();
        dummyMat.compose(dummyPos, dummyQuat, dummyScale);
        poleInstMesh.setMatrixAt(idx, dummyMat);
      });
      poleInstMesh.instanceMatrix.needsUpdate = true;
      interiorGroup.add(poleInstMesh);

      // ── BLINKING WARM AMBER & BLOOD-RED HORROR CEILING TUBE LIGHTS + VOLUMETRIC CABIN GLOW POOLS ──
      // 1) Front/Mid Warm Amber Dying Fluorescent Tube (z = -1.75m)
      const warmTubeGeo = new THREE.BoxGeometry(0.16, 0.045, 3.6);
      const warmTubeMat = busWarmTubeBaseMat.clone();
      const warmTubeMesh = new THREE.Mesh(warmTubeGeo, warmTubeMat);
      warmTubeMesh.position.set(0, floorY + 2.31, -1.75);
      warmTubeMesh.userData.noMerge = true;
      interiorGroup.add(warmTubeMesh);

      // 2) Rear/Mid Blood-Red Horror Emergency Tube (z = +1.85m)
      const redTubeGeo = new THREE.BoxGeometry(0.16, 0.045, 3.6);
      const redTubeMat = busRedTubeBaseMat.clone();
      const redTubeMesh = new THREE.Mesh(redTubeGeo, redTubeMat);
      redTubeMesh.position.set(0, floorY + 2.31, 1.85);
      redTubeMesh.userData.noMerge = true;
      interiorGroup.add(redTubeMesh);

      // 3) Warm Amber & Blood-Red Volumetric Cabin Light-Spill Pools (pulsing in sync with ceiling tubes)
      const warmGlowMat = busWarmGlowBaseMat.clone();
      const warmGlowParts = [];
      pushBusBoxGeo(warmGlowParts, 1.95, 0.02, 4.2, 0, floorY + 0.04, -1.75);
      pushBusBoxGeo(warmGlowParts, 1.55, 1.85, 0.02, 0, floorY + 1.25, -1.75, 0, 0.35, 0);
      const warmGlowMesh = new THREE.Mesh(mergeBufferGeometries(warmGlowParts), warmGlowMat);
      warmGlowMesh.userData.noMerge = true;
      interiorGroup.add(warmGlowMesh);

      const redGlowMat = busRedGlowBaseMat.clone();
      const redGlowParts = [];
      pushBusBoxGeo(redGlowParts, 1.95, 0.02, 4.2, 0, floorY + 0.04, 1.85);
      pushBusBoxGeo(redGlowParts, 1.55, 1.85, 0.02, 0, floorY + 1.25, 1.85, 0, -0.35, 0);
      const redGlowMesh = new THREE.Mesh(mergeBufferGeometries(redGlowParts), redGlowMat);
      redGlowMesh.userData.noMerge = true;
      interiorGroup.add(redGlowMesh);

      // Interior Props (scattered papers, broken glass shards on floor, old bag, fallen cushion in Bus B) + Dust Motes
      const propsGroup = new THREE.Group();
      propsGroup.name = id + '_props';
      propsGroup.userData.noMerge = true;
      const propGeos = [];
      [[-0.12, 0.02, -1.4, 0.3], [0.18, 0.02, 0.65, -0.4], [-0.05, 0.02, 2.45, 0.15], [0.68, 0.44, -1.05, 0.5]].forEach(([px, py, pz, pr]) => {
        pushBusUvBoxGeo(propGeos, 0.24, 0.008, 0.32, px, floorY + py, pz, 0, pr, 0, 0.02, 0.02, 0.48, 0.24);
      });
      pushBusUvBoxGeo(propGeos, 0.34, 0.28, 0.24, -0.74, floorY + 0.56, 1.05, 0.12, 0.35, 0, 0.02, 0.02, 0.48, 0.24);
      if (isBusB) {
        pushBusUvBoxGeo(propGeos, 0.68, 0.06, 0.38, 0.02, floorY + 0.03, 2.85, 0, 0.18, 0, 0.02, 0.02, 0.48, 0.24);
      }
      const propsMesh = new THREE.Mesh(mergeBufferGeometries(propGeos), busExteriorPaintMat);
      propsMesh.userData.noMerge = true;
      propsGroup.add(propsMesh);

      const dustCount = 28;
      const dustPositions = new Float32Array(dustCount * 3);
      for (let d = 0; d < dustCount; d++) {
        dustPositions[d * 3] = -0.95 + ((d * 0.37) % 1.9);
        dustPositions[d * 3 + 1] = floorY + 0.35 + ((d * 0.29) % 1.85);
        dustPositions[d * 3 + 2] = -4.2 + ((d * 0.61) % 8.4);
      }
      const dustGeo = new THREE.BufferGeometry();
      dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
      const dustPoints = new THREE.Points(dustGeo, busDustMat);
      dustPoints.userData.noMerge = true;
      propsGroup.add(dustPoints);
      propsGroup.visible = (typeof currentQuality === 'string' ? currentQuality !== 'fast' : true);
      interiorGroup.add(propsGroup);

      scene.add(busGroup);

      // Soft Ground Contact Shadow
      const bShadow = new THREE.Mesh(new THREE.PlaneGeometry(bWid + 0.85, bLen + 0.85), materials.vehicleShadow);
      bShadow.rotation.x = -Math.PI / 2;
      bShadow.position.set(bx, 0.022, bz);
      bShadow.rotation.z = -rotY;
      bShadow.userData.noMerge = true;
      scene.add(bShadow);

      // ── STEP 4: ORIENTED BOUNDING BOX (OBB) COLLIDERS, WALKABLE FLOORS, STAIR RAMPS & ROOF CEILING ──
      // 1. Walkable Interior Cabin Floor (y = 0.54m) & 2 Entry Door Step Ramps (0.0m -> 0.54m)
      addOrientedWalkableFloor(bx, bz, rotY, 0.06, 0.0, 2.22, bLen - 0.16, floorY);
      addOrientedWalkableStairRamp(bx, bz, rotY, -0.96, fDoorCenterZ, 0.84, 1.24, -1.38, -0.54, 0.0, floorY);
      addOrientedWalkableStairRamp(bx, bz, rotY, -0.96, rDoorCenterZ, 0.84, 1.24, -1.38, -0.54, 0.0, floorY);

      // Low physical step risers inside each doorway (each <= 0.52m stepHeight so player steps up/down smoothly)
      [fDoorCenterZ, rDoorCenterZ].forEach((dcz, dIdx) => {
        addLocalBusOBBCollider(bx, bz, rotY, -1.12, dcz, 0.22, 1.12, 0.0, 0.18, 'step', id + '_step1_' + dIdx);
        addLocalBusOBBCollider(bx, bz, rotY, -0.90, dcz, 0.22, 1.12, 0.0, 0.36, 'step', id + '_step2_' + dIdx);
      });

      // 2. Outer Walls with Doorway Gaps at Both Doors (1.20m clear doorways at Front -3.95..-2.75 and Rear +2.75..+3.95)
      addLocalBusOBBCollider(bx, bz, rotY, 1.20, 0.0, 0.12, bLen, 0.0, bH, 'wall', id + '_wall_right');
      addLocalBusOBBCollider(bx, bz, rotY, -1.20, -4.60, 0.12, 1.30, 0.0, bH, 'wall', id + '_wall_left_front');
      addLocalBusOBBCollider(bx, bz, rotY, -1.20, 0.0, 0.12, 5.50, 0.0, bH, 'wall', id + '_wall_left_mid');
      addLocalBusOBBCollider(bx, bz, rotY, -1.20, 4.60, 0.12, 1.30, 0.0, bH, 'wall', id + '_wall_left_rear');
      addLocalBusOBBCollider(bx, bz, rotY, 0.0, -5.19, bWid, 0.14, 0.0, bH, 'wall', id + '_wall_front');
      addLocalBusOBBCollider(bx, bz, rotY, 0.0, 5.19, bWid, 0.14, 0.0, bH, 'wall', id + '_wall_rear');

      // 3. Interior Seat Row Colliders (leaves a clear 0.84m center walk aisle x in [-0.42, +0.42] > 2*playerRadius = 0.56m)
      addLocalBusOBBCollider(bx, bz, rotY, -0.78, 0.0, 0.72, 4.76, floorY, floorY + 1.02, 'furniture', id + '_seats_left');
      addLocalBusOBBCollider(bx, bz, rotY, 0.78, 0.50, 0.72, 5.76, floorY, floorY + 1.02, 'furniture', id + '_seats_right');
      addLocalBusOBBCollider(bx, bz, rotY, 0.78, -4.35, 0.72, 1.40, floorY, floorY + 1.12, 'furniture', id + '_driver_cab');
      addLocalBusOBBCollider(bx, bz, rotY, 0.0, 4.80, 2.24, 0.64, floorY, floorY + 1.02, 'furniture', id + '_rear_bench');

      // 4. Bus Roof Collider (minY = 2.82, maxY = 3.12) — prevents jumping through the roof from inside
      addLocalBusOBBCollider(bx, bz, rotY, 0.0, 0.0, bWid, bLen, 2.82, bH + 0.02, 'roof', id + '_roof');

      // 5. Hiding Spots (behind existing gameplay flag; both spot and exit positions >= playerRadius + 0.15 = 0.43m clear of all colliders)
      const cosR = Math.cos(rotY);
      const sinR = Math.sin(rotY);
      const toWorld = (lx, lz) => ({
        x: bx + lx * cosR + lz * sinR,
        z: bz - lx * sinR + lz * cosR,
      });
      const driverSpotPos = toWorld(0.0, -3.05);
      const driverExitPos = toWorld(-0.02, -3.05);
      interactiveHidingSpots.push({
        id: id + '-behind-driver',
        name: label + ' — Behind Driver Seat',
        x: driverSpotPos.x,
        y: floorY,
        z: driverSpotPos.z,
        exitX: driverExitPos.x,
        exitY: floorY,
        exitZ: driverExitPos.z,
        zone: 'Bus Parking Bay',
        spotType: 'desk',
        riskLevel: 0.24,
        useCount: 0,
        requiresGameplayFlag: true,
      });
      const rearSpotPos = toWorld(-0.14, 3.92);
      const rearExitPos = toWorld(-0.12, 3.88);
      interactiveHidingSpots.push({
        id: id + '-under-rear-seats',
        name: label + ' — Under Rear Seats',
        x: rearSpotPos.x,
        y: floorY,
        z: rearSpotPos.z,
        exitX: rearExitPos.x,
        exitY: floorY,
        exitZ: rearExitPos.z,
        zone: 'Bus Parking Bay',
        spotType: 'desk',
        riskLevel: 0.22,
        useCount: 0,
        requiresGameplayFlag: true,
      });

      const busRecord = {
        id,
        label,
        bx,
        bz,
        rotY,
        length: bLen,
        width: bWid,
        height: bH,
        floorY,
        fDoorCenterZ,
        rDoorCenterZ,
        busGroup,
        interiorGroup,
        vineGroup,
        propsGroup,
        tubeStripMat: warmTubeMat,
        warmTubeMat,
        redTubeMat,
        warmGlowMat,
        redGlowMat,
        dustPoints,
        exteriorDrawCalls: 7 + (vineGeos.length > 0 ? 1 : 0),
        interiorDrawCalls: 8,
        toWorld,
      };
      enterableBuses.push(busRecord);
      return busRecord;
    }

    // Spawn 2 Enterable Gandaki University Buses in the East Parking Plaza
    // Bus A at (5.2, -44.2, rotY = 0.0) and Bus B at (15.4, -45.2, rotY = 0.04)
    // Both have >= 1.5m verified clear gap from all walls, curbs, streetlamps (11.5, -42.0), and trees.
    buildEnterableUniversityBus({
      id: 'bus-a',
      label: 'Bus A (GP62)',
      bx: 5.2,
      bz: -44.2,
      rotY: 0.0,
      mossAmount: busConfig.mossAmountA || 0.65,
      glassBreakage: busConfig.glassBreakageA || 0.35,
      doorOpenAngle: busConfig.doorOpenAngleA || 0.78,
      isBusB: false,
    });
    buildEnterableUniversityBus({
      id: 'bus-b',
      label: 'Bus B (GP64)',
      bx: 15.4,
      bz: -45.2,
      rotY: 0.04,
      mossAmount: busConfig.mossAmountB || 0.92,
      glassBreakage: busConfig.glassBreakageB || 0.72,
      doorOpenAngle: busConfig.doorOpenAngleB || 0.42,
      isBusB: true,
    });

    buildWallSegment(1.5, 0, -43.5, 0.5, 0.35, 12.0, materials.riverStoneCoping);

    // TASK 3: Organic Multi-Sloped Low-Poly Car Shape (Sloped Hood, Angled Windshield, Tapered Cabin & Blob Shadow)
    function buildParkedCar(cx, cz, rotY, carMat) {
      const cGroup = new THREE.Group();
      const carW = 1.92, carL = 4.45, carH = 1.52;

      // Sculpted lower body + sloped front hood + tapered rear trunk
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(carW, 0.46, carL * 0.92), carMat);
      chassis.position.set(0, 0.42, 0);
      cGroup.add(chassis);

      const slopedHood = new THREE.Mesh(new THREE.BoxGeometry(carW - 0.08, 0.22, 1.35), carMat);
      slopedHood.position.set(0, 0.62, -carL * 0.30);
      slopedHood.rotation.x = 0.14;
      cGroup.add(slopedHood);

      // Tapered greenhouse cabin (cylinder/octagonal roof profile + angled windshield)
      const cabin = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.18, carW - 0.22, 6), carMat);
      cabin.rotation.z = Math.PI / 2;
      cabin.scale.set(0.48, 1.0, 1.12);
      cabin.position.set(0, 0.96, 0.12);
      cGroup.add(cabin);

      const frontGlass = new THREE.Mesh(new THREE.PlaneGeometry(carW - 0.28, 0.62), materials.busWindow);
      frontGlass.position.set(0, 0.96, -0.78);
      frontGlass.rotation.x = -0.58;
      frontGlass.rotation.y = Math.PI;
      cGroup.add(frontGlass);

      const rearGlass = new THREE.Mesh(new THREE.PlaneGeometry(carW - 0.32, 0.56), materials.busWindow);
      rearGlass.position.set(0, 0.96, 1.02);
      rearGlass.rotation.x = -0.52;
      cGroup.add(rearGlass);

      const cWheelR = 0.31;
      [-carL * 0.31, carL * 0.31].forEach(wz => {
        [-carW / 2 + 0.06, carW / 2 - 0.06].forEach(wx => {
          const tire = new THREE.Mesh(new THREE.CylinderGeometry(cWheelR, cWheelR, 0.22, 10), materials.rubberTire);
          tire.rotation.z = Math.PI / 2;
          tire.position.set(wx, cWheelR, wz);
          cGroup.add(tire);
        });
      });

      cGroup.position.set(cx, 0, cz);
      cGroup.rotation.y = rotY;
      scene.add(cGroup);

      // Blob contact shadow under car
      const carShadow = new THREE.Mesh(new THREE.PlaneGeometry(carW + 0.55, carL + 0.55), materials.vehicleShadow);
      carShadow.rotation.x = -Math.PI / 2;
      carShadow.position.set(cx, 0.022, cz);
      carShadow.rotation.z = -rotY;
      scene.add(carShadow);

      addColliderBox(new THREE.Box3(
        new THREE.Vector3(cx - 1.2, 0, cz - 2.2),
        new THREE.Vector3(cx + 1.2, carH, cz + 2.2)
      ));
    }

    buildParkedCar(-17.0, -46.0, 0.45, materials.carDarkNavy);
    buildParkedCar(-6.5, -34.5, 0.12, materials.carSilver);
    buildParkedCar(-27.0, -42.0, 0.35, materials.carSilver);
    buildParkedCar(-33.0, -56.0, 0.05, materials.carDarkNavy);
    buildParkedCar(-37.5, -56.0, 0.05, materials.carDarkNavy);

    /* =========================================================================
       4. MAIN BUILDINGS: ACTUAL GANDAKI UNIVERSITY CLASSROOM WINGS (WEST L1-L3)
          + OPTIONAL TRADITIONAL NEWARI COURTYARD STRUCTURES (FALCHA & CHAITYA)
       ========================================================================= */
    // Wing L1 (Actual Gandaki University Blue-Roofed Academic Wing)
    buildLongitudinalClassroomWing(-6.5, -18.0, 7.6, 30.0, -1, false, true, false, 'West Wing L1');

    // Traditional Newari Stepped Stone Chaitya Stupa Shrine in West Courtyard (Optional Traditional Structure)
    buildStoneChaityaShrine(-12.0, -16.0, 'West Courtyard Stone Chaitya Stupa');

    // Traditional Newari Brick & Carved-Timber Falcha / Pati Pavilion in Courtyard (Optional Traditional Structure)
    buildNewariFalchaPavilion(-12.0, 4.0, 5.4, 3.6, 'Courtyard Carved-Wood Falcha Pavilion');

    // Wing L2 (Actual Gandaki University Wing with Raised 2-Tier Monitor Roof + Veranda)
    buildLongitudinalClassroomWing(-17.5, -12.0, 7.6, 28.0, 1, true, false, true, 'West Wing L2');

    // Wing L3 (Actual Gandaki University Upper Parallel Wing)
    buildLongitudinalClassroomWing(-17.5, 20.0, 7.6, 22.0, 1, false, false, false, 'West Wing L3');

    /* =========================================================================
       5. MAIN BUILDINGS: ACTUAL GANDAKI UNIVERSITY EAST WINGS (R1, R2, R4)
          + EAST COURTYARD STONE CHAITYA & SCOOTER
       ========================================================================= */
    buildLongitudinalClassroomWing(14.5, -24.0, 7.6, 26.0, -1, false, false, false, 'East Wing R1');
    spawnCampusTree(9.8, -37.0, 1.45);

    buildLongitudinalClassroomWing(25.5, -14.0, 7.6, 26.0, -1, false, false, false, 'East Wing R2');

    buildStoneChaityaShrine(18.5, 3.0, 'East Courtyard Stone Chaitya Stupa');
    buildCourtyardScooter(19.6, -4.2, 0.58);

    buildLongitudinalClassroomWing(25.5, 20.0, 7.6, 28.0, -1, false, false, false, 'East Wing R4');

    /* =========================================================================
       6. WEST CLUSTER: TRADITIONAL NEWARI HERITAGE STRUCTURES (W1, W2)
          & GANDAKI UNIVERSITY ACADEMIC BLOCKS (W3, W4)
       ========================================================================= */
    // Building W1 (Traditional Newari Brick & Carved Timber Heritage Block with Terracotta Steps)
    buildEnterableClassroomWing(-34.0, -42.0, 9.5, 14.0, 1, false, 'Newari Heritage Block W1', true);
    const w1Steps = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.45, 1.8), materials.teliyaFloorTile);
    w1Steps.position.set(-28.5, 0.22, -42.0);
    scene.add(w1Steps);
    const w1Rail = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.85, 0.08), materials.ebonyCarvedWood);
    w1Rail.position.set(-28.5, 0.85, -41.1);
    scene.add(w1Rail);

    // Enterable Building W2 (Traditional Newari Brick & Carved Woodwork Cultural & Archive Hall)
    const w2X = -34.0, w2Z = -22.0, w2W = 11.0, w2D = 16.0, w2FloorY = 0.22;
    const w2Slab = new THREE.Mesh(new THREE.BoxGeometry(w2W + 0.4, w2FloorY, w2D + 0.4), materials.teliyaFloorTile);
    w2Slab.position.set(w2X, w2FloorY / 2, w2Z);
    scene.add(w2Slab);
    addWalkableFloor(w2X - w2W / 2 - 0.4, w2X + w2W / 2 + 0.6, w2Z - w2D / 2 - 0.4, w2Z + w2D / 2 + 0.4, w2FloorY);
    buildWallSegment(w2X, w2FloorY, w2Z - w2D / 2, w2W, 3.78, 0.26, materials.nepalDachiBrick);
    buildWallSegment(w2X, w2FloorY, w2Z + w2D / 2, w2W, 3.78, 0.26, materials.nepalDachiBrick);
    buildWallSegment(w2X - w2W / 2, w2FloorY, w2Z, 0.26, 3.78, w2D, materials.nepalDachiBrick);
    buildWallSegment(w2X + w2W / 2, w2FloorY, w2Z - 4.5, 0.26, 3.78, 7.0, materials.nepalDachiBrick);
    buildWallSegment(w2X + w2W / 2, w2FloorY, w2Z + 4.5, 0.26, 3.78, 7.0, materials.nepalDachiBrick);
    addDoorFrameColliders(w2X + w2W / 2, w2FloorY, w2Z, 2.0, 0.26, true);
    buildNewariToranaDoorway(w2X + w2W / 2 + 0.04, w2FloorY, w2Z, 1, 0, 2.0, 2.55);
    buildSwingingDoor(scene, w2X + w2W / 2 - 0.18, w2FloorY, w2Z - 0.90, Math.PI - 0.45, materials.ebonyCarvedWood, 'door-w2-main');
    populateClassroomUnit(w2X, w2Z - 3.6, w2FloorY, 1, 'Newari Cultural Hall W2 South', true);
    populateClassroomUnit(w2X, w2Z + 3.6, w2FloorY, -1, 'West Wing L3 Heritage Library W2', true);
    buildSanjhyalCarvedWindow(-28.4, 2.85, -22.0, 1, 0, 3, true, true);
    buildDiyoBrickNiche(-28.4, 1.50, -26.5, 1, 0);
    buildDiyoBrickNiche(-28.4, 1.50, -17.5, 1, 0);
    buildPitchedGableRoof(-34.0, 4.0, -22.0, 11.8, 17.0, 1.48, materials.jhingatiTerracottaRoof, true);

    // Building W3 & W4 (Actual Gandaki University Upper West Academic Blocks)
    buildEnterableClassroomWing(-34.0, -2.0, 9.5, 14.0, 1, false, 'Building W3 West Wing', false);
    buildEnterableClassroomWing(-34.0, 18.0, 9.5, 14.0, 1, false, 'Building W4 West Wing', false);

    /* =========================================================================
       CULTURAL DETAILS: NEPALI LUNGTA PRAYER FLAGS & FALLEN DRY AUTUMN LEAVES
       ========================================================================= */
    // Colorful Tibetan/Nepali Prayer Flag Strings fluttering across courtyards, Chaitya shrines & Newari Falcha
    buildPrayerFlagString(-12.0, 2.45, -16.0, -14.8, 3.65, -8.0, 0.45, 14);
    buildPrayerFlagString(-12.0, 2.45, -16.0, -9.2,  3.65, -22.0, 0.45, 14);
    buildPrayerFlagString(-14.6, 3.40, 4.0,   -10.2, 3.65, -3.5, 0.52, 16);
    buildPrayerFlagString(18.5,  2.45, 3.0,   21.8,  3.65, -3.0, 0.45, 14);
    buildPrayerFlagString(18.5,  2.45, 3.0,   14.5,  3.65, -10.5, 0.55, 16);
    buildPrayerFlagString(-28.5, 3.80, -35.0, -28.5, 3.80, -14.0, 0.65, 18);
    buildPrayerFlagString(-2.1,  4.45, -64.0,  5.1,  4.45, -64.0, 0.35, 12);

    // Scattered Fallen Dry Autumn Leaf Clusters along the Concrete Footpaths & Under Trees
    spawnDryLeafClusters(-1.8, -32.0, 2.6, 14);
    spawnDryLeafClusters(2.4,  -18.0, 2.4, 12);
    spawnDryLeafClusters(-11.5,-19.5, 2.5, 14);
    spawnDryLeafClusters(-12.2, 0.5,  2.8, 15);
    spawnDryLeafClusters(19.2, -1.5,  2.6, 14);
    spawnDryLeafClusters(-1.2,  14.0, 2.5, 12);
    spawnDryLeafClusters(3.5,   34.0, 2.8, 15);
    spawnDryLeafClusters(-27.0,-30.0, 2.4, 12);

    /* =========================================================================
       7. 3-STOREY TERRACOTTA-RED-ROOFED GRAND ROTUNDA COMPLEX (IMG_5854 + IMG_5835 2.JPG)
       Unobstructed 360-degree northern terrace placement (rotZ = 64.0) with hollow
       3-story interior, dual concourse classroom doorways, and rock-solid stair physics
       ========================================================================= */
    const rotPlazaX = 6, rotPlazaZ = 50;
    const rotPlaza = new THREE.Mesh(new THREE.PlaneGeometry(66, 54), materials.interlockingPavers);
    rotPlaza.rotation.x = -Math.PI / 2;
    rotPlaza.position.set(rotPlazaX, 0.025, rotPlazaZ + 6.0);
    scene.add(rotPlaza);

    // 1. Forecourt Circular Fountain with Pink/White/Green Tiered Ring & Spout + Square Planters (IMG_5854)
    const ftnX = rotPlazaX, ftnZ = rotPlazaZ - 7.5; // z = 42.5 (14.5m in front of Rotunda facade)
    const fountainPinkOuter = new THREE.Mesh(new THREE.CylinderGeometry(4.95, 5.05, 0.12, 32), materials.fountainPinkTrim);
    fountainPinkOuter.position.set(ftnX, 0.06, ftnZ);
    scene.add(fountainPinkOuter);

    const fountainLawnRing = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 0.16, 32), materials.lawnStripGreen);
    fountainLawnRing.position.set(ftnX, 0.08, ftnZ);
    scene.add(fountainLawnRing);

    const fountainCurb = new THREE.Mesh(new THREE.CylinderGeometry(4.72, 4.72, 0.26, 32), materials.rotundaWhiteArch);
    fountainCurb.position.set(ftnX, 0.13, ftnZ);
    scene.add(fountainCurb);

    const fountainBasin = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.25, 0.58, 24), materials.rotundaWhiteArch);
    fountainBasin.position.set(ftnX, 0.34, ftnZ);
    scene.add(fountainBasin);

    const fountainWaterPool = new THREE.Mesh(new THREE.CylinderGeometry(1.92, 1.92, 0.08, 24), materials.fountainWater);
    fountainWaterPool.position.set(ftnX, 0.60, ftnZ);
    scene.add(fountainWaterPool);

    const fountainCenterPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 1.15, 16), materials.fountainPinkTrim);
    fountainCenterPillar.position.set(ftnX, 0.72, ftnZ);
    scene.add(fountainCenterPillar);

    const fountainTopBowl = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.25, 0.24, 16), materials.rotundaWhiteArch);
    fountainTopBowl.position.set(ftnX, 1.18, ftnZ);
    scene.add(fountainTopBowl);

    addColliderBox(new THREE.Box3(
      new THREE.Vector3(ftnX - 2.25, 0, ftnZ - 2.25),
      new THREE.Vector3(ftnX + 2.25, 1.35, ftnZ + 2.25)
    ));

    // Two small square landscaped planter beds in front-left of the circular fountain (IMG_5854)
    [
      { x: ftnX - 4.8, z: ftnZ - 4.6 },
      { x: ftnX - 2.4, z: ftnZ - 6.8 },
    ].forEach(sq => {
      const kerb = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.22, 2.2), materials.rotundaWhiteArch);
      kerb.position.set(sq.x, 0.11, sq.z);
      scene.add(kerb);
      const turf = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.25, 1.9), materials.lawnStripGreen);
      turf.position.set(sq.x, 0.13, sq.z);
      scene.add(turf);
      spawnRoadsideShrubs(sq.x, sq.z, 2);
    });

    // Landscaped lawn islands framing the Rotunda forecourt (with zero overlapping side buildings!)
    const leftRectKerb = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.22, 4.4), materials.rotundaWhiteArch);
    leftRectKerb.position.set(rotPlazaX - 15.5, 0.11, rotPlazaZ - 1.5);
    scene.add(leftRectKerb);
    const leftRectLawn = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.25, 4.0), materials.lawnStripGreen);
    leftRectLawn.position.set(rotPlazaX - 15.5, 0.13, rotPlazaZ - 1.5);
    scene.add(leftRectLawn);
    spawnRoadsideShrubs(rotPlazaX - 15.5, rotPlazaZ - 1.5, 3);

    const leftGrassIsland = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 0.18, 24), materials.lawnStripGreen);
    leftGrassIsland.scale.set(1.45, 1, 0.68);
    leftGrassIsland.position.set(rotPlazaX - 12.5, 0.09, rotPlazaZ - 8.5);
    scene.add(leftGrassIsland);
    buildWroughtIronFence(rotPlazaX - 18, rotPlazaZ - 7.5, rotPlazaX - 6.5, rotPlazaZ - 7.5);

    const rightGrassIsland = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 0.18, 24), materials.lawnStripGreen);
    rightGrassIsland.scale.set(1.65, 1, 0.72);
    rightGrassIsland.position.set(rotPlazaX + 15.5, 0.09, rotPlazaZ - 8.5);
    scene.add(rightGrassIsland);
    buildWroughtIronFence(rotPlazaX + 6.5, rotPlazaZ - 7.5, rotPlazaX + 23, rotPlazaZ - 7.5);

    /* -------------------------------------------------------------------------
       ARCHITECTURAL HELPERS FOR THE 3-STOREY GRAND ROTUNDA COMPLEX (IMG_5835 2.JPG & IMG_5854)
       ------------------------------------------------------------------------- */
    // Helper: Resolve Main Administration Building window material ('warm' | 'red' | 'dark' | boolean)
    function resolveMainBuildingWindowMat(mode) {
      if (mode === 'red') return materials.rotundaWindowRed || materials.windowWarmLit;
      if (mode === 'warm' || mode === true) return materials.rotundaWindowWarm || materials.windowWarmLit;
      return materials.rotundaWindowDark || materials.windowGlass;
    }

    // 1. Projecting 2-Story White Pilaster & Window Bay (Fixes 1 & 2: Crisp dark window frames/mullions, zero moire stripes, high-contrast pilasters/cornices!)
    function buildRotundaArchedBay(wx, baseY, wz, facingZDir = -1, isSideWall = false, warmGround = 'dark', warmFirst = 'dark') {
      const bayGroup = new THREE.Group();
      bayGroup.position.set(wx, baseY, wz);
      if (isSideWall) {
        bayGroup.rotation.y = facingZDir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else if (facingZDir === -1) {
        bayGroup.rotation.y = Math.PI;
      }

      const bayW = 2.36;
      const bayH = 7.05; // Spans Ground Floor (0..3.60) + 1st Floor (3.60..7.05)
      const pilasterW = 0.28;
      const pilasterD = 0.34;
      const innerW = bayW - pilasterW * 2;

      // Two tall projecting vertical pilasters framing the 2-story bay
      [-bayW / 2 + pilasterW / 2, bayW / 2 - pilasterW / 2].forEach(px => {
        const pil = new THREE.Mesh(new THREE.BoxGeometry(pilasterW, bayH, pilasterD), materials.rotundaWhiteArch);
        pil.position.set(px, bayH / 2, pilasterD / 2 - 0.04);
        bayGroup.add(pil);
      });

      // Projecting horizontal floor band & recessed spandrel panel between Ground & 1st Floor (IMG_6033 & IMG_6034)
      const spandrelPanel = new THREE.Mesh(new THREE.BoxGeometry(innerW + 0.04, 0.72, 0.14), materials.rotundaPlinthConcrete);
      spandrelPanel.position.set(0, 3.52, 0.05);
      bayGroup.add(spandrelPanel);

      const midBeam = new THREE.Mesh(new THREE.BoxGeometry(bayW + 0.06, 0.26, pilasterD + 0.06), materials.rotundaWhiteArch);
      midBeam.position.set(0, 3.86, pilasterD / 2 - 0.01);
      bayGroup.add(midBeam);

      // Top lintel & cornice hood crowning the 2-story bay
      const topCornice = new THREE.Mesh(new THREE.BoxGeometry(bayW + 0.06, 0.28, pilasterD + 0.06), materials.rotundaWhiteArch);
      topCornice.position.set(0, bayH - 0.14, pilasterD / 2 - 0.01);
      bayGroup.add(topCornice);

      // Ground Floor Window (y = 1.88 above plinth) — uses mipmapped anisotropic window texture with baked dark mullions (zero moire!)
      const winW = innerW - 0.10;
      const gWinH = 1.72;
      const gWinY = 1.88;

      const gOuterFrame = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.12, gWinH + 0.12, 0.14), materials.castIronDark);
      gOuterFrame.position.set(0, gWinY, 0.05);
      bayGroup.add(gOuterFrame);

      const gSill = new THREE.Mesh(new THREE.BoxGeometry(innerW + 0.08, 0.11, 0.28), materials.rotundaWhiteArch);
      gSill.position.set(0, gWinY - gWinH / 2 - 0.05, 0.11);
      bayGroup.add(gSill);

      const gPane = new THREE.Mesh(
        new THREE.PlaneGeometry(winW, gWinH),
        resolveMainBuildingWindowMat(warmGround)
      );
      gPane.position.set(0, gWinY, 0.13);
      bayGroup.add(gPane);

      // 1st Floor (2nd Story) Window (y = 5.36 above plinth)
      const fWinH = 1.80;
      const fWinY = 5.36;

      const fOuterFrame = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.12, fWinH + 0.12, 0.14), materials.castIronDark);
      fOuterFrame.position.set(0, fWinY, 0.05);
      bayGroup.add(fOuterFrame);

      const fSill = new THREE.Mesh(new THREE.BoxGeometry(innerW + 0.08, 0.11, 0.26), materials.rotundaWhiteArch);
      fSill.position.set(0, fWinY - fWinH / 2 - 0.05, 0.11);
      bayGroup.add(fSill);

      const fPane = new THREE.Mesh(
        new THREE.PlaneGeometry(winW, fWinH),
        resolveMainBuildingWindowMat(warmFirst)
      );
      fPane.position.set(0, fWinY, 0.13);
      bayGroup.add(fPane);

      scene.add(bayGroup);
    }

    // 2. 3rd-Story Casement Window + Eave Brackets (Fix 1: Supports 'dark', 'warm', and 'red' window states matching IMG_6032-IMG_6034!)
    function buildTopFloorWindowAndStruts(wx, topFloorY, wz, facingZDir = -1, isSideWall = false, winMode = 'dark') {
      const tGroup = new THREE.Group();
      tGroup.position.set(wx, topFloorY, wz);
      if (isSideWall) {
        tGroup.rotation.y = facingZDir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else if (facingZDir === -1) {
        tGroup.rotation.y = Math.PI;
      }

      const wW = 1.48, wH = 1.56, wY = 1.84;
      const outerFrame = new THREE.Mesh(new THREE.BoxGeometry(wW + 0.14, wH + 0.14, 0.14), materials.castIronDark);
      outerFrame.position.set(0, wY, 0.05);
      tGroup.add(outerFrame);

      const sill = new THREE.Mesh(new THREE.BoxGeometry(wW + 0.22, 0.10, 0.24), materials.rotundaWhiteArch);
      sill.position.set(0, wY - wH / 2 - 0.05, 0.10);
      tGroup.add(sill);

      const pane = new THREE.Mesh(
        new THREE.PlaneGeometry(wW, wH),
        resolveMainBuildingWindowMat(winMode)
      );
      pane.position.set(0, wY, 0.13);
      tGroup.add(pane);

      // Pair of Angled Eave Brackets flanking the 3rd-floor window (IMG_6033 & IMG_6034!)
      [-1.08, 1.08].forEach(sx => {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.48, 0.09), materials.rotundaColumnFlutedBase);
        strut.position.set(sx, 2.82, 0.48);
        strut.rotation.x = -0.68;
        tGroup.add(strut);

        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.08), materials.rotundaColumnFlutedBase);
        plate.position.set(sx, 2.24, 0.06);
        tGroup.add(plate);
      });

      scene.add(tGroup);
    }

    // 3. True 4-Slope Terracotta-Red Hipped Roof with Wide White Overhanging Eave Soffit & Lifted Ridge/Hip Edge Highlights (Fix 4: IMG_6032 & IMG_6033!)
    function buildTerracottaHippedWingRoof(cx, eaveY, cz, wingW, wingD, ridgeH = 4.15, dormerSide = -1) {
      const rGroup = new THREE.Group();
      rGroup.position.set(cx, eaveY, cz);

      const overhang = 1.15;
      const totalW = wingW + overhang * 2;
      const totalD = wingD + overhang * 2;
      const ridgeMat = materials.rotundaRoofRidge || materials.rotundaRedSteel;

      // Bright white overhanging eave soffit slab + lifted terracotta-red outer fascia edge highlight
      const soffit = new THREE.Mesh(new THREE.BoxGeometry(totalW, 0.24, totalD), materials.rotundaWhiteArch);
      soffit.position.set(0, 0.05, 0);
      rGroup.add(soffit);

      const fascia = new THREE.Mesh(new THREE.BoxGeometry(totalW + 0.10, 0.16, totalD + 0.10), ridgeMat);
      fascia.position.set(0, 0.20, 0);
      rGroup.add(fascia);

      // Multi-tiered hipped terracotta roof pyramid/prism layers for authentic 4-slope hipped silhouette
      const layers = 14;
      for (let i = 0; i < layers; i++) {
        const t0 = i / layers;
        const t1 = (i + 1) / layers;
        const tm = (t0 + t1) * 0.5;
        const layerH = ridgeH / layers + 0.04;
        const curW = totalW * (1 - tm * 0.52);
        const curD = totalD * (1 - tm * 0.88);
        const slab = new THREE.Mesh(new THREE.BoxGeometry(curW, layerH, Math.max(0.45, curD)), materials.terracottaRoof);
        slab.position.set(0, 0.22 + tm * ridgeH, 0);
        rGroup.add(slab);
      }

      // Main Front & Back Pitched Slope Planes for smooth continuous corrugated tile surface
      const halfD = totalD / 2;
      const slopeLen = Math.hypot(halfD, ridgeH);
      const slopeAng = Math.atan2(ridgeH, halfD);

      const frontSlope = new THREE.Mesh(new THREE.BoxGeometry(totalW * 0.76, 0.16, slopeLen), materials.terracottaRoof);
      frontSlope.position.set(0, 0.22 + ridgeH / 2, halfD / 2);
      frontSlope.rotation.x = slopeAng;
      rGroup.add(frontSlope);

      const backSlope = new THREE.Mesh(new THREE.BoxGeometry(totalW * 0.76, 0.16, slopeLen), materials.terracottaRoof);
      backSlope.position.set(0, 0.22 + ridgeH / 2, -halfD / 2);
      backSlope.rotation.x = -slopeAng;
      rGroup.add(backSlope);

      // Fix 4: Lifted Top Terracotta Ridge Beam + 4 Diagonal Hip Ridge Highlight Caps so the roof silhouette reads against the night sky!
      const ridgeSpanW = totalW * 0.48;
      const ridgeBeam = new THREE.Mesh(new THREE.BoxGeometry(ridgeSpanW, 0.30, 0.40), ridgeMat);
      ridgeBeam.position.set(0, 0.26 + ridgeH, 0);
      rGroup.add(ridgeBeam);

      const hipDx = (totalW - ridgeSpanW) * 0.5;
      const hipDz = totalD * 0.5;
      const hipLen = Math.hypot(hipDx, ridgeH, hipDz);
      [
        [-1, -1], [-1, 1], [1, -1], [1, 1],
      ].forEach(([sx, sz]) => {
        const hipCap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.20, hipLen), ridgeMat);
        hipCap.position.set(sx * (ridgeSpanW * 0.5 + hipDx * 0.5), 0.24 + ridgeH * 0.5, sz * (hipDz * 0.5));
        hipCap.lookAt(sx * (totalW * 0.5), 0.20, sz * hipDz);
        rGroup.add(hipCap);
      });

      // White Rooftop Ventilation Dormer / Chimney Box on outer wing slope
      const dormer = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.35, 1.15), materials.rotundaWhiteArch);
      dormer.position.set(dormerSide * (wingW * 0.28), 0.22 + ridgeH * 0.55, -1.2);
      rGroup.add(dormer);
      const dormerCap = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.14, 1.32), materials.rotundaPlinthConcrete);
      dormerCap.position.set(dormerSide * (wingW * 0.28), 0.22 + ridgeH * 0.55 + 0.72, -1.2);
      rGroup.add(dormerCap);

      scene.add(rGroup);
    }

    // 4. Walkable 3D Grand Staircase with 18 Terrazzo Steps, Stringers, Handrails & Side Guide-Rail Colliders
    function buildGrandStaircase(cx, zStart, zEnd, yStart, yEnd, width = 2.1) {
      const sGroup = new THREE.Group();
      const numSteps = 18;
      const totalZ = zEnd - zStart;
      const totalY = yEnd - yStart;
      const stepD = Math.abs(totalZ) / numSteps;
      const stepH = totalY / numSteps;
      const dirZ = totalZ >= 0 ? 1 : -1;

      for (let i = 0; i < numSteps; i++) {
        const sy = yStart + (i + 0.5) * stepH;
        const sz = zStart + (i + 0.5) * dirZ * stepD;

        const tread = new THREE.Mesh(
          new THREE.BoxGeometry(width, stepH, stepD + 0.04),
          materials.rotundaTerrazzoFloor
        );
        tread.position.set(cx, sy, sz);
        sGroup.add(tread);

        // Dark non-slip nosing strip on each step edge
        const nosing = new THREE.Mesh(
          new THREE.BoxGeometry(width - 0.04, 0.025, 0.05),
          materials.castIronDark
        );
        nosing.position.set(cx, yStart + (i + 1) * stepH + 0.01, sz - dirZ * (stepD * 0.42));
        sGroup.add(nosing);
      }

      // Sloped side stringers & twin handrails with vertical balusters + physical side guide-rail colliders
      const slopeLen = Math.hypot(totalZ, totalY);
      const slopePitch = Math.atan2(totalY, Math.abs(totalZ)) * dirZ;
      const midZ = (zStart + zEnd) * 0.5;
      const midY = (yStart + yEnd) * 0.5;
      const minStairZ = Math.min(zStart, zEnd);
      const maxStairZ = Math.max(zStart, zEnd);

      [-width / 2 + 0.06, width / 2 - 0.06].forEach(rx => {
        const stringer = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.28, slopeLen), materials.rotundaWhiteArch);
        stringer.position.set(cx + rx, midY - 0.08, midZ);
        stringer.rotation.x = slopePitch;
        sGroup.add(stringer);

        const handrail = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.065, slopeLen + 0.2), materials.chairWood);
        handrail.position.set(cx + rx, midY + 0.92, midZ);
        handrail.rotation.x = slopePitch;
        sGroup.add(handrail);

        for (let b = 0; b <= 6; b++) {
          const bt = b / 6;
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.92, 6), materials.deskSteelFrame);
          post.position.set(cx + rx, yStart + bt * totalY + 0.46, zStart + bt * totalZ);
          sGroup.add(post);
        }

        // Physical staircase side handrail collider so players cannot accidentally step off the side mid-climb
        const railCenterX = cx + (rx < 0 ? -width / 2 - 0.06 : width / 2 + 0.06);
        addColliderBox(new THREE.Box3(
          new THREE.Vector3(railCenterX - 0.08, yStart, minStairZ + 0.15),
          new THREE.Vector3(railCenterX + 0.08, yEnd + 1.05, maxStairZ - 0.15)
        ));
      });

      scene.add(sGroup);

      // Register smooth walkable ramp with generous entry/exit landing capture buffer
      const minZ = minStairZ - 0.55;
      const maxZ = maxStairZ + 0.55;
      addWalkableStairRamp(cx - width / 2 - 0.12, cx + width / 2 + 0.12, minZ, maxZ, zStart, zEnd, yStart, yEnd);
    }

    // Lecture Chalkboard drawn into Signage Texture Atlas (0, 288, 512, 224)
    if (sAtlasCtx) {
      sAtlasCtx.fillStyle = '#183829';
      sAtlasCtx.fillRect(0, 288, 512, 224);
      sAtlasCtx.strokeStyle = 'rgba(255,255,255,0.78)';
      sAtlasCtx.fillStyle = 'rgba(255,255,255,0.85)';
      sAtlasCtx.lineWidth = 2;
      sAtlasCtx.font = 'bold 20px Georgia, serif';
      sAtlasCtx.fillText('GANDAKI UNIVERSITY — FACULTY OF SCIENCE & TECH', 22, 322);
      sAtlasCtx.font = '16px monospace';
      sAtlasCtx.fillText('1. Structural Mechanics:  ∑F_x = 0,  ∑M_z = I·α', 24, 366);
      sAtlasCtx.fillText('2. Harmonic Oscillation:  x(t) = A·e^(-γt)·cos(ωt + φ)', 24, 398);
      sAtlasCtx.fillText('3. Rotunda Dome Stress:   σ_θ = (p·R) / (2·t)', 24, 430);
    }
    const rotundaChalkboardMat = harmikaEyesMat;

    // Data-Driven Horror Dressing & Per-Room Light Mood Config for Main Building (Safe for University Audience)
    const MAIN_BUILDING_ROOM_DRESSING = {
      '101': {
        lightMood: 'dying_tube',
        scatteredPapers: true,
        chairFacingWall: true,
        halfOpenDoor: true,
        boardScribbles: true,
        wallStains: true,
        crackedWindow: true,
        toppledDesk: true,
        mysteriousItem: 'brass_astrolabe',
        dustShaft: true,
        cobwebs: true,
      },
      '102': {
        lightMood: 'warm_lamp',
        scatteredPapers: true,
        chairFacingWall: false,
        halfOpenDoor: true,
        boardScribbles: false,
        wallStains: true,
        crackedWindow: false,
        toppledDesk: false,
        mysteriousItem: 'cassette_recorder',
        dustShaft: false,
        cobwebs: true,
      },
      '201': {
        lightMood: 'moonlight',
        scatteredPapers: true,
        chairFacingWall: true,
        halfOpenDoor: true,
        boardScribbles: true,
        wallStains: true,
        crackedWindow: true,
        toppledDesk: true,
        mysteriousItem: 'old_warden_key',
        dustShaft: true,
        cobwebs: true,
      },
      '202': {
        lightMood: 'warm_lamp',
        scatteredPapers: true,
        chairFacingWall: true,
        halfOpenDoor: true,
        boardScribbles: false,
        wallStains: true,
        crackedWindow: true,
        toppledDesk: false,
        mysteriousItem: 'ancient_ledger',
        dustShaft: false,
        cobwebs: true,
      },
      '301': {
        lightMood: 'dark',
        scatteredPapers: true,
        chairFacingWall: true,
        halfOpenDoor: true,
        boardScribbles: true,
        wallStains: true,
        crackedWindow: true,
        toppledDesk: true,
        mysteriousItem: 'cracked_lantern',
        dustShaft: false,
        cobwebs: true,
      },
      '302': {
        lightMood: 'emergency_red',
        scatteredPapers: true,
        chairFacingWall: false,
        halfOpenDoor: true,
        boardScribbles: true,
        wallStains: true,
        crackedWindow: false,
        toppledDesk: false,
        mysteriousItem: 'encrypted_drive',
        dustShaft: false,
        cobwebs: true,
      },
    };

    const mainBuildingFlickerTubes = [];
    const mainBuildingDustShafts = [];

    // Startup Baked AO strips in wall-floor corners, ceiling corners, under desks/shelves & behind doors
    function addRoomStartupBakedAO(rGroup, roomW = 14.0, roomD = 13.4, sideSign = -1) {
      const doorWallX = -sideSign * (roomW * 0.5 - 0.55);
      addRoomBakedAO(rGroup, roomW, roomD, 3.38, [
        { x: doorWallX, z: -4.95 },
        { x: doorWallX, z:  5.15 },
      ]);
    }

    // 5. Well-Furnished Classroom, Library, Admin Office & Computer Lab Interior Builder for All 3 Rotunda Floors
    function populateGrandRotundaClassroom(roomCX, roomCZ, floorY, sideSign, floorNum, roomCode, roomTitle) {
      const rGroup = new THREE.Group();
      rGroup.position.set(roomCX, floorY, roomCZ);
      scene.add(rGroup);

      const dressing = MAIN_BUILDING_ROOM_DRESSING[roomCode] || MAIN_BUILDING_ROOM_DRESSING['101'];

      // Startup Baked AO in wall-floor corners, ceiling corners & behind half-open doors
      addRoomStartupBakedAO(rGroup, 14.0, 13.4, sideSign);

      // Finished Interior Stained Acoustic Drop-Ceiling Grid Slab at y = 3.38m (Ref 1, Ref 2, Ref 5)
      const ceilGeo = remapInteriorAtlasUVs(new THREE.BoxGeometry(14.1, 0.08, 13.5), 0, 384, 256, 128);
      const roomCeiling = new THREE.Mesh(ceilGeo, materials.stainedCeilingTiles);
      roomCeiling.position.set(0, 3.38, 0);
      rGroup.add(roomCeiling);

      // Recessed Square Drop-Ceiling Troffer Panels & Industrial Twin-Cord Pendant Tube Fixtures (Ref 1 & Ref 4)
      [-3.4, 3.4].forEach(px => {
        [-3.2, 0.0, 3.2].forEach((pz, pIdx) => {
          const pHood = new THREE.Mesh(step2Geos.pendantTubeFixture, materials.deskSteelFrame);
          pHood.position.set(px, 2.90, pz);
          rGroup.add(pHood);
          if (pIdx === 1) {
            const rPanel = new THREE.Mesh(step2Geos.recessedCeilingPanel, step2Mats.recessedPanelWarmMat);
            rPanel.position.set(px * 0.5, 3.34, pz);
            rGroup.add(rPanel);
          }
        });
      });

      // Dark Teak-Wood Interior Baseboard & Crown Trim around the Classroom Perimeter (Ref 1)
      [-6.68, 6.68].forEach(bz => {
        const baseM = new THREE.Mesh(new THREE.BoxGeometry(14.1, 0.16, 0.06), materials.chairWood);
        baseM.position.set(0, 0.08, bz);
        rGroup.add(baseM);
        const crownM = new THREE.Mesh(new THREE.BoxGeometry(14.1, 0.14, 0.06), materials.chairWood);
        crownM.position.set(0, 3.28, bz);
        rGroup.add(crownM);
      });
      const baseOuter = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 13.4), materials.chairWood);
      baseOuter.position.set(sideSign * 6.98, 0.08, 0);
      rGroup.add(baseOuter);

      // 4 Corner Pilasters + 1 Freestanding Liminal Structural Pillar with Dark Wood Crown & Baseboard Bands (Ref 1!)
      [
        [-6.85, -6.55], [6.85, -6.55],
        [-6.85,  6.55], [6.85,  6.55],
      ].forEach(([px, pz]) => {
        const cPil = new THREE.Mesh(new THREE.BoxGeometry(0.32, 3.36, 0.32), materials.rotundaInteriorWall);
        cPil.position.set(px, 1.68, pz);
        rGroup.add(cPil);
      });
      const colX = sideSign * 4.45;
      const colZ = -4.25;
      const liminalCol = new THREE.Mesh(new THREE.BoxGeometry(0.58, 3.36, 0.58), materials.rotundaInteriorWall);
      liminalCol.position.set(colX, 1.68, colZ);
      rGroup.add(liminalCol);
      const colBaseBand = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.22, 0.64), materials.chairWood);
      colBaseBand.position.set(colX, 0.11, colZ);
      rGroup.add(colBaseBand);
      const colCrownBand = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.24, 0.64), materials.chairWood);
      colCrownBand.position.set(colX, 3.24, colZ);
      rGroup.add(colCrownBand);
      addUnderFurnitureAO(rGroup, colX, colZ, 0.95, 0.95);
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(roomCX + colX - 0.32, floorY, roomCZ + colZ - 0.32),
        new THREE.Vector3(roomCX + colX + 0.32, floorY + 3.36, roomCZ + colZ + 0.32)
      ), 'furniture');

      // Back-Corner Water Dispenser & Blue Jug tucked beside the Structural Column (Ref 1 & Ref 2!)
      const wdX = colX + sideSign * 0.65;
      const wdZ = colZ;
      const wdBody = new THREE.Mesh(step2Geos.waterDispenser, materials.rotundaInteriorWall);
      wdBody.position.set(wdX, 0.50, wdZ);
      rGroup.add(wdBody);
      const wdJug = new THREE.Mesh(step2Geos.waterBottle, step2Mats.waterJugBlue);
      wdJug.position.set(wdX, 1.20, wdZ);
      rGroup.add(wdJug);
      addUnderFurnitureAO(rGroup, wdX, wdZ, 0.62, 0.62);
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(roomCX + wdX - 0.24, floorY, roomCZ + wdZ - 0.24),
        new THREE.Vector3(roomCX + wdX + 0.24, floorY + 1.45, roomCZ + wdZ + 0.24)
      ), 'furniture');

      // Venetian Slatted Window Blinds & Curtains along Windows + Wall-Mounted Oscillating Fans (Ref 4 & Ref 5)
      [-3.2, 3.2].forEach((wx, wIdx) => {
        buildInteriorWindowCurtains(rGroup, wx, 1.92, -6.52, 0, floorNum === 2);
        const vBlind = new THREE.Mesh(step2Geos.venetianBlinds, materials.deskSteelFrame);
        vBlind.position.set(wx, 1.92, 6.48);
        rGroup.add(vBlind);
        if (wIdx === 0) {
          interactiveHidingSpots.push({
            id: 'rotunda-curtain-' + roomCode,
            name: roomTitle + ' Window Curtain Cover',
            spotType: 'curtain',
            riskLevel: 'MEDIUM',
            useCount: 0,
            peekYaw: 0,
            x: roomCX + wx,
            y: floorY,
            z: roomCZ - 5.85,
            zone: roomTitle,
          });
        }
      });
      [-4.2, 0.0, 4.2].forEach(wz => {
        const sBlind = new THREE.Mesh(step2Geos.venetianBlinds, materials.deskSteelFrame);
        sBlind.position.set(sideSign * 6.80, 1.92, wz);
        sBlind.rotation.y = -sideSign * Math.PI / 2;
        rGroup.add(sBlind);
      });
      buildWallMountedFan(rGroup, sideSign * 6.84, 2.62, -2.2, -sideSign * Math.PI / 2);
      buildWallMountedFan(rGroup, sideSign * 6.84, 2.62, 2.2, -sideSign * Math.PI / 2);

      // Framed Noticeboard on the Front Wall (z = -6.58)
      const noticeBoard = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.15, 0.06), materials.chairWood);
      noticeBoard.position.set(0, 1.85, -6.62);
      rGroup.add(noticeBoard);
      const noticeCork = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.96, 0.08), step2Mats.corkBoard);
      noticeCork.position.set(0, 1.85, -6.60);
      rGroup.add(noticeCork);

      // Phase B.1 Data-Driven Room Dispatch via ROOM_DEFINITIONS
      const roomDef = getOrRegisterRoomDefinition(roomTitle, roomCX, roomCZ, floorY, 7.1, 6.8, 'ROTUNDA', 'rotunda_lecture');
      roomDef.lightMood = normalizeRoomLightMood(dressing.lightMood || roomDef.lightMood);
      const rArch = roomDef.archetype;
      if (ROOM_ARCHETYPE_BUILDERS[rArch]) {
        ROOM_ARCHETYPE_BUILDERS[rArch](rGroup, roomCX, roomCZ, floorY, -1, roomTitle, false, roomDef);
        // Add constructed 2-door wooden cupboard & corner counter details to Admin 102 & Library 202 (Ref 1 & Ref 2)
        const cupX = sideSign * 6.38;
        const cupZ = 4.2;
        const cupboard = new THREE.Mesh(step2Geos.woodenCupboard, materials.chairWood);
        cupboard.position.set(cupX, 0.96, cupZ);
        cupboard.rotation.y = sideSign > 0 ? Math.PI : 0;
        rGroup.add(cupboard);
        addUnderFurnitureAO(rGroup, cupX, cupZ, 0.82, 1.48);
        addColliderBox(new THREE.Box3(
          new THREE.Vector3(roomCX + cupX - 0.36, floorY, roomCZ + cupZ - 0.68),
          new THREE.Vector3(roomCX + cupX + 0.36, floorY + 1.98, roomCZ + cupZ + 0.68)
        ), 'furniture');
      } else {
        // Rotunda Lecture / Seminar / Smart Computer Lab Archetypes ('rotunda_lecture' | 'rotunda_seminar' | 'rotunda_lab')
        const isRotundaLab = (rArch === 'rotunda_lab');
        const isRotundaSeminar = (rArch === 'rotunda_seminar');
        const boardZ = 6.35;
        const dais = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.16, 2.2), materials.rotundaInteriorWall);
        dais.position.set(0, 0.08, boardZ - 1.2);
        rGroup.add(dais);
        addUnderFurnitureAO(rGroup, 0, boardZ - 1.2, 8.9, 2.45);

        const boardGeo = remapInteriorAtlasUVs(new THREE.BoxGeometry(4.6, 1.48, 0.06), 256, 256, 512, 256);
        const greenBoard = new THREE.Mesh(boardGeo, materials.blackboardGreen);
        greenBoard.position.set(-1.8, 1.95, boardZ);
        rGroup.add(greenBoard);

        const whiteBoard = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.38, 0.06), materials.whiteboardSurface);
        whiteBoard.position.set(2.4, 1.95, boardZ);
        rGroup.add(whiteBoard);

        const boardTray = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.08, 0.16), materials.chairWood);
        boardTray.position.set(-0.1, 1.18, boardZ - 0.08);
        rGroup.add(boardTray);

        // Teacher Lectern Podium & Beveled Professor Desk with Drawers/Handles + Upright & Toppled Swivel Chairs (Ref 1!)
        const profDeskX = -2.4;
        const profDeskZ = boardZ - 1.35;
        const profDesk = new THREE.Mesh(step2Geos.officeDesk, materials.chairWood);
        profDesk.position.set(profDeskX, 0.16 + 0.38, profDeskZ);
        profDesk.rotation.y = 0.03;
        rGroup.add(profDesk);
        addUnderFurnitureAO(rGroup, profDeskX, profDeskZ, 1.85, 1.15);

        const profChair = new THREE.Mesh(sharedGeos.chairSeat, materials.chairWood);
        profChair.position.set(profDeskX - 0.12, 0.16 + 0.46, profDeskZ + 0.56);
        profChair.rotation.y = -0.24;
        rGroup.add(profChair);

        const podiumLectern = new THREE.Mesh(sharedGeos.podiumBody, materials.chairWood);
        podiumLectern.position.set(2.8, 0.16 + 0.59, profDeskZ);
        rGroup.add(podiumLectern);
        addUnderFurnitureAO(rGroup, 2.8, profDeskZ, 0.92, 0.85);

        addColliderBox(new THREE.Box3(
          new THREE.Vector3(roomCX + profDeskX - 0.85, floorY, roomCZ + profDeskZ - 0.46),
          new THREE.Vector3(roomCX + profDeskX + 0.85, floorY + 1.05, roomCZ + profDeskZ + 0.46)
        ), 'furniture');
        addColliderBox(new THREE.Box3(
          new THREE.Vector3(roomCX + 2.8 - 0.36, floorY, roomCZ + profDeskZ - 0.32),
          new THREE.Vector3(roomCX + 2.8 + 0.36, floorY + 1.35, roomCZ + profDeskZ + 0.32)
        ), 'furniture');

        interactiveHidingSpots.push({
          id: 'rotunda-prof-' + roomCode,
          name: roomTitle + ' Teacher Desk',
          spotType: 'desk',
          riskLevel: 'LOW',
          useCount: 0,
          peekYaw: Math.PI,
          x: roomCX + profDeskX,
          y: floorY,
          z: roomCZ + profDeskZ - 0.78,
          zone: roomTitle,
        });

        // Smart Computer Lab Archetype: Twin Glass-Door Server Racks with Blinking LEDs + Simplified Box Colliders
        if (isRotundaLab) {
          [-4.8, 4.8].forEach((srX, srIdx) => {
            const sr = new THREE.Mesh(step2Geos.serverRack, materials.deskSteelFrame);
            sr.position.set(srX, 1.08, -5.65);
            rGroup.add(sr);
            addUnderFurnitureAO(rGroup, srX, -5.65, 1.15, 1.15);
            [-0.35, 0.15, 0.65].forEach((ly, lIdx) => {
              const led = new THREE.Mesh(
                new THREE.BoxGeometry(0.48, 0.035, 0.04),
                (srIdx + lIdx) % 2 === 0 ? step2Mats.serverLedGreen : step2Mats.serverLedAmber
              );
              led.position.set(srX, 1.10 + ly, -5.20);
              rGroup.add(led);
            });
            addColliderBox(new THREE.Box3(
              new THREE.Vector3(roomCX + srX - 0.42, floorY, roomCZ - 5.65 - 0.45),
              new THREE.Vector3(roomCX + srX + 0.42, floorY + 2.15, roomCZ - 5.65 + 0.45)
            ), 'furniture');
          });
        }

        // 4 Rows x 3 Columns of Beveled Two-Seater Student Desks & Benches (InstancedMesh + Organic Jitter + Tilted/Fallen Benches)
        const rowZOffsets = [-3.8, -1.8, 0.2, 2.2];
        const colXOffsets = [-3.4, 0.0, 3.4];
        const bagMats = [step2Mats.bagNavy, step2Mats.bagOlive, step2Mats.bagMaroon];

        rowZOffsets.forEach((rz, rIdx) => {
          colXOffsets.forEach((cxOff, cIdx) => {
            const seed = (rIdx * 7 + cIdx * 13 + floorNum * 5);
            const jitterX = ((seed % 7) - 3) * 0.018;
            const jitterZ = (((seed * 3) % 7) - 3) * 0.016;
            const jitterYaw = (((seed * 5) % 9) - 4) * 0.022;
            const isToppled = !!(dressing.toppledDesk && rIdx === 2 && cIdx === 2);

            const dx = cxOff + jitterX;
            const dz = rz + jitterZ;

            // Under-desk contact AO decal strip
            addUnderFurnitureAO(rGroup, dx, dz - 0.14, 1.56, 1.15, jitterYaw);

            const dMesh = new THREE.Mesh(sharedGeos.deskTop, materials.deskWoodTop);
            if (isToppled) {
              dMesh.position.set(dx, 0.36, dz + 0.12);
              dMesh.rotation.set(1.38, jitterYaw + 0.22, 0.12);
            } else {
              dMesh.position.set(dx, 0.74, dz);
              dMesh.rotation.y = jitterYaw;
            }
            rGroup.add(dMesh);

            const modesty = new THREE.Mesh(sharedGeos.deskModestyPanel, materials.chairWood);
            modesty.position.set(dx, isToppled ? 0.28 : 0.52, dz + 0.24);
            modesty.rotation.y = jitterYaw;
            rGroup.add(modesty);

            [-0.58, 0.58].forEach(lx => {
              const leg = new THREE.Mesh(sharedGeos.deskLeg, materials.deskSteelFrame);
              leg.position.set(dx + lx, 0.36, dz);
              leg.rotation.y = jitterYaw;
              rGroup.add(leg);
            });

            // Constructed Bench with Legs & Cross-Brace (pushed in, tilted, or fallen)
            const isFallenBench = (rIdx === 1 && cIdx === 0 && dressing.toppledDesk);
            const benchPushZ = ((seed % 3) - 1) * 0.06;
            const benchYaw = jitterYaw + (((seed * 11) % 7) - 3) * 0.035;

            const benchSeat = new THREE.Mesh(step2Geos.benchLongSeat, materials.chairWood);
            if (isFallenBench) {
              benchSeat.position.set(dx - 0.08, 0.22, dz - 0.54);
              benchSeat.rotation.set(-1.32, benchYaw, 0.08);
            } else {
              benchSeat.position.set(dx, 0.44, dz - 0.48 + benchPushZ);
              benchSeat.rotation.y = benchYaw;
            }
            rGroup.add(benchSeat);

            const benchBack = new THREE.Mesh(step2Geos.benchLongBack, materials.chairWood);
            benchBack.position.set(dx, isFallenBench ? 0.16 : 0.62, dz - 0.64 + benchPushZ);
            benchBack.rotation.y = benchYaw;
            rGroup.add(benchBack);

            if (isRotundaLab) {
              // Low glass-topped cubicle partition strip along desk back (Ref 4!)
              const glassDiv = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.28, 0.025), materials.windowGlass);
              glassDiv.position.set(dx, 0.90, dz + 0.25);
              rGroup.add(glassDiv);
              [-0.36, 0.36].forEach((mx, mIdx) => {
                const mon = new THREE.Mesh(
                  step2Geos.monitorPanel,
                  (rIdx + cIdx + mIdx) % 2 === 0 ? step2Mats.monitorScreenOn : step2Mats.monitorScreenOff
                );
                mon.position.set(dx + mx, 0.96, dz + 0.12);
                mon.rotation.y = jitterYaw;
                rGroup.add(mon);
                const kb = new THREE.Mesh(step2Geos.keyboard, materials.deskSteelFrame);
                kb.position.set(dx + mx, 0.78, dz - 0.08);
                rGroup.add(kb);
              });
            } else if (isRotundaSeminar) {
              [-0.36, 0.36].forEach(lapX => {
                const lapBase = new THREE.Mesh(step2Geos.keyboard, materials.deskSteelFrame);
                lapBase.position.set(dx + lapX, 0.78, dz + 0.04);
                rGroup.add(lapBase);
                const lapScreen = new THREE.Mesh(step2Geos.monitorPanel, step2Mats.monitorScreenOff);
                lapScreen.scale.set(0.65, 0.65, 0.65);
                lapScreen.position.set(dx + lapX, 0.89, dz + 0.15);
                lapScreen.rotation.x = -0.22;
                rGroup.add(lapScreen);
              });
            } else if (!isToppled) {
              if ((rIdx + cIdx) % 2 === 0) {
                const openBk = new THREE.Mesh(step2Geos.openBook, step2Mats.paperSheet);
                openBk.position.set(dx + 0.24, 0.78, dz);
                openBk.rotation.y = jitterYaw + 0.22;
                rGroup.add(openBk);
              } else {
                const stackBk = new THREE.Mesh(step2Geos.bookStack, step2Mats.bagNavy);
                stackBk.position.set(dx - 0.28, 0.82, dz);
                stackBk.rotation.y = jitterYaw - 0.18;
                rGroup.add(stackBk);
              }
              if ((rIdx * 3 + cIdx) % 2 === 1) {
                const bag = new THREE.Mesh(step2Geos.backpack, bagMats[(rIdx + cIdx) % 3]);
                bag.position.set(dx - 0.38, 0.64, dz - 0.46);
                rGroup.add(bag);
              }
            }

            const wx = roomCX + cxOff;
            const wz = roomCZ + rz;
            addColliderBox(new THREE.Box3(
              new THREE.Vector3(wx - 0.76, floorY, wz - 0.66),
              new THREE.Vector3(wx + 0.76, floorY + 0.82, wz + 0.34)
            ), 'furniture');

            if ((rIdx + cIdx) % 2 === 0) {
              interactiveHidingSpots.push({
                id: 'rotunda-desk-' + roomCode + '-' + rIdx + '-' + cIdx,
                name: roomTitle + ' Desk #' + (rIdx * 3 + cIdx + 1),
                spotType: 'desk',
                riskLevel: (rIdx === 0) ? 'HIGH' : 'LOW',
                useCount: 0,
                peekYaw: 0,
                x: wx,
                y: floorY,
                z: wz - 0.88,
                zone: roomTitle,
              });
            }
          });
        });

        // Tall Beveled Wooden Bookshelf, 2-Door Wooden Storage Cupboard & Constructed Steel Lockers along Outer Side Wall
        const shelfX = sideSign * 6.42;
        const bookcase = new THREE.Mesh(step2Geos.tallBookshelf, materials.chairWood);
        bookcase.position.set(shelfX, 1.13, -1.6);
        rGroup.add(bookcase);
        addUnderFurnitureAO(rGroup, shelfX, -1.6, 0.90, 2.75);
        [0.55, 1.05, 1.55, 1.98].forEach((by, bRow) => {
          const books = new THREE.Mesh(
            step2Geos.bookRowSpan,
            bRow % 2 === 0 ? step2Mats.bagMaroon : step2Mats.bagNavy
          );
          books.position.set(shelfX - sideSign * 0.06, by, -1.6);
          rGroup.add(books);
        });

        const cupboard = new THREE.Mesh(step2Geos.woodenCupboard, materials.chairWood);
        cupboard.position.set(shelfX, 0.96, 0.85);
        cupboard.rotation.y = sideSign > 0 ? Math.PI : 0;
        rGroup.add(cupboard);
        addUnderFurnitureAO(rGroup, shelfX, 0.85, 0.84, 1.48);

        const lockerCab = new THREE.Mesh(step2Geos.lockerBank, step2Mats.lockerSteel);
        lockerCab.position.set(shelfX, 0.96, 3.15);
        rGroup.add(lockerCab);
        addUnderFurnitureAO(rGroup, shelfX, 3.15, 0.82, 2.05);
        [-0.56, 0, 0.56].forEach((lz, lIdx) => {
          const lDoor = new THREE.Mesh(step2Geos.lockerDoor, step2Mats.lockerDoorBlue);
          lDoor.position.set(shelfX - sideSign * 0.24, 1.05, 3.15 + lz);
          if (lIdx === 1) lDoor.rotation.y = sideSign * 0.38; // Slightly ajar locker door!
          rGroup.add(lDoor);
        });

        addColliderBox(new THREE.Box3(
          new THREE.Vector3(roomCX + shelfX - 0.34, floorY, roomCZ - 3.05),
          new THREE.Vector3(roomCX + shelfX + 0.34, floorY + 2.25, roomCZ + 4.15)
        ), 'furniture');

        interactiveHidingSpots.push(
          {
            id: 'rotunda-locker-' + roomCode,
            name: roomTitle + ' Steel Locker',
            spotType: 'locker',
            riskLevel: 'LOW',
            useCount: 0,
            peekYaw: -sideSign * (Math.PI / 2),
            x: roomCX + shelfX - sideSign * 0.85,
            y: floorY,
            z: roomCZ + 3.15,
            zone: roomTitle,
          },
          {
            id: 'rotunda-bookshelf-' + roomCode,
            name: roomTitle + ' Bookshelf Corner',
            spotType: 'bookshelf',
            riskLevel: 'MEDIUM',
            useCount: 0,
            peekYaw: -sideSign * (Math.PI / 2),
            x: roomCX + shelfX - sideSign * 0.85,
            y: floorY,
            z: roomCZ - 1.6,
            zone: roomTitle,
          }
        );
      }

      // Data-Driven Horror Dressing Items + Small Clutter & Asymmetry (Papers, Bottles, Fallen Chair, Jacket, Posters)
      populateRoomClutterAndAsymmetry(rGroup, 13.4, 12.6, floorNum * 19 + sideSign * 7, false);

      // 1) Solitary Chair Facing the Corner Wall (Requirement 4)
      if (dressing.chairFacingWall) {
        const eerieChair = new THREE.Mesh(sharedGeos.chairSeat, materials.chairWood);
        eerieChair.position.set(sideSign * 5.85, 0.45, -5.65);
        eerieChair.rotation.y = sideSign > 0 ? Math.PI * 0.25 : -Math.PI * 0.25;
        rGroup.add(eerieChair);
        addUnderFurnitureAO(rGroup, sideSign * 5.85, -5.65, 0.62, 0.62);
      }

      // 2) Scattered Loose Papers & Fallen Books Fanned Around Floor & Corner Desk (Ref 1 & Ref 3!)
      if (dressing.scatteredPapers) {
        [
          [-1.6, -2.8, 0.35], [-1.2, -2.5, -0.62], [1.8, -0.9, 0.84],
          [2.1, 1.1, -0.42], [-2.5, 1.4, 1.12], [0.4, -4.6, 0.28],
          [-2.2, 4.1, 0.52], [-1.7, 3.8, -0.34], [-2.7, 4.3, 1.05],
          [sideSign * 3.8, -4.1, 0.44], [sideSign * 4.1, -3.7, -0.58],
        ].forEach(([px, pz, rot], pIdx) => {
          const sheet = new THREE.Mesh(
            pIdx % 3 === 0 ? step2Geos.openBook : step2Geos.noticeNote,
            step2Mats.paperSheet
          );
          sheet.position.set(px, 0.020, pz);
          sheet.rotation.set(Math.PI / 2, 0, rot);
          rGroup.add(sheet);
        });
      }

      // 3) Cracked Window Glass Overlay (Requirement 4: optional cracked window per room)
      if (dressing.crackedWindow) {
        const crackPane = new THREE.Mesh(
          remapInteriorAtlasUVs(new THREE.PlaneGeometry(1.65, 1.35), 0, 256, 256, 128),
          materials.windowGlass
        );
        crackPane.position.set(sideSign * 6.84, 1.92, 0.0);
        crackPane.rotation.y = -sideSign * Math.PI / 2;
        rGroup.add(crackPane);
      }

      // 4) Single Mysterious Item Left on Central Desk (Astrolabe / Recorder / Key / Ledger / Lantern / Drive)
      if (dressing.mysteriousItem) {
        const mysBase = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.08, 8), materials.deskSteelFrame);
        mysBase.position.set(0.0, 0.81, 0.2);
        rGroup.add(mysBase);
        const mysOrb = new THREE.Mesh(new THREE.DodecahedronGeometry(0.085, 0), step2Mats.recessedPanelWarmMat);
        mysOrb.position.set(0.0, 0.90, 0.2);
        rGroup.add(mysOrb);
      }

      // 5) Damp Wall Stains & Ceiling Corner Cobwebs
      if (dressing.wallStains) {
        const stain1 = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.2), step2Mats.wallStainDecal);
        stain1.position.set(-4.2, 2.1, 6.62);
        stain1.rotation.y = Math.PI;
        rGroup.add(stain1);
        const stain2 = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.9), step2Mats.wallStainDecal);
        stain2.position.set(sideSign * 6.92, 1.85, -3.4);
        stain2.rotation.y = -sideSign * Math.PI / 2;
        rGroup.add(stain2);
      }
      if (dressing.cobwebs) {
        [
          [-6.55, 3.18, -6.35,  0.78],
          [ 6.55, 3.18, -6.35, -0.78],
          [-6.55, 3.18,  6.35,  2.35],
          [ 6.55, 3.18,  6.35, -2.35],
        ].forEach(([wx, wy, wz, ry]) => {
          const web = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.65), step2Mats.cobwebMat);
          web.position.set(wx, wy, wz);
          web.rotation.set(0.32, ry, 0);
          rGroup.add(web);
        });
      }

      // Bake all static geometry in the room first
      rGroup.userData.isRoomGroup = true;
      bakeStaticGroup(rGroup, true);

      // 6) Unified Per-Room Light Mood Fixtures, Volumetric Cone Moonlight Shafts & Dust Motes
      applyRoomLightMoodFixtures(rGroup, roomDef, roomCX, floorY, roomCZ, 14.0, 13.4, sideSign);

      rGroup.userData.isRoomGroup = true;
      rGroup.userData.roomDef = roomDef;
      rGroup.userData.roomCode = roomCode;
      roomVisibilityList.push({
        id: roomTitle,
        roomCode,
        type: 'room',
        group: rGroup,
        x: roomCX,
        y: floorY,
        z: roomCZ,
        floorY,
        radius: 9.2,
        bKey: roomDef.building,
        lightMood: roomDef.lightMood,
      });
    }

    /* -------------------------------------------------------------------------
       BUILD THE 3-STOREY GRAND ROTUNDA MAIN BUILDING (rotX = 6, rotZ = 64)
       ------------------------------------------------------------------------- */
    const rotX = 6.0, rotZ = 64.0;
    const rotW = 38.0; // x from -13.0 to +25.0
    const rotD = 14.0; // z from 57.0 to 71.0
    const rotFrontZ = rotZ - rotD / 2; // 57.0
    const rotBackZ = rotZ + rotD / 2;  // 71.0
    const rotLeftX = rotX - rotW / 2;  // -13.0
    const rotRightX = rotX + rotW / 2; // +25.0

    const rotFloor0 = 0.48;  // Ground Floor (1st Story)
    const rotFloor1 = 4.08;  // 1st Floor (2nd Story)
    const rotFloor2 = 7.68;  // 2nd Floor (3rd Story)
    const rotEaveY  = 11.18; // Top of 3rd Story / Roof Eave Level
    const storyH    = 3.60;
    const topStoryH = 3.50;
    const rotFloorY = rotFloor0; // Alias for backward compatibility

    // Helper: Build Hollow Exterior Perimeter Band (Front, Back, Left, Right strips ONLY)
    // Prevents solid horizontal slabs from cutting through the 2nd & 3rd floor interiors!
    function buildPerimeterBand(yCenter, bandH, bandOutset, mat) {
      const stripT = 0.28;
      const totalW = rotW + bandOutset * 2;
      const totalD = rotD + bandOutset * 2;
      // Front West & Front East strips (leaving central semicircular rotunda bay open)
      const wingSpanW = 14.8 + bandOutset;
      const fWest = new THREE.Mesh(new THREE.BoxGeometry(wingSpanW, bandH, stripT), mat);
      fWest.position.set(rotLeftX - bandOutset + wingSpanW / 2, yCenter, rotFrontZ - bandOutset);
      scene.add(fWest);
      const fEast = new THREE.Mesh(new THREE.BoxGeometry(wingSpanW, bandH, stripT), mat);
      fEast.position.set(rotRightX + bandOutset - wingSpanW / 2, yCenter, rotFrontZ - bandOutset);
      scene.add(fEast);
      // Back full-width strip
      const bStrip = new THREE.Mesh(new THREE.BoxGeometry(totalW, bandH, stripT), mat);
      bStrip.position.set(rotX, yCenter, rotBackZ + bandOutset);
      scene.add(bStrip);
      // Left & Right side strips
      const lStrip = new THREE.Mesh(new THREE.BoxGeometry(stripT, bandH, totalD), mat);
      lStrip.position.set(rotLeftX - bandOutset, yCenter, rotZ);
      scene.add(lStrip);
      const rStrip = new THREE.Mesh(new THREE.BoxGeometry(stripT, bandH, totalD), mat);
      rStrip.position.set(rotRightX + bandOutset, yCenter, rotZ);
      scene.add(rStrip);
    }

    // A. Raised Cement-Grey Concrete Plinth Base (IMG_5835 2.JPG) + Red Brick Toe Trim + Entrance Steps
    const mainPlinth = new THREE.Mesh(
      new THREE.BoxGeometry(rotW + 0.6, rotFloor0, rotD + 0.6),
      materials.rotundaPlinthConcrete
    );
    mainPlinth.position.set(rotX, rotFloor0 / 2, rotZ);
    scene.add(mainPlinth);

    const redToeTrim = new THREE.Mesh(
      new THREE.BoxGeometry(rotW + 0.85, 0.12, rotD + 0.85),
      materials.rotundaRedSteel
    );
    redToeTrim.position.set(rotX, 0.06, rotZ);
    scene.add(redToeTrim);

    // Polished Terrazzo Ground Floor Topping + Walkable Ground Floor
    const groundTerrazzo = new THREE.Mesh(
      new THREE.BoxGeometry(rotW, 0.04, rotD),
      materials.rotundaTerrazzoFloor
    );
    groundTerrazzo.position.set(rotX, rotFloor0 - 0.01, rotZ);
    scene.add(groundTerrazzo);
    addWalkableFloor(rotLeftX - 0.5, rotRightX + 0.5, rotFrontZ - 6.6, rotBackZ + 0.5, rotFloor0);

    // Semicircular Front Portico Concrete Deck (radius = 6.0m extending forward from rotFrontZ to rotFrontZ - 6.0)
    const porticoDeck = new THREE.Mesh(
      new THREE.CylinderGeometry(6.0, 6.2, rotFloor0, 28, 1, false, Math.PI * 0.5, Math.PI),
      materials.rotundaPlinthConcrete
    );
    porticoDeck.position.set(rotX, rotFloor0 / 2, rotFrontZ);
    scene.add(porticoDeck);

    // Wide Curved Entrance Steps at the Front of the Semicircular Portico + Smooth Walkable Step Ramp
    for (let st = 0; st < 3; st++) {
      const stepR = 6.25 + (3 - st) * 0.38;
      const stepMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(stepR, stepR + 0.1, (st + 1) * 0.15, 28, 1, false, Math.PI * 0.5, Math.PI),
        materials.rotundaTerrazzoFloor
      );
      stepMesh.position.set(rotX, ((st + 1) * 0.15) / 2, rotFrontZ);
      scene.add(stepMesh);
    }
    addWalkableStairRamp(rotX - 4.8, rotX + 4.8, rotFrontZ - 7.8, rotFrontZ - 5.4, rotFrontZ - 7.5, rotFrontZ - 5.8, 0.0, rotFloor0);

    // B. 1st Floor (y = 4.08) & 2nd Floor (y = 7.68) Walkable Terrazzo Floor Slabs
    // Stairwells occupy only the central bay (z = rotFrontZ + 4.2 to rotBackZ - 3.6, length = 6.2m),
    // leaving full-width Front (4.2m deep) and Rear (3.6m deep) Atrium Concourses on BOTH upper floors!
    const stairZFront = rotFrontZ + 4.2; // 61.2
    const stairZBack  = rotBackZ - 3.6;  // 67.4
    const stairMidZ   = (stairZFront + stairZBack) * 0.5; // 64.3

    // Floor 1 (y = 4.08): Stairwell cutout only on Left Half of middle bay (x = 1.6..4.4, z = 61.2..67.4)
    buildFloorSlabSegment(-5.7, rotFloor1, rotZ, 14.6, 0.22, rotD, materials.rotundaTerrazzoFloor); // Floor 1 West Wing Classroom 201
    buildFloorSlabSegment(17.7, rotFloor1, rotZ, 14.6, 0.22, rotD, materials.rotundaTerrazzoFloor); // Floor 1 East Wing Classroom 202
    buildFloorSlabSegment(rotX, rotFloor1, rotFrontZ + 2.1, 8.8, 0.22, 4.2, materials.rotundaTerrazzoFloor); // Floor 1 Full-Width Front Concourse
    buildFloorSlabSegment(rotX, rotFloor1, rotBackZ - 1.8, 8.8, 0.22, 3.6, materials.rotundaTerrazzoFloor);  // Floor 1 Full-Width Rear Concourse
    buildFloorSlabSegment(7.4, rotFloor1, stairMidZ, 6.0, 0.22, 6.2, materials.rotundaTerrazzoFloor);        // Floor 1 Atrium Right Bridge (x = 4.4..10.4)

    // Semicircular 1st-Floor Portico Ceiling / Mezzanine Slab
    const porticoMidSlab = new THREE.Mesh(
      new THREE.CylinderGeometry(5.85, 5.85, 0.24, 28, 1, false, Math.PI * 0.5, Math.PI),
      materials.rotundaWhiteArch
    );
    porticoMidSlab.position.set(rotX, rotFloor1 - 0.12, rotFrontZ);
    scene.add(porticoMidSlab);

    // Floor 2 (y = 7.68): Stairwell cutout only on Right Half of middle bay (x = 7.6..10.4, z = 61.2..67.4)
    buildFloorSlabSegment(-5.7, rotFloor2, rotZ, 14.6, 0.22, rotD, materials.rotundaTerrazzoFloor); // Floor 2 West Wing Seminar 301
    buildFloorSlabSegment(17.7, rotFloor2, rotZ, 14.6, 0.22, rotD, materials.rotundaTerrazzoFloor); // Floor 2 East Wing Smart Lab 302
    buildFloorSlabSegment(rotX, rotFloor2, rotFrontZ + 2.1, 8.8, 0.22, 4.2, materials.rotundaTerrazzoFloor); // Floor 2 Full-Width Front Concourse
    buildFloorSlabSegment(rotX, rotFloor2, rotBackZ - 1.8, 8.8, 0.22, 3.6, materials.rotundaTerrazzoFloor);  // Floor 2 Full-Width Rear Concourse
    buildFloorSlabSegment(4.6, rotFloor2, stairMidZ, 6.0, 0.22, 6.2, materials.rotundaTerrazzoFloor);        // Floor 2 Atrium Left Bridge (x = 1.6..7.6)

    // Finished 3rd-Floor Atrium Ceiling Slab (under the octagonal skylight well at y = 11.12)
    const atriumTopCeiling = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.12, rotD), materials.rotundaWhiteArch);
    atriumTopCeiling.position.set(rotX, rotEaveY - 0.06, rotZ);
    scene.add(atriumTopCeiling);

    // Walkable Semicircular 3rd-Floor Rotunda Balcony Deck (y = 7.68)
    const rotundaFloor2Deck = new THREE.Mesh(
      new THREE.CylinderGeometry(5.95, 5.95, 0.28, 28, 1, false, Math.PI * 0.5, Math.PI),
      materials.rotundaTerrazzoFloor
    );
    rotundaFloor2Deck.position.set(rotX, rotFloor2 - 0.14, rotFrontZ);
    scene.add(rotundaFloor2Deck);
    addWalkableFloor(rotX - 5.6, rotX + 5.6, rotFrontZ - 5.6, rotFrontZ + 0.5, rotFloor2);

    // Build Walkable 3D Grand Staircases (Flight 1: Ground -> Floor 1 on Left, Flight 2: Floor 1 -> Floor 2 on Right)
    buildGrandStaircase(3.0, stairZFront, stairZBack, rotFloor0, rotFloor1, 2.1);
    buildGrandStaircase(9.0, stairZBack, stairZFront, rotFloor1, rotFloor2, 2.1);

    // Stairwell Safety Balustrades + Physical Guardrail Colliders on Floor 1 & Floor 2
    // Prevents players from falling sideways into the stairwell opening while keeping landings 100% open!
    const railMat = materials.chairWood;
    const railF1 = new THREE.Mesh(new THREE.BoxGeometry(0.10, 1.05, 6.2), railMat);
    railF1.position.set(4.35, rotFloor1 + 0.52, stairMidZ);
    scene.add(railF1);
    addColliderBox(new THREE.Box3(
      new THREE.Vector3(4.25, rotFloor1, stairZFront),
      new THREE.Vector3(4.45, rotFloor1 + 1.15, stairZBack)
    ));
    // Floor 1 front stairwell guard return (protects the drop-off behind Flight 1 bottom)
    const railF1Front = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.05, 0.10), railMat);
    railF1Front.position.set(3.0, rotFloor1 + 0.52, stairZFront - 0.05);
    scene.add(railF1Front);
    addColliderBox(new THREE.Box3(
      new THREE.Vector3(1.7, rotFloor1, stairZFront - 0.12),
      new THREE.Vector3(4.35, rotFloor1 + 1.15, stairZFront + 0.05)
    ));

    const railF2 = new THREE.Mesh(new THREE.BoxGeometry(0.10, 1.05, 6.2), railMat);
    railF2.position.set(7.65, rotFloor2 + 0.52, stairMidZ);
    scene.add(railF2);
    addColliderBox(new THREE.Box3(
      new THREE.Vector3(7.55, rotFloor2, stairZFront),
      new THREE.Vector3(7.75, rotFloor2 + 1.15, stairZBack)
    ));
    // Floor 2 rear stairwell guard return (protects the drop-off above Flight 2 bottom)
    const railF2Back = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.05, 0.10), railMat);
    railF2Back.position.set(9.0, rotFloor2 + 0.52, stairZBack + 0.05);
    scene.add(railF2Back);
    addColliderBox(new THREE.Box3(
      new THREE.Vector3(7.65, rotFloor2, stairZBack - 0.05),
      new THREE.Vector3(10.3, rotFloor2 + 1.15, stairZBack + 0.12)
    ));

    // C. Exterior Stone-Brick Walls Across All 3 Floors + Hollow 3rd-Story White Frieze & Red Band (IMG_5835 2.JPG)
    const totalWallH = rotEaveY - rotFloor0; // 10.70m

    // Back Wall + Side Walls
    buildWallSegment(rotX, rotFloor0, rotBackZ, rotW, totalWallH, 0.32, materials.rotundaBrick);
    buildWallSegment(rotLeftX, rotFloor0, rotZ, 0.32, totalWallH, rotD, materials.rotundaBrick);
    buildWallSegment(rotRightX, rotFloor0, rotZ, 0.32, totalWallH, rotD, materials.rotundaBrick);

    // Front Facade Walls:
    // West Wing Front Wall & East Wing Front Wall
    buildWallSegment(-5.7, rotFloor0, rotFrontZ, 14.6, totalWallH, 0.32, materials.rotundaBrick);
    buildWallSegment(17.7, rotFloor0, rotFrontZ, 14.6, totalWallH, 0.32, materials.rotundaBrick);

    // Central Portico Entrance Wall:
    // Ground Floor: Wide central 2.8m double-doorway flanked by glazed window walls
    buildWallSegment(3.1, rotFloor0, rotFrontZ, 3.0, storyH, 0.30, materials.rotundaBrick);
    buildWallSegment(8.9, rotFloor0, rotFrontZ, 3.0, storyH, 0.30, materials.rotundaBrick);
    const mainDoorTransom = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.85, 0.32), materials.rotundaWhiteArch);
    mainDoorTransom.position.set(rotX, rotFloor0 + storyH - 0.42, rotFrontZ);
    scene.add(mainDoorTransom);
    // Goal 4: Warm glow at the Grand Rotunda Main Entrance & Portico Steps!
    addWarmDoorwayGlow(rotX, rotFloor0, rotFrontZ, 2.8, false);
    addWarmDoorwayGlow(rotX, 0.01, rotFrontZ - 5.8, 3.6, false);

    // Under-Portico Wide Dark-Framed Multi-Pane Glass Windows on Ground & 1st Floor
    [3.1, 8.9].forEach(px => {
      const gPortWin = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.85), materials.windowWarmLit);
      gPortWin.rotation.y = Math.PI;
      gPortWin.position.set(px, rotFloor0 + 1.85, rotFrontZ - 0.17);
      scene.add(gPortWin);

      const fPortWin = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.85), materials.windowWarmLit);
      fPortWin.rotation.y = Math.PI;
      fPortWin.position.set(px, rotFloor1 + 1.85, rotFrontZ - 0.17);
      scene.add(fPortWin);
    });

    // 1st Floor Central Portico Wall with central panoramic window
    buildWallSegment(rotX, rotFloor1, rotFrontZ, 8.8, storyH, 0.30, materials.rotundaBrick);
    const centerPortWin = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.95), materials.windowWarmLit);
    centerPortWin.rotation.y = Math.PI;
    centerPortWin.position.set(rotX, rotFloor1 + 1.85, rotFrontZ - 0.17);
    scene.add(centerPortWin);

    // 2nd Floor (3rd Story) Central Archway Opening onto the Semicircular Curved Glass Rotunda Gallery
    buildWallSegment(3.05, rotFloor2, rotFrontZ, 2.9, topStoryH, 0.30, materials.rotundaBrick);
    buildWallSegment(8.95, rotFloor2, rotFrontZ, 2.9, topStoryH, 0.30, materials.rotundaBrick);
    const rotArchHeader = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.75, 0.34), materials.rotundaWhiteArch);
    rotArchHeader.position.set(rotX, rotFloor2 + topStoryH - 0.38, rotFrontZ);
    scene.add(rotArchHeader);

    // D. Interior Partition Walls & Dual Open Classroom Doorways on All 3 Floors (Ground, 1st Floor, 2nd Floor)
    // Each classroom has a Front Concourse Doorway (z = rotFrontZ + 2.0, width 2.2m) AND a Rear Concourse Doorway
    // (z = rotBackZ - 1.8, width 2.2m), opening directly onto the solid Front & Rear Atrium Concourses!
    [rotFloor0, rotFloor1, rotFloor2].forEach((fy, fIdx) => {
      const h = fIdx === 2 ? topStoryH : storyH;
      [1.6, 10.4].forEach(px => {
        const roomSide = px < rotX ? -1 : 1;
        const rCode = String((fIdx + 1) * 100 + (roomSide === -1 ? 1 : 2));
        const rDress = MAIN_BUILDING_ROOM_DRESSING[rCode] || {};
        // 3 Wall Segments leaving two 2.2m-wide open doorways at z = rotFrontZ + 2.0 and z = rotBackZ - 1.8:
        buildWallSegment(px, fy, rotFrontZ + 0.45, 0.26, h, 0.9, materials.rotundaInteriorWall);
        buildWallSegment(px, fy, rotZ + 0.10, 0.26, h, 8.0, materials.rotundaInteriorWall);
        buildWallSegment(px, fy, rotBackZ - 0.35, 0.26, h, 0.7, materials.rotundaInteriorWall);

        // Wood-Framed Glazed Corridor Partition Sidelights along the Center Pier (Ref 2 & Ref 5!)
        const pFrameTop = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.12, 7.8), materials.chairWood);
        pFrameTop.position.set(px, fy + 2.68, rotZ + 0.10);
        scene.add(pFrameTop);
        const pFrameSill = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.10, 7.8), materials.chairWood);
        pFrameSill.position.set(px, fy + 1.05, rotZ + 0.10);
        scene.add(pFrameSill);
        [-2.4, 0.0, 2.4].forEach(gz => {
          const gPane = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.52, 1.85), materials.windowGlass);
          gPane.position.set(px, fy + 1.86, rotZ + 0.10 + gz);
          scene.add(gPane);
          const gMullion = new THREE.Mesh(new THREE.BoxGeometry(0.31, 1.62, 0.10), materials.chairWood);
          gMullion.position.set(px, fy + 1.86, rotZ + 0.10 + gz - 0.95);
          scene.add(gMullion);
        });

        // Wooden Door Frames, Glass Transoms, Half-Open Door Leaves & Room Number Plaques on Both Doorways
        [rotFrontZ + 2.0, rotBackZ - 1.8].forEach((doorZ, dIdx) => {
          addDoorFrameColliders(px, fy, doorZ, 2.20, 0.26, true);
          const dHeader = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.82, 2.24), materials.chairWood);
          dHeader.position.set(px, fy + h - 0.41, doorZ);
          scene.add(dHeader);

          const dTransomGlass = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.46, 1.88), materials.windowGlass);
          dTransomGlass.position.set(px, fy + h - 0.42, doorZ);
          scene.add(dTransomGlass);

          // Requirement 4: Half-open door per room config
          const swingAng = rDress.halfOpenDoor ? 0.92 : 1.35;
          buildSwingingDoor(
            scene,
            px + roomSide * 0.14,
            fy,
            dIdx === 0 ? doorZ + 0.96 : doorZ - 0.96,
            roomSide === -1 ? (dIdx === 0 ? swingAng : -swingAng) : (dIdx === 0 ? Math.PI - swingAng : -Math.PI + swingAng),
            materials.chairWood,
            "door-rotunda-f" + (fIdx + 1) + "-" + (roomSide === -1 ? "W" : "E") + "-" + (dIdx === 0 ? "front" : "rear")
          );
        });
      });
    });

    // E. 4 Projecting White Segmental-Arched Window Bays per Front Wing + 3 per Side Facade (IMG_6032, IMG_6033, IMG_6034!)
    // Exact 35% lit distribution matching reference images:
    // Front West Wing (12 panes): 3rd-floor inner bay (idx===3) warm yellow-amber lit; lower bays dark reflective glass with faint cool sky reflection
    // Front East Wing (12 panes): 3rd-floor bay 1 (idx===1) warm amber lit, bay 2 (idx===2) red accent lit, bay 3 (idx===3) warm lit, plus 1st/ground right bays warm lit
    const westFrontBays = [-11.3, -8.1, -4.9, -1.7];
    const eastFrontBays = [13.7, 16.9, 20.1, 23.3];

    westFrontBays.forEach((bx, idx) => {
      const gMode = idx === 2 ? 'warm' : 'dark';
      const fMode = 'dark';
      const tMode = idx === 3 ? 'warm' : 'dark';
      buildRotundaArchedBay(bx, rotFloor0, rotFrontZ - 0.16, -1, false, gMode, fMode);
      buildTopFloorWindowAndStruts(bx, rotFloor2, rotFrontZ - 0.16, -1, false, tMode);
    });
    eastFrontBays.forEach((bx, idx) => {
      const gMode = idx === 3 ? 'warm' : 'dark';
      const fMode = (idx === 2 || idx === 3) ? 'warm' : 'dark';
      const tMode = idx === 1 ? 'warm' : (idx === 2 ? 'red' : (idx === 3 ? 'warm' : 'dark'));
      buildRotundaArchedBay(bx, rotFloor0, rotFrontZ - 0.16, -1, false, gMode, fMode);
      buildTopFloorWindowAndStruts(bx, rotFloor2, rotFrontZ - 0.16, -1, false, tMode);
    });

    // Outer West & East Side Wall Arched Bays (~35% warm lit)
    [rotZ - 4.5, rotZ, rotZ + 4.5].forEach((sz, idx) => {
      buildRotundaArchedBay(rotLeftX - 0.16, rotFloor0, sz, -1, true, idx === 1 ? 'warm' : 'dark', idx === 0 ? 'warm' : 'dark');
      buildTopFloorWindowAndStruts(rotLeftX - 0.16, rotFloor2, sz, -1, true, idx === 2 ? 'warm' : 'dark');

      buildRotundaArchedBay(rotRightX + 0.16, rotFloor0, sz, 1, true, idx === 0 ? 'warm' : 'dark', idx === 2 ? 'warm' : 'dark');
      buildTopFloorWindowAndStruts(rotRightX + 0.16, rotFloor2, sz, 1, true, idx === 1 ? 'red' : 'dark');
    });

    // Rear Facade Windows & Top Struts (~35% warm lit)
    [-9.5, -4.5, 1.5, 10.5, 16.5, 21.5].forEach((bx, idx) => {
      buildDetailedWindow(bx, rotFloor0 + 1.85, rotBackZ + 0.18, 1, idx === 1 || idx === 4);
      buildDetailedWindow(bx, rotFloor1 + 1.85, rotBackZ + 0.18, 1, idx === 0 || idx === 3);
      buildTopFloorWindowAndStruts(bx, rotFloor2, rotBackZ + 0.16, 1, false, (idx === 2 || idx === 5) ? 'warm' : 'dark');
    });

    // F. Hollow Perimeter 2nd-Story Cornice Ledge + 3rd-Story White Frieze & Terracotta-Red Band (IMG_6033 & IMG_6034!)
    // Built as hollow exterior perimeter strips so the 3-floor interior is 100% unobstructed!
    buildPerimeterBand(rotFloor1 - 0.04, 0.24, 0.22, materials.rotundaWhiteArch); // 1st-Story Projecting Floor Band
    buildPerimeterBand(rotFloor2 - 0.04, 0.30, 0.36, materials.rotundaWhiteArch); // 2nd-Story Projecting White Cornice
    buildPerimeterBand(rotEaveY - 0.61, 1.22, 0.08, materials.rotundaWhiteArch);  // Upper 3rd-Story White Frieze Band
    buildPerimeterBand(rotEaveY - 1.24, 0.12, 0.12, materials.rotundaRedSteel);   // Terracotta-Red Trim Band

    // G. Central 2-Story Semicircular Portico Columns (with Fluted Pedestals) + 3rd-Floor Curved Glass Rotunda (IMG_6033 & IMG_6034)
    const rotRadius = 5.55;
    const colAngles = [-Math.PI * 0.38, -Math.PI * 0.13, Math.PI * 0.13, Math.PI * 0.38];
    colAngles.forEach(ang => {
      const cx = rotX + Math.sin(ang) * rotRadius;
      const cz = rotFrontZ - Math.cos(ang) * rotRadius;

      // 1. Octagonal/Cylindrical Fluted Dark-Grey Concrete Pedestal Base
      const pedH = 1.48;
      const pedBase = new THREE.Mesh(
        new THREE.CylinderGeometry(0.52, 0.56, pedH, 16),
        materials.rotundaColumnFlutedBase
      );
      pedBase.position.set(cx, rotFloor0 + pedH / 2, cz);
      pedBase.castShadow = true;
      scene.add(pedBase);

      // Pedestal Ground Contact Shadow Disk
      const pedShadow = new THREE.Mesh(sharedGeos.columnContactShadow, materials.pedestalShadowDecal);
      pedShadow.rotation.x = -Math.PI / 2;
      pedShadow.position.set(cx, rotFloor0 + 0.02, cz);
      scene.add(pedShadow);

      // Vertical fluted relief ribs around the pedestal base
      for (let fl = 0; fl < 12; fl++) {
        const fang = (fl * Math.PI * 2) / 12;
        const flute = new THREE.Mesh(new THREE.BoxGeometry(0.05, pedH - 0.24, 0.05), materials.castIronDark);
        flute.position.set(cx + Math.sin(fang) * 0.53, rotFloor0 + pedH / 2, cz + Math.cos(fang) * 0.53);
        flute.rotation.y = fang;
        scene.add(flute);
      }

      // Molded top & bottom collar rings on pedestal
      [rotFloor0 + 0.08, rotFloor0 + pedH - 0.06].forEach(ry => {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.12, 16), materials.rotundaPlinthConcrete);
        ring.position.set(cx, ry, cz);
        scene.add(ring);
      });

      // 2. Tall Cylindrical Weathered White Concrete Column Shaft rising to the 2nd-floor ring beam (y = 0.48..7.62)
      const colShaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.45, 7.12, 20),
        materials.rotundaWhiteArch
      );
      colShaft.position.set(cx, rotFloor0 + 3.56, cz);
      colShaft.castShadow = true;
      scene.add(colShaft);

      addColliderBox(new THREE.Box3(
        new THREE.Vector3(cx - 0.52, 0, cz - 0.52),
        new THREE.Vector3(cx + 0.52, rotFloor2, cz + 0.52)
      ));
    });

    // 3rd-Floor Curved Semicircular Stone-Brick Entablature Parapet + 10-Bay Rotunda Glass Ring (Fix 7: IMG_6033 & IMG_6034!)
    const parapetH = 1.05;
    const curvedParapet = new THREE.Mesh(
      new THREE.CylinderGeometry(rotRadius + 0.28, rotRadius + 0.28, parapetH, 28, 1, true, Math.PI * 0.5, Math.PI),
      materials.rotundaWhiteArch
    );
    curvedParapet.position.set(rotX, rotFloor2 + parapetH / 2, rotFrontZ);
    scene.add(curvedParapet);

    const parapetCoping = new THREE.Mesh(
      new THREE.CylinderGeometry(rotRadius + 0.38, rotRadius + 0.38, 0.14, 28, 1, false, Math.PI * 0.5, Math.PI),
      materials.rotundaWhiteArch
    );
    parapetCoping.position.set(rotX, rotFloor2 + parapetH + 0.05, rotFrontZ);
    scene.add(parapetCoping);

    // Fix 7: Rotunda Glass Ring — 10 individual curved glass bays: dark reflective glass + 2 warm interior-lit sections + visible orange railing!
    const glassCurtainH = 2.18;
    const numRotBays = 10;
    const litRotBays = (HORROR_CONFIG.mainBuilding && HORROR_CONFIG.mainBuilding.rotundaLitBayIndices) || [3, 6];
    for (let b = 0; b < numRotBays; b++) {
      const thetaStart = Math.PI * 0.52 + (b / numRotBays) * Math.PI * 0.96;
      const thetaLen = (Math.PI * 0.96) / numRotBays;
      const isLitBay = litRotBays.indexOf(b) !== -1;
      const bayGlassMat = isLitBay
        ? (materials.rotundaCurvedGlassWarm || materials.rotundaCurvedGlass)
        : materials.rotundaCurvedGlass;
      const bayGlassMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(rotRadius + 0.08, rotRadius + 0.08, glassCurtainH, 6, 1, true, thetaStart, thetaLen),
        bayGlassMat
      );
      bayGlassMesh.position.set(rotX, rotFloor2 + parapetH + glassCurtainH / 2, rotFrontZ);
      scene.add(bayGlassMesh);
    }

    // Visible Warm-Orange Interior Safety Railing inside the Rotunda Glass Ring (Fix 7!)
    [rotFloor2 + parapetH + 0.46, rotFloor2 + parapetH + 0.88].forEach((railY, rIdx) => {
      const orangeRail = new THREE.Mesh(
        new THREE.CylinderGeometry(rotRadius - 0.08, rotRadius - 0.08, rIdx === 1 ? 0.075 : 0.055, 28, 1, true, Math.PI * 0.52, Math.PI * 0.96),
        materials.rotundaOrangeRailingMat || materials.rotundaRedSteel
      );
      orangeRail.position.set(rotX, railY, rotFrontZ);
      scene.add(orangeRail);
    });
    for (let rp = 0; rp <= numRotBays; rp++) {
      const rang = -Math.PI * 0.48 + (rp / numRotBays) * Math.PI * 0.96;
      const rpx = rotX + Math.sin(rang) * (rotRadius - 0.08);
      const rpz = rotFrontZ - Math.cos(rang) * (rotRadius - 0.08);
      const railPost = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.95, 0.05),
        materials.rotundaOrangeRailingMat || materials.rotundaRedSteel
      );
      railPost.position.set(rpx, rotFloor2 + parapetH + 0.48, rpz);
      railPost.rotation.y = -rang;
      scene.add(railPost);
    }

    // 11 Vertical Weathered Dark Mullion Posts + 2 Horizontal Transom Rings on the Rotunda Glass Ring (IMG_6033 & IMG_6034!)
    for (let m = 0; m <= numRotBays; m++) {
      const mang = -Math.PI * 0.48 + (m / numRotBays) * Math.PI * 0.96;
      const mx = rotX + Math.sin(mang) * (rotRadius + 0.14);
      const mz = rotFrontZ - Math.cos(mang) * (rotRadius + 0.14);
      const mPost = new THREE.Mesh(new THREE.BoxGeometry(0.14, glassCurtainH + 0.35, 0.16), materials.rotundaColumnFlutedBase);
      mPost.position.set(mx, rotFloor2 + parapetH + glassCurtainH / 2, mz);
      mPost.rotation.y = -mang;
      scene.add(mPost);

      // Collider post along outer rotunda rim so players on the 3rd-floor balcony don't walk off the edge
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(mx - 0.35, rotFloor2, mz - 0.35),
        new THREE.Vector3(mx + 0.35, rotFloor2 + 3.2, mz + 0.35)
      ));
    }

    [rotFloor2 + parapetH + 0.85, rotFloor2 + parapetH + glassCurtainH - 0.08].forEach(ty => {
      const transRing = new THREE.Mesh(
        new THREE.CylinderGeometry(rotRadius + 0.16, rotRadius + 0.16, 0.08, 28, 1, true, Math.PI * 0.5, Math.PI),
        materials.castIronDark
      );
      transRing.position.set(rotX, ty, rotFrontZ);
      scene.add(transRing);
    });

    // Inner Cylindrical White Concrete Columns inside the 3rd-Floor Rotunda Gallery
    colAngles.forEach(ang => {
      const icx = rotX + Math.sin(ang) * (rotRadius - 0.85);
      const icz = rotFrontZ - Math.cos(ang) * (rotRadius - 0.85);
      const innerCol = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, topStoryH, 14), materials.rotundaWhiteArch);
      innerCol.position.set(icx, rotFloor2 + topStoryH / 2, icz);
      scene.add(innerCol);
    });

    // Overhanging Semicircular Curved Rotunda Dome/Roof Crown (Bright White Cornice Rim + Lifted Terracotta-Red Top Deck, IMG_6033!)
    const rotRoofSoffit = new THREE.Mesh(
      new THREE.CylinderGeometry(rotRadius + 0.98, rotRadius + 0.98, 0.34, 32, 1, false, Math.PI * 0.5, Math.PI),
      materials.rotundaWhiteArch
    );
    rotRoofSoffit.position.set(rotX, rotEaveY - 0.06, rotFrontZ);
    scene.add(rotRoofSoffit);

    const rotRoofRedTop = new THREE.Mesh(
      new THREE.CylinderGeometry(rotRadius + 0.78, rotRadius + 0.96, 0.24, 32, 1, false, Math.PI * 0.5, Math.PI),
      materials.terracottaRoof
    );
    rotRoofRedTop.position.set(rotX, rotEaveY + 0.18, rotFrontZ);
    scene.add(rotRoofRedTop);

    // Fix 3: Facade Warm Up-Light Wash, Portico Column Wash, Entrance Ground Spill & Baked AO Gradients (Zero New Real Lights; Skipped on FAST)
    const mainBuildingEffectsGroup = new THREE.Group();
    mainBuildingEffectsGroup.name = 'main-building-facade-effects';
    mainBuildingEffectsGroup.userData.noMerge = true;
    scene.add(mainBuildingEffectsGroup);

    if (materials.rotundaFacadeUplightMat && materials.rotundaEntranceSpillMat && materials.rotundaBakedAoMat) {
      // 1) Warm up-light wash planes on West & East front wing facades and central entrance wall
      [-5.7, 17.7].forEach(wx => {
        const wingWash = new THREE.Mesh(new THREE.PlaneGeometry(14.4, 8.8), materials.rotundaFacadeUplightMat);
        wingWash.position.set(wx, rotFloor0 + 4.4, rotFrontZ - 0.38);
        wingWash.rotation.y = Math.PI;
        mainBuildingEffectsGroup.add(wingWash);
      });
      const entranceWash = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 7.2), materials.rotundaFacadeUplightMat);
      entranceWash.position.set(rotX, rotFloor0 + 3.6, rotFrontZ - 0.22);
      entranceWash.rotation.y = Math.PI;
      mainBuildingEffectsGroup.add(entranceWash);

      // 2) Warm up-light wash on the 4 semicircular portico columns
      colAngles.forEach(ang => {
        const cx = rotX + Math.sin(ang) * rotRadius;
        const cz = rotFrontZ - Math.cos(ang) * rotRadius;
        const colWash = new THREE.Mesh(
          new THREE.CylinderGeometry(0.47, 0.50, 6.8, 14, 1, true, Math.PI * 0.55, Math.PI * 0.90),
          materials.rotundaColumnWashMat || materials.rotundaFacadeUplightMat
        );
        colWash.position.set(cx, rotFloor0 + 3.4, cz);
        mainBuildingEffectsGroup.add(colWash);
      });

      // 3) Warm ground light spill at the portico entrance, steps & right-wing lamp plaza
      const porticoSpill = new THREE.Mesh(new THREE.PlaneGeometry(13.5, 11.5), materials.rotundaEntranceSpillMat);
      porticoSpill.rotation.x = -Math.PI / 2;
      porticoSpill.position.set(rotX, rotFloor0 + 0.028, rotFrontZ - 2.6);
      mainBuildingEffectsGroup.add(porticoSpill);

      const forecourtSpill = new THREE.Mesh(new THREE.PlaneGeometry(16.0, 12.0), materials.rotundaEntranceSpillMat);
      forecourtSpill.rotation.x = -Math.PI / 2;
      forecourtSpill.position.set(rotX + 12.5, 0.04, rotFrontZ - 6.5);
      mainBuildingEffectsGroup.add(forecourtSpill);

      // 4) Subtle Baked AO gradient strips under eaves, under 2nd-floor cornice, and between floors
      [
        { y: rotEaveY - 0.28, h: 0.75, zOff: -0.22 },
        { y: rotFloor2 - 0.32, h: 0.62, zOff: -0.22 },
        { y: rotFloor1 - 0.26, h: 0.52, zOff: -0.20 },
      ].forEach(aoRow => {
        [-5.7, 17.7].forEach(wx => {
          const aoStrip = new THREE.Mesh(new THREE.PlaneGeometry(14.6, aoRow.h), materials.rotundaBakedAoMat);
          aoStrip.position.set(wx, aoRow.y, rotFrontZ + aoRow.zOff);
          aoStrip.rotation.y = Math.PI;
          mainBuildingEffectsGroup.add(aoStrip);
        });
      });

      // Curved AO shadow band under the portico entablature & mezzanine ring
      [rotFloor1 - 0.32, rotFloor2 - 0.34, rotEaveY - 0.30].forEach(cay => {
        const curvedAo = new THREE.Mesh(
          new THREE.CylinderGeometry(rotRadius + 0.32, rotRadius + 0.32, 0.55, 28, 1, true, Math.PI * 0.5, Math.PI),
          materials.rotundaBakedAoMat
        );
        curvedAo.position.set(rotX, cay, rotFrontZ);
        mainBuildingEffectsGroup.add(curvedAo);
      });
    }

    // Twin Dark Wrought-Iron Portico Lantern Posts flanking the curved steps (exact match to IMG_6033 & IMG_6034!)
    [-4.35, 4.35].forEach(lxOff => {
      const lpx = rotX + lxOff;
      const lpz = rotFrontZ - 4.45;
      const pPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.35, 8), materials.castIronDark);
      pPole.position.set(lpx, rotFloor0 + 1.68, lpz);
      scene.add(pPole);
      const pCage = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.15, 0.48, 4), materials.castIronDark);
      pCage.position.set(lpx, rotFloor0 + 3.52, lpz);
      scene.add(pCage);
      const pCap = new THREE.Mesh(new THREE.ConeGeometry(0.30, 0.24, 4), materials.castIronDark);
      pCap.position.set(lpx, rotFloor0 + 3.84, lpz);
      scene.add(pCap);
    });
    // Right-wing warm street lamp in front of East Wing (exact match to IMG_6032 & IMG_6033!)
    lampFlickerMod.addLamp(rotX + 14.2, rotFrontZ - 7.2, -1, 'steady_warm');
    addColliderCylinder(rotX + 14.2, rotFrontZ - 7.2, (HORROR_CONFIG.physics && HORROR_CONFIG.physics.streetLampPoleRadius) || 0.20, 0, 4.2);

    // H. Prominent Twin Terracotta-Red Hipped Roofs + Central White Octagonal Skylight Atrium Roof Deck + Water Tanks (IMG_5854!)
    buildTerracottaHippedWingRoof(-5.2, rotEaveY, rotZ, 16.0, rotD, 4.2, -1); // West Wing Hipped Roof
    buildTerracottaHippedWingRoof(17.2, rotEaveY, rotZ, 16.0, rotD, 4.2, 1);  // East Wing Hipped Roof

    // Central Stepped White Flat Roof Terrace & Parapet Wall (between West & East hipped roofs, IMG_5854)
    const centerRoofDeck = new THREE.Mesh(
      new THREE.BoxGeometry(11.6, 0.45, rotD + 1.2),
      materials.rotundaWhiteArch
    );
    centerRoofDeck.position.set(rotX, rotEaveY + 0.22, rotZ + 0.3);
    scene.add(centerRoofDeck);

    // Recessed Octagonal Atrium Skylight Well in the Center of the White Roof Deck (IMG_5854 signature detail!)
    const octRim = new THREE.Mesh(
      new THREE.CylinderGeometry(3.6, 3.8, 0.85, 8, 1, true),
      materials.rotundaWhiteArch
    );
    octRim.position.set(rotX, rotEaveY + 0.72, rotZ - 0.6);
    scene.add(octRim);

    const octSkylightGlass = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.4, 0.12, 8),
      materials.rotundaCurvedGlass
    );
    octSkylightGlass.position.set(rotX, rotEaveY + 0.38, rotZ - 0.6);
    scene.add(octSkylightGlass);

    // Raised Rear White Equipment Platform + Twin Cylindrical White Rooftop Water Tanks (IMG_5854!)
    const tankStand = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.85, 3.2), materials.rotundaWhiteArch);
    tankStand.position.set(rotX - 0.6, rotEaveY + 0.85, rotBackZ - 2.2);
    scene.add(tankStand);

    [-1.55, 0.35].forEach(wtX => {
      const rTank = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.76, 2.05, 16), materials.rotundaWhiteArch);
      rTank.position.set(rotX + wtX, rotEaveY + 2.25, rotBackZ - 2.2);
      scene.add(rTank);
      const tankLid = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.76, 0.24, 16), materials.castIronDark);
      tankLid.position.set(rotX + wtX, rotEaveY + 3.38, rotBackZ - 2.2);
      scene.add(tankLid);
    });

    /* -------------------------------------------------------------------------
       I. POPULATE ALL 3 FLOORS: 6 DISTINCT ROOMS, ATRIUM CONCOURSES, GRAND CHANDELIER,
          HANGING VINES, TILED FLOOR PATTERN, BALCONY RAILINGS & 3RD-FLOOR LOUNGE
       ------------------------------------------------------------------------- */
    // Ground Floor (y = 0.48): West Auditorium Hall 101 & East Admin/Registrar Office 102
    populateGrandRotundaClassroom(-5.7, rotZ, rotFloor0, -1, 1, '101', 'Rotunda Ground West Hall 101');
    populateGrandRotundaClassroom(17.7, rotZ, rotFloor0, 1, 1, '102', 'Rotunda Ground East Hall 102');

    // 1st Floor (y = 4.08): West BIT Classroom 201 & East Reference Library 202
    populateGrandRotundaClassroom(-5.7, rotZ, rotFloor1, -1, 2, '201', 'Rotunda 1st-Floor West Class 201');
    populateGrandRotundaClassroom(17.7, rotZ, rotFloor1, 1, 2, '202', 'Rotunda 1st-Floor East Class 202');

    // 2nd Floor (y = 7.68): West Seminar Hall 301 & East AI/Networking Computer Lab 302
    populateGrandRotundaClassroom(-5.7, rotZ, rotFloor2, -1, 3, '301', 'Rotunda 2nd-Floor West Seminar 301');
    populateGrandRotundaClassroom(17.7, rotZ, rotFloor2, 1, 3, '302', 'Rotunda 2nd-Floor East Lab 302');

    // 1. Tiled Floor Pattern (Geometric Compass Rose Medallion & Inlaid Gold/Slate Borders across All 3 Floors)
    [rotFloor0, rotFloor1, rotFloor2].forEach((tfY, fIdx) => {
      const patZ = fIdx === 0 ? rotFrontZ + 2.4 : rotFrontZ + 2.1;
      const outerRing = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 1.85, 0.016, 16), step2Mats.terrazzoInlayDark);
      outerRing.position.set(rotX, tfY + 0.01, patZ);
      scene.add(outerRing);
      const innerGold = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.020, 8), step2Mats.terrazzoInlayGold);
      innerGold.position.set(rotX, tfY + 0.014, patZ);
      scene.add(innerGold);
      const centerStar = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.024, 1.45), materials.rotundaWhiteArch);
      centerStar.position.set(rotX, tfY + 0.016, patZ);
      centerStar.rotation.y = Math.PI / 4;
      scene.add(centerStar);

      // Decorative runner border strips along Front & Rear concourses
      const fBorder = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.014, 0.18), step2Mats.terrazzoInlayGold);
      fBorder.position.set(rotX, tfY + 0.01, rotFrontZ + 0.85);
      scene.add(fBorder);
      const rBorder = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.014, 0.18), step2Mats.terrazzoInlayGold);
      rBorder.position.set(rotX, tfY + 0.01, rotBackZ - 0.85);
      scene.add(rBorder);
    });

    // 2. Big Central Light Fixture (Multi-Tiered Brass & Crystal Grand Chandelier suspended from Skylight Well)
    const chanGroup = new THREE.Group();
    chanGroup.position.set(rotX, rotEaveY - 0.10, rotZ - 0.6);
    const chanChain = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 4.4, 8), materials.brassGajur);
    chanChain.position.set(0, -2.2, 0);
    chanGroup.add(chanChain);
    [
      { y: -1.4, r: 1.85, h: 0.16 },
      { y: -2.6, r: 1.32, h: 0.14 },
      { y: -3.7, r: 0.78, h: 0.12 },
    ].forEach(tier => {
      const brassRing = new THREE.Mesh(new THREE.CylinderGeometry(tier.r, tier.r, tier.h, 16, 1, true), materials.brassGajur);
      brassRing.position.set(0, tier.y, 0);
      chanGroup.add(brassRing);
      const crystalRing = new THREE.Mesh(new THREE.CylinderGeometry(tier.r - 0.08, tier.r - 0.14, tier.h * 1.4, 12), materials.ceilingLightEmissive);
      crystalRing.position.set(0, tier.y - 0.08, 0);
      chanGroup.add(crystalRing);
    });
    scene.add(chanGroup);

    // 3. Hanging Vines & Balcony Baluster Railings on 1st Floor, 2nd Floor & Semicircular Gallery
    for (let bz = stairZFront + 0.4; bz <= stairZBack - 0.4; bz += 0.85) {
      const bal1 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.02, 6), materials.brassGajur);
      bal1.position.set(4.35, rotFloor1 + 0.51, bz);
      scene.add(bal1);
      const bal2 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.02, 6), materials.brassGajur);
      bal2.position.set(7.65, rotFloor2 + 0.51, bz);
      scene.add(bal2);

      // Cascading green hanging vines draping over the atrium stairwell balconies
      if (Math.round(bz * 10) % 2 === 0) {
        const vine1 = new THREE.Mesh(step2Geos.vineCluster, step2Mats.vineGreen);
        vine1.position.set(4.26, rotFloor1 - 0.42, bz);
        scene.add(vine1);
        const vine2 = new THREE.Mesh(step2Geos.vineCluster, step2Mats.vineGreen);
        vine2.position.set(7.74, rotFloor2 - 0.42, bz);
        scene.add(vine2);
      }
    }
    // Hanging vines around the 2nd & 3rd floor semicircular portico rim
    [-Math.PI * 0.32, -Math.PI * 0.12, Math.PI * 0.12, Math.PI * 0.32].forEach(vang => {
      const vx = rotX + Math.sin(vang) * (rotRadius - 0.25);
      const vz = rotFrontZ - Math.cos(vang) * (rotRadius - 0.25);
      const pVine = new THREE.Mesh(step2Geos.vineCluster, step2Mats.vineGreen);
      pVine.position.set(vx, rotFloor2 - 0.45, vz);
      pVine.rotation.y = -vang;
      scene.add(pVine);
    });

    // 4. Grand Atrium U-Shaped Reception Counter with Green Marble Top, Monitors, Bowls, Paintings, Lounge & Corridor Props (Ref 1, 2, 3, 5!)
    const recCX = rotX + 1.25;
    const recCZ = rotFrontZ + 2.25;
    const recFront = new THREE.Mesh(new THREE.BoxGeometry(2.45, 1.04, 0.72), materials.chairWood);
    recFront.position.set(recCX, rotFloor0 + 0.52, recCZ);
    scene.add(recFront);
    [-1.02, 1.02].forEach(wingX => {
      const recWing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.04, 1.15), materials.chairWood);
      recWing.position.set(recCX + wingX, rotFloor0 + 0.52, recCZ + 0.38);
      scene.add(recWing);
      const lipWing = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 1.24), step2Mats.greenMarbleTop);
      lipWing.position.set(recCX + wingX, rotFloor0 + 1.08, recCZ + 0.38);
      scene.add(lipWing);
    });
    const recTop = new THREE.Mesh(new THREE.BoxGeometry(2.60, 0.08, 0.86), step2Mats.greenMarbleTop);
    recTop.position.set(recCX, rotFloor0 + 1.08, recCZ);
    scene.add(recTop);
    addUnderFurnitureAO(scene, recCX, recCZ + 0.15, 2.85, 1.45, 0, rotFloor0 + 0.016);

    [-0.45, 0.35].forEach((mx, mIdx) => {
      const recMon = new THREE.Mesh(step2Geos.monitorPanel, mIdx === 0 ? step2Mats.monitorScreenOn : step2Mats.monitorScreenOff);
      recMon.position.set(recCX + mx, rotFloor0 + 1.28, recCZ);
      scene.add(recMon);
    });
    const recLamp = new THREE.Mesh(step2Geos.readingLampShade, step2Mats.lampShadeGreen);
    recLamp.position.set(recCX + 0.88, rotFloor0 + 1.26, recCZ);
    scene.add(recLamp);
    // Fallen swivel chair & fanned white papers beside reception counter (Ref 1 & Ref 3)
    const recFallenChair = new THREE.Mesh(sharedGeos.chairSeat, materials.chairWood);
    recFallenChair.position.set(recCX - 1.55, rotFloor0 + 0.24, recCZ + 0.35);
    recFallenChair.rotation.set(1.42, 0.65, 0.18);
    scene.add(recFallenChair);
    const entryMat = new THREE.Mesh(step2Geos.floorMat, step2Mats.matRubber);
    entryMat.position.set(rotX, rotFloor0 + 0.012, rotFrontZ + 0.65);
    scene.add(entryMat);

    addColliderBox(new THREE.Box3(
      new THREE.Vector3(recCX - 1.26, rotFloor0, recCZ - 0.42),
      new THREE.Vector3(recCX + 1.26, rotFloor0 + 1.15, recCZ + 0.96)
    ), 'furniture');

    // Ground Floor Atrium Left & Right Lounge Seating (Armchairs, Low Coffee Tables, Bowls & Scattered Papers, Ref 3!)
    [
      { x: 2.65, z: rotFrontZ + 1.65, sign: 1 },
      { x: 9.35, z: rotFrontZ + 1.65, sign: -1 },
    ].forEach(lg => {
      const cTable = new THREE.Mesh(step2Geos.coffeeTable, materials.deskWoodTop);
      cTable.position.set(lg.x, rotFloor0, lg.z);
      scene.add(cTable);
      addUnderFurnitureAO(scene, lg.x, lg.z, 1.35, 0.82, 0, rotFloor0 + 0.016);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.09, 0.07, 10), materials.deskSteelFrame);
      bowl.position.set(lg.x, rotFloor0 + 0.46, lg.z);
      scene.add(bowl);
      const armCh = new THREE.Mesh(step2Geos.loungeArmchair, step2Mats.sofaLeather);
      armCh.position.set(lg.x - lg.sign * 0.82, rotFloor0, lg.z);
      armCh.rotation.y = lg.sign * Math.PI * 0.5;
      scene.add(armCh);
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(lg.x - 0.95, rotFloor0, lg.z - 0.42),
        new THREE.Vector3(lg.x + 0.65, rotFloor0 + 0.78, lg.z + 0.42)
      ), 'furniture');
    });

    // Rear Atrium Framed Landscape Paintings, Boarded Recess & Safe Eerie Warning Lintel (Ref 3!)
    [3.4, 8.6].forEach(px => {
      const pFrame = new THREE.Mesh(new THREE.BoxGeometry(1.68, 1.12, 0.05), materials.chairWood);
      pFrame.position.set(px, rotFloor0 + 2.05, rotBackZ - 0.19);
      scene.add(pFrame);
      const pArt = new THREE.Mesh(step2Geos.photoCanvas, materials.rotundaInteriorWall);
      pArt.scale.set(1, 1.85, 2.05);
      pArt.rotation.y = Math.PI / 2;
      pArt.position.set(px, rotFloor0 + 2.05, rotBackZ - 0.21);
      scene.add(pArt);
    });
    const warningLintelGeo = remapInteriorAtlasUVs(new THREE.BoxGeometry(3.8, 0.56, 0.06), 768, 384, 256, 128);
    const warningLintel = new THREE.Mesh(warningLintelGeo, materials.rotundaInteriorWall);
    warningLintel.position.set(rotX, rotFloor0 + 2.95, rotBackZ - 0.19);
    scene.add(warningLintel);
    [-0.35, 0.15, 0.65].forEach((by, bIdx) => {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.12, 0.04), materials.deskWoodTop);
      plank.position.set(rotX, rotFloor0 + 0.85 + by, rotBackZ - 0.18);
      plank.rotation.z = (bIdx - 1) * 0.16;
      scene.add(plank);
    });

    interactiveHidingSpots.push(
      {
        id: 'rotunda-reception-desk',
        name: 'Rotunda Atrium Reception Counter',
        x: recCX,
        y: rotFloor0,
        z: recCZ + 1.12,
        zone: 'Grand Rotunda Atrium',
        spotType: 'desk',
        riskLevel: 0.25,
        useCount: 0,
      },
      {
        id: 'rotunda-under-stairs-1f',
        name: 'Under Rotunda West Grand Staircase',
        x: 3.0,
        y: rotFloor0,
        z: 63.2,
        zone: 'Grand Rotunda Atrium',
        spotType: 'stairs',
        riskLevel: 0.18,
        useCount: 0,
      },
      {
        id: 'rotunda-under-stairs-2f',
        name: 'Under Rotunda East Upper Staircase',
        x: 9.0,
        y: rotFloor1,
        z: 64.2,
        zone: 'Grand Rotunda Atrium',
        spotType: 'stairs',
        riskLevel: 0.20,
        useCount: 0,
      }
    );

    // Corridor Fog & Ground Mist Planes + Corridor Props (Cupboards, Water Dispensers, Sofa, Magazine Rack, Exit Signs) across all 3 Rotunda floors
    const corridorMistPlanes = [];
    [rotFloor0, rotFloor1, rotFloor2].forEach((afy, aIdx) => {
      spawnCorridorFogPlanes(scene, rotX, afy, rotZ, 12.0);
      const benchX = aIdx === 0 ? 6.0 : (aIdx === 1 ? 7.2 : 4.8);
      const aBench = new THREE.Mesh(step2Geos.benchLongSeat, materials.chairWood);
      aBench.position.set(benchX, afy + 0.44, rotBackZ - 1.1);
      scene.add(aBench);
      addUnderFurnitureAO(scene, benchX, rotBackZ - 1.1, 1.55, 0.55, 0, afy + 0.016);
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(benchX - 0.72, afy, rotBackZ - 1.35),
        new THREE.Vector3(benchX + 0.72, afy + 0.65, rotBackZ - 0.85)
      ), 'furniture');

      // Corridor Ground Mist Layer (soft drifting fog volume in Main Building concourse)
      const mistPlane = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 13.5), step2Mats.corridorMistMat);
      mistPlane.rotation.x = -Math.PI / 2;
      mistPlane.position.set(rotX, afy + 0.11, rotZ);
      mistPlane.receiveShadow = false;
      mistPlane.castShadow = false;
      mistPlane.userData.noMerge = true;
      mistPlane.userData.baseX = rotX;
      mistPlane.userData.baseZ = rotZ;
      mistPlane.userData.phase = aIdx * 2.1;
      scene.add(mistPlane);
      corridorMistPlanes.push(mistPlane);

      // Corridor Hot/Cold Water Dispenser, Fire Extinguisher, Wooden Cupboard & Glowing Green EXIT Sign (Ref 2 & Ref 5!)
      const wd = new THREE.Mesh(step2Geos.waterDispenser, materials.rotundaInteriorWall);
      wd.position.set(1.92, afy + 0.50, rotFrontZ + 3.6);
      scene.add(wd);
      const wJug = new THREE.Mesh(step2Geos.waterBottle, step2Mats.waterJugBlue);
      wJug.position.set(1.92, afy + 1.20, rotFrontZ + 3.6);
      scene.add(wJug);
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(1.68, afy, rotFrontZ + 3.36),
        new THREE.Vector3(2.16, afy + 1.45, rotFrontZ + 3.84)
      ), 'furniture');

      const fExt = new THREE.Mesh(step2Geos.fireExtBody, step2Mats.fireRed);
      fExt.position.set(10.18, afy + 1.22, rotFrontZ + 3.6);
      scene.add(fExt);

      // Glowing Green [EXIT ->] Sign suspended from corridor ceiling (Ref 2 & Ref 5)
      const exitSign = new THREE.Mesh(step2Geos.exitSignBox, step2Mats.exitSignGreenMat);
      exitSign.position.set(rotX, afy + 3.12, rotFrontZ + 1.15);
      scene.add(exitSign);

      if (aIdx === 1) {
        // 1st-Floor Corridor Lounge: Dark Leather Sofa, 4-Tier Wall Magazine Rack & Green-Lit 3D Wall Sign (Ref 5!)
        const cSofa = new THREE.Mesh(step2Geos.sofaBase, step2Mats.sofaLeather);
        cSofa.position.set(8.2, afy + 0.21, rotFrontZ + 1.15);
        scene.add(cSofa);
        const cSofaBack = new THREE.Mesh(step2Geos.sofaBack, step2Mats.sofaLeather);
        cSofaBack.position.set(8.2, afy + 0.56, rotFrontZ + 0.82);
        scene.add(cSofaBack);
        addColliderBox(new THREE.Box3(
          new THREE.Vector3(7.2, afy, rotFrontZ + 0.72),
          new THREE.Vector3(9.2, afy + 0.85, rotFrontZ + 1.58)
        ), 'furniture');
        const magRack = new THREE.Mesh(step2Geos.wallMagazineRack, materials.chairWood);
        magRack.position.set(10.22, afy + 1.68, rotFrontZ + 3.95);
        magRack.rotation.y = Math.PI;
        scene.add(magRack);
      }

      // Potted plants flanking the main atrium concourse
      [2.1, 9.9].forEach(px => {
        const pot = new THREE.Mesh(step2Geos.plantPot, materials.chairWood);
        pot.position.set(px, afy + 0.18, rotFrontZ + 0.65);
        scene.add(pot);
        const bush = new THREE.Mesh(step2Geos.plantBush, materials.foliageGreen);
        bush.position.set(px, afy + 0.48, rotFrontZ + 0.65);
        scene.add(bush);
      });
    });

    // 3rd-Floor Curved Rotunda Panoramic Seminar & Observation Lounge with Desktop Phone & Overturned Chair (Ref 5!)
    const loungeTable = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.08, 20), materials.deskWoodTop);
    loungeTable.position.set(rotX, rotFloor2 + 0.76, rotFrontZ - 2.8);
    scene.add(loungeTable);
    const loungePedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.52, 0.74, 14), materials.deskSteelFrame);
    loungePedestal.position.set(rotX, rotFloor2 + 0.37, rotFrontZ - 2.8);
    scene.add(loungePedestal);
    const lPhone = new THREE.Mesh(step2Geos.desktopPhone, materials.deskSteelFrame);
    lPhone.position.set(rotX - 0.38, rotFloor2 + 0.80, rotFrontZ - 2.65);
    lPhone.rotation.y = 0.42;
    scene.add(lPhone);

    for (let ch = 0; ch < 6; ch++) {
      const cang = (ch * Math.PI * 2) / 6;
      const chSeat = new THREE.Mesh(sharedGeos.chairSeat, ch === 2 ? step2Mats.lockerDoorBlue : materials.chairWood);
      if (ch === 2) {
        // Overturned blue/slate chair lying on its side in the window blind shadows (Ref 5!)
        chSeat.position.set(rotX + Math.sin(cang) * 2.05, rotFloor2 + 0.24, rotFrontZ - 2.8 + Math.cos(cang) * 2.05);
        chSeat.rotation.set(1.48, cang + 0.35, 0.15);
      } else {
        chSeat.position.set(rotX + Math.sin(cang) * 1.85, rotFloor2 + 0.45, rotFrontZ - 2.8 + Math.cos(cang) * 1.85);
        chSeat.rotation.y = cang;
      }
      scene.add(chSeat);
    }

    addColliderBox(new THREE.Box3(
      new THREE.Vector3(rotX - 1.4, rotFloor2, rotFrontZ - 4.2),
      new THREE.Vector3(rotX + 1.4, rotFloor2 + 0.85, rotFrontZ - 1.4)
    ), 'furniture');

    interactiveHidingSpots.push(
      { id: 'rotunda-3f-lounge', name: '3rd-Floor Curved Rotunda Panoramic Table', x: rotX + 1.95, y: rotFloor2, z: rotFrontZ - 2.8, zone: '3rd-Floor Rotunda Balcony', spotType: 'desk', riskLevel: 0.25, useCount: 0 },
      { id: 'parked-suv', name: 'Parked Campus SUV (Wing L1 South)', x: -8.15, y: 0.0, z: -34.5, zone: 'Parking Plaza', spotType: 'desk', riskLevel: 0.30, useCount: 0 },
      { id: 'rotunda-fountain', name: 'Rotunda Courtyard Fountain', x: ftnX + 2.85, y: 0.0, z: ftnZ, zone: 'Grand Rotunda Plaza', spotType: 'desk', riskLevel: 0.32, useCount: 0 }
    );

    // J. Glowing Recessed Square Drop-Ceiling Panels Across All 3 Floors of the Grand Rotunda Complex (Ref 1 & Ref 2!)
    [
      { x: rotX - 2.2, y: rotFloor0 + 3.2, z: rotFrontZ + 2.2 },
      { x: rotX + 2.2, y: rotFloor0 + 3.2, z: rotFrontZ + 2.2 },
      { x: rotX, y: rotFloor0 + 3.2, z: rotBackZ - 1.8 },
      { x: rotX, y: rotFloor1 + 3.2, z: rotFrontZ + 2.1 },
      { x: rotX, y: rotFloor1 + 3.2, z: rotBackZ - 1.8 },
      { x: rotX, y: rotFloor2 + 3.1, z: rotFrontZ - 2.4 },
    ].forEach(cfg => {
      const ceilOrb = new THREE.Mesh(step2Geos.recessedCeilingPanel, step2Mats.recessedPanelWarmMat);
      ceilOrb.position.set(cfg.x, cfg.y + 0.14, cfg.z);
      scene.add(ceilOrb);
    });

    /* =========================================================================
       8. REALISTIC TREES, BUSHES & SPARSE WARM AMBER LAMPS
       (Dense horror shadows between isolated warm amber pools — iPhone 17 Optimized!)
       ========================================================================= */
    // Gnarled Silhouette Trees & Bushes framing the Concrete Footpaths, Lawns & Rotunda Plaza
    spawnCampusTree(-8.2, -53.5, 1.45);
    spawnCampusTree(10.8, -55.0, 1.52);
    spawnPalmTree(-6.2, -33.5, 1.15);
    spawnCampusTree(11.2, -20.5, 1.35);
    spawnPalmTree(-5.8, -15.5, 1.18);
    spawnCampusTree(-6.4, -1.5, 1.32);
    spawnPalmTree(10.5, -4.5, 1.15);
    spawnCampusTree(-12.5, 22.0, 1.55);
    spawnCampusTree(23.5, 22.0, 1.50);
    spawnPalmTree(-4.5, 19.5, 1.25);
    spawnPalmTree(16.5, 19.5, 1.25);

    // Bushes & Shrub Clumps along the Concrete Footpath Curbs & Trees
    spawnRoadsideShrubs(-4.2, -55.5, 5);
    spawnRoadsideShrubs(-4.6, -38.5, 4);
    spawnRoadsideShrubs(8.4, -24.0, 5);
    spawnRoadsideShrubs(-4.4, -10.5, 4);
    spawnRoadsideShrubs(8.4, 3.5, 5);
    spawnRoadsideShrubs(-6.2, 25.5, 5);
    spawnRoadsideShrubs(17.8, 25.5, 5);
    spawnRoadsideShrubs(-13.8, -12.0, 4);
    spawnRoadsideShrubs(21.2, -8.0, 4);

    // TASK 3: Dead Leafless Horror Trees, Campus Benches, Old Curfew Posters & Mandala Heritage Archway
    spawnDeadTree(-22.5, -34.0, 1.38);
    spawnDeadTree(21.5, 36.0, 1.45);
    buildMandalaStreetArchway(-12.0, -28.5, 4.2);
    buildCampusBench(-4.2, -14.0, Math.PI / 2);
    buildCampusBench(4.8, 8.0, -Math.PI / 2);
    buildCampusBench(-9.5, 44.0, 0);
    buildCampusBench(21.5, 44.0, 0);
    spawnOldWallPoster(-2.65, 1.65, -24.0, Math.PI / 2, 0.05);
    spawnOldWallPoster(10.65, 1.60, -18.0, -Math.PI / 2, -0.07);
    spawnOldWallPoster(-13.65, 1.68, 16.0, Math.PI / 2, 0.04);
    spawnOldWallPoster(rotX - 4.2, rotFloor0 + 1.75, rotFrontZ - 0.18, Math.PI, -0.04);

    // Fix 6: High-Resolution "GANDAKI UNIVERSITY" Curved Entablature Sign (2048x256 with mipmaps, anisotropy & slight emissive)
    const signBackingArc = new THREE.Mesh(
      new THREE.CylinderGeometry(rotRadius + 0.36, rotRadius + 0.36, 0.78, 28, 1, true, Math.PI * 0.68, Math.PI * 0.64),
      materials.rotundaWhiteArch
    );
    signBackingArc.position.set(rotX, rotFloor2 + 0.42, rotFrontZ);
    scene.add(signBackingArc);

    const mainFacadeSign = new THREE.Mesh(
      new THREE.CylinderGeometry(rotRadius + 0.40, rotRadius + 0.40, 0.68, 28, 1, true, Math.PI * 0.70, Math.PI * 0.60),
      materials.rotundaSignMat || sharedSignageAtlasMat
    );
    mainFacadeSign.position.set(rotX, rotFloor2 + 0.42, rotFrontZ);
    mainFacadeSign.userData.noMerge = true;
    scene.add(mainFacadeSign);

    // TASK 1: Sparse Warm Amber Lamps (#ffc27a, distance 10) — Mix of Faulty Flickering, Steady & Fully Dead ('dead') Lamps!
    const lampPoleRadius = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.streetLampPoleRadius) || 0.20;
    lampFlickerMod.addLamp(3.2, -61.0, 1, 'intermittent');
    addColliderCylinder(3.2, -61.0, lampPoleRadius, 0, 4.2);
    lampFlickerMod.addLamp(-16.0, -50.0, 1, 'steady_warm');
    addColliderCylinder(-16.0, -50.0, lampPoleRadius, 0, 4.2);
    lampFlickerMod.addLamp(11.5, -42.0, 1, 'steady_warm');
    addColliderCylinder(11.5, -42.0, lampPoleRadius, 0, 4.2);
    lampFlickerMod.addLamp(-1.2, -30.0, 1, 'steady_warm');
    addColliderCylinder(-1.2, -30.0, lampPoleRadius, 0, 4.2);
    lampFlickerMod.addLamp(-1.2, -8.0, -1, 'heavy_blink');
    addColliderCylinder(-1.2, -8.0, lampPoleRadius, 0, 4.2);
    lampFlickerMod.addLamp(2.0, 16.0, 1, 'intermittent');
    addColliderCylinder(2.0, 16.0, lampPoleRadius, 0, 4.2);
    lampFlickerMod.addLamp(-12.0, -19.0, 1, 'steady_warm');
    addColliderCylinder(-12.0, -19.0, lampPoleRadius, 0, 4.2);
    lampFlickerMod.addLamp(-12.0, 7.5, -1, 'heavy_blink');
    addColliderCylinder(-12.0, 7.5, lampPoleRadius, 0, 4.2);
    lampFlickerMod.addLamp(-27.5, -36.0, 1, 'dead');
    addColliderCylinder(-27.5, -36.0, lampPoleRadius, 0, 4.2);
    lampFlickerMod.addLamp(-27.5, -8.0, -1, 'intermittent');
    addColliderCylinder(-27.5, -8.0, lampPoleRadius, 0, 4.2);
    lampFlickerMod.addLamp(19.5, -18.0, 1, 'heavy_blink');
    addColliderCylinder(19.5, -18.0, lampPoleRadius, 0, 4.2);
    lampFlickerMod.addLamp(19.5, 8.0, -1, 'heavy_blink');
    addColliderCylinder(19.5, 8.0, lampPoleRadius, 0, 4.2);
    lampFlickerMod.addLamp(-4.0, 42.0, 1, 'steady_warm');
    addColliderCylinder(-4.0, 42.0, lampPoleRadius, 0, 4.2);
    lampFlickerMod.addLamp(16.0, 42.0, -1, 'intermittent');
    addColliderCylinder(16.0, 42.0, lampPoleRadius, 0, 4.2);
    lampFlickerMod.addLamp(1.2, 54.0, 1, 'heavy_blink');
    addColliderCylinder(1.2, 54.0, lampPoleRadius, 0, 4.2);
    lampFlickerMod.addLamp(10.8, 54.0, -1, 'steady_warm');
    addColliderCylinder(10.8, 54.0, lampPoleRadius, 0, 4.2);

    lampFlickerMod.addWallSconce(rotX, rotFloorY + 3.4, rotFrontZ - 0.35, 'steady_warm');
    lampFlickerMod.addWallSconce(rotX, rotFloor1 + 3.1, rotZ, 'steady_warm');
    lampFlickerMod.addWallSconce(rotX, rotFloor2 + 3.0, rotFrontZ - 2.4, 'steady_warm');
    lampFlickerMod.addWallSconce(-6.5, 2.9, -33.2, 'steady_warm');
    lampFlickerMod.addWallSconce(-28.4, 2.9, -22.0, 'intermittent');

    /* =========================================================================
       PHASE A FINALIZATION: INSTANCED TREES & SHRUBS + BUILDING/SECTOR MERGING
       + ROOM & BUILDING VISIBILITY & SHADOW-CASTER BUDGET MANAGER (< 400 DRAW CALLS)
       ========================================================================= */
    const buildingSectors = [];
    let visibleRoomsCount = 0;

    (function finalizePhaseASceneOptimization() {
      const dummy = new THREE.Object3D();

      // 1. Build InstancedMesh for Campus Horror Trees (12 trees -> 2 draw calls: bark + canopy)
      if (exteriorTreeQueues.campusTrees.length > 0) {
        const barkParts = [];
        const canopyParts = [];
        const addXform = (arr, geo, x, y, z, rx, ry, rz, sx = 1, sy = 1, sz = 1) => {
          const g = geo.clone();
          dummy.position.set(x, y, z);
          dummy.rotation.set(rx, ry, rz);
          dummy.scale.set(sx, sy, sz);
          dummy.updateMatrix();
          g.applyMatrix4(dummy.matrix);
          arr.push(g);
        };
        addXform(barkParts, new THREE.CylinderGeometry(0.28, 0.48, 2.6, 8), 0, 1.3, 0, 0, 0, 0.06);
        addXform(barkParts, new THREE.CylinderGeometry(0.18, 0.29, 2.4, 7), -0.12, 3.5, 0.08, 0, 0, -0.11);
        const limbConfigs = [
          { rx: 0.48, rz:  0.65, len: 2.8, y: 3.9, ox: -0.9, oz:  0.6 },
          { rx: -0.42, rz: -0.62, len: 3.0, y: 4.1, ox:  1.0, oz: -0.5 },
          { rx: 0.62, rz: -0.35, len: 2.5, y: 4.3, ox:  0.5, oz:  0.9 },
          { rx: -0.55, rz:  0.40, len: 2.6, y: 3.7, ox: -0.7, oz: -0.8 },
          { rx: 0.25, rz:  0.78, len: 2.4, y: 4.6, ox: -1.2, oz:  0.2 },
        ];
        limbConfigs.forEach(cfg => {
          addXform(barkParts, new THREE.CylinderGeometry(0.05, 0.14, cfg.len, 6), cfg.ox, cfg.y, cfg.oz, cfg.rx, 0, cfg.rz);
          addXform(barkParts, new THREE.CylinderGeometry(0.02, 0.06, 1.5, 5), cfg.ox * 1.55, cfg.y + 0.85, cfg.oz * 1.55, cfg.rx * 1.25, 0.3, cfg.rz * 1.25);
          addXform(canopyParts, new THREE.DodecahedronGeometry(1.25, 1), cfg.ox * 1.45, cfg.y + 1.05, cfg.oz * 1.45, 0, 0, 0, 1.25, 0.68, 1.25);
        });
        const mergedBarkGeo = THREE.BufferGeometryUtils.mergeBufferGeometries(barkParts);
        const mergedCanopyGeo = THREE.BufferGeometryUtils.mergeBufferGeometries(canopyParts);
        const n = exteriorTreeQueues.campusTrees.length;
        const instBark = new THREE.InstancedMesh(mergedBarkGeo, materials.treeBark, n);
        const instCanopy = new THREE.InstancedMesh(mergedCanopyGeo, materials.foliageGreen, n);
        exteriorTreeQueues.campusTrees.forEach((t, idx) => {
          dummy.position.set(t.x, 0, t.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(t.scale, t.scale, t.scale);
          dummy.updateMatrix();
          instBark.setMatrixAt(idx, dummy.matrix);
          instCanopy.setMatrixAt(idx, dummy.matrix);
        });
        instBark.instanceMatrix.needsUpdate = true;
        instCanopy.instanceMatrix.needsUpdate = true;
        instBark.castShadow = true;
        instBark.receiveShadow = true;
        instCanopy.castShadow = true;
        instCanopy.receiveShadow = true;
        computeInstancedBoundingSphere(instBark, n);
        computeInstancedBoundingSphere(instCanopy, n);
        scene.add(instBark);
        scene.add(instCanopy);
      }

      // 2. Build InstancedMesh for Palm Trees (5 palms -> 2 draw calls: trunk + crown)
      if (exteriorTreeQueues.palmTrees.length > 0) {
        const trunkGeo = new THREE.CylinderGeometry(0.14, 0.24, 5.6, 8).clone();
        dummy.position.set(0, 2.8, 0);
        dummy.rotation.set(0, 0, 0.05);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        trunkGeo.applyMatrix4(dummy.matrix);
        const frondParts = [];
        for (let f = 0; f < 9; f++) {
          const ang = (f * Math.PI * 2) / 9;
          const fg = new THREE.BoxGeometry(0.36, 0.04, 2.35).clone();
          dummy.position.set(Math.sin(ang) * 1.05, 5.40, Math.cos(ang) * 1.05);
          dummy.rotation.set(0.42, ang, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          fg.applyMatrix4(dummy.matrix);
          frondParts.push(fg);
        }
        const mergedCrownGeo = THREE.BufferGeometryUtils.mergeBufferGeometries(frondParts);
        const np = exteriorTreeQueues.palmTrees.length;
        const instPTrunk = new THREE.InstancedMesh(trunkGeo, materials.treeBark, np);
        const instPCrown = new THREE.InstancedMesh(mergedCrownGeo, materials.palmFrondMat, np);
        exteriorTreeQueues.palmTrees.forEach((t, idx) => {
          dummy.position.set(t.x, 0, t.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(t.scale, t.scale, t.scale);
          dummy.updateMatrix();
          instPTrunk.setMatrixAt(idx, dummy.matrix);
          instPCrown.setMatrixAt(idx, dummy.matrix);
        });
        instPTrunk.instanceMatrix.needsUpdate = true;
        instPCrown.instanceMatrix.needsUpdate = true;
        instPTrunk.castShadow = true;
        instPTrunk.receiveShadow = true;
        instPCrown.castShadow = false;
        instPCrown.receiveShadow = true;
        computeInstancedBoundingSphere(instPTrunk, np);
        computeInstancedBoundingSphere(instPCrown, np);
        scene.add(instPTrunk);
        scene.add(instPCrown);
      }

      // 3. Build InstancedMesh for Dead Trees & Roadside Shrubs
      if (exteriorTreeQueues.deadTrees.length > 0) {
        const deadParts = [];
        const tg = new THREE.CylinderGeometry(0.18, 0.44, 4.2, 7).clone();
        dummy.position.set(0, 2.1, 0);
        dummy.rotation.set(0, 0, 0.09);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        tg.applyMatrix4(dummy.matrix);
        deadParts.push(tg);
        [
          { rx: 0.62, rz:  0.74, len: 3.1, y: 3.4, ox: -0.8, oz:  0.5 },
          { rx: -0.58, rz: -0.68, len: 3.3, y: 3.7, ox:  0.9, oz: -0.6 },
          { rx: 0.72, rz: -0.42, len: 2.7, y: 3.9, ox:  0.4, oz:  0.8 },
          { rx: -0.65, rz:  0.48, len: 2.8, y: 3.1, ox: -0.7, oz: -0.7 },
        ].forEach(cfg => {
          const lg = new THREE.CylinderGeometry(0.025, 0.13, cfg.len, 5).clone();
          dummy.position.set(cfg.ox, cfg.y, cfg.oz);
          dummy.rotation.set(cfg.rx, 0, cfg.rz);
          dummy.updateMatrix();
          lg.applyMatrix4(dummy.matrix);
          deadParts.push(lg);
        });
        const mergedDeadGeo = THREE.BufferGeometryUtils.mergeBufferGeometries(deadParts);
        const nd = exteriorTreeQueues.deadTrees.length;
        const instDead = new THREE.InstancedMesh(mergedDeadGeo, materials.treeBark, nd);
        exteriorTreeQueues.deadTrees.forEach((t, idx) => {
          dummy.position.set(t.x, 0, t.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(t.scale, t.scale, t.scale);
          dummy.updateMatrix();
          instDead.setMatrixAt(idx, dummy.matrix);
        });
        instDead.instanceMatrix.needsUpdate = true;
        instDead.castShadow = true;
        instDead.receiveShadow = true;
        computeInstancedBoundingSphere(instDead, nd);
        scene.add(instDead);
      }

      if (exteriorTreeQueues.shrubs.length > 0) {
        const ns = exteriorTreeQueues.shrubs.length;
        const instShrubs = new THREE.InstancedMesh(sharedGeos.shrubClump, materials.foliageGreen, ns);
        exteriorTreeQueues.shrubs.forEach((s, idx) => {
          dummy.position.set(s.x, s.y, s.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(s.sx, s.sy, s.sz);
          dummy.updateMatrix();
          instShrubs.setMatrixAt(idx, dummy.matrix);
        });
        instShrubs.instanceMatrix.needsUpdate = true;
        instShrubs.castShadow = false;
        instShrubs.receiveShadow = true;
        computeInstancedBoundingSphere(instShrubs, ns);
        scene.add(instShrubs);
      }

      // 4. Partition static exterior & building meshes into spatial Building/Courtyard Sectors and bake each sector by material!
      const sectorDefs = [
        { id: 'ground-base', x: 0, z: 0, radius: 220, alwaysVisible: true, test: (x, z) => false },
        { id: 'rotunda-complex', x: 6.0, z: 60.0, radius: 26.0, isLandmark: true, test: (x, z) => z >= 36.0 },
        { id: 'west-wing-l1', x: -6.5, z: -18.0, radius: 18.0, test: (x, z) => x >= -12.5 && x <= -1.5 && z >= -34.0 && z <= -2.0 },
        { id: 'west-wing-l2', x: -17.5, z: -12.0, radius: 17.0, test: (x, z) => x >= -23.0 && x < -12.5 && z >= -28.0 && z <= 4.0 },
        { id: 'west-wing-l3', x: -17.5, z: 20.0, radius: 15.0, test: (x, z) => x >= -23.0 && x <= -11.0 && z > 4.0 && z < 36.0 },
        { id: 'east-wing-r1-r2', x: 20.0, z: -19.0, radius: 20.0, test: (x, z) => x >= 10.0 && z >= -38.0 && z <= 2.0 },
        { id: 'east-wing-r4', x: 25.5, z: 20.0, radius: 18.0, test: (x, z) => x >= 10.0 && z > 2.0 && z < 36.0 },
        { id: 'west-heritage-cluster', x: -34.0, z: -12.0, radius: 28.0, test: (x, z) => x < -23.0 && z >= -52.0 && z < 36.0 },
        { id: 'south-gate-parking', x: 0.0, z: -50.0, radius: 28.0, test: (x, z) => z < -34.0 },
        { id: 'central-courtyard', x: 0.0, z: 0.0, radius: 36.0, test: () => true },
      ];

      sectorDefs.forEach(sd => {
        const grp = new THREE.Group();
        grp.name = sd.id;
        scene.add(grp);
        buildingSectors.push({ ...sd, group: grp });
      });

      scene.updateMatrixWorld(true);
      const topChildren = scene.children.slice();
      const worldPos = new THREE.Vector3();
      const childWorldPos = new THREE.Vector3();

      for (let i = 0; i < topChildren.length; i++) {
        const ch = topChildren[i];
        if (!ch || ch === atmosphere.skyGroup || ch.isLight || ch.isCamera || ch.isInstancedMesh || ch.isPoints) continue;
        if (ch.userData && (ch.userData.isRoomGroup || (ch.userData.noMerge && !ch.userData.isSwingingDoor))) continue;
        if (buildingSectors.some(s => s.group === ch)) continue;
        if (ch === terrainMesh || ch === southParkingApron) {
          buildingSectors[0].group.add(ch);
          continue;
        }
        ch.getWorldPosition(worldPos);
        // If a top-level Group sits at origin (0,0,0), compute the centroid of its child meshes so it joins its true spatial sector
        if (ch.isGroup && Math.abs(worldPos.x) < 0.01 && Math.abs(worldPos.z) < 0.01 && ch.children.length > 0) {
          let sumX = 0, sumZ = 0, cnt = 0;
          ch.traverse(sub => {
            if (sub !== ch && (sub.isMesh || sub.isInstancedMesh)) {
              sub.getWorldPosition(childWorldPos);
              sumX += childWorldPos.x;
              sumZ += childWorldPos.z;
              cnt++;
            }
          });
          if (cnt > 0) {
            worldPos.x = sumX / cnt;
            worldPos.z = sumZ / cnt;
          }
        }
        for (let s = 1; s < buildingSectors.length; s++) {
          if (buildingSectors[s].test(worldPos.x, worldPos.z)) {
            buildingSectors[s].group.add(ch);
            break;
          }
        }
      }

      for (let s = 0; s < buildingSectors.length; s++) {
        bakeStaticGroup(buildingSectors[s].group, true);
      }

      // Flat ground planes (sector 0) only receive shadows and never need to cast shadows into moonDirLight
      buildingSectors[0].group.traverse(ch => {
        if (ch.isMesh) ch.castShadow = false;
      });

      // Cache mesh lists on rooms & sectors so shadow-caster culling is O(1) without per-frame traverse
      roomVisibilityList.forEach(r => {
        const meshes = [];
        r.group.traverse(ch => {
          if (ch.isMesh || ch.isInstancedMesh) {
            ch.userData._canCastShadow = !!ch.castShadow;
            meshes.push(ch);
          }
        });
        r.meshes = meshes;
      });
      buildingSectors.forEach(sec => {
        const meshes = [];
        sec.group.traverse(ch => {
          if (ch.isMesh || ch.isInstancedMesh) {
            ch.userData._canCastShadow = !!ch.castShadow;
            meshes.push(ch);
          }
        });
        sec.meshes = meshes;
      });
    })();

    function getRoomBuildingKey(id) {
      if (!id) return 'other';
      if (ROOM_DEFINITIONS[id] && ROOM_DEFINITIONS[id].building) {
        return ROOM_DEFINITIONS[id].building;
      }
      const corridorMap = {
        'West Wing L1 Corridor': 'L1',
        'West Wing L2 Corridor': 'L2',
        'West Wing L3 Corridor': 'L3',
        'East Wing R1 Corridor': 'R1',
        'East Wing R2 Corridor': 'R2',
        'East Wing R4 Corridor': 'R4',
      };
      return corridorMap[id] || 'other';
    }
    roomVisibilityList.forEach(r => { if (!r.bKey) r.bKey = getRoomBuildingKey(r.id); });

    let activeRoomSoundTimer = 0;
    let powerCutDarkBuilding = null;
    let powerCutBuildingTimer = 0;

    function setRoomShadowCasters(r, enableShadows) {
      if (r._lastShadowState === enableShadows) return;
      r._lastShadowState = enableShadows;
      const list = r.meshes || [];
      for (let m = 0; m < list.length; m++) {
        const mesh = list[m];
        mesh.castShadow = enableShadows && !!mesh.userData._canCastShadow;
      }
    }

    function updateRoomAndBuildingVisibility(playerPos, yaw, preset) {
      const cullInterior = (preset && preset.cullDistInterior) || 20.0;
      const cullBuilding = (preset && preset.cullDistBuilding) || 75.0;
      const fwdX = -Math.sin(yaw);
      const fwdZ = -Math.cos(yaw);

      // 1. Check if player is currently inside any enclosed room or building corridor
      let currentInsideRoom = null;
      let activeBuildingKey = null;
      if (playerPos.z >= 51.0 && playerPos.x >= -13.5 && playerPos.x <= 25.5) {
        activeBuildingKey = 'ROTUNDA';
      }
      for (let i = 0; i < roomVisibilityList.length; i++) {
        const r = roomVisibilityList[i];
        const dx = Math.abs(playerPos.x - r.x);
        const dz = Math.abs(playerPos.z - r.z);
        if (r.type === 'room') {
          if (dx < r.radius * 0.72 && dz < r.radius * 0.72 && Math.abs(playerPos.y - r.floorY) < 2.2) {
            currentInsideRoom = r;
            activeBuildingKey = r.bKey;
            break;
          }
        } else if (r.type === 'corridor' && !activeBuildingKey) {
          if (dx < 2.6 && dz < r.radius && Math.abs(playerPos.y - r.floorY) < 2.2) {
            activeBuildingKey = r.bKey;
          }
        }
      }

      // Requirement 2 & 5: Lower, cooler ambient modulated by per-room lightMood so flashlight is the hero!
      if (atmosphere && atmosphere.updateRoomMoodAmbient) {
        const activeMood = currentInsideRoom ? normalizeRoomLightMood(currentInsideRoom.lightMood) : null;
        const inCorridor = !!(activeBuildingKey && !currentInsideRoom);
        atmosphere.updateRoomMoodAmbient(0.016, activeMood, inCorridor);
      }

      // 2. Room & Corridor Interior Visibility + Shadow-Caster Culling (stays strictly < 400 draw calls on HIGH!)
      const isOverview = !!(typeof exploreTools !== 'undefined' && exploreTools && exploreTools.overviewCam);
      let visCount = 0;
      for (let i = 0; i < roomVisibilityList.length; i++) {
        const r = roomVisibilityList[i];
        if (isOverview || r === currentInsideRoom) {
          r.group.visible = true;
          setRoomShadowCasters(r, !isOverview);
          visCount++;
          continue;
        }
        // Different floor elevation (> 2.4m vertical separation) -> hidden
        if (Math.abs(playerPos.y - r.floorY) > 2.4) {
          r.group.visible = false;
          setRoomShadowCasters(r, false);
          continue;
        }
        // If player is inside a specific building/corridor, do NOT render interiors of other buildings!
        if (activeBuildingKey && r.bKey !== activeBuildingKey) {
          r.group.visible = false;
          setRoomShadowCasters(r, false);
          continue;
        }
        const dx = r.x - playerPos.x;
        const dz = r.z - playerPos.z;
        const dist = Math.hypot(dx, dz);
        const effDist = Math.max(0, dist - r.radius);

        // Far buildings' interiors must never be rendered
        const maxIntDist = activeBuildingKey ? cullInterior : Math.min(cullInterior, 13.5);
        if (effDist > maxIntDist) {
          r.group.visible = false;
          setRoomShadowCasters(r, false);
          continue;
        }
        // If player is inside an enclosed room, hide other rooms in the same wing unless right at the doorway
        if (currentInsideRoom && r.type === 'room' && dist > 7.2) {
          r.group.visible = false;
          setRoomShadowCasters(r, false);
          continue;
        }
        // Check camera sightline cone through doorway/windows
        if (effDist > 4.2) {
          const dot = (dx * fwdX + dz * fwdZ) / (dist || 1);
          if (dot < 0.05) {
            r.group.visible = false;
            setRoomShadowCasters(r, false);
            continue;
          }
        }
        r.group.visible = true;
        setRoomShadowCasters(r, dist < 9.5);
        visCount++;
      }
      visibleRoomsCount = visCount;

      // 2b. Distance-cull articulated swinging doors beyond interior visibility range
      const maxDoorDist = cullInterior + 8.0;
      for (let d = 0; d < swingingDoors.length; d++) {
        const dr = swingingDoors[d];
        const dDist = Math.hypot(dr.x - playerPos.x, dr.z - playerPos.z);
        dr.pivot.visible = (dDist <= maxDoorDist) && (Math.abs(dr.y - playerPos.y) <= 2.6);
      }

      // 3. Building & Courtyard Sector Distance & Shadow-Caster Culling
      const maxSectorDist = currentInsideRoom ? Math.min(cullBuilding, 24.0) : (activeBuildingKey ? Math.min(cullBuilding, 32.0) : Math.min(cullBuilding, 54.0));
      const minLandmarkDist = (HORROR_CONFIG.mainBuilding && HORROR_CONFIG.mainBuilding.minLandmarkCullDist) || 145.0;
      if (typeof mainBuildingEffectsGroup !== 'undefined' && mainBuildingEffectsGroup) {
        mainBuildingEffectsGroup.visible = (currentQuality !== 'fast');
      }
      for (let s = 0; s < buildingSectors.length; s++) {
        const sec = buildingSectors[s];
        if (sec.alwaysVisible) {
          sec.group.visible = true;
          continue;
        }
        if (activeBuildingKey === 'ROTUNDA' && sec.id !== 'rotunda-complex' && currentInsideRoom) {
          sec.group.visible = false;
          continue;
        }
        const dx = sec.x - playerPos.x;
        const dz = sec.z - playerPos.z;
        const dist = Math.max(0, Math.hypot(dx, dz) - sec.radius);
        const limit = sec.isLandmark ? Math.max(maxSectorDist * 1.25, minLandmarkDist) : maxSectorDist;
        const isVis = dist <= limit;
        sec.group.visible = isVis;
        const castShad = isVis && (dist <= 26.0);
        if (sec._lastShadowState !== castShad && sec.meshes) {
          sec._lastShadowState = castShad;
          for (let m = 0; m < sec.meshes.length; m++) {
            sec.meshes[m].castShadow = castShad && !!sec.meshes[m].userData._canCastShadow;
          }
        }
      }

      // 4. Distance-cull exterior lamp groups, puddles, tree shadow decals, corridor fog/mist & non-visible room shafts/gobos
      const isLowOrFast = (currentQuality === 'low' || currentQuality === 'fast');
      if (lampFlickerMod && lampFlickerMod.lamps) {
        const lamps = lampFlickerMod.lamps;
        for (let l = 0; l < lamps.length; l++) {
          const lm = lamps[l];
          const lx = lm.x !== undefined ? lm.x : (lm.bulbPos ? lm.bulbPos.x : 0);
          const lz = lm.z !== undefined ? lm.z : (lm.bulbPos ? lm.bulbPos.z : 0);
          const lDist = Math.hypot(lx - playerPos.x, lz - playerPos.z);
          const showLamp = currentInsideRoom ? (lDist < 14.0) : (lDist < 34.0);
          if (lm.group) lm.group.visible = showLamp;
          if (lm.puddleMesh) lm.puddleMesh.visible = showLamp && lm.blinkProfile !== 'dead';
        }
      }
      if (typeof rainPuddles !== 'undefined' && Array.isArray(rainPuddles)) {
        for (let p = 0; p < rainPuddles.length; p++) {
          const pd = rainPuddles[p];
          if (!pd) continue;
          pd.visible = !currentInsideRoom && Math.hypot(pd.position.x - playerPos.x, pd.position.z - playerPos.z) < 34.0;
        }
      }
      if (typeof treeShadowDecals !== 'undefined' && Array.isArray(treeShadowDecals)) {
        for (let t = 0; t < treeShadowDecals.length; t++) {
          const ts = treeShadowDecals[t];
          if (!ts || !ts.mesh) continue;
          ts.mesh.visible = !currentInsideRoom && !isLowOrFast && Math.hypot(ts.mesh.position.x - playerPos.x, ts.mesh.position.z - playerPos.z) < 34.0;
        }
      }
      // 5. Cull Rotunda corridor mist planes & corridor fog planes when outside sightline or on different floor (or on LOW/FAST)
      for (let cm = 0; cm < corridorMistPlanes.length; cm++) {
        const mp = corridorMistPlanes[cm];
        if (!mp) continue;
        const fy = mp.position.y - 0.11;
        const inRotundaRange = (playerPos.z >= 36.0) && (Math.abs(playerPos.y - fy) <= 2.3);
        mp.visible = !isLowOrFast && inRotundaRange && (!currentInsideRoom || currentInsideRoom.bKey === 'ROTUNDA');
      }
      for (let cf = 0; cf < corridorFogPlanes.length; cf++) {
        const fp = corridorFogPlanes[cf];
        if (!fp || !fp.mesh) continue;
        if (isLowOrFast) {
          fp.mesh.visible = false;
        } else if (fp.isRootScene) {
          fp.mesh.visible = (playerPos.z >= 36.0) && (Math.abs(playerPos.y - fp.floorY) <= 2.3) && (!currentInsideRoom || currentInsideRoom.bKey === 'ROTUNDA');
        } else {
          fp.mesh.visible = !!(fp.mesh.parent && fp.mesh.parent.visible);
        }
      }
      // 6. Cull window shafts, gobos & beam dust in non-visible rooms, and reduce gobos/dust on LOW & FAST
      for (let sg = 0; sg < roomShaftGroups.length; sg++) {
        const item = roomShaftGroups[sg];
        const rmVis = !!(item.roomGroup && item.roomGroup.visible);
        item.group.visible = rmVis;
        if (rmVis) {
          if (item.gobo) item.gobo.visible = !isLowOrFast;
          if (item.dPoints) item.dPoints.visible = !isLowOrFast;
        }
      }
      // 7. Distance-cull battery pickups & fuse boxes on other floors or far away
      if (typeof batteryPickups !== 'undefined') {
        for (let b = 0; b < batteryPickups.length; b++) {
          const bp = batteryPickups[b];
          if (!bp || !bp.mesh) continue;
          bp.mesh.visible = !bp.collected && (Math.abs(playerPos.y - bp.y) <= 2.5) && (Math.hypot(playerPos.x - bp.x, playerPos.z - bp.z) <= cullInterior + 10.0);
        }
      }
      if (typeof fuseBoxes !== 'undefined') {
        for (let f = 0; f < fuseBoxes.length; f++) {
          const fb = fuseBoxes[f];
          if (!fb || !fb.mesh) continue;
          fb.mesh.visible = (Math.abs(playerPos.y - fb.y) <= 2.5) && (Math.hypot(playerPos.x - fb.x, playerPos.z - fb.z) <= cullInterior + 12.0);
        }
      }
      // 8. Distance-cull enterable bus interiors (> 25m), keep horror roof/window vines visible, and blink Warm Amber & Blood-Red cabin tubes
      if (typeof enterableBuses !== 'undefined') {
        const busInteriorCutoff = (HORROR_CONFIG && HORROR_CONFIG.buses && HORROR_CONFIG.buses.interiorCutoffDistance) || 25.0;
        const busCutoffSq = busInteriorCutoff * busInteriorCutoff;
        const nowMs = performance.now();
        for (let bi = 0; bi < enterableBuses.length; bi++) {
          const b = enterableBuses[bi];
          const dx = playerPos.x - b.bx;
          const dz = playerPos.z - b.bz;
          const distSq = dx * dx + dz * dz;
          const showInt = distSq <= busCutoffSq;
          if (b.interiorGroup && b.interiorGroup.visible !== showInt) b.interiorGroup.visible = showInt;
          const showVines = distSq <= (busCutoffSq * 4.0);
          if (b.vineGroup && b.vineGroup.visible !== showVines) b.vineGroup.visible = showVines;
          const showProps = currentQuality !== 'fast' && showInt;
          if (b.propsGroup && b.propsGroup.visible !== showProps) b.propsGroup.visible = showProps;
          if (showInt) {
            // Erratic dying-ballast blink for the Warm Amber front tube & Blood-Red rear horror tube
            const wWave = Math.sin(nowMs * 0.013 + bi * 1.7) + 0.55 * Math.sin(nowMs * 0.041 + bi * 3.1) + 0.35 * Math.cos(nowMs * 0.089);
            const warmOn = wWave > -0.35;
            const warmInt = warmOn ? (wWave > 0.65 ? 1.55 : 0.95) : 0.08;
            if (b.warmTubeMat) b.warmTubeMat.emissiveIntensity = warmInt;
            if (b.warmGlowMat) b.warmGlowMat.opacity = warmOn ? 0.15 : 0.02;

            const rWave = Math.sin(nowMs * 0.009 + bi * 2.3) + 0.65 * Math.cos(nowMs * 0.037 + bi * 0.9) + 0.4 * Math.sin(nowMs * 0.073);
            const redOn = rWave > -0.20;
            const redInt = redOn ? (rWave > 0.50 ? 1.75 : 1.05) : 0.10;
            if (b.redTubeMat) b.redTubeMat.emissiveIntensity = redInt;
            if (b.redGlowMat) b.redGlowMat.opacity = redOn ? 0.18 : 0.025;
          }
        }
      }
    }

    /* =========================================================================
       CHARACTERS, BOTS, PHYSICS & SINGLE-PLAYER HIDE-AND-SEEK GAMEPLAY LOOP
       ========================================================================= */
    const GAME_CONFIG = {
      role: 'hider',
      difficulty: 'medium',
      matchDuration: (HORROR_CONFIG.gameplay && HORROR_CONFIG.gameplay.roundDurationSec) || 540,
      seekerGracePeriod: (HORROR_CONFIG.gameplay && HORROR_CONFIG.gameplay.gracePeriodSec) || 10,
      botCount: 5,
    };

    let matchTimer = GAME_CONFIG.matchDuration;
    let graceTimer = GAME_CONFIG.seekerGracePeriod;
    let isMatchActive = true;
    let isGameOver = false;
    let statusSyncTimer = 0;
    let heartbeatCooldown = 0;
    let killApproachSfxCooldown = 0;
    let currentHunterProximity = 0.0;
    let proximitySyncCooldown = 0.0;
    let flickerBurstTimer = 11.0;

    // Single-Player Hide-and-Seek Loop State (Fuse Boxes, Main Gate, Flashlight Battery, Throwables, Noise, Breath Mini-Game, Rescue)
    const fuseBoxes = [];
    const batteryPickups = [];
    const activeProjectiles = [];
    const recentNoiseEvents = [];
    let mainGateUnlocked = false;
    let mainGateBannerMesh = null;
    let playerNoiseLevel = 0.08;
    let flashlightBattery = 100.0;
    let isFlashlightOn = true;
    let throwablesRemaining = (HORROR_CONFIG.gameplay && HORROR_CONFIG.gameplay.scholarStartingThrowables) || 2;
    let playerCatchCount = 0;
    let isPlayerSpectating = false;
    let spectateBotIdx = 0;
    let breathMiniGame = {
      active: false,
      holdingButton: false,
      meter: 1.0,
      surviveTimer: 0.0,
      spot: null,
    };
    let hunterAbilities = {
      pingTimer: (HORROR_CONFIG.gameplay && HORROR_CONFIG.gameplay.hunterFootstepPingIntervalSec) || 30.0,
      doorLockCooldown: 0.0,
      powerCutCooldown: 0.0,
    };

    const sharedCharMats = {
      skin: new THREE.MeshStandardMaterial({ color: 0xc89666, roughness: 0.5 }),
      pants: new THREE.MeshStandardMaterial({ color: 0x090b10, roughness: 0.75 }),
      clothByColor: {},
    };

    function createCampusCharacter(colorHex, isSeeker = false, labelName = 'Scholar') {
      const root = new THREE.Group();
      const bodyPivot = new THREE.Group();
      bodyPivot.position.y = 0.75;
      root.add(bodyPivot);

      const cKey = isSeeker ? 0x11161f : colorHex;
      if (!sharedCharMats.clothByColor[cKey]) {
        sharedCharMats.clothByColor[cKey] = new THREE.MeshStandardMaterial({
          color: cKey,
          roughness: 0.55,
        });
      }
      const clothMat = sharedCharMats.clothByColor[cKey];

      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.25, 0.7, 10), clothMat);
      torso.position.y = 0.35;
      bodyPivot.add(torso);

      const headGroup = new THREE.Group();
      headGroup.position.y = 0.82;
      bodyPivot.add(headGroup);
      headGroup.add(new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 10, 10),
        sharedCharMats.skin
      ));

      const leftArmPivot = new THREE.Group();
      leftArmPivot.position.set(-0.35, 0.65, 0);
      bodyPivot.add(leftArmPivot);
      const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.52, 8), clothMat);
      leftArm.position.y = -0.24;
      leftArmPivot.add(leftArm);

      const rightArmPivot = new THREE.Group();
      rightArmPivot.position.set(0.35, 0.65, 0);
      bodyPivot.add(rightArmPivot);
      const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.52, 8), clothMat);
      rightArm.position.y = -0.24;
      rightArmPivot.add(rightArm);

      const pantsMat = sharedCharMats.pants;
      const leftLegPivot = new THREE.Group();
      leftLegPivot.position.set(-0.15, 0.05, 0);
      bodyPivot.add(leftLegPivot);
      const leftLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.68, 8), pantsMat);
      leftLeg.position.y = -0.32;
      leftLegPivot.add(leftLeg);

      const rightLegPivot = new THREE.Group();
      rightLegPivot.position.set(0.15, 0.05, 0);
      bodyPivot.add(rightLegPivot);
      const rightLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.68, 8), pantsMat);
      rightLeg.position.y = -0.32;
      rightLegPivot.add(rightLeg);

      root.traverse(ch => {
        if (ch.isMesh) {
          ch.castShadow = true;
          ch.receiveShadow = true;
        }
      });
      root.userData = {
        name: labelName,
        isSeeker,
        parts: { bodyPivot, headGroup, leftArmPivot, rightArmPivot, leftLegPivot, rightLegPivot },
        walkPhase: Math.random() * 6.28,
      };
      return root;
    }

    function animateCharacterRig(charMesh, speedRatio, isCrouching, delta) {
      const parts = charMesh.userData.parts;
      if (!parts) return;
      const targetBodyY = isCrouching ? 0.48 : 0.75;
      parts.bodyPivot.position.y += (targetBodyY - parts.bodyPivot.position.y) * 12 * delta;
      parts.bodyPivot.rotation.x = isCrouching ? 0.35 : 0;

      if (speedRatio > 0.05) {
        charMesh.userData.walkPhase += delta * (6.5 + speedRatio * 5.5);
        const p = charMesh.userData.walkPhase;
        const swing = Math.min(0.85, speedRatio * 0.75);
        parts.leftLegPivot.rotation.x = Math.sin(p) * swing;
        parts.rightLegPivot.rotation.x = -Math.sin(p) * swing;
        parts.leftArmPivot.rotation.x = -Math.sin(p) * swing * 0.85;
        parts.rightArmPivot.rotation.x = Math.sin(p) * swing * 0.85;
      } else {
        parts.leftLegPivot.rotation.x *= 0.85;
        parts.rightLegPivot.rotation.x *= 0.85;
        parts.leftArmPivot.rotation.x *= 0.85;
        parts.rightArmPivot.rotation.x *= 0.85;
      }
    }

    // Phase B.3: Full Interior & Multi-Floor Bot Navigation Waypoints generated from ROOM_DEFINITIONS
    const navWaypoints = [];
    (function buildCampusNavWaypoints() {
      function addWp(id, x, y, z, kind = 'exterior', roomId = null) {
        navWaypoints.push({ id, x, y, z, kind, roomId });
      }
      function addRoomVisit(roomId) {
        const def = ROOM_DEFINITIONS[roomId];
        if (!def || !def.waypoints || def.waypoints.length === 0) return;
        const doorWp = def.waypoints[0];
        const inWp = def.waypoints[def.waypoints.length - 1];
        addWp(doorWp.id, doorWp.x, doorWp.y, doorWp.z, 'door', roomId);
        if (inWp !== doorWp) {
          addWp(inWp.id, inWp.x, inWp.y, inWp.z, 'interior', roomId);
          addWp(doorWp.id + '-exit', doorWp.x, doorWp.y, doorWp.z, 'door', roomId);
        }
      }

      // 1. Southern Gate, Security Guardhouse & Enterable University Buses (Bus A & Bus B Perimeter + Walk-In Aisles)
      addWp('gate-entry', 1.5, 0, -60, 'exterior');
      addRoomVisit('Security Guardhouse');
      addWp('parking-plaza', -8.0, 0, -50, 'exterior');
      addWp('bus-a-front-door', 2.8, 0, -40.85, 'door', 'Bus A');
      addWp('bus-a-aisle-front', 5.2, 0.54, -40.85, 'interior', 'Bus A');
      addWp('bus-a-aisle-mid', 5.2, 0.54, -44.20, 'interior', 'Bus A');
      addWp('bus-a-aisle-rear', 5.2, 0.54, -47.55, 'interior', 'Bus A');
      addWp('bus-a-rear-door', 2.8, 0, -47.55, 'door', 'Bus A');
      addWp('bus-plaza-lane', 9.2, 0, -44.5, 'exterior');
      addWp('bus-b-front-door', 13.0, 0, -41.85, 'door', 'Bus B');
      addWp('bus-b-aisle-front', 15.53, 0.54, -41.85, 'interior', 'Bus B');
      addWp('bus-b-aisle-mid', 15.40, 0.54, -45.20, 'interior', 'Bus B');
      addWp('bus-b-aisle-rear', 15.27, 0.54, -48.55, 'interior', 'Bus B');
      addWp('bus-b-rear-door', 12.7, 0, -48.55, 'door', 'Bus B');

      // 2. West Cluster (W1, W2, W3, W4)
      addWp('w1-walkway', -28.0, 0, -34.6, 'corridor');
      addRoomVisit('Newari Heritage Block W1 Room 2');
      addRoomVisit('Newari Heritage Block W1 Room 1');
      addWp('w2-walkway', -27.5, 0, -22.0, 'corridor');
      addRoomVisit('Newari Cultural Hall W2 South');
      addWp('wp-w2-north-in', -33.6, 0.22, -19.5, 'interior', 'West Wing L3 Heritage Library W2');
      addWp('wp-w2-door-out', -28.1, 0.22, -22.0, 'door', 'Newari Cultural Hall W2 South');
      addWp('w3-walkway', -27.5, 0, 5.4, 'corridor');
      addRoomVisit('Building W3 West Wing Room 2');
      addRoomVisit('Building W3 West Wing Room 1');
      addWp('w4-walkway', -27.5, 0, 25.4, 'corridor');
      addRoomVisit('Building W4 West Wing Room 1');
      addRoomVisit('Building W4 West Wing Room 2');

      // 3. West Wings (L3, L2, L1)
      addWp('l3-corridor-north', -12.6, 0.18, 25.5, 'corridor');
      addRoomVisit('West Wing L3 Room 2');
      addRoomVisit('West Wing L3 Room 1');
      addWp('l2-corridor-north', -12.6, 0.18, -2.67, 'corridor');
      addRoomVisit('West Wing L2 Room 3');
      addRoomVisit('West Wing L2 Room 2');
      addRoomVisit('West Wing L2 Room 1');
      addWp('l1-corridor-south', -11.2, 0.18, -28.0, 'corridor');
      addRoomVisit('West Wing L1 Room 1');
      addRoomVisit('West Wing L1 Room 2');
      addRoomVisit('West Wing L1 Room 3');

      // 4. Spine Avenue & East Wings (R1, R2, R4)
      addWp('spine-road-south', 0.8, 0, -28.0, 'exterior');
      addWp('r1-corridor-south', 10.0, 0.18, -32.67, 'corridor');
      addRoomVisit('East Wing R1 Room 1');
      addRoomVisit('East Wing R1 Room 2');
      addRoomVisit('East Wing R1 Room 3');
      addWp('r2-corridor-south', 20.6, 0.18, -22.67, 'corridor');
      addRoomVisit('East Wing R2 Room 1');
      addRoomVisit('East Wing R2 Room 2');
      addRoomVisit('East Wing R2 Room 3');
      addWp('r4-corridor-south', 20.6, 0.18, 10.67, 'corridor');
      addRoomVisit('East Wing R4 Room 1');
      addRoomVisit('East Wing R4 Room 2');
      addRoomVisit('East Wing R4 Room 3');

      // 5. Grand Rotunda All 3 Floors (Ground: 101 & 102, 1st Floor: 201 & 202, 2nd Floor: 301 & 302)
      addWp('rotunda-fountain', 6.0, 0, 42.5, 'exterior');
      addWp('rotunda-ground-lobby', 6.0, 0.48, 59.0, 'corridor');
      addRoomVisit('Rotunda Ground West Hall 101');
      addRoomVisit('Rotunda Ground East Hall 102');
      addWp('rotunda-stair1-bot', 3.0, 0.48, 60.5, 'stair');
      addWp('rotunda-stair1-top', 3.0, 4.08, 68.0, 'stair');
      addRoomVisit('Rotunda 1st-Floor West Class 201');
      addWp('rotunda-1f-landing', 9.0, 4.08, 68.0, 'corridor');
      addRoomVisit('Rotunda 1st-Floor East Class 202');
      addWp('rotunda-stair2-bot', 9.0, 4.08, 68.0, 'stair');
      addWp('rotunda-stair2-top', 9.0, 7.68, 60.5, 'stair');
      addRoomVisit('Rotunda 2nd-Floor East Lab 302');
      addWp('rotunda-3f-balcony', 6.0, 7.68, 54.2, 'corridor');
      addRoomVisit('Rotunda 2nd-Floor West Seminar 301');
      addWp('rotunda-stair2-down', 9.0, 7.68, 60.5, 'stair');
      addWp('rotunda-1f-down', 9.0, 4.08, 68.0, 'stair');
      addWp('rotunda-stair1-down', 3.0, 4.08, 68.0, 'stair');
      addWp('rotunda-exit', 6.0, 0.48, 59.0, 'corridor');
      addWp('spine-terrace', 3.0, 0, 34.0, 'exterior');
    })();

    function isObstacleCollider(b, y) {
      const stepHeight = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.stepHeight) || 0.52;
      const playerHeight = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.standingHeight) || 1.80;
      if (b.max.y <= y + stepHeight) return false;
      if (b.min.y >= y + playerHeight) return false;
      return true;
    }

    function isPositionClearOfColliders(x, y, z, clearance) {
      for (let i = 0; i < colliders.length; i++) {
        const b = colliders[i];
        if (!isObstacleCollider(b, y)) continue;
        if (b.type === 'cylinder') {
          const d = Math.hypot(x - b.x, z - b.z);
          if (d < b.radius + clearance) return false;
        } else if (b.type === 'obb') {
          if (x < b.min.x - clearance || x > b.max.x + clearance ||
              z < b.min.z - clearance || z > b.max.z + clearance) {
            continue;
          }
          const dx = x - b.cx;
          const dz = z - b.cz;
          const lx = dx * b.cosR - dz * b.sinR;
          const lz = dx * b.sinR + dz * b.cosR;
          const clx = Math.max(-b.hx, Math.min(b.hx, lx));
          const clz = Math.max(-b.hz, Math.min(b.hz, lz));
          const dlx = lx - clx;
          const dlz = lz - clz;
          if (dlx * dlx + dlz * dlz < clearance * clearance) return false;
        } else {
          if (x >= b.min.x - clearance && x <= b.max.x + clearance &&
              z >= b.min.z - clearance && z <= b.max.z + clearance) {
            return false;
          }
        }
      }
      return true;
    }

    function computeSafeHidingExit(spot) {
      const pRad = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.playerRadius) || 0.28;
      const minClearance = pRad + 0.15;
      if (spot.exitX !== undefined && spot.exitZ !== undefined) {
        const ey = spot.exitY !== undefined ? spot.exitY : spot.y;
        if (isPositionClearOfColliders(spot.exitX, ey, spot.exitZ, minClearance)) {
          return { x: spot.exitX, y: ey, z: spot.exitZ };
        }
      }
      if (isPositionClearOfColliders(spot.x, spot.y, spot.z, minClearance)) {
        return { x: spot.x, y: spot.y, z: spot.z };
      }
      const radii = [0.5, 0.7, 0.9, 1.1, 1.3, 1.6, 2.0, 2.5, 3.0];
      const angles = 16;
      for (let r = 0; r < radii.length; r++) {
        const dist = radii[r];
        for (let a = 0; a < angles; a++) {
          const theta = (a * Math.PI * 2) / angles;
          const cx = spot.x + Math.sin(theta) * dist;
          const cz = spot.z + Math.cos(theta) * dist;
          if (isPositionClearOfColliders(cx, spot.y, cz, minClearance)) {
            return { x: cx, y: spot.y, z: cz };
          }
        }
      }
      return { x: spot.x, y: spot.y, z: spot.z };
    }

    function initializeHidingSpotExitPositions() {
      let warningCount = 0;
      for (let i = 0; i < interactiveHidingSpots.length; i++) {
        const spot = interactiveHidingSpots[i];
        const exit = computeSafeHidingExit(spot);
        spot.exitX = exit.x;
        spot.exitY = exit.y;
        spot.exitZ = exit.z;

        if (!isPositionClearOfColliders(spot.exitX, spot.exitY, spot.exitZ, 0.001)) {
          console.warn('[Hiding Spot Startup Dev Check] WARNING: Spot exit position is inside a collider!', spot.id, spot.name);
          warningCount++;
        }
      }
      if (warningCount === 0) {
        console.log('[Hiding Spot Startup Dev Check] PASSED: All ' + interactiveHidingSpots.length + ' hiding spots have verified collision-free exit positions (>= playerRadius + 0.15 clear).');
      }
    }
    initializeHidingSpotExitPositions();

    const bots = [];
    let playerCharacter = null;
    let seekerRef = null;

    const fallbackExploreBot = {
      id: 'explore-standby-bot',
      name: 'Standby Bot',
      mesh: new THREE.Group(),
      isSeeker: true,
      isCaught: false,
      currentWpIdx: 0,
      speed: 0,
      state: 'standby',
    };

    function initFuseBoxesAndPickups() {
      fuseBoxes.forEach(fb => { if (fb.mesh) scene.remove(fb.mesh); });
      fuseBoxes.length = 0;
      batteryPickups.forEach(bp => { if (bp.mesh) scene.remove(bp.mesh); });
      batteryPickups.length = 0;
      activeProjectiles.forEach(pr => { if (pr.mesh) scene.remove(pr.mesh); });
      activeProjectiles.length = 0;
      recentNoiseEvents.length = 0;
      mainGateUnlocked = false;

      if (!EXPLORE_FLAGS.ENABLE_FUSE_OBJECTIVES) {
        return;
      }

      const fuseLocations = [
        { id: 'fuse-main-302', name: 'Main Bldg 3F Server Lab 302 Fuse Box', x: 23.2, y: 7.68, z: 62.5, building: 'ROTUNDA' },
        { id: 'fuse-main-101', name: 'Main Bldg 1F Lecture Hall 101 Fuse Box', x: -11.2, y: 0.48, z: 62.5, building: 'ROTUNDA' },
        { id: 'fuse-west-l2', name: 'West Academic Wing L2 Fuse Box', x: -13.2, y: 0.18, z: -14.0, building: 'L2' },
        { id: 'fuse-east-r2', name: 'East Engineering Wing R2 Fuse Box', x: 20.2, y: 0.18, z: -14.0, building: 'R2' },
      ];

      const boxGeo = new THREE.BoxGeometry(0.42, 0.56, 0.22);
      const ledGeo = new THREE.SphereGeometry(0.06, 8, 8);
      fuseLocations.forEach(loc => {
        const grp = new THREE.Group();
        grp.userData.noMerge = true;
        const body = new THREE.Mesh(boxGeo, step2Mats.rustedLockerMetal);
        const ledMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
        const led = new THREE.Mesh(ledGeo, ledMat);
        led.position.set(0, 0.18, 0.13);
        grp.add(body, led);
        grp.position.set(loc.x, loc.y + 1.35, loc.z);
        scene.add(grp);
        fuseBoxes.push({
          ...loc,
          restored: false,
          progress: 0,
          mesh: grp,
          ledMat,
        });
      });

      // Requirement 5 (Playability): At least one battery recharge pickup per building across all 12 buildings!
      const battLocs = [
        { id: 'batt-rotunda-1f', building: 'ROTUNDA', x: 6.0, y: 0.48, z: 61.2 },
        { id: 'batt-rotunda-201', building: 'ROTUNDA', x: -4.8, y: 4.08, z: 63.5 },
        { id: 'batt-rotunda-301', building: 'ROTUNDA', x: -4.8, y: 7.68, z: 63.5 },
        { id: 'batt-west-l1', building: 'L1', x: -10.8, y: 0.18, z: -20.0 },
        { id: 'batt-west-l2', building: 'L2', x: -14.2, y: 0.22, z: -12.0 },
        { id: 'batt-west-l3', building: 'L3', x: -14.2, y: 0.22, z: 18.0 },
        { id: 'batt-east-r1', building: 'R1', x: 10.2, y: 0.18, z: -22.0 },
        { id: 'batt-east-r2', building: 'R2', x: 20.8, y: 0.18, z: -18.0 },
        { id: 'batt-east-r4', building: 'R4', x: 24.5, y: 0.18, z: 18.0 },
        { id: 'batt-heritage-w1', building: 'W1', x: -33.5, y: 0.22, z: -41.5 },
        { id: 'batt-heritage-w2', building: 'W2', x: -33.6, y: 0.22, z: -26.5 },
        { id: 'batt-canteen-w3', building: 'W3', x: -34.0, y: 0.15, z: -6.0 },
        { id: 'batt-annex-w4', building: 'W4', x: -29.0, y: 0.15, z: 8.0 },
        { id: 'batt-guardhouse', building: 'GUARDHOUSE', x: 6.2, y: 0.15, z: -57.8 },
      ];
      const battGeo = new THREE.CylinderGeometry(0.10, 0.10, 0.24, 10);
      const battMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xca8a04, emissiveIntensity: 0.65, roughness: 0.35 });
      battLocs.forEach(bl => {
        const bm = new THREE.Mesh(battGeo, battMat);
        bm.userData.noMerge = true;
        bm.position.set(bl.x, bl.y + 0.22, bl.z);
        scene.add(bm);
        batteryPickups.push({ ...bl, collected: false, mesh: bm });
      });
    }

    function recordNoiseEvent(x, y, z, intensity, label) {
      if (!EXPLORE_FLAGS.ENABLE_GAMEPLAY) return;
      recentNoiseEvents.push({ x, y, z, intensity, label, time: Date.now() * 0.001 });
      if (recentNoiseEvents.length > 16) recentNoiseEvents.shift();
      // Alert Hunter bot if noise is loud enough within hearing range
      if (seekerRef && !seekerRef.isPlayer && seekerRef.bot && !seekerRef.bot.isCaught) {
        const sb = seekerRef.bot;
        const d = Math.hypot(sb.mesh.position.x - x, sb.mesh.position.z - z);
        const hearRadius = 14.0 + intensity * 38.0;
        if (d <= hearRadius) {
          sb.investigateTarget = { x, y, z, timer: 7.5 };
        }
      }
    }

    function initCharactersAndBots() {
      bots.forEach(b => { if (b && b.mesh) scene.remove(b.mesh); });
      bots.length = 0;
      if (playerCharacter) scene.remove(playerCharacter);

      initFuseBoxesAndPickups();

      if (!EXPLORE_FLAGS.ENABLE_HUNTER_AND_BOTS) {
        playerCharacter = createCampusCharacter(0x334155, false, 'You (Explorer)');
        playerCharacter.visible = (playerPhysics.cameraMode === 'third');
        scene.add(playerCharacter);
        seekerRef = null;
        Object.defineProperty(bots, '0', {
          get() { return fallbackExploreBot; },
          configurable: true,
          enumerable: false,
        });
        return;
      }
      delete bots[0];

      const botNames = ['Aayush', 'Bikash', 'Puja', 'Suman', 'Kritika', 'Rohan', 'Nabin'];
      const colors = [0x334155, 0x475569, 0x1e293b, 0x3f3f46, 0x52525b, 0x27272a, 0x1f2937];
      const hunterBaseSpd = (HORROR_CONFIG.gameplay && HORROR_CONFIG.gameplay.hunterSpeed) || 5.35;

      if (GAME_CONFIG.role === 'seeker') {
        playerCharacter = createCampusCharacter(0x11161f, true, 'You (Hollow Proctor)');
        playerCharacter.visible = (playerPhysics.cameraMode === 'third');
        scene.add(playerCharacter);
        seekerRef = { isPlayer: true, mesh: playerCharacter };

        for (let i = 0; i < GAME_CONFIG.botCount; i++) {
          const bMesh = createCampusCharacter(colors[i % colors.length], false, botNames[i % botNames.length]);
          scene.add(bMesh);
          const targetSpot = interactiveHidingSpots[(i * 7 + 3) % interactiveHidingSpots.length];
          bMesh.position.set(targetSpot.x, targetSpot.y, targetSpot.z);
          bots.push({
            id: 'bot-' + i,
            name: botNames[i % botNames.length],
            mesh: bMesh,
            isSeeker: false,
            isCaught: false,
            catchCount: 0,
            canBeRescued: false,
            targetSpot,
            state: 'hiding',
            speed: 4.6,
            fuseTimer: 12 + i * 7,
          });
        }
      } else {
        playerCharacter = createCampusCharacter(0x334155, false, 'You (Scholar)');
        playerCharacter.visible = (playerPhysics.cameraMode === 'third');
        scene.add(playerCharacter);

        const seekerBotMesh = createCampusCharacter(0x11161f, true, 'The Hollow Proctor');
        scene.add(seekerBotMesh);
        seekerBotMesh.position.set(0, 0, -60);

        const seekerBot = {
          id: 'seeker-bot',
          name: 'The Hollow Proctor',
          mesh: seekerBotMesh,
          isSeeker: true,
          isCaught: false,
          currentWpIdx: 0,
          speed: GAME_CONFIG.difficulty === 'hard' ? (hunterBaseSpd + 0.25) : (GAME_CONFIG.difficulty === 'easy' ? (hunterBaseSpd - 0.35) : hunterBaseSpd),
          state: 'patrolling',
          inspectTimer: 0,
          inspectSpot: null,
          lastCheckedWpId: null,
          investigateTarget: null,
        };
        bots.push(seekerBot);
        seekerRef = { isPlayer: false, bot: seekerBot };

        for (let i = 0; i < GAME_CONFIG.botCount - 1; i++) {
          const bMesh = createCampusCharacter(colors[(i + 1) % colors.length], false, botNames[i % botNames.length]);
          scene.add(bMesh);
          const targetSpot = interactiveHidingSpots[(i * 6 + 2) % interactiveHidingSpots.length];
          bMesh.position.set(targetSpot.x, targetSpot.y, targetSpot.z);
          bots.push({
            id: 'bot-' + (i + 1),
            name: botNames[i % botNames.length],
            mesh: bMesh,
            isSeeker: false,
            isCaught: false,
            catchCount: 0,
            canBeRescued: false,
            targetSpot,
            state: 'hiding',
            speed: 4.6,
            fuseTimer: 16 + i * 9,
          });
        }
      }
    }

    const playerPhysics = {
      pos: new THREE.Vector3(-4, 0, -48),
      vel: new THREE.Vector3(0, 0, 0),
      radius: 0.28,
      height: 1.8,
      eyeHeight: 1.62,
      currentEyeHeight: 1.62,
      isGrounded: true,
      isCrouching: false,
      isHiding: false,
      currentHidingSpot: null,
      yaw: 0,
      pitch: 0,
      targetYaw: 0,
      targetPitch: 0,
      meshYaw: 0,
      cameraMode: 'first',
      footstepTimer: 0,
      bobTimer: 0,
      smoothMoveX: 0,
      smoothMoveZ: 0,
      camDist: 3.4,
      isSprinting: false,
    };

    // Phase B.4: Physics Colliders & Bot Waypoints Debug View (Toggle)
    const isDevTelemetryAllowed = !!(HORROR_CONFIG.enableDevTelemetry || (HORROR_CONFIG.physics && HORROR_CONFIG.physics.debugPhysics));
    const dbgBtnEl = document.getElementById('btn-debug-physics');
    if (dbgBtnEl) dbgBtnEl.style.display = isDevTelemetryAllowed ? 'flex' : 'none';
    const physicsDebug = {
      enabled: isDevTelemetryAllowed && !!(HORROR_CONFIG.physics && HORROR_CONFIG.physics.debugPhysics),
      helpersGroup: new THREE.Group(),
      helpersCreated: false,
      playerCapsuleHelper: null,
      lastNormal: new THREE.Vector3(0, 0, 0),
      hasCollided: false,
      lastInputForward: 0,
      lastInputRight: 0,
      speedMultiplier: 1.0,
      fakeLowFPS: false,
      lagSpikeRemaining: 0,
      physicsCostMs: 0,
      fps: 60,
      initHelpers() {
        if (this.helpersCreated) return;
        this.helpersCreated = true;
        this.helpersGroup.userData.noMerge = true;
        scene.add(this.helpersGroup);
        const cylMat = new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 1 });

        // 1. Draw All Colliders (Cyan = Wall, Amber = Independent Furniture Box Colliders, Orange = Door Frame, Green = Cylinder)
        let furnColCount = 0;
        for (let i = 0; i < colliders.length; i++) {
          const col = colliders[i];
          if (col.type === 'cylinder') {
            const h = Math.max(0.2, (col.maxY || 4.0) - (col.minY || 0));
            const geo = new THREE.CylinderGeometry(col.radius, col.radius, h, 12);
            const wire = new THREE.WireframeGeometry(geo);
            const line = new THREE.LineSegments(wire, cylMat);
            line.position.set(col.x, (col.minY || 0) + h / 2, col.z);
            this.helpersGroup.add(line);
          } else if (col.type === 'obb') {
            if (col.tag === 'furniture') furnColCount++;
            const h = Math.max(0.1, (col.maxY || 3.1) - (col.minY || 0));
            const geo = new THREE.BoxGeometry(col.hx * 2, h, col.hz * 2);
            const wire = new THREE.WireframeGeometry(geo);
            const colHex = col.tag === 'furniture' ? 0xffaa00 : (col.tag === 'roof' ? 0x38bdf8 : 0x00e5ff);
            const line = new THREE.LineSegments(wire, new THREE.LineBasicMaterial({ color: colHex, linewidth: 1 }));
            line.position.set(col.cx, (col.minY || 0) + h / 2, col.cz);
            line.rotation.y = col.rotY || 0;
            line.userData.colliderTag = col.tag || 'wall';
            this.helpersGroup.add(line);
          } else {
            const min = col.min;
            const max = col.max;
            if (min && max) {
              if (col.tag === 'furniture') furnColCount++;
              const b = col.box || new THREE.Box3(min, max);
              const colHex = col.tag === 'furniture' ? 0xffaa00 : (col.tag === 'door_frame' ? 0xff5500 : 0x00e5ff);
              const helper = new THREE.Box3Helper(b, colHex);
              helper.userData.colliderTag = col.tag || 'wall';
              this.helpersGroup.add(helper);
            }
          }
        }
        this.furnitureColliderCount = furnColCount;

        // 2. Draw All Bot Waypoints (Magenta = Interior/Door Waypoints, Yellow = Corridor/Stair/Exterior Waypoints) + Route Line
        const wpGeo = new THREE.CylinderGeometry(0, 0.24, 0.48, 4);
        const wpWire = new THREE.WireframeGeometry(wpGeo);
        const wpIntMat = new THREE.LineBasicMaterial({ color: 0xff00ff, linewidth: 2 });
        const wpExtMat = new THREE.LineBasicMaterial({ color: 0xffee00, linewidth: 2 });
        const pathPoints = [];

        for (let w = 0; w < navWaypoints.length; w++) {
          const wp = navWaypoints[w];
          const wy = (typeof wp.y === 'number' ? wp.y : 0) + 0.55;
          const marker = new THREE.LineSegments(wpWire, (wp.kind === 'interior' || wp.kind === 'door') ? wpIntMat : wpExtMat);
          marker.position.set(wp.x, wy, wp.z);
          this.helpersGroup.add(marker);
          pathPoints.push(new THREE.Vector3(wp.x, wy, wp.z));
        }

        if (pathPoints.length > 1) {
          const pathGeo = new THREE.BufferGeometry().setFromPoints(pathPoints);
          const pathMat = new THREE.LineBasicMaterial({ color: 0xff44cc, linewidth: 1 });
          const pathLine = new THREE.Line(pathGeo, pathMat);
          this.helpersGroup.add(pathLine);
        }

        // 3. Draw Hiding Spot Markers (Lime Green Wireframe Boxes)
        const hsGeo = new THREE.BoxGeometry(0.32, 0.32, 0.32);
        const hsWire = new THREE.WireframeGeometry(hsGeo);
        const hsMat = new THREE.LineBasicMaterial({ color: 0x22ff66, linewidth: 1 });
        for (let s = 0; s < interactiveHidingSpots.length; s++) {
          const sp = interactiveHidingSpots[s];
          const hsMarker = new THREE.LineSegments(hsWire, hsMat);
          hsMarker.position.set(sp.x, (sp.y || 0) + 0.35, sp.z);
          this.helpersGroup.add(hsMarker);
        }

        // 4. Player collision capsule wireframe helper
        const capGeo = new THREE.CylinderGeometry(0.38, 0.38, 1.8, 12, 1, true);
        const capWire = new THREE.WireframeGeometry(capGeo);
        const capMat = new THREE.LineBasicMaterial({ color: 0xff0055, linewidth: 2 });
        this.playerCapsuleHelper = new THREE.LineSegments(capWire, capMat);
        this.helpersGroup.add(this.playerCapsuleHelper);

        this.helpersGroup.visible = this.enabled;
      },
      updateCapsule(pos, height) {
        if (this.playerCapsuleHelper) {
          this.playerCapsuleHelper.position.set(pos.x, pos.y + height / 2, pos.z);
          this.playerCapsuleHelper.scale.set(1, Math.max(0.1, height / 1.8), 1);
        }
      },
      teleport(x, y, z, yaw) {
        playerPhysics.pos.set(x, y, z);
        playerPhysics.vel.set(0, 0, 0);
        if (yaw !== undefined) {
          playerPhysics.yaw = yaw;
          playerPhysics.targetYaw = yaw;
        }
        camera.position.set(x, y + (playerPhysics.isCrouching ? 1.05 : 1.62), z);
        camera.rotation.y = yaw !== undefined ? yaw : playerPhysics.yaw;
        showToast('Teleported to (' + x.toFixed(1) + ', ' + z.toFixed(1) + ')');
      },
      toggle(force) {
        this.initHelpers();
        this.enabled = (force !== undefined) ? !!force : !this.enabled;
        this.helpersGroup.visible = this.enabled;
        const hudEl = document.getElementById('physics-debug-hud');
        if (hudEl) hudEl.style.display = this.enabled ? 'block' : 'none';
        showToast(this.enabled ? 'Debug View: ON (Colliders + Waypoints)' : 'Debug View: OFF');
      }
    };

    // Circle/Capsule vs Box & Cylinder Collision Solver with Pure Tangent Sliding (Zero Bouncing, Zero Inversion)
    function resolveCollisionSubstep(pos, vel, radius, playerHeight, stepHeight, isHiding) {
      const BOUND = 88.0;
      const playerBottom = pos.y;
      const playerTop = pos.y + playerHeight;
      let collided = false;

      // 1. World Bounds clamping
      if (pos.x < -BOUND) { pos.x = -BOUND; if (vel.x < 0) vel.x = 0; }
      if (pos.x > BOUND) { pos.x = BOUND; if (vel.x > 0) vel.x = 0; }
      if (pos.z < -BOUND) { pos.z = -BOUND; if (vel.z < 0) vel.z = 0; }
      if (pos.z > BOUND) { pos.z = BOUND; if (vel.z > 0) vel.z = 0; }

      // 2. Iterate colliders
      for (let i = 0; i < colliders.length; i++) {
        const col = colliders[i];

        // Vertical obstacle filter
        if (col.max.y <= playerBottom + stepHeight) continue;
        if (col.min.y >= playerTop) continue;

        if (isHiding && playerPhysics.currentHidingSpot) {
          const hDist = Math.hypot(pos.x - playerPhysics.currentHidingSpot.x, pos.z - playerPhysics.currentHidingSpot.z);
          if (hDist < 1.35 && col.max.y < playerBottom + 1.05) continue;
        }

        let nx = 0, nz = 0, pen = 0;

        if (col.type === 'cylinder') {
          // Circle vs Cylinder
          const dx = pos.x - col.x;
          const dz = pos.z - col.z;
          const distSq = dx * dx + dz * dz;
          const combinedR = radius + col.radius;
          if (distSq < combinedR * combinedR) {
            const dist = Math.sqrt(distSq);
            if (dist > 0.0001) {
              nx = dx / dist;
              nz = dz / dist;
              pen = combinedR - dist;
            } else {
              nx = 0;
              nz = 1;
              pen = combinedR;
            }
          }
        } else if (col.type === 'obb') {
          // Circle vs Oriented Bounding Box (OBB in local bus space)
          if (pos.x < col.min.x - radius || pos.x > col.max.x + radius ||
              pos.z < col.min.z - radius || pos.z > col.max.z + radius) {
            continue;
          }
          const dx = pos.x - col.cx;
          const dz = pos.z - col.cz;
          const lx = dx * col.cosR - dz * col.sinR;
          const lz = dx * col.sinR + dz * col.cosR;
          const clx = Math.max(-col.hx, Math.min(col.hx, lx));
          const clz = Math.max(-col.hz, Math.min(col.hz, lz));
          const dlx = lx - clx;
          const dlz = lz - clz;
          const distSq = dlx * dlx + dlz * dlz;

          if (distSq < radius * radius) {
            let nlx = 0;
            let nlz = 0;
            if (distSq > 0.00001) {
              const dist = Math.sqrt(distSq);
              nlx = dlx / dist;
              nlz = dlz / dist;
              pen = radius - dist;
            } else {
              const penLeft = lx + col.hx;
              const penRight = col.hx - lx;
              const penTop = lz + col.hz;
              const penBottom = col.hz - lz;
              const minP = Math.min(penLeft, penRight, penTop, penBottom);
              if (minP === penLeft) { nlx = -1; nlz = 0; pen = radius + penLeft; }
              else if (minP === penRight) { nlx = 1; nlz = 0; pen = radius + penRight; }
              else if (minP === penTop) { nlx = 0; nlz = -1; pen = radius + penTop; }
              else { nlx = 0; nlz = 1; pen = radius + penBottom; }
            }
            nx = nlx * col.cosR + nlz * col.sinR;
            nz = -nlx * col.sinR + nlz * col.cosR;
          }
        } else {
          // Circle vs Axis-Aligned Box
          const minX = col.min.x;
          const maxX = col.max.x;
          const minZ = col.min.z;
          const maxZ = col.max.z;

          // Quick rejection AABB
          if (pos.x < minX - radius || pos.x > maxX + radius ||
              pos.z < minZ - radius || pos.z > maxZ + radius) {
            continue;
          }

          const cx = Math.max(minX, Math.min(maxX, pos.x));
          const cz = Math.max(minZ, Math.min(maxZ, pos.z));
          const dx = pos.x - cx;
          const dz = pos.z - cz;
          const distSq = dx * dx + dz * dz;

          if (distSq < radius * radius) {
            if (distSq > 0.00001) {
              // Outside box corner/edge/face
              const dist = Math.sqrt(distSq);
              nx = dx / dist;
              nz = dz / dist;
              pen = radius - dist;
            } else {
              // Center penetrated box interior — push out along shallowest face
              const penLeft = pos.x - minX;
              const penRight = maxX - pos.x;
              const penTop = pos.z - minZ;
              const penBottom = maxZ - pos.z;
              const minP = Math.min(penLeft, penRight, penTop, penBottom);

              if (minP === penLeft) { nx = -1; nz = 0; pen = radius + penLeft; }
              else if (minP === penRight) { nx = 1; nz = 0; pen = radius + penRight; }
              else if (minP === penTop) { nx = 0; nz = -1; pen = radius + penTop; }
              else { nx = 0; nz = 1; pen = radius + penBottom; }
            }
          }
        }

        // Apply penetration resolution and tangent sliding
        if (pen > 0) {
          pos.x += nx * pen;
          pos.z += nz * pen;

          // Remove only into-wall velocity component (v . n < 0)
          const vDotN = vel.x * nx + vel.z * nz;
          if (vDotN < 0) {
            vel.x -= vDotN * nx;
            vel.z -= vDotN * nz;
          }

          physicsDebug.lastNormal.set(nx, 0, nz);
          physicsDebug.hasCollided = true;
          collided = true;
        }
      }

      return collided;
    }

    function resolvePlayerMovement(startX, startY, startZ, vx, vz, delta, radius, isCrouching, isHiding) {
      const p = new THREE.Vector3(startX, startY, startZ);
      const v = new THREE.Vector3(vx, 0, vz);
      p.x += v.x * delta;
      p.z += v.z * delta;
      const pH = isHiding ? 0.65 : (isCrouching ? 1.05 : 1.80);
      resolveCollisionSubstep(p, v, radius, pH, 0.52, isHiding);
      return { x: p.x, z: p.z, vx: v.x, vz: v.z };
    }

    function resolveCylinderAABB(px, py, pz, vx, vz, delta, radius, isCrouching, isHiding) {
      return resolvePlayerMovement(px, py, pz, vx, vz, delta, radius, isCrouching, isHiding);
    }

    function getSupportFloorY(x, z, currentY = playerPhysics.pos.y) {
      // 1. Check Walkable Staircase Ramps first so climbing between Floor 0 <-> Floor 1 <-> Floor 2 & Bus Steps is seamless
      for (let i = 0; i < walkableStairRamps.length; i++) {
        const r = walkableStairRamps[i];
        if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
        if (r.isOBB) {
          const dx = x - r.cx;
          const dz = z - r.cz;
          const lx = dx * r.cosR - dz * r.sinR;
          const lz = dx * r.sinR + dz * r.cosR;
          if (Math.abs(lx) <= r.hx && Math.abs(lz) <= r.hz) {
            const worldLX = lx + (r.lxStart + r.lxEnd) * 0.5;
            const t = Math.max(0.0, Math.min(1.0, (worldLX - r.lxStart) / (r.lxEnd - r.lxStart)));
            const rampY = r.yStart + t * (r.yEnd - r.yStart);
            if (Math.abs(currentY - rampY) <= 0.85) {
              return rampY;
            }
          }
        } else if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
          const t = Math.max(0.0, Math.min(1.0, (z - r.zStart) / (r.zEnd - r.zStart)));
          const rampY = r.yStart + t * (r.yEnd - r.yStart);
          if (Math.abs(currentY - rampY) <= 1.55) {
            return rampY;
          }
        }
      }

      // 2. Check Multi-Story & Bus Walkable Floor Slabs reachable from currentY (prevents snapping through upper ceilings)
      let maxFloor = 0.0;
      for (let i = 0; i < walkableFloors.length; i++) {
        const f = walkableFloors[i];
        if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
        if (f.isOBB) {
          const dx = x - f.cx;
          const dz = z - f.cz;
          const lx = dx * f.cosR - dz * f.sinR;
          const lz = dx * f.sinR + dz * f.cosR;
          if (Math.abs(lx) <= f.hx && Math.abs(lz) <= f.hz) {
            if (f.floorY <= currentY + 0.72 && f.floorY > maxFloor) {
              maxFloor = f.floorY;
            }
          }
        } else if (x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ) {
          if (f.floorY <= currentY + 0.72 && f.floorY > maxFloor) {
            maxFloor = f.floorY;
          }
        }
      }
      return maxFloor;
    }

    // Ceiling head-bump clamp so jumping inside a bus or under low eaves never clips through the roof
    function getCeilingLimitBottomY(x, z, currentBottomY, playerHeight) {
      let minAllowedBottomY = Infinity;
      const r = 0.18;
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        if (!c || !c.min || !c.max) continue;
        if (c.min.y < currentBottomY + playerHeight - 0.15) continue;
        if (c.type === 'obb') {
          if (x < c.min.x - r || x > c.max.x + r || z < c.min.z - r || z > c.max.z + r) continue;
          const dx = x - c.cx;
          const dz = z - c.cz;
          const lx = dx * c.cosR - dz * c.sinR;
          const lz = dx * c.sinR + dz * c.cosR;
          if (Math.abs(lx) <= c.hx + r && Math.abs(lz) <= c.hz + r) {
            const limitY = c.min.y - playerHeight;
            if (limitY < minAllowedBottomY) minAllowedBottomY = limitY;
          }
        } else if (c.type !== 'cylinder') {
          if (x >= c.min.x - r && x <= c.max.x + r && z >= c.min.z - r && z <= c.max.z + r) {
            const limitY = c.min.y - playerHeight;
            if (limitY < minAllowedBottomY) minAllowedBottomY = limitY;
          }
        }
      }
      return minAllowedBottomY;
    }

    // Fast 3D Ray-Box intersection for 3rd-person camera wall occlusion
    function raycastCameraDistance(ox, oy, oz, dirX, dirY, dirZ, maxDist) {
      let shortest = maxDist;
      const minCamDist = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.minCameraDist) || 0.45;
      const pushBack = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.cameraPushBack) || 0.18;
      for (let i = 0; i < colliders.length; i++) {
        const b = colliders[i];
        if (b.max.y <= oy - 0.2) continue;
        if (b.min.y >= Math.max(oy, oy + dirY * maxDist) + 0.2) continue;

        if (b.type === 'obb') {
          if (b.tag === 'furniture' || b.tag === 'step') continue;
          const rx = ox - b.cx;
          const rz = oz - b.cz;
          const lox = rx * b.cosR - rz * b.sinR;
          const loz = rx * b.sinR + rz * b.cosR;
          const ldx = dirX * b.cosR - dirZ * b.sinR;
          const ldz = dirX * b.sinR + dirZ * b.cosR;
          let tmin = 0;
          let tmax = shortest;
          if (Math.abs(ldx) > 1e-6) {
            const inv = 1.0 / ldx;
            let t1 = (-b.hx - lox) * inv;
            let t2 = (b.hx - lox) * inv;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
            if (tmin > tmax) continue;
          } else if (lox < -b.hx || lox > b.hx) continue;
          if (Math.abs(dirY) > 1e-6) {
            const inv = 1.0 / dirY;
            let t1 = (b.minY - oy) * inv;
            let t2 = (b.maxY - oy) * inv;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
            if (tmin > tmax) continue;
          } else if (oy < b.minY || oy > b.maxY) continue;
          if (Math.abs(ldz) > 1e-6) {
            const inv = 1.0 / ldz;
            let t1 = (-b.hz - loz) * inv;
            let t2 = (b.hz - loz) * inv;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
            if (tmin > tmax) continue;
          } else if (loz < -b.hz || loz > b.hz) continue;
          if (tmin > 0.05 && tmin < shortest) {
            const unobstructed = Math.max(0.0, tmin - pushBack);
            shortest = unobstructed < minCamDist ? 0.0 : unobstructed;
          }
          continue;
        }

        let tmin = 0;
        let tmax = shortest;

        // X slab
        if (Math.abs(dirX) > 0.000001) {
          const inv = 1.0 / dirX;
          let t1 = (b.min.x - ox) * inv;
          let t2 = (b.max.x - ox) * inv;
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) continue;
        } else if (ox < b.min.x || ox > b.max.x) continue;

        // Y slab
        if (Math.abs(dirY) > 0.000001) {
          const inv = 1.0 / dirY;
          let t1 = (b.min.y - oy) * inv;
          let t2 = (b.max.y - oy) * inv;
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) continue;
        } else if (oy < b.min.y || oy > b.max.y) continue;

        // Z slab
        if (Math.abs(dirZ) > 0.000001) {
          const inv = 1.0 / dirZ;
          let t1 = (b.min.z - oz) * inv;
          let t2 = (b.max.z - oz) * inv;
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) continue;
        } else if (oz < b.min.z || oz > b.max.z) continue;

        const minCamDist = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.minCameraDist) || 0.45;
        const pushBack = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.cameraPushBack) || 0.18;
        if (tmin > 0.05 && tmin < shortest) {
          const unobstructed = Math.max(0.0, tmin - pushBack);
          if (unobstructed < minCamDist) {
            shortest = 0.0;
          } else {
            shortest = unobstructed;
          }
        }
      }
      return shortest;
    }

    const keys = {};
    window.addEventListener('keydown', e => {
      soundEngine.resume();
      keys[e.code] = true;
      if (e.code === 'KeyV') toggleCameraMode();
      if (e.code === 'KeyE') performAction();
      if (e.code === 'KeyC') toggleCrouch();
      if (e.code === 'KeyF' || e.code === 'KeyQ') toggleFlashlightOrHunterPing();
      if (e.code === 'KeyR') useThrowableOrHunterAbility();
      if (e.code === 'Space') {
        if (breathMiniGame.active) {
          breathMiniGame.holdingButton = true;
        } else {
          performJump();
        }
      }
      if (isDevTelemetryAllowed && (e.code === 'KeyP' || e.code === 'Backquote')) physicsDebug.toggle();
      if (e.code === 'KeyG') {
        window.toggleColorGrade();
      }
    });
    window.addEventListener('keyup', e => {
      keys[e.code] = false;
      if (e.code === 'Space') breathMiniGame.holdingButton = false;
    });

    const joystickZone = document.getElementById('joystick-zone');
    const joystickThumb = document.getElementById('joystick-thumb');
    let touchMove = { x: 0, y: 0 };
    let joystickActive = false;
    let joystickTouchId = null;

    function handleJoyStart(clientX, clientY, identifier) {
      soundEngine.resume();
      joystickActive = true;
      joystickTouchId = identifier;
      handleJoyMove(clientX, clientY);
    }

    function handleJoyMove(clientX, clientY) {
      if (!joystickActive) return;
      const rect = joystickZone.getBoundingClientRect();
      const dx = clientX - (rect.left + rect.width / 2);
      const dy = clientY - (rect.top + rect.height / 2);
      const maxR = 38;
      const clampedDist = Math.min(Math.hypot(dx, dy), maxR);
      const angle = Math.atan2(dy, dx);
      const thumbX = Math.cos(angle) * clampedDist;
      const thumbY = Math.sin(angle) * clampedDist;
      joystickThumb.style.transform = 'translate(' + thumbX + 'px, ' + thumbY + 'px)';

      const deadZone = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.joystickDeadZone) || 0.10;
      const rawMag = clampedDist / maxR;
      if (rawMag < deadZone) {
        touchMove.x = 0;
        touchMove.y = 0;
      } else {
        const remappedMag = (rawMag - deadZone) / (1.0 - deadZone);
        const factor = Math.min(1.0, remappedMag) / rawMag;
        touchMove.x = (thumbX / maxR) * factor;
        touchMove.y = (thumbY / maxR) * factor;
      }
    }

    function handleJoyEnd() {
      joystickActive = false;
      joystickTouchId = null;
      touchMove.x = 0;
      touchMove.y = 0;
      joystickThumb.style.transform = 'translate(0px, 0px)';
    }

    joystickZone.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      handleJoyStart(t.clientX, t.clientY, t.identifier);
    }, { passive: false });

    window.addEventListener('touchmove', e => {
      if (!joystickActive) return;
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === joystickTouchId) {
          handleJoyMove(e.touches[i].clientX, e.touches[i].clientY);
          break;
        }
      }
    }, { passive: true });

    window.addEventListener('touchend', e => {
      if (!joystickActive) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === joystickTouchId) {
          handleJoyEnd();
          break;
        }
      }
      if (e.touches.length === 0) {
        handleJoyEnd();
      }
    });

    window.addEventListener('touchcancel', handleJoyEnd);

    // Robust GTA V Style Free-Look Touch & Mouse Controller
    function isControlElement(el) {
      if (!el) return false;
      return !!(
        el.closest('#joystick-zone') ||
        el.closest('#action-cluster') ||
        el.closest('.touch-btn') ||
        el.closest('#action-prompt') ||
        el.closest('#campus-banner') ||
        el.closest('#physics-debug-hud') ||
        el.closest('#breath-minigame-overlay')
      );
    }

    let lookTouchId = null;
    let lastLookX = 0;
    let lastLookY = 0;
    let isMouseDown = false;

    window.addEventListener('touchstart', e => {
      soundEngine.resume();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === joystickTouchId) continue;
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        if (isControlElement(target)) continue;

        if (lookTouchId === null) {
          lookTouchId = touch.identifier;
          lastLookX = touch.clientX;
          lastLookY = touch.clientY;
          break;
        }
      }
    }, { passive: false });

    window.addEventListener('touchmove', e => {
      if (lookTouchId === null) return;
      for (let i = 0; i < e.touches.length; i++) {
        const touch = e.touches[i];
        if (touch.identifier === lookTouchId) {
          e.preventDefault();
          const dx = touch.clientX - lastLookX;
          const dy = touch.clientY - lastLookY;
          lastLookX = touch.clientX;
          lastLookY = touch.clientY;

          const sensX = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.lookSensitivityX) || 0.0055;
          const sensY = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.lookSensitivityY) || 0.0048;
          playerPhysics.targetYaw -= dx * sensX;
          playerPhysics.targetPitch = Math.max(-1.35, Math.min(1.35, playerPhysics.targetPitch - dy * sensY));
          if (playerPhysics.isHiding && typeof playerPhysics.hideBaseYaw === 'number') {
            const maxPeek = 0.72;
            const dYaw = playerPhysics.targetYaw - playerPhysics.hideBaseYaw;
            if (dYaw > maxPeek) playerPhysics.targetYaw = playerPhysics.hideBaseYaw + maxPeek;
            if (dYaw < -maxPeek) playerPhysics.targetYaw = playerPhysics.hideBaseYaw - maxPeek;
          }
          break;
        }
      }
    }, { passive: false });

    window.addEventListener('touchend', e => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === lookTouchId) {
          lookTouchId = null;
        }
      }
      if (e.touches.length === 0) {
        lookTouchId = null;
      }
    });

    window.addEventListener('touchcancel', () => {
      lookTouchId = null;
    });

    window.addEventListener('blur', () => {
      lookTouchId = null;
      isMouseDown = false;
      handleJoyEnd();
    });

    // Mouse / Desktop / Simulator Drag Controls
    window.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (isControlElement(e.target)) return;
      soundEngine.resume();
      isMouseDown = true;
      lastLookX = e.clientX;
      lastLookY = e.clientY;
    });

    window.addEventListener('mousemove', e => {
      if (!isMouseDown) return;
      const dx = e.clientX - lastLookX;
      const dy = e.clientY - lastLookY;
      lastLookX = e.clientX;
      lastLookY = e.clientY;

      const sensX = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.mouseSensitivityX) || 0.0035;
      const sensY = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.mouseSensitivityY) || 0.0030;
      playerPhysics.targetYaw -= dx * sensX;
      playerPhysics.targetPitch = Math.max(-1.35, Math.min(1.35, playerPhysics.targetPitch - dy * sensY));
      if (playerPhysics.isHiding && typeof playerPhysics.hideBaseYaw === 'number') {
        const maxPeek = 0.72;
        const dYaw = playerPhysics.targetYaw - playerPhysics.hideBaseYaw;
        if (dYaw > maxPeek) playerPhysics.targetYaw = playerPhysics.hideBaseYaw + maxPeek;
        if (dYaw < -maxPeek) playerPhysics.targetYaw = playerPhysics.hideBaseYaw - maxPeek;
      }
    });

    window.addEventListener('mouseup', () => {
      isMouseDown = false;
    });

    function bindTouchBtn(id, fn) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', e => {
        e.preventDefault();
        e.stopPropagation();
        soundEngine.resume();
        fn();
      }, { passive: false });
      el.addEventListener('click', () => {
        soundEngine.resume();
        fn();
      });
    }

    function toggleSprint() {
      playerPhysics.isSprinting = !playerPhysics.isSprinting;
      const el = document.getElementById('btn-sprint');
      if (el) el.classList.toggle('active', playerPhysics.isSprinting);
      showToast(playerPhysics.isSprinting ? 'Sprint ON (Loud Footsteps!)' : 'Sprint OFF');
    }

    function toggleFlashlightOrHunterPing() {
      if (GAME_CONFIG.role === 'seeker') {
        if (hunterAbilities.pingTimer <= 0.5) {
          hunterAbilities.pingTimer = (HORROR_CONFIG.gameplay && HORROR_CONFIG.gameplay.hunterFootstepPingIntervalSec) || 30.0;
          soundEngine.playSonarPingSfx();
          const lastNoise = recentNoiseEvents[recentNoiseEvents.length - 1];
          if (lastNoise) {
            showToast('Footstep Ping: Noise detected near (' + lastNoise.x.toFixed(0) + ', ' + lastNoise.z.toFixed(0) + ')!');
          } else {
            showToast('Footstep-Sense Ping: Scanning campus...');
          }
        } else {
          showToast('Footstep-Sense Ping Cooldown: ' + Math.ceil(hunterAbilities.pingTimer) + 's');
        }
        return;
      }
      if (flashlightBattery <= 0) {
        isFlashlightOn = false;
        showToast('Flashlight Battery Empty! Find a yellow battery cell.');
        return;
      }
      isFlashlightOn = !isFlashlightOn;
      showToast(isFlashlightOn ? 'Flashlight: ON' : 'Flashlight: OFF (Stealth)');
    }

    function useThrowableOrHunterAbility() {
      if (GAME_CONFIG.role === 'seeker') {
        if (hunterAbilities.powerCutCooldown <= 0) {
          hunterAbilities.powerCutCooldown = (HORROR_CONFIG.gameplay && HORROR_CONFIG.gameplay.hunterPowerCutCooldownSec) || 28.0;
          lampFlickerMod.triggerPowerDip(0.55);
          soundEngine.playPowerDipHum();
          powerCutDarkBuilding = 'ROTUNDA';
          powerCutBuildingTimer = 9.0;
          for (let d = 0; d < swingingDoors.length; d++) {
            const dr = swingingDoors[d];
            if (Math.hypot(dr.x - playerPhysics.pos.x, dr.z - playerPhysics.pos.z) < 5.5) {
              dr.lockedTimer = 10.0;
              dr.isOpen = false;
              dr.targetAngleY = 0;
            }
          }
          showToast('Power-Cut Pulse & Door Lock Activated!');
        } else {
          showToast('Power-Cut Pulse Cooldown: ' + Math.ceil(hunterAbilities.powerCutCooldown) + 's');
        }
        return;
      }

      if (throwablesRemaining <= 0) {
        showToast('No distraction items left!');
        return;
      }
      throwablesRemaining--;
      const btnLbl = document.getElementById('btn-throw-label');
      if (btnLbl) btnLbl.textContent = 'THROW (' + throwablesRemaining + ')';

      const pMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.16, 8),
        materials.brassGajur
      );
      pMesh.userData.noMerge = true;
      const fx = -Math.sin(playerPhysics.yaw) * Math.cos(playerPhysics.pitch);
      const fy = Math.max(0.15, Math.sin(playerPhysics.pitch) + 0.25);
      const fz = -Math.cos(playerPhysics.yaw) * Math.cos(playerPhysics.pitch);
      pMesh.position.set(playerPhysics.pos.x + fx * 0.6, playerPhysics.pos.y + 1.35, playerPhysics.pos.z + fz * 0.6);
      scene.add(pMesh);
      activeProjectiles.push({
        mesh: pMesh,
        vel: new THREE.Vector3(fx * 11.5, fy * 7.2, fz * 11.5),
        floorY: playerPhysics.pos.y,
        life: 2.2,
      });
      showToast('Threw distraction item! (' + throwablesRemaining + ' left)');
    }

    const holdBreathBtn = document.getElementById('btn-hold-breath');
    if (holdBreathBtn) {
      holdBreathBtn.addEventListener('touchstart', e => {
        e.preventDefault();
        e.stopPropagation();
        breathMiniGame.holdingButton = true;
      }, { passive: false });
      holdBreathBtn.addEventListener('touchend', e => {
        e.preventDefault();
        breathMiniGame.holdingButton = false;
      }, { passive: false });
      holdBreathBtn.addEventListener('mousedown', () => { breathMiniGame.holdingButton = true; });
      holdBreathBtn.addEventListener('mouseup', () => { breathMiniGame.holdingButton = false; });
    }

    bindTouchBtn('btn-debug-physics', () => physicsDebug.toggle());
    bindTouchBtn('btn-flashlight', toggleFlashlightOrHunterPing);
    bindTouchBtn('btn-throw', useThrowableOrHunterAbility);
    bindTouchBtn('btn-cam', () => {
      if (isPlayerSpectating) {
        const aliveScholars = bots.filter(b => !b.isSeeker && !b.isCaught);
        if (aliveScholars.length > 0) {
          spectateBotIdx = (spectateBotIdx + 1) % aliveScholars.length;
          showToast('Spectating ' + aliveScholars[spectateBotIdx].name);
          return;
        }
      }
      toggleCameraMode();
    });
    bindTouchBtn('btn-sprint', toggleSprint);
    bindTouchBtn('btn-crouch', toggleCrouch);
    bindTouchBtn('btn-jump', performJump);
    bindTouchBtn('btn-action', performAction);

    // Test Controls & Accessibility UI Event Bindings
    function bindDbgClick(id, fn) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    }
    bindDbgClick('dbg-btn-spd-1', () => {
      physicsDebug.speedMultiplier = 1.0;
      document.querySelectorAll('.dbg-btn').forEach(b => b.classList.remove('active'));
      const el = document.getElementById('dbg-btn-spd-1');
      if (el) el.classList.add('active');
      showToast('Speed: 1x (Normal)');
    });
    bindDbgClick('dbg-btn-spd-2', () => {
      physicsDebug.speedMultiplier = 2.0;
      document.querySelectorAll('.dbg-btn').forEach(b => b.classList.remove('active'));
      const el = document.getElementById('dbg-btn-spd-2');
      if (el) el.classList.add('active');
      showToast('Speed: 2x (Sprint)');
    });
    bindDbgClick('dbg-btn-spd-5', () => {
      physicsDebug.speedMultiplier = 5.0;
      document.querySelectorAll('.dbg-btn').forEach(b => b.classList.remove('active'));
      const el = document.getElementById('dbg-btn-spd-5');
      if (el) el.classList.add('active');
      showToast('Speed: 5x (Super-Fast)');
    });
    bindDbgClick('dbg-btn-lowfps', () => {
      physicsDebug.fakeLowFPS = !physicsDebug.fakeLowFPS;
      const el = document.getElementById('dbg-btn-lowfps');
      if (el) el.classList.toggle('active', physicsDebug.fakeLowFPS);
      showToast(physicsDebug.fakeLowFPS ? 'Fake Low FPS: 15 FPS ON' : 'Low FPS Mode: OFF');
    });
    bindDbgClick('dbg-btn-lag', () => {
      physicsDebug.lagSpikeRemaining = 1.0;
      showToast('Lag Spike Triggered (1.0s Freeze)');
    });
    bindDbgClick('dbg-btn-wireframes', () => {
      physicsDebug.toggle();
    });
    bindDbgClick('dbg-btn-shadows', () => {
      if (atmosphere && typeof atmosphere.toggleShadowsOnly === 'function') {
        const sOn = atmosphere.toggleShadowsOnly();
        showToast('Shadows Only: ' + (sOn ? 'ON' : 'OFF'));
      }
    });
    bindDbgClick('dbg-btn-run-audit', () => {
      if (window.__TEST_HARNESS__ && window.__TEST_HARNESS__.runAuditSuite) {
        window.__TEST_HARNESS__.runAuditSuite();
      }
    });
    bindDbgClick('dbg-btn-fear', () => {
      const order = ['high', 'medium', 'low'];
      const next = order[(order.indexOf(accessibilitySettings.fearIntensity) + 1) % order.length];
      accessibilitySettings.fearIntensity = next;
      const el = document.getElementById('dbg-btn-fear');
      if (el) el.textContent = 'Fear: ' + next.toUpperCase();
      showToast('Fear Intensity: ' + next.toUpperCase());
    });
    bindDbgClick('dbg-btn-flicker', () => {
      accessibilitySettings.flickerReduction = !accessibilitySettings.flickerReduction;
      const el = document.getElementById('dbg-btn-flicker');
      if (el) el.textContent = 'Flicker: ' + (accessibilitySettings.flickerReduction ? 'REDUCED' : 'FULL');
      showToast('Flicker Reduction: ' + (accessibilitySettings.flickerReduction ? 'ON' : 'OFF'));
    });
    bindDbgClick('dbg-btn-shake', () => {
      accessibilitySettings.screenShakeOff = !accessibilitySettings.screenShakeOff;
      const el = document.getElementById('dbg-btn-shake');
      if (el) el.textContent = 'Shake: ' + (accessibilitySettings.screenShakeOff ? 'OFF' : 'ON');
      showToast('Screen Shake: ' + (accessibilitySettings.screenShakeOff ? 'OFF' : 'ON'));
    });

    const tpSelect = document.getElementById('dbg-teleport-select');
    if (tpSelect) {
      tpSelect.addEventListener('change', e => {
        const val = e.target.value;
        if (!val) return;
        const [x, y, z, yaw] = val.split(',').map(Number);
        physicsDebug.teleport(x, y, z, yaw);
        tpSelect.value = '';
      });
    }

    /* =========================================================================
       MAP-DESIGN TOOLS SUITE (DEBUG / TOOLS MENU)
       ========================================================================= */
    Object.assign(exploreTools, {
      freeFly: false,
      flySpeed: 14.0,
      overviewCam: false,
      minimapVisible: true,
      screenshotMode: false,
      fogEnabled: true,
      dustEnabled: true,
      lightShaftsEnabled: true,
      flashlightBeamEnabled: true,
      timeOfNight: 1.0,
      fogMultiplier: 1.0,
      currentRoomId: 'OUTDOORS',
      currentBuilding: 'CAMPUS',
      currentMood: 'night_sky',
      notes: [],

      init() {
        const roomSelect = document.getElementById('dbg-room-teleport-select');
        if (roomSelect && typeof ROOM_DEFINITIONS === 'object') {
          Object.keys(ROOM_DEFINITIONS).forEach(roomId => {
            const def = ROOM_DEFINITIONS[roomId];
            if (!def || !def.bounds) return;
            const cx = ((def.bounds.minX + def.bounds.maxX) * 0.5).toFixed(2);
            const cz = ((def.bounds.minZ + def.bounds.maxZ) * 0.5).toFixed(2);
            const fy = (def.bounds.floorY || 0).toFixed(2);
            const opt = document.createElement('option');
            opt.value = cx + ',' + fy + ',' + cz + ',0,' + roomId;
            const floorTag = def.bounds.floorY > 6 ? '2F' : (def.bounds.floorY > 2 ? '1F' : 'GF');
            opt.textContent = '[' + (def.building || 'BLDG') + ' ' + floorTag + '] ' + roomId + ' (' + (def.lightMood || 'dark') + ')';
            if (typeof roomSelect.appendChild === 'function') {
              roomSelect.appendChild(opt);
            }
          });
          roomSelect.addEventListener('change', e => {
            const val = e.target.value;
            if (!val) return;
            const parts = val.split(',');
            const x = Number(parts[0]), y = Number(parts[1]), z = Number(parts[2]), yaw = Number(parts[3] || 0);
            const rId = parts.slice(4).join(',');
            this.overviewCam = false;
            const ovBtn = document.getElementById('dbg-btn-overview-cam');
            if (ovBtn) ovBtn.classList.remove('active');
            physicsDebug.teleport(x, y, z, yaw);
            showToast('Teleported to ' + (rId || 'Room'));
            roomSelect.value = '';
          });
        }

        bindDbgClick('dbg-btn-freefly', () => {
          this.freeFly = !this.freeFly;
          playerPhysics.vel.set(0, 0, 0);
          const flyBtn = document.getElementById('dbg-btn-freefly');
          const walkBtn = document.getElementById('dbg-btn-walkmode');
          if (flyBtn) {
            flyBtn.classList.toggle('active', this.freeFly);
            flyBtn.textContent = this.freeFly ? 'Free-Fly: ON (Noclip)' : 'Free-Fly: OFF';
          }
          if (walkBtn) walkBtn.classList.toggle('active', !this.freeFly);
          showToast(this.freeFly ? 'Free-Fly Camera ON (Collisions Off)' : 'Walking Mode Restored');
        });
        bindDbgClick('dbg-btn-walkmode', () => {
          this.freeFly = false;
          this.overviewCam = false;
          playerPhysics.pos.y = getSupportFloorY(playerPhysics.pos.x, playerPhysics.pos.z, playerPhysics.pos.y);
          playerPhysics.vel.set(0, 0, 0);
          const flyBtn = document.getElementById('dbg-btn-freefly');
          const walkBtn = document.getElementById('dbg-btn-walkmode');
          const ovBtn = document.getElementById('dbg-btn-overview-cam');
          if (flyBtn) {
            flyBtn.classList.remove('active');
            flyBtn.textContent = 'Free-Fly: OFF';
          }
          if (walkBtn) walkBtn.classList.add('active');
          if (ovBtn) ovBtn.classList.remove('active');
          showToast('Switched back to Walking Mode');
        });

        const flySpdSlider = document.getElementById('dbg-slider-flyspeed');
        if (flySpdSlider) {
          flySpdSlider.addEventListener('input', e => {
            this.flySpeed = Number(e.target.value) || 14.0;
            const lbl = document.getElementById('dbg-flyspeed-val');
            if (lbl) lbl.textContent = this.flySpeed.toFixed(0) + 'm/s';
          });
        }

        bindDbgClick('dbg-btn-cycle-mood', () => {
          const moods = ['dark', 'dying_tube', 'moonlight', 'warm_lamp', 'emergency_red'];
          const targetRoomId = this.currentRoomId !== 'OUTDOORS' ? this.currentRoomId : 'Rotunda Ground West Hall 101';
          const def = ROOM_DEFINITIONS[targetRoomId];
          const cur = (def && def.lightMood) ? normalizeRoomLightMood(def.lightMood) : 'dying_tube';
          const next = moods[(moods.indexOf(cur) + 1) % moods.length];
          if (typeof setRoomLightMood === 'function') {
            setRoomLightMood(targetRoomId, next);
          }
          this.currentMood = next;
          const btn = document.getElementById('dbg-btn-cycle-mood');
          if (btn) btn.textContent = 'Mood: ' + next;
          showToast(targetRoomId + ' -> ' + next.toUpperCase());
        });

        const timeSlider = document.getElementById('dbg-slider-time');
        if (timeSlider) {
          timeSlider.addEventListener('input', e => {
            this.timeOfNight = Number(e.target.value);
            const lbl = document.getElementById('dbg-time-val');
            if (lbl) lbl.textContent = Math.round(this.timeOfNight * 100) + '%';
            if (atmosphere) {
              atmosphere.baseAmbIntensity = ((HORROR_CONFIG.lighting && HORROR_CONFIG.lighting.ambientIntensity) || 0.28) * this.timeOfNight;
              if (atmosphere.moonLight) {
                atmosphere.moonLight.intensity = ((HORROR_CONFIG.lighting && HORROR_CONFIG.lighting.moonIntensity) || 1.28) * this.timeOfNight;
              }
              if (atmosphere.hemiLight) {
                atmosphere.hemiLight.intensity = ((HORROR_CONFIG.lighting && HORROR_CONFIG.lighting.hemiIntensity) || 0.42) * this.timeOfNight;
              }
            }
          });
        }

        const fogSlider = document.getElementById('dbg-slider-fog');
        if (fogSlider) {
          fogSlider.addEventListener('input', e => {
            this.fogMultiplier = Number(e.target.value);
            const lbl = document.getElementById('dbg-fog-val');
            if (lbl) lbl.textContent = Math.round(this.fogMultiplier * 100) + '%';
          });
        }

        bindDbgClick('dbg-btn-layer-fog', () => {
          this.fogEnabled = !this.fogEnabled;
          const b = document.getElementById('dbg-btn-layer-fog');
          if (b) {
            b.classList.toggle('active', this.fogEnabled);
            b.textContent = 'Fog: ' + (this.fogEnabled ? 'ON' : 'OFF');
          }
          showToast('Fog Layer: ' + (this.fogEnabled ? 'ON' : 'OFF'));
        });
        bindDbgClick('dbg-btn-layer-dust', () => {
          this.dustEnabled = !this.dustEnabled;
          const b = document.getElementById('dbg-btn-layer-dust');
          if (b) {
            b.classList.toggle('active', this.dustEnabled);
            b.textContent = 'Dust: ' + (this.dustEnabled ? 'ON' : 'OFF');
          }
          showToast('Dust Particles: ' + (this.dustEnabled ? 'ON' : 'OFF'));
        });
        bindDbgClick('dbg-btn-layer-shafts', () => {
          this.lightShaftsEnabled = !this.lightShaftsEnabled;
          if (typeof roomShaftGroups !== 'undefined') {
            roomShaftGroups.forEach(s => { if (s && s.group) s.group.visible = this.lightShaftsEnabled; });
          }
          const b = document.getElementById('dbg-btn-layer-shafts');
          if (b) {
            b.classList.toggle('active', this.lightShaftsEnabled);
            b.textContent = 'Shafts: ' + (this.lightShaftsEnabled ? 'ON' : 'OFF');
          }
          showToast('Window & Lamp Light Shafts: ' + (this.lightShaftsEnabled ? 'ON' : 'OFF'));
        });
        bindDbgClick('dbg-btn-layer-beam', () => {
          this.flashlightBeamEnabled = !this.flashlightBeamEnabled;
          const b = document.getElementById('dbg-btn-layer-beam');
          if (b) {
            b.classList.toggle('active', this.flashlightBeamEnabled);
            b.textContent = 'FL Beam: ' + (this.flashlightBeamEnabled ? 'ON' : 'OFF');
          }
          showToast('Flashlight Cone & Spill: ' + (this.flashlightBeamEnabled ? 'ON' : 'OFF'));
        });

        bindDbgClick('dbg-btn-screenshot', () => this.setScreenshotMode(true));
        bindDbgClick('screenshot-restore-btn', () => this.setScreenshotMode(false));

        bindDbgClick('dbg-btn-overview-cam', () => {
          this.overviewCam = !this.overviewCam;
          const b = document.getElementById('dbg-btn-overview-cam');
          if (b) {
            b.classList.toggle('active', this.overviewCam);
            b.textContent = this.overviewCam ? 'Overview Cam: ON' : 'Overview Cam: OFF';
          }
          showToast(this.overviewCam ? 'Top-Down 3D Campus Overview Camera' : 'Returned to Player Camera');
        });
        bindDbgClick('dbg-btn-minimap', () => {
          this.minimapVisible = !this.minimapVisible;
          const c = document.getElementById('explore-minimap-canvas');
          if (c) c.style.display = this.minimapVisible ? 'block' : 'none';
          const b = document.getElementById('dbg-btn-minimap');
          if (b) b.classList.toggle('active', this.minimapVisible);
        });

        bindDbgClick('dbg-btn-add-note', () => {
          const inp = document.getElementById('dbg-note-input');
          const txt = (inp && inp.value.trim()) ? inp.value.trim() : 'Inspect lighting / props here';
          const p = playerPhysics.pos;
          const entry = '[' + new Date().toISOString().slice(11, 19) + '] Pos(' +
            p.x.toFixed(2) + ', ' + p.y.toFixed(2) + ', ' + p.z.toFixed(2) + ') | Room: ' +
            this.currentRoomId + ' (' + this.currentBuilding + ', mood=' + this.currentMood + ') — ' + txt;
          this.notes.push(entry);
          if (inp) inp.value = '';
          const out = document.getElementById('dbg-notes-output');
          if (out) out.value = this.notes.join('\\n');
          showToast('Logged note #' + this.notes.length);
        });
        bindDbgClick('dbg-btn-copy-notes', () => {
          const text = this.notes.join('\\n');
          if (!text) {
            showToast('No notes logged yet!');
            return;
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => {});
          }
          const out = document.getElementById('dbg-notes-output');
          if (out) {
            out.select();
            try { document.execCommand('copy'); } catch (e) {}
          }
          sendToReactNative('COPY_DESIGN_NOTES', { notesText: text, count: this.notes.length });
          showToast('Copied ' + this.notes.length + ' notes!');
        });

        const volSlider = document.getElementById('dbg-slider-volume');
        if (volSlider) {
          volSlider.addEventListener('input', e => {
            const v = Number(e.target.value);
            const lbl = document.getElementById('dbg-vol-val');
            if (lbl) lbl.textContent = Math.round(v * 100) + '%';
            soundEngine.setAmbienceVolume(v);
          });
        }
        bindDbgClick('dbg-btn-mute-audio', () => {
          soundEngine.setMuted(!soundEngine.isMuted);
          const b = document.getElementById('dbg-btn-mute-audio');
          if (b) {
            b.classList.toggle('active', soundEngine.isMuted);
            b.textContent = soundEngine.isMuted ? 'Muted: YES' : 'Mute Audio';
          }
          showToast(soundEngine.isMuted ? 'Audio Muted' : 'Audio Unmuted');
        });
      },

      setScreenshotMode(hideUi) {
        this.screenshotMode = !!hideUi;
        const ids = ['campus-banner', 'explore-coord-pill', 'joystick-zone', 'action-cluster', 'physics-debug-hud', 'crosshair', 'action-prompt', 'toast'];
        ids.forEach(id => {
          const el = document.getElementById(id);
          if (!el) return;
          if (hideUi) {
            el.dataset.prevDisplay = el.style.display || '';
            el.style.display = 'none';
          } else if (id === 'physics-debug-hud') {
            el.style.display = physicsDebug.enabled ? 'block' : 'none';
          } else {
            el.style.display = el.dataset.prevDisplay || '';
          }
        });
        const restoreBtn = document.getElementById('screenshot-restore-btn');
        if (restoreBtn) restoreBtn.style.display = hideUi ? 'block' : 'none';
        sendToReactNative('SCREENSHOT_UI_VISIBILITY', { hidden: hideUi });
      },

      drawMinimap() {
        if (!this.minimapVisible) return;
        const canvas = document.getElementById('explore-minimap-canvas');
        if (!canvas || !canvas.getContext) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const w = canvas.width, h = canvas.height;
        ctx.fillStyle = '#050b14';
        ctx.fillRect(0, 0, w, h);

        const mapX = x => ((x + 52) / 104) * w;
        const mapZ = z => ((z + 75) / 155) * h;

        ctx.fillStyle = 'rgba(71, 85, 105, 0.35)';
        ctx.fillRect(mapX(-3.5), mapZ(-65), mapX(5.5) - mapX(-3.5), mapZ(55) - mapZ(-65));

        if (typeof ROOM_DEFINITIONS === 'object') {
          Object.keys(ROOM_DEFINITIONS).forEach(rId => {
            const def = ROOM_DEFINITIONS[rId];
            if (!def || !def.bounds) return;
            const b = def.bounds;
            const rx = mapX(b.minX), rz = mapZ(b.minZ);
            const rw = Math.max(2, mapX(b.maxX) - rx);
            const rh = Math.max(2, mapZ(b.maxZ) - rz);
            const isCur = (rId === this.currentRoomId);
            ctx.fillStyle = isCur ? 'rgba(56, 189, 248, 0.55)' : (def.lightMood === 'emergency_red' ? 'rgba(239, 68, 68, 0.32)' : 'rgba(30, 41, 59, 0.78)');
            ctx.strokeStyle = isCur ? '#38bdf8' : 'rgba(148, 163, 184, 0.42)';
            ctx.lineWidth = isCur ? 1.5 : 0.75;
            ctx.fillRect(rx, rz, rw, rh);
            ctx.strokeRect(rx, rz, rw, rh);
          });
        }

        const px = mapX(playerPhysics.pos.x);
        const pz = mapZ(playerPhysics.pos.z);
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.arc(px, pz, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px, pz);
        ctx.lineTo(px - Math.sin(playerPhysics.yaw) * 8, pz - Math.cos(playerPhysics.yaw) * 8);
        ctx.stroke();
      },

      updateFrame() {
        const p = playerPhysics.pos;
        let foundRoom = null;
        if (typeof ROOM_DEFINITIONS === 'object') {
          const keys = Object.keys(ROOM_DEFINITIONS);
          for (let i = 0; i < keys.length; i++) {
            const rId = keys[i];
            const def = ROOM_DEFINITIONS[rId];
            if (!def || !def.bounds) continue;
            const b = def.bounds;
            if (p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ && Math.abs(p.y - (b.floorY || 0)) <= 2.3) {
              foundRoom = def;
              break;
            }
          }
        }
        this.currentRoomId = foundRoom ? foundRoom.id : 'OUTDOORS';
        this.currentBuilding = foundRoom ? (foundRoom.building || 'CAMPUS') : 'OUTDOORS';
        this.currentMood = foundRoom ? (foundRoom.lightMood || 'dark') : 'night_sky';

        const pill = document.getElementById('explore-coord-pill');
        if (pill && !this.screenshotMode) {
          pill.textContent = 'XYZ: (' + p.x.toFixed(1) + ', ' + p.y.toFixed(1) + ', ' + p.z.toFixed(1) + ') • BLDG: ' +
            this.currentBuilding + ' • ROOM: ' + this.currentRoomId + ' • MOOD: ' + this.currentMood.toUpperCase() +
            (this.freeFly ? ' [FREE-FLY]' : '');
        }
        const dbgRoom = document.getElementById('dbg-room-info');
        if (dbgRoom && physicsDebug.enabled) {
          dbgRoom.textContent = 'Room: ' + this.currentRoomId + ' [' + this.currentBuilding + '] | Mood: ' + this.currentMood;
        }
        if (physicsDebug.enabled) {
          this.drawMinimap();
        }
      },
    });
    exploreTools.initUI = () => exploreTools.init();
    exploreTools.init();
    window.exploreTools = exploreTools;

    // STEP 1: Headless Scripted Input Runner
    window.__TEST_HARNESS__ = {
      simulateJoystick(dx, dy, durationMs = 250) {
        touchMove.x = dx;
        touchMove.y = dy;
        const thumb = document.getElementById('joystick-thumb');
        if (thumb) thumb.style.transform = 'translate(' + (dx * 35) + 'px, ' + (dy * 35) + 'px)';
        if (durationMs > 0) {
          setTimeout(() => {
            touchMove.x = 0;
            touchMove.y = 0;
            if (thumb) thumb.style.transform = 'translate(0, 0)';
          }, durationMs);
        }
      },
      simulateLook(deltaYaw, deltaPitch = 0) {
        playerPhysics.targetYaw += deltaYaw;
        playerPhysics.targetPitch = Math.max(-1.35, Math.min(1.35, playerPhysics.targetPitch + deltaPitch));
      },
      simulateJump() {
        performJump();
      },
      simulateCrouch() {
        toggleCrouch();
      },
      simulateAction() {
        performAction();
      },
      teleport(x, y, z, yaw) {
        physicsDebug.teleport(x, y, z, yaw);
      },
      setSpeedMultiplier(mult) {
        physicsDebug.speedMultiplier = mult;
      },
      setFakeLowFPS(enabled) {
        physicsDebug.fakeLowFPS = enabled;
      },
      triggerLagSpike(durationMs = 1000) {
        physicsDebug.lagSpikeRemaining = durationMs / 1000;
      },
      toggleColliders(show) {
        physicsDebug.toggle(show);
      },
      getState() {
        return {
          pos: { x: playerPhysics.pos.x, y: playerPhysics.pos.y, z: playerPhysics.pos.z },
          vel: { x: playerPhysics.vel.x, y: playerPhysics.vel.y, z: playerPhysics.vel.z },
          moveVector: { x: touchMove.x, y: touchMove.y },
          input: { forward: physicsDebug.lastInputForward, right: physicsDebug.lastInputRight },
          yaw: playerPhysics.yaw,
          pitch: playerPhysics.pitch,
          isGrounded: playerPhysics.isGrounded,
          isCrouching: playerPhysics.isCrouching,
          isHiding: playerPhysics.isHiding,
          lastNormal: { x: physicsDebug.lastNormal.x, y: physicsDebug.lastNormal.y, z: physicsDebug.lastNormal.z },
          fps: physicsDebug.fps,
          physicsCostMs: physicsDebug.physicsCostMs,
        };
      },
      runAuditSuite() {
        showToast('Running Physics & Bus Audit Suite...');
        console.log('[TEST HARNESS] Running automated physics & enterable bus audit...');
        const savedPos = playerPhysics.pos.clone();
        const savedVel = playerPhysics.vel.clone();
        const savedYaw = playerPhysics.yaw;
        const savedTargetYaw = playerPhysics.targetYaw;
        const results = {
          doorEntryExit: [],
          aisleWalk: [],
          eightAngleSweep: [],
          sprintAntiTunneling: [],
          roofHeadBump: [],
          hidingSpotClearance: [],
          fpsIndependenceInside: [],
        };
        for (let bi = 0; bi < enterableBuses.length; bi++) {
          const bus = enterableBuses[bi];
          const cosR = Math.cos(bus.rotY);
          const sinR = Math.sin(bus.rotY);
          const toW = (lx, lz) => ({
            x: bus.bx + lx * cosR + lz * sinR,
            z: bus.bz - lx * sinR + lz * cosR,
          });
          const toL = (wx, wz) => {
            const dx = wx - bus.bx;
            const dz = wz - bus.bz;
            return { lx: dx * cosR - dz * sinR, lz: dx * sinR + dz * cosR };
          };
          // 1. Door entry & exit (front & rear doors)
          [['front_door', bus.fDoorCenterZ], ['rear_door', bus.rDoorCenterZ]].forEach(([doorName, dcz]) => {
            const sw = toW(-1.85, dcz);
            playerPhysics.pos.set(sw.x, 0, sw.z);
            playerPhysics.vel.set(0, 0, 0);
            playerPhysics.isGrounded = true;
            const enterYaw = Math.atan2(-cosR, sinR);
            playerPhysics.yaw = enterYaw;
            playerPhysics.targetYaw = enterYaw;
            keys['KeyW'] = true; keys['ShiftLeft'] = false;
            for (let f = 0; f < 55; f++) updatePlayer(1 / 60, f / 60);
            const inL = toL(playerPhysics.pos.x, playerPhysics.pos.z);
            const inY = playerPhysics.pos.y;
            const enterOk = inL.lx > -0.38 && inL.lx < 0.92 && Math.abs(inY - bus.floorY) < 0.08;

            const aw = toW(0.0, dcz);
            playerPhysics.pos.set(aw.x, bus.floorY, aw.z);
            playerPhysics.vel.set(0, 0, 0);
            const exitYaw = Math.atan2(cosR, -sinR);
            playerPhysics.yaw = exitYaw;
            playerPhysics.targetYaw = exitYaw;
            for (let f = 0; f < 55; f++) updatePlayer(1 / 60, f / 60);
            keys['KeyW'] = false;
            const outL = toL(playerPhysics.pos.x, playerPhysics.pos.z);
            const outY = playerPhysics.pos.y;
            const exitOk = outL.lx < -1.45 && outY <= 0.06;
            results.doorEntryExit.push({
              busId: bus.id,
              door: doorName,
              enteredLX: Number(inL.lx.toFixed(2)),
              enteredY: Number(inY.toFixed(2)),
              exitedLX: Number(outL.lx.toFixed(2)),
              exitedY: Number(outY.toFixed(2)),
              pass: enterOk && exitOk,
            });
          });
          // 2. Walk full aisle front (-3.35) to back (+4.20)
          const fW = toW(0.0, -3.35);
          playerPhysics.pos.set(fW.x, bus.floorY, fW.z);
          playerPhysics.vel.set(0, 0, 0);
          const aisleYaw = Math.atan2(-sinR, -cosR); // facing +localZ (front to back)
          playerPhysics.yaw = aisleYaw;
          playerPhysics.targetYaw = aisleYaw;
          keys['KeyW'] = true;
          for (let f = 0; f < 130; f++) updatePlayer(1 / 60, f / 60);
          keys['KeyW'] = false;
          const endAisleL = toL(playerPhysics.pos.x, playerPhysics.pos.z);
          results.aisleWalk.push({
            busId: bus.id,
            startLZ: -3.35,
            endLZ: Number(endAisleL.lz.toFixed(2)),
            endLX: Number(endAisleL.lx.toFixed(2)),
            pass: endAisleL.lz > 3.45 && Math.abs(endAisleL.lx) < 0.25,
          });
        }
        playerPhysics.pos.copy(savedPos);
        playerPhysics.vel.copy(savedVel);
        playerPhysics.yaw = savedYaw;
        playerPhysics.targetYaw = savedTargetYaw;
        return results;
      }
    };

    function toggleCameraMode() {
      playerPhysics.cameraMode = playerPhysics.cameraMode === 'first' ? 'third' : 'first';
      if (playerCharacter) playerCharacter.visible = (playerPhysics.cameraMode === 'third');
      showToast(playerPhysics.cameraMode === 'first' ? '1st-Person View' : '3rd-Person View');
    }

    function toggleCrouch() {
      if (playerPhysics.isCrouching) {
        const standH = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.standingHeight) || 1.80;
        const ceilingLimit = getCeilingLimitBottomY(playerPhysics.pos.x, playerPhysics.pos.z, playerPhysics.pos.y, standH);
        if (playerPhysics.pos.y > ceilingLimit + 0.02) {
          showToast('Low Clearance — Cannot Stand Here');
          return;
        }
      }
      playerPhysics.isCrouching = !playerPhysics.isCrouching;
      showToast(playerPhysics.isCrouching ? 'Crouched (Quiet Steps)' : 'Standing');
    }

    function performJump() {
      if (playerPhysics.isGrounded && !playerPhysics.isHiding && !playerPhysics.isCrouching) {
        playerPhysics.vel.y = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.jumpForce) || 5.2;
        playerPhysics.isGrounded = false;
        soundEngine.playFootstep('road', false);
      }
    }

    function findNearbyHidingSpot() {
      if (EXPLORE_FLAGS.ENABLE_HIDING_SPOTS_AND_MINIGAME === false) return null;
      let bestSpot = null;
      let bestDist = 2.6;
      for (let i = 0; i < interactiveHidingSpots.length; i++) {
        const s = interactiveHidingSpots[i];
        if (Math.abs((playerPhysics.pos.y || 0) - (s.y || 0)) > 1.45) continue;
        const d = Math.hypot(playerPhysics.pos.x - s.x, playerPhysics.pos.z - s.z);
        if (d < bestDist) {
          bestDist = d;
          bestSpot = s;
        }
      }
      return bestSpot;
    }

    function findNearbyFuseBox() {
      for (let i = 0; i < fuseBoxes.length; i++) {
        const fb = fuseBoxes[i];
        if (fb.restored) continue;
        if (Math.abs(playerPhysics.pos.y - fb.y) < 1.8 && Math.hypot(playerPhysics.pos.x - fb.x, playerPhysics.pos.z - fb.z) < 2.6) {
          return fb;
        }
      }
      return null;
    }

    function findNearbyCaptiveTeammate() {
      for (let i = 0; i < bots.length; i++) {
        const b = bots[i];
        if (!b.isSeeker && b.isCaught && b.canBeRescued && b.mesh) {
          if (Math.abs(playerPhysics.pos.y - b.mesh.position.y) < 1.8 &&
              Math.hypot(playerPhysics.pos.x - b.mesh.position.x, playerPhysics.pos.z - b.mesh.position.z) < 2.6) {
            return b;
          }
        }
      }
      return null;
    }

    function checkTagLineOfSight(eyePos, chestPos, colliderList) {
      const dx = chestPos.x - eyePos.x;
      const dy = chestPos.y - eyePos.y;
      const dz = chestPos.z - eyePos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 0.001) return true;
      const dirX = dx / dist;
      const dirY = dy / dist;
      const dirZ = dz / dist;

      for (let i = 0; i < colliderList.length; i++) {
        const b = colliderList[i];
        if (!b) continue;

        // Cylinder collider check
        if (b.type === 'cylinder') {
          const cx = b.x !== undefined ? b.x : (b.min.x + b.max.x) / 2;
          const cz = b.z !== undefined ? b.z : (b.min.z + b.max.z) / 2;
          const cr = b.radius || 0.20;
          const bMinY = b.minY !== undefined ? b.minY : (b.min ? b.min.y : 0);
          const bMaxY = b.maxY !== undefined ? b.maxY : (b.max ? b.max.y : 5.0);

          const ocX = eyePos.x - cx;
          const ocZ = eyePos.z - cz;
          const a = dirX * dirX + dirZ * dirZ;
          if (a > 0.000001) {
            const bCoeff = 2 * (ocX * dirX + ocZ * dirZ);
            const cCoeff = ocX * ocX + ocZ * ocZ - cr * cr;
            const disc = bCoeff * bCoeff - 4 * a * cCoeff;
            if (disc >= 0) {
              const sqrtDisc = Math.sqrt(disc);
              const t1 = (-bCoeff - sqrtDisc) / (2 * a);
              const t2 = (-bCoeff + sqrtDisc) / (2 * a);
              let tHit = -1;
              if (t1 > 0.05 && t1 < dist - 0.05) tHit = t1;
              else if (t2 > 0.05 && t2 < dist - 0.05) tHit = t2;
              if (tHit > 0) {
                const hitY = eyePos.y + dirY * tHit;
                if (hitY >= bMinY && hitY <= bMaxY) {
                  return false; // Obstructed by cylinder collider
                }
              }
            }
          }
          continue;
        }

        // Oriented Box (OBB) collider check
        if (b.type === 'obb') {
          if (b.tag === 'step') continue;
          const rx = eyePos.x - b.cx;
          const rz = eyePos.z - b.cz;
          const lox = rx * b.cosR - rz * b.sinR;
          const loz = rx * b.sinR + rz * b.cosR;
          const ldx = dirX * b.cosR - dirZ * b.sinR;
          const ldz = dirX * b.sinR + dirZ * b.cosR;
          let tmin = 0.0;
          let tmax = dist - 0.05;
          if (Math.abs(ldx) > 1e-6) {
            const inv = 1.0 / ldx;
            let t1 = (-b.hx - lox) * inv;
            let t2 = (b.hx - lox) * inv;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
            if (tmin > tmax) continue;
          } else if (lox < -b.hx || lox > b.hx) continue;
          if (Math.abs(dirY) > 1e-6) {
            const inv = 1.0 / dirY;
            let t1 = (b.minY - eyePos.y) * inv;
            let t2 = (b.maxY - eyePos.y) * inv;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
            if (tmin > tmax) continue;
          } else if (eyePos.y < b.minY || eyePos.y > b.maxY) continue;
          if (Math.abs(ldz) > 1e-6) {
            const inv = 1.0 / ldz;
            let t1 = (-b.hz - loz) * inv;
            let t2 = (b.hz - loz) * inv;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
            tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
            if (tmin > tmax) continue;
          } else if (loz < -b.hz || loz > b.hz) continue;
          if (tmin < dist - 0.05 && tmax > 0.05) return false;
          continue;
        }

        // AABB Box collider check
        if (!b.min || !b.max) continue;
        let tmin = 0.0;
        let tmax = dist - 0.05;

        // X slab
        if (Math.abs(dirX) > 0.000001) {
          const inv = 1.0 / dirX;
          let t1 = (b.min.x - eyePos.x) * inv;
          let t2 = (b.max.x - eyePos.x) * inv;
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) continue;
        } else if (eyePos.x < b.min.x || eyePos.x > b.max.x) {
          continue;
        }

        // Y slab
        if (Math.abs(dirY) > 0.000001) {
          const inv = 1.0 / dirY;
          let t1 = (b.min.y - eyePos.y) * inv;
          let t2 = (b.max.y - eyePos.y) * inv;
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) continue;
        } else if (eyePos.y < b.min.y || eyePos.y > b.max.y) {
          continue;
        }

        // Z slab
        if (Math.abs(dirZ) > 0.000001) {
          const inv = 1.0 / dirZ;
          let t1 = (b.min.z - eyePos.z) * inv;
          let t2 = (b.max.z - eyePos.z) * inv;
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) continue;
        } else if (eyePos.z < b.min.z || eyePos.z > b.max.z) {
          continue;
        }

        if (tmin < dist - 0.05 && tmax > 0.05) {
          return false; // Obstructed by box collider
        }
      }
      return true;
    }

    function performAction() {
      soundEngine.resume();
      if (!EXPLORE_FLAGS.ENABLE_GAMEPLAY) {
        for (let d = 0; d < swingingDoors.length; d++) {
          const dr = swingingDoors[d];
          if (Math.abs(playerPhysics.pos.y - dr.y) < 2.2 && Math.hypot(playerPhysics.pos.x - dr.x, playerPhysics.pos.z - dr.z) < 2.8) {
            dr.isOpen = !dr.isOpen;
            dr.targetAngleY = dr.isOpen ? dr.openAngle : 0;
            soundEngine.playDoorCreakSfx();
            showToast(dr.isOpen ? 'Door Opened' : 'Door Closed');
            return;
          }
        }
        showToast('Map Exploration Mode — Open DEBUG for Map-Design Tools');
        return;
      }
      if (GAME_CONFIG.role === 'seeker') {
        let tagged = false;
        const eyeH = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.tagEyeHeight) || 1.62;
        const chestH = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.tagChestHeight) || 1.10;
        const tagRange = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.tagRange) || 3.2;
        const seekerEye = {
          x: playerPhysics.pos.x,
          y: playerPhysics.pos.y + (playerPhysics.isCrouching ? ((HORROR_CONFIG.physics && HORROR_CONFIG.physics.crouchEyeHeight) || 0.95) : eyeH),
          z: playerPhysics.pos.z,
        };

        bots.forEach(b => {
          if (!b.isSeeker && !b.isCaught) {
            const bPos = b.mesh ? b.mesh.position : (b.pos || b);
            const dist = playerPhysics.pos.distanceTo(bPos);
            if (dist < tagRange) {
              const targetChest = { x: bPos.x, y: bPos.y + chestH, z: bPos.z };
              if (checkTagLineOfSight(seekerEye, targetChest, colliders)) {
                b.catchCount = (b.catchCount || 0) + 1;
                b.isCaught = true;
                b.canBeRescued = (b.catchCount === 1);
                if (b.mesh && !b.canBeRescued) scene.remove(b.mesh);
                tagged = true;
                soundEngine.playCatchSting();
                showToast(b.canBeRescued ? ('Captured ' + b.name + ' (1/2 - Can be rescued once!)') : ('Eliminated ' + b.name + ' (2/2 Permanent)!'));
                sendToReactNative('HIDER_CAUGHT', {
                  hiderName: b.name,
                  remaining: bots.filter(h => !h.isSeeker && !h.isCaught).length,
                });
              }
            }
          }
        });
        if (!tagged) showToast('Searching classrooms & hiding spots...');
        evaluateGameStatus();
        return;
      }

      if (playerPhysics.isHiding) {
        playerPhysics.isHiding = false;
        breathMiniGame.active = false;
        const bmEl = document.getElementById('breath-minigame-overlay');
        if (bmEl) bmEl.style.display = 'none';
        if (playerPhysics.currentHidingSpot) {
          const spot = playerPhysics.currentHidingSpot;
          if (spot.exitX !== undefined && spot.exitY !== undefined && spot.exitZ !== undefined) {
            playerPhysics.pos.x = spot.exitX;
            playerPhysics.pos.y = spot.exitY;
            playerPhysics.pos.z = spot.exitZ;
          }
        }
        playerPhysics.currentHidingSpot = null;
        document.getElementById('stealth-overlay').classList.remove('active');
        soundEngine.setMuffled(false);
        soundEngine.playHideSwoosh();
        showToast('Stepped out from cover');
        updatePrompts();
        return;
      }

      // Priority 1: Rescue a captured teammate (1st catch)
      const captive = findNearbyCaptiveTeammate();
      if (captive) {
        captive.isCaught = false;
        captive.canBeRescued = false;
        if (captive.mesh) captive.mesh.visible = true;
        soundEngine.playFuseRepairSfx();
        showToast('Freed teammate ' + captive.name + '!');
        sendToReactNative('STATUS', {
          hidersRemaining: bots.filter(b => !b.isSeeker && !b.isCaught).length + (isPlayerSpectating ? 0 : 1),
          timeLeft: matchTimer,
        });
        updatePrompts();
        return;
      }

      // Priority 2: Escape through Main Gate if all 4 Fuse Boxes are restored
      if (mainGateUnlocked && Math.hypot(playerPhysics.pos.x - 1.5, playerPhysics.pos.z - (-59.0)) < 4.5) {
        isGameOver = true;
        isMatchActive = false;
        soundEngine.playFuseRepairSfx();
        sendToReactNative('GAMEOVER', {
          winner: 'HIDERS',
          reason: 'All 4 Fuse Boxes restored — You unlocked the South Main Gate and escaped!',
        });
        return;
      }

      // Priority 3: Restore nearby Fuse Box
      const nearbyFuse = findNearbyFuseBox();
      if (nearbyFuse) {
        nearbyFuse.restored = true;
        if (nearbyFuse.ledMat) nearbyFuse.ledMat.color.setHex(0x22c55e);
        soundEngine.playFuseRepairSfx();
        recordNoiseEvent(nearbyFuse.x, nearbyFuse.y, nearbyFuse.z, 0.55, 'Fuse Box Restored');
        const restoredCount = fuseBoxes.filter(f => f.restored).length;
        const fuseHud = document.getElementById('hud-fuses-label');
        if (fuseHud) fuseHud.textContent = restoredCount + '/' + fuseBoxes.length;
        if (restoredCount >= fuseBoxes.length) {
          mainGateUnlocked = true;
          soundEngine.playDistantChime();
          showToast('ALL 4 FUSES RESTORED! Unlock & Escape at the South Main Gate!');
        } else {
          showToast('Restored ' + nearbyFuse.name + ' (' + restoredCount + '/4)!');
        }
        sendToReactNative('FUSES_UPDATED', {
          fusesRestored: restoredCount,
          mainGateUnlocked,
        });
        updatePrompts();
        return;
      }

      // Priority 4: Enter nearby Hiding Spot (under desks, lockers, behind curtains, cupboards, under stairs, behind bookshelves)
      const spot = findNearbyHidingSpot();
      if (spot) {
        playerPhysics.isHiding = true;
        playerPhysics.currentHidingSpot = spot;
        playerPhysics.hideBaseYaw = playerPhysics.yaw;
        spot.useCount = (spot.useCount || 0) + 1;
        const isKnownSpot = spot.useCount >= ((HORROR_CONFIG.gameplay && HORROR_CONFIG.gameplay.spotKnownThreshold) || 2);
        playerPhysics.pos.x = spot.x;
        playerPhysics.pos.y = spot.y;
        playerPhysics.pos.z = spot.z;
        const badgeTxt = document.getElementById('stealth-badge-text');
        if (badgeTxt) {
          const riskTag = isKnownSpot ? 'KNOWN SPOT (HIGH RISK!)' : ('RISK ' + Math.round((spot.riskLevel || 0.2) * 100) + '%');
          badgeTxt.textContent = 'HIDDEN: ' + spot.name.toUpperCase() + ' • ' + riskTag + ' • PEEK VIEW';
        }
        document.getElementById('stealth-overlay').classList.add('active');
        soundEngine.setMuffled(true);
        soundEngine.playHideSwoosh();
        showToast(isKnownSpot ? ('Hidden at ' + spot.name + ' — Careful, Hunter knows this spot!') : ('Hidden at ' + spot.name));
      } else {
        showToast('Move near a Desk, Locker, Curtain, Bookshelf, Staircase, or Fuse Box!');
      }
      updatePrompts();
    }

    function updatePrompts() {
      const promptEl = document.getElementById('action-prompt');
      const labelEl = document.getElementById('action-prompt-text');
      const btnLabel = document.getElementById('btn-action-label');
      const crosshairEl = document.getElementById('crosshair');

      if (!EXPLORE_FLAGS.ENABLE_HIDING_PROMPTS) {
        if (promptEl) promptEl.classList.remove('active');
        if (crosshairEl) crosshairEl.classList.remove('active');
        return;
      }

      if (GAME_CONFIG.role === 'seeker') {
        btnLabel.textContent = 'TAG';
        let nearHider = false;
        bots.forEach(b => {
          if (!b.isSeeker && !b.isCaught && playerPhysics.pos.distanceTo(b.mesh.position) < 3.2) nearHider = true;
        });
        if (nearHider) {
          labelEl.textContent = 'TAG SCHOLAR (E)';
          promptEl.classList.add('active');
          crosshairEl.classList.add('active');
        } else {
          promptEl.classList.remove('active');
          crosshairEl.classList.remove('active');
        }
        return;
      }

      if (playerPhysics.isHiding) {
        labelEl.textContent = 'LEAVE COVER (E)';
        btnLabel.textContent = 'EXIT';
        promptEl.classList.add('active');
        crosshairEl.classList.add('active');
        return;
      }

      const captive = findNearbyCaptiveTeammate();
      if (captive) {
        labelEl.textContent = 'FREE TEAMMATE: ' + captive.name.toUpperCase() + ' (E)';
        btnLabel.textContent = 'RESCUE';
        promptEl.classList.add('active');
        crosshairEl.classList.add('active');
        return;
      }

      if (mainGateUnlocked && Math.hypot(playerPhysics.pos.x - 1.5, playerPhysics.pos.z - (-59.0)) < 4.5) {
        labelEl.textContent = 'UNLOCK MAIN GATE & ESCAPE! (E)';
        btnLabel.textContent = 'ESCAPE';
        promptEl.classList.add('active');
        crosshairEl.classList.add('active');
        return;
      }

      const fb = findNearbyFuseBox();
      if (fb) {
        labelEl.textContent = 'RESTORE ' + fb.name.toUpperCase() + ' (E)';
        btnLabel.textContent = 'REPAIR';
        promptEl.classList.add('active');
        crosshairEl.classList.add('active');
        return;
      }

      const spot = findNearbyHidingSpot();
      if (spot) {
        const knownStr = (spot.useCount || 0) >= 2 ? ' [KNOWN]' : '';
        labelEl.textContent = 'HIDE: ' + spot.name + knownStr + ' (E)';
        btnLabel.textContent = 'HIDE';
        promptEl.classList.add('active');
        crosshairEl.classList.add('active');
      } else {
        btnLabel.textContent = 'HIDE';
        promptEl.classList.remove('active');
        crosshairEl.classList.remove('active');
      }
    }

    function updateCampusZoneBanner() {
      const zoneEl = document.getElementById('campus-zone-text');
      if (!zoneEl) return;
      const x = playerPhysics.pos.x, y = playerPhysics.pos.y, z = playerPhysics.pos.z;
      let zone = 'GANDAKI UNIVERSITY • CENTRAL CAMPUS SPINE ROAD';
      if (z < -42 && x < 2) zone = 'GANDAKI UNIVERSITY • MAIN PARKING PLAZA & ESCAPE GATE';
      else if (z < -36 && x >= 2) zone = 'GANDAKI UNIVERSITY • BUS PARKING BAY (YELLOW BUSES)';
      else if (x < -28) zone = 'GANDAKI UNIVERSITY • WEST ADMIN & WORKSHOP CLUSTER';
      else if (x >= -17 && x <= -9 && z >= -28 && z <= 0) zone = 'GANDAKI UNIVERSITY • PLANTER ISLAND COURTYARD';
      else if (x < -2 && z >= -36 && z <= 2) zone = 'GANDAKI UNIVERSITY • WEST CLASSROOM WING L1';
      else if (x < -14 && z >= -26 && z <= 6) zone = 'GANDAKI UNIVERSITY • WEST WING L2 (FUSE BOX SECTOR)';
      else if (x < -14 && z > 6 && z <= 28) zone = 'GANDAKI UNIVERSITY • WEST CLASSROOM WING L3';
      else if (x < -14 && z > 28) zone = 'GANDAKI UNIVERSITY • WEST CLASSROOM WING L4';
      else if (x >= 9 && x <= 20 && z >= -38 && z <= -10) zone = 'GANDAKI UNIVERSITY • EAST WING R1 (ACADEMIC BLOCK)';
      else if (x > 18 && z >= -28 && z <= -4) zone = 'GANDAKI UNIVERSITY • EAST WING R2 (FUSE BOX SECTOR)';
      else if (x > 20 && z > -4 && z <= 18) zone = 'GANDAKI UNIVERSITY • EAST WING R3 (ACADEMIC BLOCK)';
      else if (x > 22 && z > 18 && z <= 46) zone = 'GANDAKI UNIVERSITY • EAST WING R4 (LONG BLOCK)';
      else if (z > 51 && x >= -14 && x <= 26) {
        if (y >= 6.2) zone = 'MAIN BUILDING • 2ND FLOOR: SEMINAR 301 (DARK) & LAB 302 (EMERGENCY RED)';
        else if (y >= 2.5) zone = 'MAIN BUILDING • 1ST FLOOR: CLASS 201 (MOONLIT) & LIBRARY 202 (WARM LAMP)';
        else zone = 'MAIN BUILDING • GROUND FLOOR: HALL 101 (FLICKER TUBE) & ADMIN 102';
      } else if (z > 44) zone = 'GANDAKI UNIVERSITY • GRAND ROTUNDA PLAZA & FOUNTAIN';
      if (zoneEl.textContent !== zone) zoneEl.textContent = zone;
    }

    function startMatch() {
      matchTimer = GAME_CONFIG.matchDuration;
      graceTimer = EXPLORE_FLAGS.ENABLE_ROLES_AND_TIMER ? GAME_CONFIG.seekerGracePeriod : 0;
      isMatchActive = true;
      isGameOver = false;
      playerPhysics.isHiding = false;
      playerCatchCount = 0;
      isPlayerSpectating = false;
      flashlightBattery = 100.0;
      isFlashlightOn = true;
      throwablesRemaining = (HORROR_CONFIG.gameplay && HORROR_CONFIG.gameplay.scholarStartingThrowables) || 2;
      breathMiniGame.active = false;
      document.getElementById('stealth-overlay').classList.remove('active');
      document.getElementById('horror-pulse-overlay').style.opacity = '0';
      const glitchEl = document.getElementById('horror-glitch-overlay');
      if (glitchEl) glitchEl.style.opacity = '0';
      const flashEl = document.getElementById('horror-jumpscare-flash');
      if (flashEl) flashEl.style.opacity = '0';
      const specEl = document.getElementById('spectator-overlay');
      if (specEl) specEl.style.display = 'none';
      const bmEl = document.getElementById('breath-minigame-overlay');
      if (bmEl) bmEl.style.display = 'none';
      const telHud = document.getElementById('gameplay-telemetry-hud');
      if (telHud) telHud.style.display = EXPLORE_FLAGS.ENABLE_GAMEPLAY_HUD ? 'flex' : 'none';
      const actPrompt = document.getElementById('action-prompt');
      if (actPrompt && !EXPLORE_FLAGS.ENABLE_GAMEPLAY_HUD) actPrompt.classList.remove('active');

      const flBtnLbl = document.getElementById('btn-flashlight-label');
      if (flBtnLbl) flBtnLbl.textContent = (!EXPLORE_MODE && GAME_CONFIG.role === 'seeker') ? 'PING' : 'LIGHT';
      const thBtn = document.getElementById('btn-throw');
      if (thBtn) thBtn.style.display = EXPLORE_FLAGS.ENABLE_THROWABLE_DISTRACTIONS ? 'flex' : 'none';
      const actBtn = document.getElementById('btn-action');
      if (actBtn) actBtn.style.display = EXPLORE_FLAGS.ENABLE_HIDING_SPOTS_AND_MINIGAME ? 'flex' : 'none';
      const thBtnLbl = document.getElementById('btn-throw-label');
      if (thBtnLbl) thBtnLbl.textContent = (!EXPLORE_MODE && GAME_CONFIG.role === 'seeker') ? 'PULSE' : ('THROW (' + throwablesRemaining + ')');

      initCharactersAndBots();

      if (!EXPLORE_MODE && GAME_CONFIG.role === 'seeker') {
        playerPhysics.pos.set(0, 0, -60);
        playerPhysics.yaw = 0;
        playerPhysics.targetYaw = 0;
        if (EXPLORE_FLAGS.ENABLE_ROLES_AND_TIMER) {
          document.getElementById('blindfold-overlay').classList.add('active');
        }
      } else {
        playerPhysics.pos.set(-4, 0, -48);
        playerPhysics.yaw = 0;
        playerPhysics.targetYaw = 0;
        document.getElementById('blindfold-overlay').classList.remove('active');
      }

      if (EXPLORE_FLAGS.ENABLE_ROLES_AND_TIMER) {
        sendToReactNative('STATUS', {
          hidersRemaining: GAME_CONFIG.botCount,
          timeLeft: matchTimer,
          fusesRestored: 0,
          mainGateUnlocked: false,
        });
      }
    }

    function evaluateGameStatus(timeOut = false) {
      if (!EXPLORE_FLAGS.ENABLE_WIN_LOSE_EVALUATION || isGameOver) return;
      const activeBotScholars = bots.filter(b => !b.isSeeker && !b.isCaught).length;
      const remainingHiders = GAME_CONFIG.role === 'seeker'
        ? activeBotScholars
        : (activeBotScholars + (isPlayerSpectating ? 0 : 1));

      if (remainingHiders === 0) {
        isGameOver = true;
        isMatchActive = false;
        sendToReactNative('GAMEOVER', {
          winner: 'SEEKER',
          reason: 'The Hollow Proctor captured all Scholars before the Main Gate was unlocked!',
        });
      } else if (timeOut) {
        isGameOver = true;
        isMatchActive = false;
        sendToReactNative('GAMEOVER', {
          winner: 'HIDERS',
          reason: 'Scholars survived the night until the 9-minute bell rang!',
        });
      }
    }

    function updatePlayer(delta, timeSec = 0) {
      if (!isMatchActive) return;

      let canMove = !isPlayerSpectating;
      if (EXPLORE_FLAGS.ENABLE_ROLES_AND_TIMER && graceTimer > 0) {
        graceTimer -= delta;
        document.getElementById('blindfold-counter').textContent = Math.ceil(Math.max(0, graceTimer));
        if (graceTimer <= 0) {
          document.getElementById('blindfold-overlay').classList.remove('active');
          showToast('Round Started — Restore 4 Fuse Boxes or Survive!');
        }
        if (GAME_CONFIG.role === 'seeker') {
          canMove = false;
        }
      }

      // 1. Look orientation: yaw and pitch come strictly from look input (collision NEVER modifies them)
      const lookSmoothing = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.lookSmoothing) || 24.0;
      playerPhysics.yaw += (playerPhysics.targetYaw - playerPhysics.yaw) * Math.min(1.0, lookSmoothing * delta);
      playerPhysics.pitch += (playerPhysics.targetPitch - playerPhysics.pitch) * Math.min(1.0, lookSmoothing * delta);

      // 2. Input handling: touch joystick & keyboard
      let targetInputX = touchMove.x;
      let targetInputZ = -touchMove.y;
      if (keys['KeyD'] || keys['ArrowRight']) targetInputX += 1;
      if (keys['KeyA'] || keys['ArrowLeft']) targetInputX -= 1;
      if (keys['KeyW'] || keys['ArrowUp']) targetInputZ += 1;
      if (keys['KeyS'] || keys['ArrowDown']) targetInputZ -= 1;

      if (!canMove) {
        targetInputX = 0;
        targetInputZ = 0;
      }

      const inputSnap = 32.0;
      playerPhysics.smoothMoveX += (targetInputX - playerPhysics.smoothMoveX) * Math.min(1.0, inputSnap * delta);
      playerPhysics.smoothMoveZ += (targetInputZ - playerPhysics.smoothMoveZ) * Math.min(1.0, inputSnap * delta);

      let moveRight = playerPhysics.smoothMoveX;
      let moveForward = playerPhysics.smoothMoveZ;

      if (playerPhysics.isHiding) {
        if (!breathMiniGame.active && (Math.abs(moveForward) > 0.45 || Math.abs(moveRight) > 0.45)) performAction();
        moveForward = 0;
        moveRight = 0;
      }

      physicsDebug.lastInputForward = moveForward;
      physicsDebug.lastInputRight = moveRight;

      const moveMag = Math.hypot(moveForward, moveRight);
      const isMoving = moveMag > 0.05 && canMove;

      // 3. Movement speeds & tunables
      const pCfg = (HORROR_CONFIG.physics) || {};
      const walkSpd = pCfg.walkSpeed || 4.8;
      const runSpd = pCfg.runSpeed || 6.6;
      const crouchSpd = pCfg.crouchSpeed || 2.2;
      const hunterSpd = (HORROR_CONFIG.gameplay && HORROR_CONFIG.gameplay.hunterSpeed) || 5.35;

      let targetSpeed = (!EXPLORE_MODE && GAME_CONFIG.role === 'seeker') ? hunterSpd : walkSpd;
      const isSprint = keys['ShiftLeft'] || keys['ShiftRight'] || playerPhysics.isSprinting;
      if (playerPhysics.isCrouching && !exploreTools.freeFly) targetSpeed = crouchSpd;
      else if (isSprint && (EXPLORE_MODE || GAME_CONFIG.role !== 'seeker')) targetSpeed = runSpd;

      // Update Noise Level Indicator (only when gameplay HUD is enabled)
      if (EXPLORE_FLAGS.ENABLE_GAMEPLAY_HUD) {
        const targetNoise = !isMoving
          ? 0.06
          : (playerPhysics.isCrouching ? 0.14 : (isSprint ? 0.94 : 0.46));
        playerNoiseLevel += (targetNoise - playerNoiseLevel) * Math.min(1.0, 8.0 * delta);
        const noiseBarEl = document.getElementById('hud-noise-bar');
        const noiseLblEl = document.getElementById('hud-noise-label');
        if (noiseBarEl && noiseLblEl) {
          noiseBarEl.style.width = Math.round(playerNoiseLevel * 100) + '%';
          if (playerNoiseLevel > 0.68) {
            noiseBarEl.style.background = '#ef4444';
            noiseLblEl.textContent = 'LOUD!';
          } else if (playerNoiseLevel > 0.25) {
            noiseBarEl.style.background = '#f59e0b';
            noiseLblEl.textContent = 'MEDIUM';
          } else {
            noiseBarEl.style.background = '#22c55e';
            noiseLblEl.textContent = 'QUIET';
          }
        }
      }

      // 4. Free-Fly (Noclip) Camera Mode vs. Walk Mode
      if (exploreTools.freeFly) {
        const flySpd = targetSpeed * 1.45;
        const sinY = Math.sin(playerPhysics.yaw);
        const cosY = Math.cos(playerPhysics.yaw);
        const cosP = Math.cos(playerPhysics.pitch);
        const sinP = Math.sin(playerPhysics.pitch);
        let vx = 0, vy = 0, vz = 0;
        if (isMoving) {
          const axialMag = Math.min(1.0, Math.max(Math.abs(moveForward), Math.abs(moveRight)));
          const normF = (moveForward / (moveMag || 1)) * axialMag;
          const normR = (moveRight / (moveMag || 1)) * axialMag;
          vx = (normR * cosY - normF * sinY * cosP) * flySpd;
          vz = (normR * sinY - normF * cosY * cosP) * flySpd;
          vy = (normF * sinP) * flySpd;
        }
        if (keys['Space'] || keys['KeyE'] || exploreTools.flyUpHeld) vy += flySpd * 0.85;
        if (keys['KeyC'] || keys['KeyQ'] || exploreTools.flyDownHeld) vy -= flySpd * 0.85;
        playerPhysics.vel.set(vx, vy, vz);
        playerPhysics.pos.x = Math.max(-88, Math.min(88, playerPhysics.pos.x + vx * delta));
        playerPhysics.pos.y = Math.max(-2, Math.min(65, playerPhysics.pos.y + vy * delta));
        playerPhysics.pos.z = Math.max(-88, Math.min(88, playerPhysics.pos.z + vz * delta));
        playerPhysics.isGrounded = false;
        physicsDebug.hasCollided = false;
      } else {
        // Movement direction computed strictly from playerPhysics.yaw only
        let targetVx = 0;
        let targetVz = 0;
        if (isMoving) {
          const axialMag = Math.max(Math.abs(moveForward), Math.abs(moveRight));
          const clampedMag = Math.min(1.0, axialMag);
          const normF = (moveForward / (moveMag || 1)) * clampedMag;
          const normR = (moveRight / (moveMag || 1)) * clampedMag;
          const sinY = Math.sin(playerPhysics.yaw);
          const cosY = Math.cos(playerPhysics.yaw);
          targetVx = (normR * cosY - normF * sinY) * targetSpeed;
          targetVz = (normR * sinY - normF * cosY) * targetSpeed;
        }

        // 5. Substepping movement physics & sliding collision response
        const maxDt = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.maxDeltaTime) || 0.1;
        const clampedDelta = Math.min(delta, maxDt);
        const maxSubSteps = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.maxSubSteps) || 6;
        const targetDt = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.targetSubStepDt) || (1.0 / 60.0);
        const subSteps = Math.min(maxSubSteps, Math.max(1, Math.ceil(clampedDelta / targetDt)));
        const subDt = clampedDelta / subSteps;
        const accelRate = isMoving ? (pCfg.acceleration || 28.0) : (pCfg.deceleration || 32.0);
        const playerH = playerPhysics.isHiding ? (pCfg.hidingHeight || 0.65) : (playerPhysics.isCrouching ? (pCfg.crouchHeight || 1.05) : (pCfg.standingHeight || 1.80));
        const stepH = pCfg.stepHeight || 0.52;
        const gravity = pCfg.gravity || 16.5;

        physicsDebug.hasCollided = false;

        for (let s = 0; s < subSteps; s++) {
          playerPhysics.vel.x += (targetVx - playerPhysics.vel.x) * Math.min(1.0, accelRate * subDt);
          playerPhysics.vel.z += (targetVz - playerPhysics.vel.z) * Math.min(1.0, accelRate * subDt);

          playerPhysics.pos.x += playerPhysics.vel.x * subDt;
          playerPhysics.pos.z += playerPhysics.vel.z * subDt;

          const targetGroundY = getSupportFloorY(playerPhysics.pos.x, playerPhysics.pos.z, playerPhysics.pos.y);
          const ceilingMaxBottomY = getCeilingLimitBottomY(playerPhysics.pos.x, playerPhysics.pos.z, playerPhysics.pos.y, playerH);

          if (!playerPhysics.isGrounded) {
            playerPhysics.vel.y -= gravity * subDt;
            let nextY = playerPhysics.pos.y + playerPhysics.vel.y * subDt;
            if (nextY >= ceilingMaxBottomY) {
              nextY = ceilingMaxBottomY;
              if (playerPhysics.vel.y > 0) playerPhysics.vel.y = 0;
            }
            if (nextY <= targetGroundY) {
              nextY = targetGroundY;
              playerPhysics.vel.y = 0;
              playerPhysics.isGrounded = true;
            }
            playerPhysics.pos.y = nextY;
          } else {
            const stepDiff = targetGroundY - playerPhysics.pos.y;
            if (Math.abs(stepDiff) < 0.04) {
              playerPhysics.pos.y = targetGroundY;
            } else {
              playerPhysics.pos.y += stepDiff * Math.min(1.0, 18.0 * subDt);
            }
          }

          resolveCollisionSubstep(playerPhysics.pos, playerPhysics.vel, playerPhysics.radius, playerH, stepH, playerPhysics.isHiding);
          resolveCollisionSubstep(playerPhysics.pos, playerPhysics.vel, playerPhysics.radius, playerH, stepH, playerPhysics.isHiding);
        }

        // Realistic Footsteps with surface audio
        if (isMoving && playerPhysics.isGrounded) {
          const actualSpeed = Math.hypot(playerPhysics.vel.x, playerPhysics.vel.z);
          playerPhysics.footstepTimer += delta * (actualSpeed / 4.8);
          if (playerPhysics.footstepTimer > 0.44) {
            playerPhysics.footstepTimer = 0;
            let surface = 'paver';
            const px = playerPhysics.pos.x;
            const py = playerPhysics.pos.y;
            const pz = playerPhysics.pos.z;

            const isLawn = (px < -21 || px > 27) || (pz > 66) || (Math.hypot(px - 9.8, pz - (-37.0)) < 2.5);
            const isOnRamp = walkableStairRamps.some(r => px >= r.minX && px <= r.maxX && pz >= r.minZ && pz <= r.maxZ);

            if (isLawn && py <= 0.05) {
              surface = 'grass';
            } else if (isOnRamp || (Math.abs(playerPhysics.vel.y) > 0.08 && py > 0.1)) {
              surface = 'stair';
            } else if (py >= 0.42) {
              surface = 'classroom';
            } else if (pz < -42 && px > -2.0 && px < 4.0) {
              surface = 'road';
            } else {
              surface = 'paver';
            }
            soundEngine.playFootstep(surface, playerPhysics.isCrouching);
            if (EXPLORE_FLAGS.ENABLE_HUNTER_AND_BOTS) {
              if (isSprint && !playerPhysics.isCrouching) {
                recordNoiseEvent(px, py, pz, 0.90, 'Sprint Footsteps');
              } else if (!playerPhysics.isCrouching) {
                recordNoiseEvent(px, py, pz, 0.35, 'Walk Footsteps');
              }
            }
          }
        }
      }

      // Check for Battery Pickups (disabled in EXPLORE_MODE)
      if (EXPLORE_FLAGS.ENABLE_FUSE_BOXES_AND_OBJECTIVES) {
        for (let b = 0; b < batteryPickups.length; b++) {
          const bp = batteryPickups[b];
          if (bp.collected) continue;
          if (Math.abs(playerPhysics.pos.y - bp.y) < 1.5 && Math.hypot(playerPhysics.pos.x - bp.x, playerPhysics.pos.z - bp.z) < 1.35) {
            bp.collected = true;
            if (bp.mesh) bp.mesh.visible = false;
            flashlightBattery = Math.min(100, flashlightBattery + ((HORROR_CONFIG.gameplay && HORROR_CONFIG.gameplay.flashlightRechargeAmount) || 45));
            isFlashlightOn = true;
            soundEngine.playFuseRepairSfx();
            showToast('Picked up Battery Cell (+45% Flashlight)!');
          }
        }
      }

      // Flashlight Battery Drain: Infinite in EXPLORE_MODE!
      if (EXPLORE_FLAGS.INFINITE_FLASHLIGHT_BATTERY) {
        flashlightBattery = 100.0;
      } else if (GAME_CONFIG.role !== 'seeker' && isFlashlightOn && flashlightBattery > 0) {
        const drainRate = (HORROR_CONFIG.gameplay && HORROR_CONFIG.gameplay.flashlightBatteryDrainPerSec) || 1.15;
        flashlightBattery = Math.max(0, flashlightBattery - drainRate * delta);
        if (flashlightBattery <= 0) {
          isFlashlightOn = false;
          showToast('Flashlight battery depleted!');
        }
      }
      const battLbl = document.getElementById('hud-battery-label');
      if (battLbl) battLbl.textContent = Math.round(flashlightBattery) + '%';

      const inCoveredArea = (playerPhysics.pos.y >= 0.42) ||
        (playerPhysics.pos.x >= -19 && playerPhysics.pos.x <= -13 && playerPhysics.pos.z >= -26 && playerPhysics.pos.z <= 6) ||
        (Math.hypot(playerPhysics.pos.x - rotX, playerPhysics.pos.z - rotFrontZ) < 6.5 && playerPhysics.pos.y <= 0.6);
      const isIndoorsBuilding = inCoveredArea ||
        (playerPhysics.pos.z >= 51.0 && playerPhysics.pos.x >= -13.5 && playerPhysics.pos.x <= 25.5) ||
        (playerPhysics.pos.x >= 19.5 && playerPhysics.pos.z >= -34.0 && playerPhysics.pos.z <= 12.0) ||
        (playerPhysics.pos.x <= -13.0 && playerPhysics.pos.z >= -34.0 && playerPhysics.pos.z <= 12.0);
      soundEngine.setCorridorAcoustics(inCoveredArea);
      soundEngine.updateSpatialLoops(playerPhysics.pos, playerPhysics.yaw, isIndoorsBuilding);

      // Third-Person Character Rig
      if (playerCharacter) {
        playerCharacter.visible = (playerPhysics.cameraMode === 'third' && !isPlayerSpectating && !exploreTools.overviewCam && !exploreTools.freeFly);
        playerCharacter.position.copy(playerPhysics.pos);

        const actualSpeed = Math.hypot(playerPhysics.vel.x, playerPhysics.vel.z);
        if (actualSpeed > 0.15) {
          const moveHeading = Math.atan2(playerPhysics.vel.x, playerPhysics.vel.z);
          let diff = moveHeading - playerPhysics.meshYaw;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          playerPhysics.meshYaw += diff * Math.min(1.0, 14.0 * delta);
        }
        playerCharacter.rotation.y = playerPhysics.meshYaw;

        const speedRatio = actualSpeed / 5.0;
        animateCharacterRig(playerCharacter, speedRatio, playerPhysics.isCrouching || playerPhysics.isHiding, delta);
      }

      const targetEye = playerPhysics.isHiding
        ? (pCfg.hidingEyeHeight || 0.58)
        : (playerPhysics.isCrouching && !exploreTools.freeFly ? (pCfg.crouchEyeHeight || 0.95) : (pCfg.standingEyeHeight || 1.62));
      playerPhysics.currentEyeHeight += (targetEye - playerPhysics.currentEyeHeight) * 12.0 * delta;

      let vertBob = 0;
      let latBob = 0;
      if (!exploreTools.freeFly && !exploreTools.overviewCam) {
        if (isMoving && playerPhysics.isGrounded && !playerPhysics.isHiding) {
          const bobSpeed = (targetSpeed > 5.5) ? 12.0 : (playerPhysics.isCrouching ? 6.5 : 9.5);
          playerPhysics.bobTimer += delta * bobSpeed;
          const bobAmp = playerPhysics.isCrouching ? 0.022 : (targetSpeed > 5.5 ? 0.052 : 0.038);
          vertBob = Math.sin(playerPhysics.bobTimer) * bobAmp;
          latBob = Math.cos(playerPhysics.bobTimer * 0.5) * (bobAmp * 0.45);
        } else if (!playerPhysics.isHiding && EXPLORE_FLAGS.ENABLE_CAMERA_AND_SCREEN_SHAKE) {
          vertBob = Math.sin(Date.now() * 0.0024) * 0.008;
        }
      }

      const eyeY = playerPhysics.pos.y + playerPhysics.currentEyeHeight + vertBob;

      // Top-Down 3D Campus Overview Camera vs Spectator / 1st-Person / 3rd-Person
      if (exploreTools.overviewCam) {
        camera.position.set(playerPhysics.pos.x * 0.35, 112.0, playerPhysics.pos.z * 0.35 + 4.0);
        camera.rotation.set(-Math.PI * 0.49, 0, 0);
      } else if (isPlayerSpectating && EXPLORE_FLAGS.ENABLE_HUNTER_AND_BOTS) {
        const aliveScholars = bots.filter(b => !b.isSeeker && !b.isCaught && b.mesh);
        if (aliveScholars.length > 0) {
          const sb = aliveScholars[spectateBotIdx % aliveScholars.length];
          camera.position.set(sb.mesh.position.x, sb.mesh.position.y + 2.2, sb.mesh.position.z + 3.0);
          camera.lookAt(sb.mesh.position.x, sb.mesh.position.y + 1.2, sb.mesh.position.z);
        }
      } else if (playerPhysics.cameraMode === 'first' || exploreTools.freeFly) {
        const cosYaw = Math.cos(playerPhysics.yaw);
        const sinYaw = Math.sin(playerPhysics.yaw);
        camera.position.set(
          playerPhysics.pos.x + cosYaw * latBob,
          eyeY,
          playerPhysics.pos.z + sinYaw * latBob
        );
        camera.rotation.y = playerPhysics.yaw;
        camera.rotation.x = playerPhysics.pitch;

        if (EXPLORE_FLAGS.ENABLE_CAMERA_AND_SCREEN_SHAKE) {
          const turnRate = playerPhysics.targetYaw - playerPhysics.yaw;
          camera.rotation.z = Math.max(-0.025, Math.min(0.025, turnRate * 0.15));
        } else {
          camera.rotation.z = 0;
        }
      } else {
        camera.rotation.z = 0;
        const idealDist = pCfg.idealCameraDist || 3.4;
        const pitchCos = Math.cos(playerPhysics.pitch * 0.5);
        const dirX = Math.sin(playerPhysics.yaw) * pitchCos;
        const dirY = Math.sin(playerPhysics.pitch * 0.5) * 0.55;
        const dirZ = Math.cos(playerPhysics.yaw) * pitchCos;

        const headX = playerPhysics.pos.x;
        const headY = eyeY + 0.15;
        const headZ = playerPhysics.pos.z;

        const targetCamDist = raycastCameraDistance(headX, headY, headZ, dirX, dirY, dirZ, idealDist);
        const camRate = (targetCamDist < playerPhysics.camDist) ? 22.0 : 8.0;
        playerPhysics.camDist += (targetCamDist - playerPhysics.camDist) * Math.min(1.0, camRate * delta);

        const minCamDistRef = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.minCameraDist) || 0.45;
        const vertRatio = Math.min(1.0, playerPhysics.camDist / minCamDistRef);
        let camPosY = headY + 0.65 * vertRatio + dirY * playerPhysics.camDist;
        if (headX >= rotLeftX && headX <= rotRightX && headZ >= rotFrontZ - 5.8 && headZ <= rotBackZ) {
          const indoorCeilingY = playerPhysics.pos.y + 3.05;
          if (camPosY > indoorCeilingY) camPosY = indoorCeilingY;
        }
        camera.position.set(
          headX + dirX * playerPhysics.camDist,
          camPosY,
          headZ + dirZ * playerPhysics.camDist
        );
        camera.lookAt(headX, headY + 0.15 * vertRatio, headZ);

        if (playerCharacter) {
          const fadeStart = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.cameraFadeStartDist) || 0.60;
          const fadeEnd = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.cameraFadeEndDist) || 0.15;
          const charOpacity = Math.max(0.0, Math.min(1.0, (playerPhysics.camDist - fadeEnd) / (fadeStart - fadeEnd)));
          playerCharacter.traverse(child => {
            if (child.isMesh && child.material) {
              child.material.transparent = true;
              child.material.opacity = charOpacity;
              child.visible = charOpacity > 0.01;
            }
          });
        }
      }

      // Phase A Requirement 3: Update Room & Building Portal/Distance Visibility & Shadow Budget
      updateRoomAndBuildingVisibility(playerPhysics.pos, playerPhysics.yaw, activePreset);

      // Requirement 1 & 5: Update Main Player Flashlight (Soft-edged SpotLight, visible volumetric beam cone, >=4m reveal in dark rooms at min battery)
      if (atmosphere && atmosphere.updateFlashlight) {
        const isOn = (!EXPLORE_MODE && GAME_CONFIG.role === 'seeker') ? true : isFlashlightOn;
        atmosphere.updateFlashlight(
          delta,
          timeSec,
          camera.position,
          playerPhysics.yaw,
          playerPhysics.pitch,
          EXPLORE_FLAGS.INFINITE_FLASHLIGHT_BATTERY ? 0.0 : (currentHunterProximity || 0.0),
          playerPhysics.isHiding,
          (playerPhysics.cameraMode === 'first' || exploreTools.freeFly) && !isPlayerSpectating && !exploreTools.overviewCam
        );
        if (!isOn || exploreTools.overviewCam) {
          atmosphere.flashlight.intensity = 0;
          if (atmosphere.flashlightSpill) atmosphere.flashlightSpill.intensity = 0;
          if (atmosphere.flashlightRig) atmosphere.flashlightRig.visible = false;
        } else {
          if (atmosphere.flashlightRig) {
            atmosphere.flashlightRig.visible = (exploreTools.flashlightBeamEnabled !== false);
          }
          if (!EXPLORE_FLAGS.INFINITE_FLASHLIGHT_BATTERY && flashlightBattery <= 5.0) {
            // At minimum/reserve battery in dark rooms, guarantee ~4.2m ahead reveal without washing out the room mood
            const minDarkDist = (HORROR_CONFIG.gameplay && HORROR_CONFIG.gameplay.flashlightMinDarkRoomDistance) || 4.6;
            atmosphere.flashlight.distance = Math.min(atmosphere.flashlight.distance, minDarkDist + (flashlightBattery / 5.0) * 4.0);
          }
        }
      }

      // Physics & Render Telemetry HUD update & capsule wireframe
      if (physicsDebug.enabled) {
        physicsDebug.updateCapsule(playerPhysics.pos, playerPhysics.isHiding ? 0.65 : (playerPhysics.isCrouching ? 1.05 : 1.8));
        const hudEl = document.getElementById('physics-debug-hud');
        if (hudEl) {
          const fpsEl = document.getElementById('dbg-fps');
          const rInfo = (renderer && renderer.info) ? renderer.info : { render: { calls: 0 }, memory: { geometries: 0, textures: 0 } };
          const totalCalls = (atmosphere && typeof atmosphere.lastTotalDrawCalls === 'number' && atmosphere.lastTotalDrawCalls > 0)
            ? atmosphere.lastTotalDrawCalls
            : (rInfo.render.calls || 0);
          if (fpsEl) {
            const curFrameMs = 1000.0 / Math.max(1.0, rollingAvgFps || physicsDebug.fps || 60);
            const headroomPct = Math.max(0, ((16.67 - curFrameMs) / 16.67) * 100).toFixed(0);
            const minHist = (sessionTelemetry && sessionTelemetry.minuteHistory && sessionTelemetry.minuteHistory.length > 0)
              ? (' | 10mLog: ' + sessionTelemetry.minuteHistory.map(m => 'M' + m.minute + ':' + m.avgFps).join(' '))
              : '';
            fpsEl.textContent = 'FPS: ' + Math.round(physicsDebug.fps) + ' (5s Avg: ' + Math.round(rollingAvgFps) + ', ' + curFrameMs.toFixed(1) + 'ms, Headroom: ' + headroomPct + '%) | Calls: ' + totalCalls + ' | ' + qualityPinMode.toUpperCase() + ':' + currentQuality.toUpperCase() + (batterySaverEnabled ? ' [SAVER 30]' : '') + minHist;
          }
          document.getElementById('dbg-pos').textContent = 'Pos: (' + playerPhysics.pos.x.toFixed(1) + ', ' + playerPhysics.pos.y.toFixed(1) + ', ' + playerPhysics.pos.z.toFixed(1) + ') | VisRooms: ' + visibleRoomsCount;
          const spd = Math.hypot(playerPhysics.vel.x, playerPhysics.vel.z);
          document.getElementById('dbg-vel').textContent = 'Vel: (' + playerPhysics.vel.x.toFixed(2) + ', ' + playerPhysics.vel.y.toFixed(2) + ', ' + playerPhysics.vel.z.toFixed(2) + ') ' + spd.toFixed(2) + ' m/s';
          const mvEl = document.getElementById('dbg-move');
          if (mvEl) mvEl.textContent = 'MoveVec: (' + touchMove.x.toFixed(2) + ', ' + touchMove.y.toFixed(2) + ')';
          document.getElementById('dbg-input').textContent = 'Input: Fwd: ' + moveForward.toFixed(2) + ', Right: ' + moveRight.toFixed(2);
          const yawDeg = ((playerPhysics.yaw * 180 / Math.PI) % 360).toFixed(1);
          const pitchDeg = ((playerPhysics.pitch * 180 / Math.PI) % 360).toFixed(1);
          document.getElementById('dbg-look').textContent = 'Yaw: ' + yawDeg + '° (' + playerPhysics.yaw.toFixed(2) + ' rad) | Pitch: ' + pitchDeg + '°';
          const grEl = document.getElementById('dbg-ground');
          if (grEl) grEl.textContent = 'Grounded: ' + playerPhysics.isGrounded + ' | Crouching: ' + playerPhysics.isCrouching + ' | FreeFly: ' + exploreTools.freeFly;
          const n = physicsDebug.lastNormal;
          document.getElementById('dbg-normal').textContent = physicsDebug.hasCollided ? ('Coll Normal: (' + n.x.toFixed(2) + ', ' + n.z.toFixed(2) + ')') : 'Coll Normal: None';
        }
      }

      // Extra camera breathing & roll sway scaled by hunter proximity (disabled in EXPLORE_MODE)
      if (EXPLORE_FLAGS.ENABLE_CAMERA_AND_SCREEN_SHAKE && !accessibilitySettings.screenShakeOff) {
        const proxSway = (currentHunterProximity || 0.0) * getFearMultiplier();
        const swayAmp = (HORROR_CONFIG.tension.baseSwayRoll || 0.006) + proxSway * (HORROR_CONFIG.tension.hunterNearSwayRoll || 0.028);
        camera.rotation.z += Math.sin(timeSec * (2.2 + proxSway * 3.5)) * swayAmp;
        camera.position.y += Math.sin(timeSec * (2.6 + proxSway * 4.2)) * ((HORROR_CONFIG.tension.baseBreathingAmp || 0.012) + proxSway * (HORROR_CONFIG.tension.hunterNearBreathingBoost || 0.038));
      }

      if (EXPLORE_FLAGS.ENABLE_GAMEPLAY_HUD) {
        updatePrompts();
      }
      updateCampusZoneBanner();
    }

    const tmpTargetVec = new THREE.Vector3();
    const tmpDirVec = new THREE.Vector3();
    let envEventTimer = 22 + Math.random() * 14;

    // Phase B.3: Smoothly open swinging doors when bots or player approach within 2.2m (unless locked by Hunter!)
    function updateSwingingDoors(delta) {
      for (let d = 0; d < swingingDoors.length; d++) {
        const door = swingingDoors[d];
        if (door.lockedTimer && door.lockedTimer > 0) {
          door.lockedTimer = Math.max(0, door.lockedTimer - delta);
          door.isOpen = false;
          door.targetAngleY = 0;
          const diffL = door.targetAngleY - door.currentAngleY;
          if (Math.abs(diffL) > 0.002) {
            door.currentAngleY += diffL * Math.min(1.0, 9.0 * delta);
            door.pivot.rotation.y = door.currentAngleY;
          }
          continue;
        }
        let nearAgent = false;
        if (Math.abs(playerPhysics.pos.y - door.y) < 1.8 && Math.hypot(playerPhysics.pos.x - door.x, playerPhysics.pos.z - door.z) < 2.15) {
          nearAgent = true;
        }
        if (!nearAgent) {
          for (let b = 0; b < bots.length; b++) {
            const bot = bots[b];
            if (!bot || bot.isCaught || !bot.mesh) continue;
            if (Math.abs(bot.mesh.position.y - door.y) < 1.8 && Math.hypot(bot.mesh.position.x - door.x, bot.mesh.position.z - door.z) < 2.25) {
              nearAgent = true;
              break;
            }
          }
        }
        if (nearAgent) {
          if (!door.isOpen) {
            soundEngine.playDoorCreakSfx();
            recordNoiseEvent(door.x, door.y, door.z, 0.45, 'Door Creak');
          }
          door.isOpen = true;
          door.holdTimer = 1.6;
          door.targetAngleY = door.openAngleY;
        } else if (door.holdTimer > 0) {
          door.holdTimer = Math.max(0, door.holdTimer - delta);
          if (door.holdTimer <= 0) {
            door.isOpen = false;
            door.targetAngleY = door.ajarAngleY;
          }
        }
        const diff = door.targetAngleY - door.currentAngleY;
        if (Math.abs(diff) > 0.002) {
          door.currentAngleY += diff * Math.min(1.0, 6.5 * delta);
          door.pivot.rotation.y = door.currentAngleY;
        }
      }
    }

    function updateEnvironmentAndBots(delta, timeSec) {
      if (!isMatchActive) return;

      if (EXPLORE_FLAGS.ENABLE_ROLES_AND_TIMER) {
        matchTimer -= delta;
        if (matchTimer <= 0) evaluateGameStatus(true);
      }

      // Update Hunter ability timers (disabled in EXPLORE_MODE)
      if (EXPLORE_FLAGS.ENABLE_HUNTER_AND_BOTS) {
        if (hunterAbilities.pingTimer > 0) {
          hunterAbilities.pingTimer = Math.max(0, hunterAbilities.pingTimer - delta);
          if (hunterAbilities.pingTimer <= 0 && GAME_CONFIG.role !== 'seeker' && graceTimer <= 0) {
            hunterAbilities.pingTimer = (HORROR_CONFIG.gameplay && HORROR_CONFIG.gameplay.hunterFootstepPingIntervalSec) || 30.0;
            soundEngine.playSonarPingSfx();
            if (playerNoiseLevel > 0.35 && seekerRef && seekerRef.bot) {
              seekerRef.bot.investigateTarget = { x: playerPhysics.pos.x, y: playerPhysics.pos.y, z: playerPhysics.pos.z, timer: 8.0 };
              showToast('Hunter Footstep-Sense Ping detected your noise!');
            }
          }
        }
        if (hunterAbilities.powerCutCooldown > 0) hunterAbilities.powerCutCooldown = Math.max(0, hunterAbilities.powerCutCooldown - delta);
      }
      if (powerCutBuildingTimer > 0) {
        powerCutBuildingTimer = Math.max(0, powerCutBuildingTimer - delta);
        if (powerCutBuildingTimer <= 0) powerCutDarkBuilding = null;
      }

      // Update active thrown distraction projectiles (disabled in EXPLORE_MODE)
      if (EXPLORE_FLAGS.ENABLE_THROWABLE_DISTRACTIONS) {
        for (let p = activeProjectiles.length - 1; p >= 0; p--) {
          const pr = activeProjectiles[p];
          pr.life -= delta;
          pr.vel.y -= 15.0 * delta;
          pr.mesh.position.x += pr.vel.x * delta;
          pr.mesh.position.y += pr.vel.y * delta;
          pr.mesh.position.z += pr.vel.z * delta;
          if (pr.mesh.position.y <= pr.floorY + 0.08 || pr.life <= 0) {
            soundEngine.playDistractionClatterSfx();
            recordNoiseEvent(pr.mesh.position.x, pr.floorY, pr.mesh.position.z, 1.0, 'Thrown Distraction');
            scene.remove(pr.mesh);
            activeProjectiles.splice(p, 1);
          }
        }
      }

      // Requirement 2 & 3: Update Per-Room Light Moods, Window Light Shaft Dust Motes & Drifting Corridor Fog
      updateRoomMoodLighting(delta, timeSec, playerPhysics.pos);

      const showFogLayer = exploreTools.fogEnabled !== false;
      for (let cf = 0; cf < corridorFogPlanes.length; cf++) {
        const fp = corridorFogPlanes[cf];
        if (!fp.mesh) continue;
        fp.mesh.visible = showFogLayer;
        if (!showFogLayer || !fp.mesh.parent || !fp.mesh.parent.visible) continue;
        fp.mesh.position.x = fp.baseX + Math.sin(timeSec * fp.speed + fp.phase) * 0.22;
        fp.mesh.position.z = fp.baseZ + Math.cos(timeSec * (fp.speed * 0.8) + fp.phase) * 0.35;
      }

      const showDustLayer = exploreTools.dustEnabled !== false && currentQuality !== 'fast';
      for (let bd = 0; bd < roomBeamDustSystems.length; bd++) {
        const sys = roomBeamDustSystems[bd];
        if (!sys.points) continue;
        sys.points.visible = showDustLayer && (exploreTools.lightShaftsEnabled !== false);
        if (!sys.points.visible || !sys.points.parent || !sys.points.parent.parent || !sys.points.parent.parent.visible) continue;
        const arr = sys.pos;
        const meta = sys.meta;
        for (let k = 0; k < meta.length; k++) {
          const m = meta[k];
          arr[k * 3]     = m.baseX + Math.sin(timeSec * 0.85 + m.phase) * 0.12;
          arr[k * 3 + 1] = m.baseY + Math.cos(timeSec * 0.65 + m.phase * 1.3) * 0.10;
          arr[k * 3 + 2] = m.baseZ + Math.sin(timeSec * 0.72 + m.phase * 0.7) * 0.12;
        }
        sys.geo.attributes.position.needsUpdate = true;
      }

      for (let cm = 0; cm < corridorMistPlanes.length; cm++) {
        const mp = corridorMistPlanes[cm];
        mp.visible = showFogLayer;
        if (!showFogLayer) continue;
        mp.position.x = mp.userData.baseX + Math.sin(timeSec * 0.45 + mp.userData.phase) * 0.35;
      }

      // Procedural per-room Web Audio soundscape (room tone, creaks, door sounds, toilet dripping, computer lab & server rack hum)
      activeRoomSoundTimer -= delta;
      if (activeRoomSoundTimer <= 0) {
        activeRoomSoundTimer = 3.2 + Math.random() * 3.2;
        const px = playerPhysics.pos.x, py = playerPhysics.pos.y, pz = playerPhysics.pos.z;
        if (pz >= 51.0 && px >= -13.5 && px <= 25.5) {
          if (py >= 6.2 && px > 6.0) {
            // Room 302 Computer Lab & Server Rack: 60Hz/120Hz hum + room tone
            soundEngine.playServerRackHumPulse();
            soundEngine.playRoomTonePulse('rotunda_lab');
          } else if (py >= 6.2 && px < 6.0) {
            // Room 301 Dark Seminar Hall: room tone + structural creak
            soundEngine.playRoomTonePulse('rotunda_seminar');
            if (!EXPLORE_MODE && Math.random() < 0.5) soundEngine.playDistantCorridorFootsteps();
            else soundEngine.playStructuralCreak();
          } else if (py >= 2.8 && px > 6.0) {
            // Room 202 Library: quiet archive room tone + wood creak
            soundEngine.playRoomTonePulse('library');
            soundEngine.playStructuralCreak();
          } else if (py >= 2.8 && px < 6.0) {
            // Room 201 Moonlit Classroom: room tone + subtle creak
            soundEngine.playRoomTonePulse('rotunda_lecture');
            if (!EXPLORE_MODE) soundEngine.playDistantCorridorFootsteps();
            else soundEngine.playStructuralCreak();
          } else if (px > 6.0) {
            // Room 102 Admin Office & Washroom pipe line: dripping water + room tone
            soundEngine.playWaterDripSfx();
            soundEngine.playRoomTonePulse('staff_office');
          } else if (px < 1.6) {
            // Room 101 Lecture Hall: dying tube buzz + room tone
            soundEngine.playTubeFlickerBuzzSfx();
            soundEngine.playRoomTonePulse('rotunda_lecture');
          } else {
            // Main Building Atrium & Corridors: room tone + door creak
            soundEngine.playRoomTonePulse('atrium');
            if (!EXPLORE_MODE && Math.random() < 0.5) soundEngine.playDistantCorridorFootsteps();
            else soundEngine.playDoorCreakSfx();
          }
        } else if (px > 20.0 && pz > -10.5 && pz < -0.5) {
          // Campus Toilets (East Wing R2 Room 3): water dripping
          soundEngine.playWaterDripSfx();
          soundEngine.playRoomTonePulse('toilets');
        } else if (px < -13.0 && pz > -26.5 && pz < -7.0) {
          // West Wing L2 Computer Labs: server rack hum
          soundEngine.playServerRackHumPulse();
          soundEngine.playRoomTonePulse('computer_lab');
        }
      }

      if (EXPLORE_FLAGS.ENABLE_ROLES_AND_TIMER) {
        statusSyncTimer += delta;
        if (statusSyncTimer >= 1.0) {
          statusSyncTimer = 0;
          const restoredCount = fuseBoxes.filter(f => f.restored).length;
          sendToReactNative('STATUS', {
            hidersRemaining: GAME_CONFIG.role === 'seeker'
              ? bots.filter(b => !b.isSeeker && !b.isCaught).length
              : bots.filter(b => !b.isSeeker && !b.isCaught).length + (isPlayerSpectating ? 0 : 1),
            timeLeft: matchTimer,
            fusesRestored: restoredCount,
            mainGateUnlocked,
          });
        }
      }

      if (EXPLORE_FLAGS.ENABLE_SCREEN_GLITCH_AND_DISTORTION && horrorGlitchTimer > 0) {
        horrorGlitchTimer = Math.max(0, horrorGlitchTimer - delta);
        const glitchEl = document.getElementById('horror-glitch-overlay');
        if (glitchEl) {
          glitchEl.style.opacity = (horrorGlitchTimer > 0 ? Math.min(0.85, horrorGlitchTimer * 2.2 * getFearMultiplier()) : 0).toFixed(2);
        }
      }
      if (EXPLORE_FLAGS.ENABLE_CAMERA_AND_SCREEN_SHAKE && horrorCameraShake > 0 && !accessibilitySettings.screenShakeOff) {
        horrorCameraShake = Math.max(0, horrorCameraShake - delta * 0.85);
        camera.position.x += (Math.random() - 0.5) * horrorCameraShake * 0.28;
        camera.position.y += (Math.random() - 0.5) * horrorCameraShake * 0.24;
        camera.rotation.z += (Math.random() - 0.5) * horrorCameraShake * 0.08;
      }

      // World events: In EXPLORE_MODE, play only calm ambient sounds (distant temple bell or timber settling), zero scare shocks/brownouts!
      envEventTimer -= delta;
      if (envEventTimer <= 0) {
        const minI = Math.max(14, (activePreset.eventIntervalMin || 20) * 0.75);
        const maxI = Math.max(24, (activePreset.eventIntervalMax || 35) * 0.85);
        envEventTimer = minI + Math.random() * (maxI - minI);
        if (!EXPLORE_FLAGS.ENABLE_RANDOM_SCARE_EVENTS) {
          if (Math.random() < 0.55) {
            soundEngine.playDistantChime();
          } else {
            soundEngine.playStructuralCreak();
          }
        } else {
          const roll = Math.random();
          if (roll < 0.24) {
            lampFlickerMod.triggerPowerDip(0.32);
            soundEngine.playPowerDipHum();
            soundEngine.playTubeFlickerBuzzSfx();
          } else if (roll < 0.48) {
            soundEngine.playFarDoorSlamSfx();
            if (swingingDoors.length > 0) {
              const farDoor = swingingDoors[Math.floor(Math.random() * swingingDoors.length)];
              if (farDoor && Math.hypot(farDoor.x - playerPhysics.pos.x, farDoor.z - playerPhysics.pos.z) > 6.5) {
                farDoor.targetAngleY = farDoor.closedAngleY;
              }
            }
          } else if (roll < 0.72) {
            soundEngine.playChairScrapeSfx();
          } else if (roll < 0.88) {
            soundEngine.playDistantCorridorFootsteps();
            soundEngine.playStructuralCreak();
          } else {
            powerCutDarkBuilding = 'ROTUNDA';
            powerCutBuildingTimer = 4.5;
            lampFlickerMod.triggerPowerDip(0.42);
            soundEngine.playPowerDipHum();
          }
        }
      }

      if (EXPLORE_FLAGS.ENABLE_GHOST_APPARITIONS) {
        rareSilhouetteMod.update(delta, playerPhysics.pos);
      } else if (rareSilhouetteMod && rareSilhouetteMod.group) {
        rareSilhouetteMod.group.visible = false;
      }

      for (let i = 0; i < treeShadowDecals.length; i++) {
        const ts = treeShadowDecals[i];
        ts.mesh.rotation.z = Math.sin(timeSec * 1.5 + ts.seed) * 0.05;
        const s = 1.0 + Math.sin(timeSec * 2.2 + ts.seed) * 0.025;
        ts.mesh.scale.set(s, s, 1.0);
      }

      particleFieldMod.update(delta, timeSec, playerPhysics.pos);
      lampFlickerMod.update(delta, timeSec, playerPhysics.pos);
      updateSwingingDoors(delta);

      if (!EXPLORE_FLAGS.ENABLE_HIDE_AND_SEEK_GAMEPLAY) {
        return;
      }

      // Update Hold-Your-Breath Mini-Game if Hunter is checking player's hiding spot
      if (EXPLORE_FLAGS.ENABLE_HIDING_SPOTS_AND_MINIGAME && breathMiniGame.active) {
        const drainRate = 0.38 + ((breathMiniGame.spot && breathMiniGame.spot.useCount >= 2) ? 0.22 : 0.0);
        if (breathMiniGame.holdingButton) {
          breathMiniGame.meter = Math.max(0, breathMiniGame.meter - drainRate * delta);
          breathMiniGame.surviveTimer -= delta;
        } else {
          breathMiniGame.surviveTimer -= delta * 0.35;
          breathMiniGame.meter = Math.max(0, breathMiniGame.meter - drainRate * 1.65 * delta);
        }
        const fillEl = document.getElementById('breath-meter-fill');
        if (fillEl) fillEl.style.width = Math.round(breathMiniGame.meter * 100) + '%';

        if (breathMiniGame.meter <= 0) {
          breathMiniGame.active = false;
          const bmEl = document.getElementById('breath-minigame-overlay');
          if (bmEl) bmEl.style.display = 'none';
          handlePlayerCaughtByHunter('You gasped for air while the Hunter inspected your hiding spot!');
        } else if (breathMiniGame.surviveTimer <= 0) {
          breathMiniGame.active = false;
          const bmEl = document.getElementById('breath-minigame-overlay');
          if (bmEl) bmEl.style.display = 'none';
          showToast('Held your breath — The Hollow Proctor moved on!');
        }
      }

      if (!EXPLORE_FLAGS.ENABLE_HUNTER_AND_BOTS) return;

      for (let i = 0; i < bots.length; i++) {
        const b = bots[i];
        if (b.isCaught) continue;

        if (b.isSeeker) {
          if (graceTimer > 0) continue;

          if (b.investigateTarget && b.investigateTarget.timer > 0) {
            b.investigateTarget.timer -= delta;
            const ix = b.investigateTarget.x;
            const iz = b.investigateTarget.z;
            const dInv = Math.hypot(ix - b.mesh.position.x, iz - b.mesh.position.z);
            if (dInv > 1.4) {
              tmpDirVec.set(ix - b.mesh.position.x, 0, iz - b.mesh.position.z).normalize();
              b.mesh.position.x += tmpDirVec.x * b.speed * delta;
              b.mesh.position.z += tmpDirVec.z * b.speed * delta;
              const botSupportY = getSupportFloorY(b.mesh.position.x, b.mesh.position.z, b.mesh.position.y);
              b.mesh.position.y += (botSupportY - b.mesh.position.y) * Math.min(1.0, 14.0 * delta);
              b.mesh.rotation.y = Math.atan2(tmpDirVec.x, tmpDirVec.z);
              animateCharacterRig(b.mesh, 0.95, false, delta);
            } else {
              b.investigateTarget = null;
            }
          } else if (b.state === 'checking_spot' && b.inspectSpot) {
            b.inspectTimer -= delta;
            const sx = (typeof b.inspectSpot.exitX === 'number') ? b.inspectSpot.exitX : b.inspectSpot.x;
            const sz = (typeof b.inspectSpot.exitZ === 'number') ? b.inspectSpot.exitZ : b.inspectSpot.z;
            const distToSpot = Math.hypot(sx - b.mesh.position.x, sz - b.mesh.position.z);
            if (distToSpot > 0.95 && b.inspectTimer > 0.25) {
              tmpDirVec.set(sx - b.mesh.position.x, 0, sz - b.mesh.position.z).normalize();
              b.mesh.position.x += tmpDirVec.x * (b.speed * 0.78) * delta;
              b.mesh.position.z += tmpDirVec.z * (b.speed * 0.78) * delta;
              b.mesh.rotation.y = Math.atan2(tmpDirVec.x, tmpDirVec.z);
              animateCharacterRig(b.mesh, 0.75, false, delta);
            } else {
              b.mesh.rotation.y = Math.atan2(b.inspectSpot.x - b.mesh.position.x, b.inspectSpot.z - b.mesh.position.z);
              animateCharacterRig(b.mesh, 0.1, true, delta);
              if (playerPhysics.isHiding && playerPhysics.currentHidingSpot && !breathMiniGame.active && !isPlayerSpectating) {
                const dSpot = Math.hypot(playerPhysics.currentHidingSpot.x - b.inspectSpot.x, playerPhysics.currentHidingSpot.z - b.inspectSpot.z);
                if (dSpot < 3.5 && Math.abs(playerPhysics.pos.y - b.mesh.position.y) < 2.0) {
                  breathMiniGame.active = true;
                  breathMiniGame.meter = 1.0;
                  breathMiniGame.surviveTimer = (HORROR_CONFIG.gameplay && HORROR_CONFIG.gameplay.breathHoldDurationSec) || 2.6;
                  breathMiniGame.spot = playerPhysics.currentHidingSpot;
                  const bmEl = document.getElementById('breath-minigame-overlay');
                  if (bmEl) bmEl.style.display = 'flex';
                }
              }
              for (let h = 0; h < bots.length; h++) {
                const hb = bots[h];
                if (!hb.isSeeker && !hb.isCaught && hb.targetSpot && hb.targetSpot.id === b.inspectSpot.id) {
                  hb.catchCount = (hb.catchCount || 0) + 1;
                  hb.isCaught = true;
                  hb.canBeRescued = (hb.catchCount === 1);
                  hb.mesh.visible = hb.canBeRescued;
                }
              }
            }
            if (b.inspectTimer <= 0) {
              b.state = 'patrolling';
              b.inspectSpot = null;
              b.currentWpIdx = (b.currentWpIdx + 1) % navWaypoints.length;
            }
          } else {
            const targetWp = navWaypoints[b.currentWpIdx];
            const wpY = typeof targetWp.y === 'number' ? targetWp.y : 0;
            tmpTargetVec.set(targetWp.x, wpY, targetWp.z);
            const distToWp = Math.hypot(targetWp.x - b.mesh.position.x, targetWp.z - b.mesh.position.z);

            if (distToWp < 1.35) {
              if (targetWp.kind === 'interior' && b.lastCheckedWpId !== targetWp.id) {
                b.lastCheckedWpId = targetWp.id;
                let nearestSpot = null;
                let bestScore = 999;
                for (let s = 0; s < interactiveHidingSpots.length; s++) {
                  const sp = interactiveHidingSpots[s];
                  if (targetWp.roomId && sp.zone !== targetWp.roomId) continue;
                  const d = Math.hypot(sp.x - b.mesh.position.x, sp.z - b.mesh.position.z);
                  const knownBonus = (sp.useCount || 0) >= 2 ? 4.0 : 0.0;
                  const score = d - knownBonus;
                  if (d < 8.5 && score < bestScore) {
                    bestScore = score;
                    nearestSpot = sp;
                  }
                }
                if (nearestSpot) {
                  b.state = 'checking_spot';
                  b.inspectSpot = nearestSpot;
                  b.inspectTimer = 1.35;
                } else {
                  b.currentWpIdx = (b.currentWpIdx + 1) % navWaypoints.length;
                }
              } else {
                b.currentWpIdx = (b.currentWpIdx + 1) % navWaypoints.length;
              }
            } else {
              tmpDirVec.set(targetWp.x - b.mesh.position.x, 0, targetWp.z - b.mesh.position.z).normalize();
              b.mesh.position.x += tmpDirVec.x * b.speed * delta;
              b.mesh.position.z += tmpDirVec.z * b.speed * delta;
              const botSupportY = getSupportFloorY(b.mesh.position.x, b.mesh.position.z, b.mesh.position.y);
              b.mesh.position.y += (botSupportY - b.mesh.position.y) * Math.min(1.0, 14.0 * delta);
              b.mesh.rotation.y = Math.atan2(tmpDirVec.x, tmpDirVec.z);
              animateCharacterRig(b.mesh, 0.9, false, delta);
            }
          }

          if (GAME_CONFIG.role === 'hider' && !isPlayerSpectating) {
            const distToPlayer = b.mesh.position.distanceTo(playerPhysics.pos);
            const horrorOverlay = document.getElementById('horror-pulse-overlay');
            const bannerEl = document.getElementById('campus-banner');

            if (distToPlayer < 26) {
              const hasLos = distToPlayer < 18 && checkTagLineOfSight(
                { x: b.mesh.position.x, y: b.mesh.position.y + 1.6, z: b.mesh.position.z },
                { x: playerPhysics.pos.x, y: playerPhysics.pos.y + 1.1, z: playerPhysics.pos.z },
                colliders
              );
              const rawProx = Math.max(0, Math.min(1, (1 - distToPlayer / 26) * (hasLos ? 1.25 : 0.92)));
              const proximity = rawProx * getFearMultiplier();
              currentHunterProximity = proximity;
              if (EXPLORE_FLAGS.ENABLE_HEARTBEAT_AND_CHASE_AUDIO) {
                soundEngine.updateProximityTension(proximity);
              }
              if (horrorOverlay && EXPLORE_FLAGS.ENABLE_RED_VIGNETTE_AND_PULSES) {
                horrorOverlay.style.opacity = (proximity * 0.92).toFixed(2);
              }
              if (bannerEl && EXPLORE_FLAGS.ENABLE_RED_VIGNETTE_AND_PULSES) {
                bannerEl.classList.add('danger');
              }

              heartbeatCooldown -= delta;
              if (heartbeatCooldown <= 0 && EXPLORE_FLAGS.ENABLE_HEARTBEAT_AND_CHASE_AUDIO) {
                heartbeatCooldown = Math.max(0.24, 0.92 - proximity * 0.64);
                soundEngine.playHeartbeat(proximity);
              }

              if (distToPlayer < 11.5 && EXPLORE_FLAGS.ENABLE_JUMPSCARES_AND_STINGERS) {
                killApproachSfxCooldown -= delta;
                if (killApproachSfxCooldown <= 0) {
                  const danger = Math.min(1.0, (11.5 - distToPlayer) / 8.0 + 0.35);
                  killApproachSfxCooldown = Math.max(0.65, 1.8 - danger * 0.95);
                  soundEngine.playWardenKillApproachSfx(danger);
                }
              }
            } else {
              currentHunterProximity = 0.0;
              soundEngine.updateProximityTension(0.0);
              if (horrorOverlay) horrorOverlay.style.opacity = '0';
              if (bannerEl) bannerEl.classList.remove('danger');
            }

            const detectionDist = playerPhysics.isHiding ? (breathMiniGame.active ? 0.65 : 1.35) : (playerPhysics.isCrouching ? 4.0 : 7.4);
            const sameFloor = Math.abs(b.mesh.position.y - playerPhysics.pos.y) < 2.2;
            if (sameFloor && distToPlayer < detectionDist && !breathMiniGame.active) {
              handlePlayerCaughtByHunter('The Hollow Proctor caught you during midnight patrol!');
            }
          }
        } else {
          animateCharacterRig(b.mesh, 0, true, delta);
          if (typeof b.fuseTimer === 'number' && EXPLORE_FLAGS.ENABLE_FUSE_BOXES_AND_OBJECTIVES) {
            b.fuseTimer -= delta;
            if (b.fuseTimer <= 0) {
              b.fuseTimer = 22 + Math.random() * 14;
              if (isPlayerSpectating && playerCatchCount === 1) {
                isPlayerSpectating = false;
                const specEl = document.getElementById('spectator-overlay');
                if (specEl) specEl.style.display = 'none';
                playerPhysics.pos.set(-4, 0, -48);
                soundEngine.playFuseRepairSfx();
                showToast('Teammate ' + b.name + ' freed you! (Final Life — 2nd catch is permanent)');
              } else {
                const pendingFuse = fuseBoxes.find(f => !f.restored);
                if (pendingFuse && Math.random() < 0.35) {
                  pendingFuse.restored = true;
                  if (pendingFuse.ledMat) pendingFuse.ledMat.color.setHex(0x22c55e);
                  const restoredCount = fuseBoxes.filter(f => f.restored).length;
                  const fuseHud = document.getElementById('hud-fuses-label');
                  if (fuseHud) fuseHud.textContent = restoredCount + '/' + fuseBoxes.length;
                  if (restoredCount >= fuseBoxes.length) mainGateUnlocked = true;
                  showToast(b.name + ' restored ' + pendingFuse.name + ' (' + restoredCount + '/4)!');
                  sendToReactNative('FUSES_UPDATED', { fusesRestored: restoredCount, mainGateUnlocked });
                }
              }
            }
          }
        }
      }
    }

    function handlePlayerCaughtByHunter(reasonText) {
      if (!EXPLORE_FLAGS.ENABLE_WIN_LOSE_EVALUATION) return;
      soundEngine.playJumpscareSting();
      playerCatchCount++;
      playerPhysics.isHiding = false;
      document.getElementById('stealth-overlay').classList.remove('active');
      soundEngine.setMuffled(false);

      const aliveTeammates = bots.filter(b => !b.isSeeker && !b.isCaught);
      if (playerCatchCount === 1 && aliveTeammates.length > 0) {
        isPlayerSpectating = true;
        const specEl = document.getElementById('spectator-overlay');
        if (specEl) specEl.style.display = 'flex';
        showToast('Caught (1/2)! Spectating teammates — a teammate can free you once!');
      } else {
        isGameOver = true;
        isMatchActive = false;
        sendToReactNative('GAMEOVER', {
          winner: 'SEEKER',
          reason: reasonText,
        });
      }
    }

    // Requirement 2: LOW & FAST material bumpMap reduction (HIGH and ULTRA keep 100% of bump maps & textures untouched!)
    function setLowFastMaterialSimplification(simplify) {
      const allMatCollections = [materials, step2Mats];
      allMatCollections.forEach(coll => {
        if (!coll) return;
        Object.keys(coll).forEach(k => {
          const m = coll[k];
          if (!m || !m.isMaterial) return;
          if (!m.userData) m.userData = {};
          if (m.userData._origBumpSaved === undefined) {
            m.userData._origBumpSaved = true;
            m.userData._origBumpMap = m.bumpMap || null;
            m.userData._origBumpScale = m.bumpScale || 0;
          }
          const nextBump = simplify ? null : m.userData._origBumpMap;
          if (m.bumpMap !== nextBump) {
            m.bumpMap = nextBump;
            m.bumpScale = simplify ? 0 : m.userData._origBumpScale;
            m.needsUpdate = true;
          }
          if (m.userData._vcMat) {
            const vc = m.userData._vcMat;
            if (vc.bumpMap !== nextBump) {
              vc.bumpMap = nextBump;
              vc.bumpScale = simplify ? 0 : m.userData._origBumpScale;
              vc.needsUpdate = true;
            }
          }
        });
      });
    }

    function applyGraphicsQuality(q, pinModeOverride) {
      if (pinModeOverride !== undefined) {
        qualityPinMode = pinModeOverride;
      }
      currentQuality = (HORROR_CONFIG.qualityPresets && HORROR_CONFIG.qualityPresets[q]) ? q : 'high';
      activePreset = HORROR_CONFIG.qualityPresets[currentQuality];
      const isLowOrFast = (currentQuality === 'low' || currentQuality === 'fast');
      setLowFastMaterialSimplification(isLowOrFast);
      atmosphere.applyQuality(activePreset);
      particleFieldMod.applyQuality(activePreset);
      if (lampFlickerMod && lampFlickerMod.applyQuality) lampFlickerMod.applyQuality(activePreset);
      updateRoomAndBuildingVisibility(playerPhysics.pos, playerPhysics.yaw, activePreset);
    }

    function setBatterySaverMode(enabled) {
      batterySaverEnabled = !!enabled;
      const w = Math.max(window.innerWidth || 0, 320);
      const h = Math.max(window.innerHeight || 0, 240);
      if (atmosphere && atmosphere.resizeGradeTarget) {
        atmosphere.resizeGradeTarget(w, h);
      }
    }

    function handleIncomingMessage(e) {
      try {
        const raw = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
        const data = JSON.parse(raw);
        if (data.type === 'CONFIGURE') {
          if (typeof data.exploreMode === 'boolean') {
            setExploreMode(data.exploreMode);
          }
          GAME_CONFIG.role = data.role || 'hider';
          GAME_CONFIG.difficulty = data.difficulty || 'medium';
          GAME_CONFIG.botCount = data.difficulty === 'easy' ? 4 : (data.difficulty === 'hard' ? 7 : 5);
          if (typeof data.muted === 'boolean') soundEngine.setMuted(data.muted);
          if (typeof data.batterySaver === 'boolean') setBatterySaverMode(data.batterySaver);
          if (data.pinMode) qualityPinMode = data.pinMode;
          if (data.quality) applyGraphicsQuality(data.quality, data.pinMode);
          if (typeof data.flickerReduction === 'boolean') accessibilitySettings.flickerReduction = data.flickerReduction;
          if (typeof data.screenShakeOff === 'boolean') accessibilitySettings.screenShakeOff = data.screenShakeOff;
          if (data.fearIntensity) accessibilitySettings.fearIntensity = data.fearIntensity;
          if (data.accessibility) {
            if (data.accessibility.fearIntensity) accessibilitySettings.fearIntensity = data.accessibility.fearIntensity;
            if (typeof data.accessibility.flickerReduction === 'boolean') accessibilitySettings.flickerReduction = data.accessibility.flickerReduction;
            if (typeof data.accessibility.screenShakeOff === 'boolean') accessibilitySettings.screenShakeOff = data.accessibility.screenShakeOff;
          }
          startMatch();
        } else if (data.type === 'SET_EXPLORE_MODE') {
          setExploreMode(Boolean(data.exploreMode));
          startMatch();
        } else if (data.type === 'SET_ACCESSIBILITY') {
          if (data.fearIntensity) accessibilitySettings.fearIntensity = data.fearIntensity;
          if (typeof data.flickerReduction === 'boolean') accessibilitySettings.flickerReduction = data.flickerReduction;
          if (typeof data.screenShakeOff === 'boolean') accessibilitySettings.screenShakeOff = data.screenShakeOff;
        } else if (data.type === 'SET_MUTE') {
          soundEngine.setMuted(data.muted);
          if (typeof exploreTools !== 'undefined' && exploreTools.syncAudioUi) exploreTools.syncAudioUi();
        } else if (data.type === 'SET_BATTERY_SAVER') {
          setBatterySaverMode(Boolean(data.enabled));
          showToast('Battery Saver: ' + (batterySaverEnabled ? 'ON (30 FPS • 1.0x PR)' : 'OFF'));
        } else if (data.type === 'SET_AMBIENCE_VOLUME') {
          soundEngine.setAmbienceVolume(Number(data.volume));
          if (typeof exploreTools !== 'undefined' && exploreTools.syncAudioUi) exploreTools.syncAudioUi();
        } else if (data.type === 'SET_TINNITUS') {
          soundEngine.setTinnitusEnabled(Boolean(data.enabled));
        } else if (data.type === 'APP_STATE_CHANGE') {
          if (data.active) {
            soundEngine.resumeFromBackground();
          } else {
            soundEngine.suspendForBackground();
          }
        } else if (data.type === 'SET_QUALITY') {
          applyGraphicsQuality(data.quality, data.pinMode);
          const modeText = qualityPinMode === 'auto' ? ('AUTO (' + currentQuality.toUpperCase() + ')') : ('PINNED ' + currentQuality.toUpperCase());
          showToast('Graphics Quality: ' + modeText);
        } else if (data.type === 'RESTART_GAME') {
          startMatch();
        } else if (data.type === 'DISPOSE') {
          soundEngine.dispose();
          atmosphere.dispose();
        }
      } catch (err) {}
    }

    window.addEventListener('message', handleIncomingMessage);
    document.addEventListener('message', handleIncomingMessage);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        soundEngine.suspendForBackground();
      } else {
        soundEngine.resumeFromBackground();
      }
    });
    window.addEventListener('blur', () => {
      soundEngine.suspendForBackground();
    });
    window.addEventListener('focus', () => {
      soundEngine.resumeFromBackground();
    });

    const unlockGateEl = document.getElementById('audio-unlock-gate');
    if (unlockGateEl) {
      unlockGateEl.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        soundEngine.unlockAudio();
      }, { passive: false });
      unlockGateEl.addEventListener('click', () => {
        soundEngine.unlockAudio();
      });
    }

    window.addEventListener('pagehide', () => {
      soundEngine.dispose();
      atmosphere.dispose();
    });
    window.addEventListener('beforeunload', () => {
      soundEngine.dispose();
      atmosphere.dispose();
    });

    // Step 1 & 6: Dev A/B Toggle for Color Grade & Stylized PS1 Mode
    window.toggleColorGrade = function(forceState) {
      if (!atmosphere) return false;
      atmosphere.gradeDevToggle = typeof forceState === 'boolean' ? forceState : !atmosphere.gradeDevToggle;
      atmosphere.updateCssFallbackVisibility();
      const isOn = atmosphere.isColorGradePassActive();
      showToast('Color Grade Pass: ' + (isOn ? 'ON (Teal/Orange S-Curve)' : 'OFF (Raw A/B)'));
      return isOn;
    };

    window.toggleStylizedPs1Mode = function(forceState) {
      if (!atmosphere) return false;
      atmosphere.stylizedMode = typeof forceState === 'boolean' ? forceState : !atmosphere.stylizedMode;
      if (atmosphere.gradeUniforms) {
        atmosphere.gradeUniforms.uStylized.value = atmosphere.stylizedMode ? 1.0 : 0.0;
      }
      const w = Math.max(window.innerWidth || 0, 320);
      const h = Math.max(window.innerHeight || 0, 240);
      atmosphere.resizeGradeTarget(w, h);
      atmosphere.updateCssFallbackVisibility();
      showToast('PS1 Stylized 0.7x Dither Mode: ' + (atmosphere.stylizedMode ? 'ON' : 'OFF'));
      return atmosphere.stylizedMode;
    };

    // Requirement 1: Process chunked procedural textures across frames behind the loading screen
    function flushTextureChunksIncrementally(chunksPerFrame = 2) {
      if (!window.__TEXTURE_CHUNK_QUEUE__ || window.__TEXTURE_CHUNK_QUEUE__.length === 0) return;
      let count = 0;
      while (window.__TEXTURE_CHUNK_QUEUE__.length > 0 && count < chunksPerFrame) {
        const fn = window.__TEXTURE_CHUNK_QUEUE__.shift();
        try { fn(); } catch (e) {}
        count++;
      }
      if (window.__TEXTURE_CHUNK_QUEUE__.length > 0) {
        requestAnimationFrame(() => flushTextureChunksIncrementally(chunksPerFrame));
      }
    }
    flushTextureChunksIncrementally(2);

    startMatch();
    if (typeof exploreTools !== 'undefined' && exploreTools.initUI) {
      exploreTools.initUI();
    }
    sendToReactNative('ENGINE_READY');

    // Requirement 2 & 3: Rolling 5s Auto Quality Ladder + 10-Minute Session FPS & Headroom Telemetry
    let fpsFrameCount = 0;
    let fpsAccumSec = 0.0;
    let rollingAvgFps = 60.0;
    let rollingAvgFrameMs = 16.67;
    let batterySaverFrameAccum = 0.0;
    const sessionTelemetry = {
      elapsedSec: 0,
      currentMinute: 1,
      minFrameCount: 0,
      minAccumSec: 0,
      minuteHistory: [], // [{ minute: 1, avgFps, avgFrameMs, headroomPct, quality }]
    };
    window.__HORROR_SESSION_TELEMETRY__ = sessionTelemetry;
    const clock = new THREE.Clock();

    function stepDownQualityOneTier(avgFps) {
      const ladder = ['ultra', 'high', 'low', 'fast'];
      const idx = ladder.indexOf(currentQuality);
      if (idx >= 0 && idx < ladder.length - 1) {
        const nextTier = ladder[idx + 1];
        applyGraphicsQuality(nextTier, 'auto');
        sendToReactNative('AUTO_STEP_DOWN_QUALITY', { fps: Math.round(avgFps), quality: nextTier });
        showToast('FPS < 40 for 5s: Stepped down to ' + nextTier.toUpperCase());
      }
    }

    function animate() {
      requestAnimationFrame(animate);
      const rawDelta = clock.getDelta();
      // Requirement 3: Optional Battery Saver 30 FPS frame-rate cap (never auto-enabled on capable phones)
      if (batterySaverEnabled && !physicsDebug.fakeLowFPS) {
        batterySaverFrameAccum += rawDelta;
        if (batterySaverFrameAccum < (1.0 / 30.5)) {
          return;
        }
        batterySaverFrameAccum = 0.0;
      }
      const maxDt = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.maxDeltaTime) || (1.0 / 30.0);
      let delta = Math.min(rawDelta, maxDt);
      const timeSec = Date.now() * 0.001;

      // Update GPU shader uniform for waving cloth prayer flags (zero CPU vertex loop!)
      prayerFlagUniforms.uTime.value = timeSec;

      // Keep sky dome centered at player camera position
      if (atmosphere.skyGroup && camera) {
        atmosphere.skyGroup.position.copy(camera.position);
      }

      // TASK 2: Occasional random lamp flicker bursts (disabled in EXPLORE_MODE)
      if (EXPLORE_FLAGS.ENABLE_STROBING_AND_BROWNOUTS) {
        flickerBurstTimer -= delta;
        if (flickerBurstTimer <= 0) {
          flickerBurstTimer = (HORROR_CONFIG.tension.flickerBurstIntervalMin || 9.0) +
            Math.random() * ((HORROR_CONFIG.tension.flickerBurstIntervalMax || 18.0) - (HORROR_CONFIG.tension.flickerBurstIntervalMin || 9.0));
          lampFlickerMod.triggerPowerDip(0.35);
          soundEngine.playLampBuzz();
        }
      }

      // Fog & Vignette update: In EXPLORE_MODE, keep steady baseline or slider-tuned fog & normal subtle vignette
      if (scene.fog && scene.fog.isFog) {
        if (!exploreTools.fogEnabled) {
          scene.fog.near = 9999;
          scene.fog.far = 10000;
        } else if (!EXPLORE_FLAGS.ENABLE_FEAR_FOV_AND_TENSION_FOG) {
          const userFar = exploreTools.fogFar || ((HORROR_CONFIG.renderer && HORROR_CONFIG.renderer.fogFar) || 88.0);
          scene.fog.near = Math.max(2.5, (userFar / 88.0) * ((HORROR_CONFIG.renderer && HORROR_CONFIG.renderer.fogNear) || 14.0));
          scene.fog.far = userFar;
        } else {
          const timerRatio = Math.max(0, Math.min(1, 1 - (matchTimer / (GAME_CONFIG.matchDuration || 135))));
          const combinedTension = Math.min(1.0, currentHunterProximity * 0.75 + timerRatio * 0.45);
          const baseFar = (HORROR_CONFIG.renderer && HORROR_CONFIG.renderer.fogFar) || 88.0;
          const minFar = (HORROR_CONFIG.renderer && HORROR_CONFIG.renderer.fogMinFarUnderTension) || 45.0;
          scene.fog.near = Math.max(2.5, ((HORROR_CONFIG.renderer && HORROR_CONFIG.renderer.fogNear) || 14.0) - combinedTension * 3.0);
          scene.fog.far = baseFar - (baseFar - minFar) * combinedTension;
          const vigEl = document.getElementById('cinematic-vignette');
          if (vigEl) {
            vigEl.style.opacity = (0.28 + combinedTension * 0.20).toFixed(2);
          }
        }

        // Faint warm tint to the fog when the player is near a warm lamp pool (< 14m)
        const lampDist = (lampFlickerMod && typeof lampFlickerMod.nearestLampDist === 'number')
          ? lampFlickerMod.nearestLampDist
          : 999;
        const warmFactor = Math.max(0.0, Math.min(0.45, (1.0 - lampDist / 14.0) * 0.45));
        scene.fog.color.copy(atmosphere.baseFogColor).lerp(atmosphere.warmFogColor, warmFactor);
      }
      if (!EXPLORE_FLAGS.ENABLE_FEAR_FOV_AND_TENSION_FOG) {
        const vigEl = document.getElementById('cinematic-vignette');
        if (vigEl) vigEl.style.opacity = '0.28';
      }

      // Throttled hunter proximity message (disabled in EXPLORE_MODE)
      if (EXPLORE_FLAGS.ENABLE_HUNTER_AND_BOTS) {
        proximitySyncCooldown -= delta;
        if (proximitySyncCooldown <= 0) {
          proximitySyncCooldown = 0.25;
          sendToReactNative('HUNTER_PROXIMITY', { proximity: Number(currentHunterProximity.toFixed(2)) });
        }
      }

      // Physics execution with test harness profiling and hooks
      if (physicsDebug.fakeLowFPS) {
        delta = 1 / 15;
      }
      if (physicsDebug.lagSpikeRemaining > 0) {
        physicsDebug.lagSpikeRemaining = 0;
        const freezeStart = performance.now();
        while (performance.now() - freezeStart < 1000) {
          // Simulated 1.0s system / garbage collection freeze
        }
      }

      const physT0 = performance.now();
      const simDelta = delta * physicsDebug.speedMultiplier;
      updatePlayer(simDelta, timeSec);
      physicsDebug.physicsCostMs = performance.now() - physT0;
      physicsDebug.fps = rawDelta > 0.0001 ? (1.0 / rawDelta) : 60;

      updateEnvironmentAndBots(delta, timeSec);
      if (typeof exploreTools !== 'undefined' && exploreTools.updateFrame) {
        exploreTools.updateFrame();
      }
      atmosphere.renderFrame(timeSec);

      // Step 1 FPS Guard: If average FPS < 40 for 3.0 seconds, disable the color grade pass automatically!
      if (rawDelta > 0.001 && rawDelta < 0.5 && atmosphere.isColorGradePassActive()) {
        atmosphere._gradeFpsCount = (atmosphere._gradeFpsCount || 0) + 1;
        atmosphere._gradeFpsAccum = (atmosphere._gradeFpsAccum || 0.0) + rawDelta;
        const guardWin = (HORROR_CONFIG.grade && HORROR_CONFIG.grade.fpsGuardWindowSec) || 3.0;
        if (atmosphere._gradeFpsAccum >= guardWin) {
          const gradeAvgFps = atmosphere._gradeFpsCount / atmosphere._gradeFpsAccum;
          atmosphere._gradeFpsCount = 0;
          atmosphere._gradeFpsAccum = 0.0;
          const guardThresh = (HORROR_CONFIG.grade && HORROR_CONFIG.grade.fpsGuardThreshold) || 40;
          if (gradeAvgFps < guardThresh) {
            atmosphere.gradeAutoDisabledByFps = true;
            atmosphere.updateCssFallbackVisibility();
            showToast('FPS < 40: Color Grade switched to CSS fallback');
          }
        }
      }

      // Requirement 2 & 3: Rolling 5.0s FPS & Frame-Time Monitor + 10-Minute Session Telemetry
      if (rawDelta > 0.001 && rawDelta < 0.5) {
        fpsFrameCount++;
        fpsAccumSec += rawDelta;
        sessionTelemetry.elapsedSec += rawDelta;
        sessionTelemetry.minFrameCount++;
        sessionTelemetry.minAccumSec += rawDelta;

        if (sessionTelemetry.minAccumSec >= 60.0 && sessionTelemetry.minuteHistory.length < 10) {
          const mAvgFps = sessionTelemetry.minFrameCount / sessionTelemetry.minAccumSec;
          const mAvgMs = 1000.0 / Math.max(1.0, mAvgFps);
          const headroomPct = Math.max(0, ((16.67 - mAvgMs) / 16.67) * 100);
          const entry = {
            minute: sessionTelemetry.currentMinute,
            avgFps: Number(mAvgFps.toFixed(1)),
            avgFrameMs: Number(mAvgMs.toFixed(2)),
            headroomPct: Number(headroomPct.toFixed(1)),
            quality: currentQuality,
          };
          sessionTelemetry.minuteHistory.push(entry);
          sessionTelemetry.currentMinute++;
          sessionTelemetry.minFrameCount = 0;
          sessionTelemetry.minAccumSec = 0.0;
          sendToReactNative('SESSION_TELEMETRY_REPORT', entry);
        }

        const windowSec = (HORROR_CONFIG.tension && HORROR_CONFIG.tension.autoStepDownWindowSec) || 5.0;
        if (fpsAccumSec >= windowSec) {
          rollingAvgFps = fpsFrameCount / fpsAccumSec;
          rollingAvgFrameMs = 1000.0 / Math.max(1.0, rollingAvgFps);
          fpsFrameCount = 0;
          fpsAccumSec = 0.0;
          const stepDownThresh = (HORROR_CONFIG.tension && HORROR_CONFIG.tension.autoStepDownFpsThreshold) || 40;
          const safeFps = (HORROR_CONFIG.tension && HORROR_CONFIG.tension.autoStepDownSafeFps) || 45;
          // Never step down if pinned manually, if Battery Saver 30 FPS cap is active, or if holding >= 45 FPS
          if (qualityPinMode === 'auto' && !batterySaverEnabled && rollingAvgFps < safeFps && rollingAvgFps < stepDownThresh) {
            stepDownQualityOneTier(rollingAvgFps);
          }
        }
      }
    }
    animate();

    function handleResize() {
      const w = Math.max(window.innerWidth || 0, 320);
      const h = Math.max(window.innerHeight || 0, 240);
      if (camera) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      if (atmosphere && atmosphere.resizeGradeTarget) {
        atmosphere.resizeGradeTarget(w, h);
      } else if (renderer) {
        renderer.setSize(w, h);
      }
    }
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', () => {
      setTimeout(handleResize, 100);
      setTimeout(handleResize, 350);
    });
  </script>
</body>
</html>
`;
}
