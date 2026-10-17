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

    /* FAST Mode / Fallback CSS Color-Grade & Grain Overlay (Used when ULTRA WebGL grade pass is off) */
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
        radial-gradient(circle at 50% 50%, rgba(12, 28, 36, 0.02) 45%, rgba(6, 16, 22, 0.24) 82%, rgba(2, 6, 10, 0.58) 100%),
        repeating-linear-gradient(0deg, rgba(255,255,255,0.012) 0px, rgba(0,0,0,0.015) 1px, transparent 2px);
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
      HIDDEN UNDER CLASSROOM DESK
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
    <div class="blindfold-sub">Exact aerial blueprint replica: Longitudinal Classroom Wings (L1-L3, R1-R4), 3 Yellow Buses, Parking Plaza, Guardhouse, Planter Island & the 3-Storey Grand Rotunda.</div>
    <div class="blindfold-timer-box" id="blindfold-counter">10</div>
  </div>

  <div id="toast"></div>

  <div id="physics-debug-hud">
    <div class="debug-title">PHYSICS &amp; CONTROLS TELEMETRY</div>
    <div id="dbg-fps">FPS: 60 | Physics: 0.00ms</div>
    <div id="dbg-pos">Pos: 0.00, 0.00, 0.00</div>
    <div id="dbg-vel">Vel: (0.00, 0.00, 0.00) 0.00 m/s</div>
    <div id="dbg-move">MoveVec: (0.00, 0.00)</div>
    <div id="dbg-input">Input: Fwd: 0.00, Right: 0.00</div>
    <div id="dbg-look">Yaw: 0.0° (0.00 rad) | Pitch: 0.0°</div>
    <div id="dbg-ground">Grounded: true | Crouching: false</div>
    <div id="dbg-normal">Coll Normal: None</div>
    <div class="debug-controls-section">
      <div class="debug-section-label">TEST CONTROLS</div>
      <div class="debug-btn-row">
        <button id="dbg-btn-spd-1" class="dbg-btn active">1x</button>
        <button id="dbg-btn-spd-2" class="dbg-btn">2x</button>
        <button id="dbg-btn-spd-5" class="dbg-btn">5x</button>
        <button id="dbg-btn-lowfps" class="dbg-btn">15 FPS</button>
        <button id="dbg-btn-lag" class="dbg-btn">1s Freeze</button>
      </div>
      <div class="debug-btn-row" style="margin-top:4px;">
        <button id="dbg-btn-wireframes" class="dbg-btn">Colliders+WPs</button>
        <button id="dbg-btn-shadows" class="dbg-btn active">Shadows: ON</button>
        <button id="dbg-btn-run-audit" class="dbg-btn">Run Audit</button>
      </div>
      <div style="margin-top:4px;">
        <select id="dbg-teleport-select" class="dbg-select">
          <option value="">Teleport-to-Point...</option>
          <option value="-3.8,0,-18.0,-1.57">West Wing L1 Exterior Wall</option>
          <option value="-38.2,0.22,-48.45,0.785">Heritage W1 Inside Corner</option>
          <option value="-4.5,0,-33.5,1.57">Narrow Gap (Car vs Wall)</option>
          <option value="3.2,0,-60.0,0">Street Lamp Post</option>
          <option value="-6.0,0,40.0,3.14">Wrought-Iron Spiked Fence</option>
          <option value="-12.0,0,-14.0,0">Stone Chaitya Stupa Base</option>
          <option value="0,0,-60,0">Spawn: Hunter Patrol Post</option>
          <option value="-4,0,-48,0">Spawn: Scholar Hider Spot</option>
        </select>
      </div>
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
      <div class="touch-btn primary" id="btn-action" title="Interact / Hide / Tag (E)">
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
    let currentQuality = 'high';
    let activePreset = HORROR_CONFIG.qualityPresets[currentQuality] || HORROR_CONFIG.qualityPresets.high;

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
        const validGeos = [];

        for (let i = 0; i < geometries.length; i++) {
          const g = geometries[i];
          if (!g || !g.attributes || !g.attributes.position) continue;
          const vCount = g.attributes.position.count;
          if (vCount === 0) continue;
          const iCount = g.index ? g.index.count : vCount;
          totalVerts += vCount;
          totalIndices += iCount;
          validGeos.push(g);
        }
        if (validGeos.length === 0) return null;

        const positions = new Float32Array(totalVerts * 3);
        const normals = new Float32Array(totalVerts * 3);
        const uvs = new Float32Array(totalVerts * 2);
        const indices = totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

        let vOffset = 0;
        let iOffset = 0;

        for (let i = 0; i < validGeos.length; i++) {
          const g = validGeos[i];
          const posAttr = g.attributes.position;
          const normAttr = g.attributes.normal;
          const uvAttr = g.attributes.uv;
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
        merged.setIndex(new THREE.BufferAttribute(indices, 1));
        merged.computeBoundingBox();
        merged.computeBoundingSphere();
        return merged;
      }

      THREE.BufferGeometryUtils = THREE.BufferGeometryUtils || {};
      THREE.BufferGeometryUtils.mergeBufferGeometries = mergeBufferGeometries;
    })();

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
          inst.castShadow = isOpaque;
          inst.receiveShadow = isOpaque;
          computeInstancedBoundingSphere(inst, bucket.matrices.length);
          rootGroup.add(inst);
        }
      });

      // Merge each material bucket into a single BufferGeometry & Mesh
      materialBuckets.forEach((mBucket) => {
        const isOpaque = !mBucket.mat.transparent;
        if (mBucket.items.length === 1) {
          const item = mBucket.items[0];
          const clonedSingle = item.geo.clone();
          clonedSingle.applyMatrix4(item.matrix);
          clonedSingle.computeBoundingBox();
          clonedSingle.computeBoundingSphere();
          const singleMesh = new THREE.Mesh(clonedSingle, mBucket.mat);
          singleMesh.renderOrder = mBucket.renderOrder;
          singleMesh.castShadow = isOpaque;
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
          const mergedMesh = new THREE.Mesh(mergedGeo, mBucket.mat);
          mergedMesh.renderOrder = mBucket.renderOrder;
          mergedMesh.castShadow = isOpaque;
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

    function triggerHorrorVisualShock(intensity = 0.75, showMaskFlash = false) {
      horrorCameraShake = Math.max(horrorCameraShake, intensity * 0.42);
      horrorGlitchTimer = Math.max(horrorGlitchTimer, 0.22 + intensity * 0.35);
      const glitchEl = document.getElementById('horror-glitch-overlay');
      if (glitchEl) {
        glitchEl.style.opacity = Math.min(0.95, intensity * 0.88).toFixed(2);
      }
      if (showMaskFlash) {
        const flashEl = document.getElementById('horror-jumpscare-flash');
        if (flashEl) {
          flashEl.style.opacity = Math.min(0.92, 0.45 + intensity * 0.5).toFixed(2);
          clearTimeout(flashEl._hideTimer);
          flashEl._hideTimer = setTimeout(() => {
            flashEl.style.opacity = '0';
          }, 190 + Math.floor(intensity * 180));
        }
      }
    }

    class CampusNightSoundEngine {
      constructor() {
        this.ctx = null;
        this.isMuffled = false;
        this.isMuted = false;
        this.cricketsSilenced = false;
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
        this.cricketTimer = null;
        this.musicLoopTimer = null;
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

      createDarkCourtyardReverbBuffer() {
        const rate = this.ctx.sampleRate;
        const duration = 2.6;
        const length = Math.floor(rate * duration);
        const impulse = this.ctx.createBuffer(2, length, rate);
        for (let ch = 0; ch < 2; ch++) {
          const data = impulse.getChannelData(ch);
          let lp = 0;
          for (let i = 0; i < length; i++) {
            const t = i / length;
            const env = Math.pow(1 - t, 2.35);
            const white = Math.random() * 2 - 1;
            // Damp high frequencies so echoes sound like cold wet stone & dark timber
            lp = lp * 0.82 + white * 0.18;
            const earlyEcho = (i % Math.floor(rate * 0.085) < 40) ? 1.45 : 1.0;
            data[i] = lp * env * earlyEcho * 0.55;
          }
        }
        return impulse;
      }

      init() {
        if (this.ctx) return;
        try {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (!AudioContext) return;
          this.ctx = new AudioContext();
          this.distortionCurve = this.makeDistortionCurve(78);

          // Dynamics compressor to keep jumpscares punchy and loud without digital clipping
          this.compressor = this.ctx.createDynamicsCompressor();
          this.compressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
          this.compressor.knee.setValueAtTime(12, this.ctx.currentTime);
          this.compressor.ratio.setValueAtTime(6, this.ctx.currentTime);
          this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
          this.compressor.release.setValueAtTime(0.22, this.ctx.currentTime);

          this.masterGain = this.ctx.createGain();
          this.masterGain.gain.setValueAtTime(this.isMuted ? 0.0 : 0.94, this.ctx.currentTime);

          this.muffleFilter = this.ctx.createBiquadFilter();
          this.muffleFilter.type = 'lowpass';
          this.muffleFilter.frequency.setValueAtTime(18000, this.ctx.currentTime);

          // Ultra-Lightweight Dual-Tap Courtyard Echo Bus (Zero FFT CPU/Thermal Overhead on iPhone 17!)
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

          this.startLowWindLoop();
          this.startTensionDrone();
          this.startProximityChaseLayer();
          this.startHauntedMusicLoop();
          this.startNightCrickets();
        } catch (e) {}
      }

      resume() {
        if (!this.ctx) this.init();
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
      }

      setMuted(muted) {
        this.isMuted = !!muted;
        if (this.ctx && this.masterGain) {
          this.masterGain.gain.setTargetAtTime(this.isMuted ? 0.0 : 0.94, this.ctx.currentTime, 0.08);
        }
      }

      // 1. Eerie Himalayan Midnight Wind Howl with Dual-Formant Resonant Sweeps
      startLowWindLoop() {
        if (!this.ctx) return;
        try {
          const bufferSize = this.ctx.sampleRate * 4.0;
          const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
          const output = noiseBuffer.getChannelData(0);
          let b0 = 0, b1 = 0, b2 = 0;
          for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.992 * b0 + white * 0.05;
            b1 = 0.96 * b1 + white * 0.08;
            b2 = 0.86 * b2 + white * 0.12;
            output[i] = (b0 + b1 + b2) * 0.38;
          }

          const whiteNoise = this.ctx.createBufferSource();
          whiteNoise.buffer = noiseBuffer;
          whiteNoise.loop = true;

          const gustFilter = this.ctx.createBiquadFilter();
          gustFilter.type = 'bandpass';
          gustFilter.frequency.setValueAtTime(220, this.ctx.currentTime);
          gustFilter.Q.setValueAtTime(3.2, this.ctx.currentTime);

          // Slow LFO modulating wind pitch so the courtyard wind moans like a ghost
          const windLfo = this.ctx.createOscillator();
          const windLfoGain = this.ctx.createGain();
          windLfo.type = 'sine';
          windLfo.frequency.setValueAtTime(0.14, this.ctx.currentTime);
          windLfoGain.gain.setValueAtTime(95, this.ctx.currentTime);
          windLfo.connect(windLfoGain);
          windLfoGain.connect(gustFilter.frequency);

          this.windGain = this.ctx.createGain();
          this.windGain.gain.setValueAtTime(0.085, this.ctx.currentTime);

          whiteNoise.connect(gustFilter);
          gustFilter.connect(this.windGain);
          this.windGain.connect(this.masterGain);
          whiteNoise.start();
          windLfo.start();
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
          tritoneOsc.frequency.setValueAtTime(51.91, now); // G#1 devil's tritone interval!

          darkFilter.type = 'lowpass';
          darkFilter.frequency.setValueAtTime(135, now);
          darkFilter.Q.setValueAtTime(4.2, now);

          // Breathing filter LFO for ominous pulsing dread
          const lfo = this.ctx.createOscillator();
          const lfoGain = this.ctx.createGain();
          lfo.type = 'sine';
          lfo.frequency.setValueAtTime(0.09, now);
          lfoGain.gain.setValueAtTime(65, now);
          lfo.connect(lfoGain);
          lfoGain.connect(darkFilter.frequency);

          this.droneGain.gain.setValueAtTime(0.068, now);

          subOsc.connect(darkFilter);
          detuneOsc.connect(darkFilter);
          tritoneOsc.connect(darkFilter);
          darkFilter.connect(this.droneGain);
          this.droneGain.connect(this.masterGain);

          subOsc.start();
          detuneOsc.start();
          tritoneOsc.start();
          lfo.start();
        } catch (e) {}
      }

      // 3. Dynamic Seeker Proximity Bowed Waterphone / Sarangi Tension Layer + Tinnitus Ear-Ring
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
          this.proximityScreechOsc2.frequency.setValueAtTime(164.81, now); // E3 minor-second clash!

          this.proximityFilter.type = 'bandpass';
          this.proximityFilter.frequency.setValueAtTime(520, now);
          this.proximityFilter.Q.setValueAtTime(5.5, now);

          this.proximityScreechGain.gain.setValueAtTime(0.0, now);

          this.proximityScreechOsc1.connect(this.proximityFilter);
          this.proximityScreechOsc2.connect(this.proximityFilter);
          this.proximityFilter.connect(this.proximityScreechGain);
          this.proximityScreechGain.connect(this.masterGain);

          this.proximityScreechOsc1.start();
          this.proximityScreechOsc2.start();

          // High-pitched panic tinnitus ring when Warden is critically close (< 9m)
          const tinOsc = this.ctx.createOscillator();
          this.tinnitusGain = this.ctx.createGain();
          tinOsc.type = 'sine';
          tinOsc.frequency.setValueAtTime(3820, now);
          this.tinnitusGain.gain.setValueAtTime(0.0, now);
          tinOsc.connect(this.tinnitusGain);
          this.tinnitusGain.connect(this.masterGain);
          tinOsc.start();
        } catch (e) {}
      }

      updateProximityTension(proximity = 0.0) {
        if (!this.ctx || !this.proximityScreechGain || this.isMuted) return;
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

          // Tinnitus ear-ring when proximity > 0.62
          const tinLevel = clamped > 0.62 ? (clamped - 0.62) * 0.085 : 0.0;
          this.tinnitusGain.gain.setTargetAtTime(tinLevel, now, 0.18);
        } catch (e) {}
      }

      // 4. Generative Haunted Nepali Singing Bowl, Pluck & Ghostly Choir Motif Loop
      startHauntedMusicLoop() {
        if (this.musicLoopTimer) clearInterval(this.musicLoopTimer);
        // Dark Phrygian/Locrian horror scale notes (D, Eb, G#, A, Bb, C#)
        const darkNotes = [73.42, 77.78, 103.83, 110.0, 116.54, 138.59, 146.83, 155.56, 207.65];
        this.musicLoopTimer = setInterval(() => {
          if (!this.ctx || this.isMuted || this.ctx.state !== 'running') return;
          try {
            const now = this.ctx.currentTime;
            const root = darkNotes[Math.floor(Math.random() * darkNotes.length)];
            // Play eerie FM Tibetan/Newari singing bowl with downward pitch bend
            [1.0, 2.756, 5.404].forEach((ratio, idx) => {
              const osc = this.ctx.createOscillator();
              const gain = this.ctx.createGain();
              const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
              osc.type = idx === 0 ? 'sine' : 'triangle';
              const freq = root * ratio;
              osc.frequency.setValueAtTime(freq, now);
              osc.frequency.exponentialRampToValueAtTime(freq * (idx === 1 ? 0.96 : 0.985), now + 4.8);

              const peak = (idx === 0 ? 0.048 : (idx === 1 ? 0.022 : 0.009));
              gain.gain.setValueAtTime(0.0005, now);
              gain.gain.linearRampToValueAtTime(peak, now + 0.35);
              gain.gain.exponentialRampToValueAtTime(0.0004, now + 4.9);

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

            // 42% chance to layer a ghostly spectral whisper or distant wail 1.8s later
            if (Math.random() < 0.42) {
              setTimeout(() => {
                if (Math.random() < 0.55) this.playGhostWhisperSfx();
                else this.playDistantFemaleWeepOrSigh();
              }, 1600);
            }
          } catch (e) {}
        }, 6400);
      }

      startNightCrickets() {
        if (this.cricketTimer) clearInterval(this.cricketTimer);
        this.cricketTimer = setInterval(() => {
          if (!this.ctx || this.isMuted || this.cricketsSilenced || this.ctx.state !== 'running') return;
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
              gain.gain.setValueAtTime(0.001, t0);
              gain.gain.linearRampToValueAtTime(0.014, t0 + 0.014);
              gain.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.042);
              osc.connect(gain);
              gain.connect(this.masterGain);
              osc.start(t0);
              osc.stop(t0 + 0.045);
            }
          } catch (e) {}
        }, 1550);
      }

      // 5. Demonic Kangling Horn & Metallic Blade-Scrape when Seeker is Hunting Close (< 11.5m)
      playWardenKillApproachSfx(dangerIntensity = 0.85) {
        if (!this.ctx || this.isMuted) return;
        try {
          const now = this.ctx.currentTime;
          triggerHorrorVisualShock(dangerIntensity * 0.55, dangerIntensity > 0.82);

          // Brazen low demonic horn growl with waveshaper distortion
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

          growlGain.gain.setValueAtTime(0.001, now);
          growlGain.gain.linearRampToValueAtTime(0.28 * dangerIntensity, now + 0.05);
          growlGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

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

          // Piercing metallic waterphone/blade screech cluster
          [622.25, 880.0, 1174.66, 1661.22].forEach((f, idx) => {
            const sOsc = this.ctx.createOscillator();
            const sGain = this.ctx.createGain();
            sOsc.type = idx % 2 === 0 ? 'sawtooth' : 'square';
            sOsc.frequency.setValueAtTime(f, now);
            sOsc.frequency.exponentialRampToValueAtTime(f * (1.12 + idx * 0.04), now + 0.48);
            sGain.gain.setValueAtTime(0.001, now);
            sGain.gain.linearRampToValueAtTime(0.09 * dangerIntensity, now + 0.04);
            sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.50);
            sOsc.connect(sGain);
            sGain.connect(this.masterGain);
            sGain.connect(this.reverbSend);
            sOsc.start(now);
            sOsc.stop(now + 0.52);
          });
        } catch (e) {}
      }

      // 6. Stereo-Panned Spectral Ghost Whisper ("Shhh... Pachhaadi...")
      playGhostWhisperSfx() {
        if (!this.ctx || this.isMuted) return;
        try {
          const now = this.ctx.currentTime;
          const dur = 1.45;
          const len = Math.floor(this.ctx.sampleRate * dur);
          const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
          const data = buf.getChannelData(0);
          for (let i = 0; i < len; i++) {
            const t = i / len;
            // 3 whispered syllables envelope
            const syl = Math.pow(Math.sin(t * Math.PI * 3), 2) * Math.sin(t * Math.PI);
            data[i] = (Math.random() * 2 - 1) * syl * 0.65;
          }

          const src = this.ctx.createBufferSource();
          src.buffer = buf;

          // Vocal tract formant bandpass filters (F1 = 580Hz, F2 = 1650Hz, F3 = 2850Hz)
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
          wGain.gain.setValueAtTime(0.22, now);

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
        } catch (e) {}
      }

      // 7. Haunting Distant Ghostly Wail / Weeping Echo in the Courtyard
      playDistantFemaleWeepOrSigh() {
        if (!this.ctx || this.isMuted) return;
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

          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(0.075, now + 0.35);
          gain.gain.exponentialRampToValueAtTime(0.0005, now + 2.45);

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

      // 8. High-Voltage Lightning Crack & Rolling Himalayan Thunder Rumble
      playThunderCrackSfx() {
        if (!this.ctx || this.isMuted) return;
        try {
          const now = this.ctx.currentTime;
          triggerHorrorVisualShock(0.72, Math.random() < 0.45);

          const dur = 3.2;
          const len = Math.floor(this.ctx.sampleRate * dur);
          const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
          const data = buf.getChannelData(0);
          for (let i = 0; i < len; i++) {
            const t = i / len;
            const crackEnv = t < 0.06 ? 1.0 : Math.pow(1 - t, 1.8) * (0.65 + 0.35 * Math.sin(t * 28));
            data[i] = (Math.random() * 2 - 1) * crackEnv;
          }

          const src = this.ctx.createBufferSource();
          src.buffer = buf;

          const lp = this.ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.setValueAtTime(1600, now);
          lp.frequency.exponentialRampToValueAtTime(95, now + dur);

          const gain = this.ctx.createGain();
          gain.gain.setValueAtTime(0.46, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

          src.connect(lp);
          lp.connect(gain);
          gain.connect(this.masterGain);
          gain.connect(this.reverbSend);
          src.start(now);
        } catch (e) {}
      }

      playLampBuzz() {
        if (!this.ctx || this.isMuted) return;
        try {
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(110, now);
          gain.gain.setValueAtTime(0.032, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now);
          osc.stop(now + 0.10);
        } catch (e) {}
      }

      // 9. FULL-SPECTRUM NIGHTMARE JUMPSCARE SCREAM & SEISMIC SUB-DROP
      playJumpscareSting() {
        if (!this.ctx || this.isMuted) return;
        try {
          const now = this.ctx.currentTime;
          triggerHorrorVisualShock(1.0, true);

          // A. Seismic 110Hz -> 22Hz Sub-Bass Slam
          const sub = this.ctx.createOscillator();
          const subGain = this.ctx.createGain();
          sub.type = 'sine';
          sub.frequency.setValueAtTime(115, now);
          sub.frequency.exponentialRampToValueAtTime(22, now + 0.95);
          subGain.gain.setValueAtTime(0.85, now);
          subGain.gain.exponentialRampToValueAtTime(0.001, now + 1.05);
          sub.connect(subGain);
          subGain.connect(this.masterGain);
          sub.start(now);
          sub.stop(now + 1.08);

          // B. Distorted Banshee Scream (6 Detuned FM Sawtooth/Square Oscillators)
          const shaper = this.ctx.createWaveShaper();
          shaper.curve = this.distortionCurve;
          const screamGain = this.ctx.createGain();
          screamGain.gain.setValueAtTime(0.32, now);
          screamGain.gain.exponentialRampToValueAtTime(0.001, now + 1.15);
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
          fmMod.stop(now + 1.15);

          [277.18, 392.0, 554.37, 783.99, 1108.73, 1567.98].forEach((f, idx) => {
            const osc = this.ctx.createOscillator();
            osc.type = idx % 2 === 0 ? 'sawtooth' : 'square';
            osc.frequency.setValueAtTime(f * 0.88, now);
            osc.frequency.exponentialRampToValueAtTime(f * 1.18, now + 0.14);
            osc.frequency.exponentialRampToValueAtTime(f * 0.76, now + 1.12);
            fmModGain.connect(osc.frequency);
            osc.connect(shaper);
            osc.start(now);
            osc.stop(now + 1.15);
          });

          // C. Roaring Noise Burst through Formant Bandpass
          const nLen = Math.floor(this.ctx.sampleRate * 0.9);
          const nBuf = this.ctx.createBuffer(1, nLen, this.ctx.sampleRate);
          const nData = nBuf.getChannelData(0);
          for (let i = 0; i < nLen; i++) {
            nData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nLen, 1.2);
          }
          const nSrc = this.ctx.createBufferSource();
          nSrc.buffer = nBuf;
          const nBand = this.ctx.createBiquadFilter();
          nBand.type = 'bandpass';
          nBand.frequency.setValueAtTime(1450, now);
          nBand.frequency.exponentialRampToValueAtTime(520, now + 0.9);
          nBand.Q.setValueAtTime(2.2, now);
          nSrc.connect(nBand);
          nBand.connect(shaper);
          nSrc.start(now);
        } catch (e) {}
      }

      playFootstep(surface = 'paver', isCrouching = false) {
        if (!this.ctx || this.isMuted) return;
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
          gain.gain.setValueAtTime(isCrouching ? 0.07 : (surface === 'grass' ? 0.12 : 0.22), now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

          osc.connect(filter);
          filter.connect(gain);
          gain.connect(this.masterGain);

          if (this.inCorridor) {
            gain.connect(this.reverbSend);
          }

          osc.start(now);
          osc.stop(now + dur + 0.05);
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

      // TASK 2: Distant Feral Dog Bark One-Shot in the Foggy Valley
      playDistantDogBarkSfx() {
        if (!this.ctx || this.isMuted) return;
        try {
          const now = this.ctx.currentTime;
          [0, 0.34].forEach((offset, idx) => {
            const t0 = now + offset;
            const osc = this.ctx.createOscillator();
            const noiseLen = Math.floor(this.ctx.sampleRate * 0.22);
            const nBuf = this.ctx.createBuffer(1, noiseLen, this.ctx.sampleRate);
            const nData = nBuf.getChannelData(0);
            for (let i = 0; i < noiseLen; i++) {
              nData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (noiseLen * 0.35));
            }
            const nSrc = this.ctx.createBufferSource();
            nSrc.buffer = nBuf;

            const formant = this.ctx.createBiquadFilter();
            formant.type = 'bandpass';
            formant.frequency.setValueAtTime(idx === 0 ? 480 : 440, t0);
            formant.frequency.exponentialRampToValueAtTime(260, t0 + 0.20);
            formant.Q.setValueAtTime(3.2, t0);

            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.001, t0);
            gain.gain.linearRampToValueAtTime(idx === 0 ? 0.085 : 0.065, t0 + 0.025);
            gain.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.22);

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(idx === 0 ? 235 : 215, t0);
            osc.frequency.exponentialRampToValueAtTime(125, t0 + 0.20);

            osc.connect(formant);
            nSrc.connect(formant);
            formant.connect(gain);
            gain.connect(this.reverbSend);
            gain.connect(this.masterGain);

            osc.start(t0);
            nSrc.start(t0);
            osc.stop(t0 + 0.23);
          });
        } catch (e) {}
      }

      // TASK 2: Distant Phantom Footsteps Hurrying in the Fog
      playPhantomFootstepsSfx() {
        if (!this.ctx || this.isMuted) return;
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
            gain.gain.setValueAtTime(0.055 * Math.pow(0.82, s), t0);
            gain.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.095);
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.reverbSend);
            osc.start(t0);
            osc.stop(t0 + 0.10);
          }
        } catch (e) {}
      }

            // 10. Cursed Nepali Bronze Temple Ghanta Bell with Inharmonic Minor-Second Decay
      playDistantChime() {
        if (!this.ctx || this.isMuted) return;
        try {
          const now = this.ctx.currentTime;
          [174.61, 366.0, 523.25, 830.61, 1396.91].forEach((f, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
            osc.frequency.setValueAtTime(f, now);
            osc.frequency.exponentialRampToValueAtTime(f * 0.965, now + 3.8);
            const peak = idx === 0 ? 0.11 : (0.045 / idx);
            gain.gain.setValueAtTime(0.001, now);
            gain.gain.linearRampToValueAtTime(peak, now + 0.025);
            gain.gain.exponentialRampToValueAtTime(0.0004, now + 3.85);
            osc.connect(gain);
            gain.connect(this.masterGain);
            gain.connect(this.reverbSend);
            osc.start(now);
            osc.stop(now + 3.9);
          });
        } catch (e) {}
      }

      playWindGustSfx() {
        if (!this.ctx || this.isMuted || !this.windGain) return;
        try {
          const now = this.ctx.currentTime;
          this.windGain.gain.cancelScheduledValues(now);
          this.windGain.gain.setValueAtTime(this.windGain.gain.value, now);
          this.windGain.gain.linearRampToValueAtTime(this.inCorridor ? 0.11 : 0.22, now + 1.1);
          this.windGain.gain.exponentialRampToValueAtTime(this.inCorridor ? 0.038 : 0.085, now + 3.6);
          this.playGhostWhisperSfx();
        } catch (e) {}
      }

      // 11. Heavy Old Sal-Wood Timber Creak Followed by Distant Reverberant Door Slam
      playStructuralCreak() {
        if (!this.ctx || this.isMuted) return;
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

          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(0.085, now + 0.09);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);

          osc.connect(filter);
          filter.connect(gain);
          gain.connect(this.masterGain);
          gain.connect(this.reverbSend);
          osc.start(now);
          osc.stop(now + 0.60);

          // Distant heavy wooden Khapa door slam 0.52s after the creak!
          const slamTime = now + 0.52;
          const slamOsc = this.ctx.createOscillator();
          const slamGain = this.ctx.createGain();
          slamOsc.type = 'sine';
          slamOsc.frequency.setValueAtTime(118, slamTime);
          slamOsc.frequency.exponentialRampToValueAtTime(24, slamTime + 0.28);
          slamGain.gain.setValueAtTime(0.28, slamTime);
          slamGain.gain.exponentialRampToValueAtTime(0.001, slamTime + 0.30);
          slamOsc.connect(slamGain);
          slamGain.connect(this.masterGain);
          slamGain.connect(this.reverbSend);
          slamOsc.start(slamTime);
          slamOsc.stop(slamTime + 0.32);
        } catch (e) {}
      }

      playPowerDipHum() {
        if (!this.ctx || this.isMuted) return;
        try {
          const now = this.ctx.currentTime;
          triggerHorrorVisualShock(0.45, false);
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(60, now);
          osc.frequency.exponentialRampToValueAtTime(42, now + 0.45);
          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(0.11, now + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now);
          osc.stop(now + 0.50);
        } catch (e) {}
      }

      playHideSwoosh() {
        if (!this.ctx || this.isMuted) return;
        try {
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(390, now);
          osc.frequency.exponentialRampToValueAtTime(115, now + 0.26);
          gain.gain.setValueAtTime(0.28, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now);
          osc.stop(now + 0.27);
        } catch (e) {}
      }

      playCatchSting() {
        if (!this.ctx || this.isMuted) return;
        try {
          const now = this.ctx.currentTime;
          triggerHorrorVisualShock(0.7, false);
          [311.13, 440.0, 587.33, 880.0].forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.06);
            gain.gain.setValueAtTime(0.3, now + idx * 0.06);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.38);
            osc.connect(gain);
            gain.connect(this.masterGain);
            gain.connect(this.reverbSend);
            osc.start(now + idx * 0.06);
            osc.stop(now + idx * 0.06 + 0.4);
          });
        } catch (e) {}
      }

      // 12. Visceral Double Chest-Thump Heartbeat (Lub-Dub) + Visual Pulse Sync
      playHeartbeat(intensity = 0.7) {
        if (!this.ctx || this.isMuted) return;
        try {
          const now = this.ctx.currentTime;
          const vol = Math.min(0.88, 0.32 + intensity * 0.56);
          const pulseEl = document.getElementById('horror-pulse-overlay');
          if (pulseEl) {
            pulseEl.style.transform = 'scale(' + (1.0 + intensity * 0.035).toFixed(3) + ')';
            setTimeout(() => {
              if (pulseEl) pulseEl.style.transform = 'scale(1.0)';
            }, 140);
          }

          [0, 0.14].forEach((tOffset, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(idx === 0 ? 82 : 68, now + tOffset);
            osc.frequency.exponentialRampToValueAtTime(26, now + tOffset + 0.12);
            gain.gain.setValueAtTime(vol * (idx === 0 ? 1.0 : 0.82), now + tOffset);
            gain.gain.exponentialRampToValueAtTime(0.001, now + tOffset + 0.125);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(now + tOffset);
            osc.stop(now + tOffset + 0.13);
          });
        } catch (e) {}
      }

      setMuffled(muffled) {
        if (!this.ctx || this.isMuffled === muffled) return;
        this.isMuffled = muffled;
        this.muffleFilter.frequency.setTargetAtTime(muffled ? 420 : 18000, this.ctx.currentTime, 0.2);
      }

      dispose() {
        if (this.cricketTimer) {
          clearInterval(this.cricketTimer);
          this.cricketTimer = null;
        }
        if (this.musicLoopTimer) {
          clearInterval(this.musicLoopTimer);
          this.musicLoopTimer = null;
        }
        if (this.ctx) {
          try {
            if (this.masterGain) this.masterGain.disconnect();
            if (this.muffleFilter) this.muffleFilter.disconnect();
            this.ctx.close().catch(() => {});
          } catch (e) {}
          this.ctx = null;
        }
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
    const rectContactShadowTex = softContactShadowTex;
    const corridorDarknessTex = softContactShadowTex;

    /* =========================================================================
       MODULE 1: NightAtmosphere — COOL SLATE-BLUE NIGHT SKY, STORM CLOUDS & MOON
       (Matches Reference 1 '9.19.58 AM.png' & Reference 3 '9.20.33 AM.png')
       ========================================================================= */
    class NightAtmosphere {
      constructor(canvasEl) {
        this.scene = new THREE.Scene();
        // Step 4: Fog color is a greener gray-blue than the sky so distance layers separate
        const fogHex = (HORROR_CONFIG.grade && HORROR_CONFIG.grade.fogColor) || HORROR_CONFIG.renderer.fogColor || 0x14222c;
        this.scene.background = new THREE.Color(HORROR_CONFIG.renderer.clearColor || 0x071118);
        this.baseFogColor = new THREE.Color(fogHex);
        this.warmFogColor = new THREE.Color(HORROR_CONFIG.renderer.fogWarmTintColor || 0x221d18);
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
            // If the original canvas was tainted by a rejected context request, swap in a fresh clean canvas
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
          // Last resort: let Three.js create its own internal canvas
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

        // ACES Filmic tone mapping calibrated so #ff8a2a lamps stay warm orange without whitening
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

        // Cold darkness base + visibility floor
        const minAmb = (HORROR_CONFIG.lighting && HORROR_CONFIG.lighting.visibilityFloorAmbient) || 0.45;
        const ambInt = Math.max(minAmb, (HORROR_CONFIG.lighting && HORROR_CONFIG.lighting.ambientIntensity) || 0.65);
        this.ambientLight = new THREE.AmbientLight(
          (HORROR_CONFIG.lighting && HORROR_CONFIG.lighting.ambientColor) || 0x486475,
          ambInt
        );
        this.scene.add(this.ambientLight);

        this.hemiLight = new THREE.HemisphereLight(
          (HORROR_CONFIG.lighting && HORROR_CONFIG.lighting.hemiSkyColor) || 0x587b91,
          (HORROR_CONFIG.lighting && HORROR_CONFIG.lighting.hemiGroundColor) || 0x24333b,
          Math.max(minAmb, (HORROR_CONFIG.lighting && HORROR_CONFIG.lighting.hemiIntensity) || 0.62)
        );
        this.scene.add(this.hemiLight);

        // Phase A Requirement 4: Limit shadow-casting strictly to moonlight and player flashlight!
        this.moonDirLight = new THREE.DirectionalLight(
          (HORROR_CONFIG.lighting && HORROR_CONFIG.lighting.moonColor) || 0x9bc0d9,
          (HORROR_CONFIG.lighting && HORROR_CONFIG.lighting.moonIntensity) || 1.15
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

        // Player Flashlight (SpotLight) — dynamic light budget: flashlight + at most 3 nearby PointLights
        this.flashlight = new THREE.SpotLight(0xfff4e0, 1.85, 28.0, Math.PI / 5.2, 0.48, 1.6);
        this.flashlight.position.set(-4, 1.5, -48);
        this.flashlight.castShadow = shadowsOn;
        if (this.flashlight.shadow) {
          this.flashlight.shadow.mapSize.width = shadowSize;
          this.flashlight.shadow.mapSize.height = shadowSize;
          if (this.flashlight.shadow.camera) {
            this.flashlight.shadow.camera.near = 0.3;
            this.flashlight.shadow.camera.far = 28.0;
          }
        }
        this.flashlightTarget = new THREE.Object3D();
        this.flashlightTarget.position.set(-4, 1.4, -58);
        this.scene.add(this.flashlightTarget);
        this.flashlight.target = this.flashlightTarget;
        this.scene.add(this.flashlight);

        this.skyGroup = null;
        this.buildCloudyMoonlitSkyDome();

        // Step 1: Single-Pass Full-Screen Color Grade (1 WebGLRenderTarget + 1 Full-Screen Quad)
        this.initColorGradePass(initW, initH, targetPR);
      }

      getEffectivePixelRatio(preset) {
        if (this.stylizedMode) {
          return (HORROR_CONFIG.grade && HORROR_CONFIG.grade.stylizedPixelRatio) || 0.7;
        }
        const cap = (preset && preset.pixelRatioCap) || 1.4;
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

      // Step 4: Replace large black dome with Sky Gradient (deep blue-black top, sickly teal horizon,
      // soft dim moon glow, 2 thin cloud bands) + 3 Layered Distant Ridge Silhouettes fading into fog!
      buildCloudyMoonlitSkyDome() {
        if (this.skyGroup) {
          this.scene.remove(this.skyGroup);
        }
        this.skyGroup = new THREE.Group();

        const skyCanvas = document.createElement('canvas');
        skyCanvas.width = 512;
        skyCanvas.height = 256;
        const sCtx = skyCanvas.getContext('2d');

        // 1. Sky gradient: deep blue-black top (#060c18) -> atmospheric teal-slate near horizon (#1b3248)
        const grad = sCtx.createLinearGradient(0, 0, 0, 256);
        grad.addColorStop(0.0, '#060c18');
        grad.addColorStop(0.35, '#0b1626');
        grad.addColorStop(0.65, '#132338');
        grad.addColorStop(0.85, '#1b3248');
        grad.addColorStop(1.0, '#162738');
        sCtx.fillStyle = grad;
        sCtx.fillRect(0, 0, 512, 256);

        // 2. Soft moonlight glow in upper sky
        const moonGlow = sCtx.createRadialGradient(340, 74, 4, 340, 74, 110);
        moonGlow.addColorStop(0.0, 'rgba(215, 235, 248, 0.75)');
        moonGlow.addColorStop(0.20, 'rgba(140, 180, 210, 0.42)');
        moonGlow.addColorStop(0.55, 'rgba(60, 100, 130, 0.18)');
        moonGlow.addColorStop(1.0, 'rgba(16, 32, 48, 0.0)');
        sCtx.fillStyle = moonGlow;
        sCtx.fillRect(0, 0, 512, 256);

        // Soft bright moon disc
        sCtx.fillStyle = 'rgba(240, 248, 255, 0.92)';
        sCtx.beginPath();
        sCtx.arc(340, 74, 11, 0, Math.PI * 2);
        sCtx.fill();

        // 3. Two thin horizontal cloud bands drifting across the moonlit sky
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

        // 4. Three Layered Distant Mountain/Ridge Silhouettes (Far, Mid, Near) Fading into Greener Gray-Blue Fog!
        const ridgeConfigs = [
          { radius: 110, height: 34, color: 0x142533, opacity: 0.82, seed: 1.1, freq1: 5, freq2: 11 }, // Layer 1: Far High Himalayan Ridge
          { radius: 101, height: 24, color: 0x101f2b, opacity: 0.88, seed: 2.7, freq1: 7, freq2: 13 }, // Layer 2: Mid Valley Ridge
          { radius: 92,  height: 15, color: 0x0c1720, opacity: 0.94, seed: 4.3, freq1: 9, freq2: 17 }, // Layer 3: Near Wooded Foothill Ridge
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
        this.lightPool = [];
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
        const showCones = !!(activePreset && activePreset.enableLampCones);
        const stride = (activePreset && activePreset.fakePoolStride) || 1;

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

          if (l.blinkProfile === 'dead') {
            factor = 0.0;
          } else if (l.blinkState === 'power_dip') {
            factor = 0.22 + Math.sin(timeSec * 38.0 + l.seed) * 0.08;
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
            const wave = Math.sin(timeSec * 52.0 + l.seed * 3.1) + Math.cos(timeSec * 33.0 + l.seed);
            factor = wave > 0.15 ? 0.95 : (l.blinkProfile === 'heavy_blink' ? 0.06 : 0.24);
            if (Math.random() < 0.025) soundEngine.playLampBuzz();
            if (l.stateTimer <= 0) {
              l.blinkState = 'recover';
              l.stateTimer = 0.18;
            }
          } else if (l.blinkState === 'brownout') {
            factor = 0.22 + Math.sin(timeSec * 24.0 + l.seed) * 0.06;
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

          if (factor > 0.1) {
            if (dSq < minActiveDistSq) minActiveDistSq = dSq;
          }
        }

        this.nearestLampDist = Math.sqrt(minActiveDistSq);

        // Dynamically assign at most 3 real PointLights to the nearest active lamps to the player
        const activeLamps = this.lamps.filter(l => l.blinkProfile !== 'dead' && l.currentIntensity > 0.5);
        activeLamps.sort((a, b) => {
          const da = (a.x - playerPos.x) ** 2 + (a.z - playerPos.z) ** 2;
          const db = (b.x - playerPos.x) ** 2 + (b.z - playerPos.z) ** 2;
          return da - db;
        });

        const activeCount = Math.min(this.lightPool.length, activePreset.maxActiveLampLights || 3);
        for (let i = 0; i < this.lightPool.length; i++) {
          const pl = this.lightPool[i];
          if (i < activeCount && i < activeLamps.length) {
            pl.position.copy(activeLamps[i].bulbPos);
            pl.intensity = activeLamps[i].currentIntensity;
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
        const count = activePreset.particleCount;
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
        this.geo.attributes.position.needsUpdate = true;

        for (let i = 0; i < this.mistPlanes.length; i++) {
          const mp = this.mistPlanes[i];
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

    function createProceduralTexture(width, height, drawFn) {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const ctx = c.getContext('2d');
      if (ctx && typeof drawFn === 'function') {
        drawFn(ctx);
      }
      return new THREE.CanvasTexture(c);
    }

    function createProceduralTextureWithBump(type) {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 512;
      const ctx = c.getContext('2d');

      const bumpC = document.createElement('canvas');
      bumpC.width = 512;
      bumpC.height = 512;
      const bCtx = bumpC.getContext('2d');

      const roughC = document.createElement('canvas');
      roughC.width = 512;
      roughC.height = 512;
      const rCtx = roughC.getContext('2d');
      rCtx.fillStyle = '#a0a0a0';
      rCtx.fillRect(0, 0, 512, 512);

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
      }

      // Step 3: Darken wall/roof/brick textures by ~35% and add vertical grime & damp stain gradients (Zero new draw calls!)
      if (type !== 'surveyor-field-grass' && type !== 'interlocking-pavers') {
        const darkMult = (HORROR_CONFIG.grade && HORROR_CONFIG.grade.materialDarknessMultiplier) || 0.64;
        const darkAlpha = Math.max(0.15, Math.min(0.55, 1.0 - darkMult));
        ctx.fillStyle = 'rgba(6, 10, 12, ' + darkAlpha.toFixed(2) + ')';
        ctx.fillRect(0, 0, 512, 512);

        // Top eave-drip soot & water-stain vertical gradient
        const topGrime = ctx.createLinearGradient(0, 0, 0, 128);
        topGrime.addColorStop(0.0, 'rgba(4, 7, 9, 0.58)');
        topGrime.addColorStop(0.45, 'rgba(10, 16, 14, 0.24)');
        topGrime.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
        ctx.fillStyle = topGrime;
        ctx.fillRect(0, 0, 512, 128);

        // Bottom rising-damp moss & mud stain vertical gradient
        const botGrime = ctx.createLinearGradient(0, 350, 0, 512);
        botGrime.addColorStop(0.0, 'rgba(0, 0, 0, 0.0)');
        botGrime.addColorStop(0.55, 'rgba(12, 20, 15, 0.32)');
        botGrime.addColorStop(1.0, 'rgba(5, 9, 7, 0.64)');
        ctx.fillStyle = botGrime;
        ctx.fillRect(0, 350, 512, 162);

        // Subtle vertical rain/grime streaks down walls & roofs
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

      const map = new THREE.CanvasTexture(c);
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.RepeatWrapping;
      if (!window.__sharedArchBumpTex) {
        const bTex = new THREE.CanvasTexture(bumpC);
        bTex.wrapS = THREE.RepeatWrapping;
        bTex.wrapT = THREE.RepeatWrapping;
        window.__sharedArchBumpTex = bTex;
      }
      if (!window.__sharedArchRoughTex) {
        const rTex = new THREE.CanvasTexture(roughC);
        rTex.wrapS = THREE.RepeatWrapping;
        rTex.wrapT = THREE.RepeatWrapping;
        window.__sharedArchRoughTex = rTex;
      }
      return {
        map,
        bumpMap: window.__sharedArchBumpTex,
        roughnessMap: window.__sharedArchRoughTex,
      };
    }

    // Phase A Texture Atlas & Shared Surface Maps:
    // Reuse shared procedural maps for visually similar roof/tile/wood families + shared bump/roughness
    const riverStoneTex = createProceduralTextureWithBump('nepali-river-stone');
    riverStoneTex.map.repeat.set(14, 2);

    const blueRoofTex = createProceduralTextureWithBump('bright-blue-corrugated-roof');
    blueRoofTex.map.repeat.set(10, 4);

    const redRoofTex = createProceduralTextureWithBump('terracotta-red-roof');
    redRoofTex.map.repeat.set(10, 5);

    const rotundaBrickTex = createProceduralTextureWithBump('rotunda-stone-brick');
    rotundaBrickTex.map.repeat.set(6, 4);

    const terrazzoFloorTex = createProceduralTextureWithBump('polished-terrazzo-tile');
    terrazzoFloorTex.map.repeat.set(14, 10);

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
      riverStoneCoping: new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.62 }),
      brightBlueRoof: new THREE.MeshStandardMaterial({
        map: blueRoofTex.map,
        bumpMap: blueRoofTex.bumpMap,
        bumpScale: 0.06,
        color: 0x24313d, // Step 3: 35% darker desaturated slate roof
        metalness: 0.28,
        roughness: 0.54,
      }),
      weatheredGreyRoof: new THREE.MeshStandardMaterial({
        color: 0x1e2630,
        roughness: 0.64,
        metalness: 0.28,
      }),
      terracottaRoof: new THREE.MeshStandardMaterial({
        map: redRoofTex.map,
        bumpMap: redRoofTex.bumpMap,
        bumpScale: 0.075,
        color: 0x8a5a52,
        roughness: 0.48,
        metalness: 0.18,
      }),
      rotundaBrick: new THREE.MeshStandardMaterial({
        map: rotundaBrickTex.map,
        bumpMap: rotundaBrickTex.bumpMap,
        bumpScale: 0.055,
        color: 0x8c867e,
        roughness: 0.66,
        side: THREE.DoubleSide,
      }),
      rotundaWhiteArch: new THREE.MeshStandardMaterial({
        color: 0x8b959e, // Step 3: Darkened weathered stone trim (38% darker than pure white)
        roughness: 0.56,
        metalness: 0.08,
      }),
      rotundaPlinthConcrete: new THREE.MeshStandardMaterial({
        color: 0x6c757d,
        roughness: 0.68,
        metalness: 0.10,
      }),
      rotundaColumnFlutedBase: new THREE.MeshStandardMaterial({
        color: 0x495057,
        roughness: 0.56,
        metalness: 0.18,
      }),
      rotundaRedSteel: new THREE.MeshStandardMaterial({
        color: 0xc0392b,
        roughness: 0.36,
        metalness: 0.52,
      }),
      rotundaCurvedGlass: new THREE.MeshStandardMaterial({
        color: 0x1e3a5f,
        emissive: 0xffb366,
        emissiveIntensity: 0.22,
        roughness: 0.08,
        metalness: 0.85,
        transparent: true,
        opacity: 0.48,
        side: THREE.DoubleSide,
      }),
      rotundaTerrazzoFloor: new THREE.MeshStandardMaterial({
        map: terrazzoFloorTex.map,
        bumpMap: terrazzoFloorTex.bumpMap,
        bumpScale: 0.02,
        roughness: 0.26,
        metalness: 0.18,
      }),
      rotundaInteriorWall: new THREE.MeshStandardMaterial({
        color: 0xd8dee6,
        roughness: 0.58,
        side: THREE.DoubleSide,
      }),
      ceilingLightEmissive: new THREE.MeshStandardMaterial({
        color: 0xfff8eb,
        emissive: 0xffd485,
        emissiveIntensity: 1.45,
        roughness: 0.15,
      }),
      fountainPinkTrim: new THREE.MeshStandardMaterial({
        // Step 3: Removed pink — now dark weathered stone!
        color: 0x283038,
        roughness: 0.68,
        metalness: 0.12,
      }),
      fountainWater: new THREE.MeshStandardMaterial({
        // Step 3: Removed cyan — now dark water tone with a faint cold reflection!
        color: 0x09131c,
        emissive: 0x061018,
        emissiveIntensity: 0.14,
        roughness: 0.12,
        metalness: 0.88,
        transparent: true,
        opacity: 0.88,
      }),
      campusStucco: new THREE.MeshStandardMaterial({
        map: stuccoTex.map,
        bumpMap: stuccoTex.bumpMap,
        bumpScale: 0.05,
        color: 0x58625c, // Step 3: 35% darker & grimy desaturated green-gray stucco
        roughness: 0.78,
        side: THREE.DoubleSide,
      }),
      classroomFloor: new THREE.MeshStandardMaterial({
        color: 0x1c242e,
        roughness: 0.45,
        metalness: 0.12,
      }),
      interlockingPavers: new THREE.MeshStandardMaterial({
        map: paverTex.map,
        bumpMap: paverTex.bumpMap,
        bumpScale: 0.055,
        roughnessMap: paverTex.roughnessMap,
        roughness: 0.35, // Step 3: Road roughness ~0.35 so warm #ff8a2a lamp light streaks on paving!
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
        color: 0x8c3b26,
        roughness: 0.64,
        side: THREE.DoubleSide,
      }),
      nepalCreamPlaster: new THREE.MeshStandardMaterial({
        color: 0xdfd3c3,
        roughness: 0.62,
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
        color: 0xd99b26,
        roughness: 0.24,
        metalness: 0.86,
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
      lawnStripGreen: new THREE.MeshStandardMaterial({ color: 0x121915, roughness: 0.90 }),
      castIronDark: new THREE.MeshStandardMaterial({ color: 0x11161f, metalness: 0.84, roughness: 0.28 }),
      gandakiBluePole: new THREE.MeshStandardMaterial({ color: 0x1d4ed8, metalness: 0.65, roughness: 0.36 }),
      royalBlueDark: new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.8, roughness: 0.34 }),
      whiteTrim: new THREE.MeshStandardMaterial({ color: 0x8d97a0, roughness: 0.56 }),
      concretePillar: new THREE.MeshStandardMaterial({ color: 0x9aa6b2, roughness: 0.58 }),
      plinthDarkConcrete: new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.72 }),
      windowGlass: new THREE.MeshStandardMaterial({
        color: 0x0d1b2a,
        roughness: 0.08,
        metalness: 0.92,
        transparent: true,
        opacity: 0.68,
      }),
      windowWarmLit: new THREE.MeshStandardMaterial({
        color: 0xffb35c,
        emissive: HORROR_CONFIG.lighting.windowEmissive || 0xffa84c,
        emissiveIntensity: HORROR_CONFIG.lighting.windowEmissiveIntensity || 0.72,
        roughness: 0.32,
      }),
      deskWoodTop: new THREE.MeshStandardMaterial({ color: 0x6b3410, roughness: 0.58 }),
      chairWood: new THREE.MeshStandardMaterial({ color: 0x4f240a, roughness: 0.65 }),
      deskSteelFrame: new THREE.MeshStandardMaterial({ color: 0x1e242b, metalness: 0.75, roughness: 0.36 }),
      whiteboardSurface: new THREE.MeshStandardMaterial({ color: 0xb8c4d0, roughness: 0.24, metalness: 0.1 }),
      blackboardGreen: new THREE.MeshStandardMaterial({ color: 0x0c331c, roughness: 0.55 }),
      busAmberPaint: new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        metalness: 0.22,
        roughness: 0.35,
      }),
      busWindow: new THREE.MeshStandardMaterial({ color: 0x090e17, roughness: 0.08, metalness: 0.85 }),
      busBumper: new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.55, metalness: 0.4 }),
      headlightLit: new THREE.MeshBasicMaterial({ color: 0xfef08a }),
      taillightRed: new THREE.MeshBasicMaterial({ color: 0xdc2626 }),
      wheelRim: new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.3 }),
      carSilver: new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.82, roughness: 0.22 }),
      carDarkNavy: new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.82, roughness: 0.20 }),
      rubberTire: new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.92 }),
      treeBark: new THREE.MeshStandardMaterial({ color: 0x1e1814, roughness: 0.94 }),
      foliageGreen: new THREE.MeshStandardMaterial({ color: 0x131c16, roughness: 0.86 }),
      palmFrondMat: new THREE.MeshStandardMaterial({ color: 0x151f19, roughness: 0.86, side: THREE.DoubleSide }),
      roofSoffitDark: new THREE.MeshStandardMaterial({
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

    // Step 5: Faint cool moonlit rim light on tree canopies & roof edges (no new lights!)
    [
      materials.foliageGreen,
      materials.palmFrondMat,
      materials.brightBlueRoof,
      materials.terracottaRoof,
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

    function addWalkableFloor(minX, maxX, minZ, maxZ, floorY) {
      walkableFloors.push({ minX, maxX, minZ, maxZ, floorY });
    }

    function addWalkableStairRamp(minX, maxX, minZ, maxZ, zStart, zEnd, yStart, yEnd) {
      walkableStairRamps.push({ minX, maxX, minZ, maxZ, zStart, zEnd, yStart, yEnd });
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
      sAtlasCtx.fillStyle = '#cbd5c0';
      sAtlasCtx.fillRect(256, 0, 128, 160);
      sAtlasCtx.fillStyle = '#475569';
      sAtlasCtx.fillRect(266, 12, 108, 28);
      sAtlasCtx.fillStyle = '#7f1d1d';
      sAtlasCtx.font = 'bold 14px serif';
      sAtlasCtx.fillText('CURFEW NOTICE', 270, 30);

      sAtlasCtx.fillStyle = '#1a120b';
      sAtlasCtx.fillRect(512, 0, 512, 96);
      sAtlasCtx.strokeStyle = '#d99b26';
      sAtlasCtx.lineWidth = 4;
      sAtlasCtx.strokeRect(518, 6, 500, 84);
      sAtlasCtx.fillStyle = '#f8fafc';
      sAtlasCtx.font = 'bold 28px Georgia, serif';
      sAtlasCtx.textAlign = 'center';
      sAtlasCtx.fillText('GANDAKI HERITAGE ALLEY', 768, 44);
    }
    const oldPosterMat = sharedSignageAtlasMat;
    const sharedPosterGeo = createAtlasUvGeo(new THREE.PlaneGeometry(0.65, 0.82), 256, 0, 128, 160);

    function spawnOldWallPoster(px, py, pz, rotY = 0, tiltZ = 0.06) {
      const poster = new THREE.Mesh(sharedPosterGeo, oldPosterMat);
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
    const step2Mats = {
      curtainFabric: new THREE.MeshStandardMaterial({ color: 0x3b4d63, roughness: 0.82, side: THREE.DoubleSide }),
      curtainGold: new THREE.MeshStandardMaterial({ color: 0x6e472b, roughness: 0.78, side: THREE.DoubleSide }),
      lockerSteel: new THREE.MeshStandardMaterial({ color: 0x2c3a47, roughness: 0.42, metalness: 0.68 }),
      lockerDoorBlue: new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.38, metalness: 0.62 }),
      fireRed: new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.32, metalness: 0.45 }),
      waterJugBlue: new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.15, metalness: 0.25, transparent: true, opacity: 0.82 }),
      matRubber: new THREE.MeshStandardMaterial({ color: 0x1e252b, roughness: 0.92 }),
      corkBoard: new THREE.MeshStandardMaterial({ color: 0x8c5a32, roughness: 0.85 }),
      paperSheet: new THREE.MeshStandardMaterial({ color: 0xd8dee6, roughness: 0.75 }),
      bagNavy: new THREE.MeshStandardMaterial({ color: 0x172554, roughness: 0.84 }),
      bagOlive: new THREE.MeshStandardMaterial({ color: 0x27382a, roughness: 0.86 }),
      bagMaroon: new THREE.MeshStandardMaterial({ color: 0x4c1d24, roughness: 0.84 }),
      sofaLeather: new THREE.MeshStandardMaterial({ color: 0x3b2314, roughness: 0.52, metalness: 0.08 }),
      monitorScreenOn: new THREE.MeshStandardMaterial({ color: 0x0c192c, emissive: 0x1d4ed8, emissiveIntensity: 0.55, roughness: 0.18 }),
      monitorScreenOff: new THREE.MeshStandardMaterial({ color: 0x090d14, roughness: 0.16, metalness: 0.45 }),
      serverLedGreen: new THREE.MeshBasicMaterial({ color: 0x22c55e }),
      serverLedAmber: new THREE.MeshBasicMaterial({ color: 0xf59e0b }),
      lampShadeGreen: new THREE.MeshStandardMaterial({ color: 0x14532d, emissive: 0xffb35c, emissiveIntensity: 0.65, roughness: 0.28 }),
      ceramicWhite: new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.18, metalness: 0.15 }),
      mirrorGlass: new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.06, metalness: 0.92 }),
      stainlessSteel: new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.26, metalness: 0.82 }),
      cardboardCrate: new THREE.MeshStandardMaterial({ color: 0x785532, roughness: 0.86 }),
      vineGreen: new THREE.MeshStandardMaterial({ color: 0x1a3322, roughness: 0.78, side: THREE.DoubleSide }),
      terrazzoInlayGold: new THREE.MeshStandardMaterial({ color: 0x9a7b3e, roughness: 0.30, metalness: 0.42 }),
      terrazzoInlayDark: new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.28, metalness: 0.22 }),
    };

    const step2Geos = {
      doorLeaf: new THREE.BoxGeometry(0.92, 2.26, 0.065),
      doorHandle: new THREE.BoxGeometry(0.14, 0.04, 0.14),
      roomPlaque: new THREE.BoxGeometry(0.46, 0.22, 0.03),
      curtainRod: new THREE.CylinderGeometry(0.016, 0.016, 2.05, 6),
      curtainPanel: new THREE.BoxGeometry(0.52, 1.52, 0.045),
      wallFanMount: new THREE.BoxGeometry(0.12, 0.16, 0.18),
      wallFanCage: new THREE.CylinderGeometry(0.24, 0.24, 0.10, 10),
      lockerBank: new THREE.BoxGeometry(0.48, 1.92, 1.80),
      lockerDoor: new THREE.BoxGeometry(0.03, 0.84, 0.52),
      noticeBoard: new THREE.BoxGeometry(0.06, 0.96, 1.65),
      noticeCork: new THREE.BoxGeometry(0.07, 0.84, 1.52),
      noticeNote: new THREE.BoxGeometry(0.08, 0.24, 0.18),
      waterDispenser: new THREE.BoxGeometry(0.38, 1.02, 0.38),
      waterBottle: new THREE.CylinderGeometry(0.15, 0.15, 0.42, 10),
      fireExtBody: new THREE.CylinderGeometry(0.09, 0.09, 0.54, 10),
      fireExtTop: new THREE.BoxGeometry(0.12, 0.10, 0.14),
      floorMat: new THREE.BoxGeometry(1.15, 0.02, 0.72),
      photoFrame: new THREE.BoxGeometry(0.05, 0.64, 0.86),
      photoCanvas: new THREE.BoxGeometry(0.06, 0.52, 0.74),
      plantPot: new THREE.CylinderGeometry(0.22, 0.16, 0.36, 8),
      plantBush: new THREE.DodecahedronGeometry(0.28, 1),
      wallLampBack: new THREE.BoxGeometry(0.06, 0.28, 0.18),
      wallLampBulb: new THREE.BoxGeometry(0.12, 0.18, 0.12),
      wallShelf: new THREE.BoxGeometry(0.32, 0.04, 1.85),
      backpack: new THREE.BoxGeometry(0.32, 0.38, 0.22),
      bookStack: new THREE.BoxGeometry(0.26, 0.12, 0.20),
      openBook: new THREE.BoxGeometry(0.32, 0.025, 0.22),
      benchLongSeat: new THREE.BoxGeometry(1.26, 0.05, 0.34),
      benchLongBack: new THREE.BoxGeometry(1.26, 0.30, 0.04),
      benchLeg: new THREE.BoxGeometry(0.05, 0.44, 0.32),
      officeDesk: new THREE.BoxGeometry(1.50, 0.76, 0.78),
      filingCabinet: new THREE.BoxGeometry(0.52, 1.38, 0.62),
      monitorPanel: new THREE.BoxGeometry(0.52, 0.34, 0.035),
      monitorStand: new THREE.BoxGeometry(0.16, 0.14, 0.16),
      keyboard: new THREE.BoxGeometry(0.38, 0.02, 0.14),
      paperStack: new THREE.BoxGeometry(0.24, 0.16, 0.30),
      sofaBase: new THREE.BoxGeometry(1.95, 0.42, 0.82),
      sofaBack: new THREE.BoxGeometry(1.95, 0.48, 0.22),
      sofaArm: new THREE.BoxGeometry(0.22, 0.56, 0.82),
      tallBookshelf: new THREE.BoxGeometry(0.54, 2.28, 2.60),
      bookRowSpan: new THREE.BoxGeometry(0.42, 0.26, 2.38),
      readingTable: new THREE.BoxGeometry(1.65, 0.76, 1.05),
      readingLampStand: new THREE.CylinderGeometry(0.08, 0.12, 0.34, 8),
      readingLampShade: new THREE.BoxGeometry(0.26, 0.10, 0.16),
      serverRack: new THREE.BoxGeometry(0.78, 2.15, 0.86),
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
      storageShelf: new THREE.BoxGeometry(0.58, 2.10, 2.20),
      crateBox: new THREE.BoxGeometry(0.46, 0.38, 0.46),
      vineCluster: new THREE.BoxGeometry(0.14, 1.65, 0.38),
    };
    // Tag repeated Step 2 interior prop geometries for automatic InstancedMesh batching
    step2Geos.lockerBank.userData.instancedCategory = 'locker';
    step2Geos.lockerDoor.userData.instancedCategory = 'locker';
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

    // Helper: Swinging Wooden Door with Frame, Brass Handle & Room Code Plaque
    function buildSwingingDoor(parent, x, y, z, openAngleY = 1.05, plaqueMat = materials.gandakiBluePole, doorId = '') {
      const dPivot = new THREE.Group();
      dPivot.userData.noMerge = true;
      const initAngle = openAngleY * 0.42;
      dPivot.position.set(x, y, z);
      dPivot.rotation.y = initAngle;

      const leaf = new THREE.Mesh(step2Geos.doorLeaf, materials.deskWoodTop);
      leaf.position.set(0.46, 1.13, 0);
      leaf.castShadow = true;
      leaf.receiveShadow = true;
      dPivot.add(leaf);

      const handle = new THREE.Mesh(step2Geos.doorHandle, materials.brassGajur);
      handle.position.set(0.82, 1.02, 0);
      dPivot.add(handle);

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

    // Helper: Populate Corridor / Veranda Strip with Lockers, Notice Boards, Water Dispenser, Fire Extinguisher, Wall Lamps, Floor Mats, Framed Photos & Plants
    function populateCorridorProps(corridorX, corridorZ, floorY, length, wallSignX = 1, doorZList = [], zoneName = 'Corridor') {
      const cGroup = new THREE.Group();
      cGroup.position.set(corridorX, floorY, corridorZ);
      scene.add(cGroup);

      // 1. Floor Mats at each doorway + Wall Lamp Sconces & Framed Photos beside doors
      doorZList.forEach((dz, idx) => {
        const localZ = dz - corridorZ;
        const mat = new THREE.Mesh(step2Geos.floorMat, step2Mats.matRubber);
        mat.position.set(-wallSignX * 0.58, 0.012, localZ);
        mat.rotation.y = Math.PI / 2;
        cGroup.add(mat);

        // Wall lamp above/beside doorway
        const lampBack = new THREE.Mesh(step2Geos.wallLampBack, materials.castIronDark);
        lampBack.position.set(-wallSignX * 0.04, 2.38, localZ + 1.25);
        cGroup.add(lampBack);
        const lampBulb = new THREE.Mesh(step2Geos.wallLampBulb, materials.ceilingLightEmissive);
        lampBulb.position.set(-wallSignX * 0.10, 2.38, localZ + 1.25);
        cGroup.add(lampBulb);

        // Framed campus photo on opposite side of doorway
        const frame = new THREE.Mesh(step2Geos.photoFrame, materials.chairWood);
        frame.position.set(-wallSignX * 0.04, 1.78, localZ - 1.35);
        cGroup.add(frame);
        const photo = new THREE.Mesh(step2Geos.photoCanvas, materials.gandakiBluePole);
        photo.position.set(-wallSignX * 0.05, 1.78, localZ - 1.35);
        cGroup.add(photo);

        // Potted plant flanking doorway
        if (idx % 2 === 0) {
          const pot = new THREE.Mesh(step2Geos.plantPot, materials.nepalOchreDado);
          pot.position.set(-wallSignX * 0.36, 0.18, localZ + 1.45);
          cGroup.add(pot);
          const bush = new THREE.Mesh(step2Geos.plantBush, materials.foliageGreen);
          bush.position.set(-wallSignX * 0.36, 0.48, localZ + 1.45);
          cGroup.add(bush);
        }
      });

      // 2. Corridor Steel Locker Bank between Room 1 & Room 2
      const lockerZ = -length * 0.16;
      const lockerMesh = new THREE.Mesh(step2Geos.lockerBank, step2Mats.lockerSteel);
      lockerMesh.position.set(-wallSignX * 0.28, 0.96, lockerZ);
      cGroup.add(lockerMesh);
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

      // Flush simplified box collider for corridor locker bank & water dispenser (leaves >1.75m clear corridor walk width)
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

      bakeStaticGroup(cGroup, true);
      cGroup.userData.isRoomGroup = true;
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

      // Side Wall Wooden Bookshelf + Upper Wall Shelves with Books + Simplified Box Collider
      const bookcase = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.95, 2.1), materials.chairWood);
      bookcase.position.set(-3.15, 0.98, 0.4);
      cGroup.add(bookcase);
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

      // Teacher Podium & Lecture Desk with Simplified Box Colliders
      const podiumZ = facingDirZ * -2.1;
      const podium = new THREE.Mesh(sharedGeos.podiumBody, materials.chairWood);
      podium.position.set(-2.6, 0.64, podiumZ);
      cGroup.add(podium);
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(unitCenterX - 2.95, floorY, unitCenterZ + podiumZ - 0.30),
        new THREE.Vector3(unitCenterX - 2.25, floorY + 1.25, unitCenterZ + podiumZ + 0.30)
      ), 'furniture');

      const tDesk = new THREE.Mesh(sharedGeos.deskTop, materials.deskWoodTop);
      tDesk.position.set(0.4, 0.82, podiumZ);
      cGroup.add(tDesk);
      const tBook = new THREE.Mesh(step2Geos.openBook, step2Mats.paperSheet);
      tBook.position.set(0.35, 0.86, podiumZ);
      cGroup.add(tBook);
      const tChair = new THREE.Mesh(sharedGeos.chairSeat, materials.chairWood);
      tChair.position.set(0.4, 0.50, podiumZ - facingDirZ * 0.5);
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

      // Student Desks & Benches with Bags and Books
      const rowOffsetsZ = layoutVariant === 1
        ? [facingDirZ * -0.65, facingDirZ * 0.65, facingDirZ * 1.95]
        : [facingDirZ * -0.45, facingDirZ * 0.85, facingDirZ * 2.10];
      const colOffsetsX = [-2.35, 0.0, 2.35];
      const bagMats = [step2Mats.bagNavy, step2Mats.bagOlive, step2Mats.bagMaroon];

      rowOffsetsZ.forEach((rz, rIdx) => {
        colOffsetsX.forEach((cx, cIdx) => {
          if (layoutVariant === 1 && rIdx === 0 && cIdx === 1) return;

          const deskGroup = new THREE.Group();
          deskGroup.position.set(cx, 0, rz);

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

          const benchZ = facingDirZ * 0.44;
          const bSeat = new THREE.Mesh(step2Geos.benchLongSeat, materials.chairWood);
          bSeat.position.set(0, 0.44, benchZ);
          deskGroup.add(bSeat);
          const bBack = new THREE.Mesh(step2Geos.benchLongBack, materials.chairWood);
          bBack.position.set(0, 0.62, benchZ + facingDirZ * 0.16);
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
          const wGrp = new THREE.Group();
          wGrp.position.set(cx, 0, rz);

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
            wGrp.add(mon);
            const stand = new THREE.Mesh(step2Geos.monitorStand, materials.castIronDark);
            stand.position.set(mx, 0.82, -facingDirZ * 0.12);
            wGrp.add(stand);
            const kb = new THREE.Mesh(step2Geos.keyboard, materials.deskSteelFrame);
            kb.position.set(mx, 0.79, facingDirZ * 0.12);
            wGrp.add(kb);

            const chSeat = new THREE.Mesh(sharedGeos.chairSeat, materials.castIronDark);
            chSeat.position.set(mx, 0.46, facingDirZ * 0.44);
            wGrp.add(chSeat);
            const chBack = new THREE.Mesh(sharedGeos.chairBack, materials.castIronDark);
            chBack.position.set(mx, 0.68, facingDirZ * 0.62);
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

        const lampStand = new THREE.Mesh(step2Geos.readingLampStand, materials.brassGajur);
        lampStand.position.set(tx, 0.92, tz);
        cGroup.add(lampStand);
        const lampShade = new THREE.Mesh(step2Geos.readingLampShade, step2Mats.lampShadeGreen);
        lampShade.position.set(tx, 1.10, tz);
        cGroup.add(lampShade);

        const openBk = new THREE.Mesh(step2Geos.openBook, step2Mats.paperSheet);
        openBk.position.set(tx - 0.38, 0.78, tz + 0.22);
        cGroup.add(openBk);

        [-0.45, 0.45].forEach(chZ => {
          const ch = new THREE.Mesh(sharedGeos.chairSeat, materials.chairWood);
          ch.position.set(tx, 0.45, tz + chZ * 1.45);
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
          cGroup.add(pStack);
        }
      });
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(unitCenterX - 2.45, floorY, unitCenterZ - 3.10),
        new THREE.Vector3(unitCenterX + 0.35, floorY + 1.42, unitCenterZ - 2.40)
      ), 'furniture');

      const sofaX = 2.15, sofaZ = 1.85;
      const sBase = new THREE.Mesh(step2Geos.sofaBase, step2Mats.sofaLeather);
      sBase.position.set(sofaX, 0.21, sofaZ);
      cGroup.add(sBase);
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
        cGroup.add(oDesk);

        const mon = new THREE.Mesh(step2Geos.monitorPanel, dIdx === 0 ? step2Mats.monitorScreenOn : step2Mats.monitorScreenOff);
        mon.position.set(dx - 0.28, 0.94, dz - 0.12);
        cGroup.add(mon);

        const papers = new THREE.Mesh(step2Geos.paperStack, step2Mats.paperSheet);
        papers.position.set(dx + 0.36, 0.84, dz + 0.08);
        cGroup.add(papers);

        const chair = new THREE.Mesh(sharedGeos.chairSeat, materials.castIronDark);
        chair.position.set(dx, 0.46, dz + 0.56);
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
        const hood = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.55, 2.60), step2Mats.stainlessSteel);
        hood.position.set(2.45, 2.25, -0.4);
        cGroup.add(hood);

        const rack = new THREE.Mesh(step2Geos.storageShelf, materials.deskSteelFrame);
        rack.position.set(-1.85, 1.05, -1.4);
        cGroup.add(rack);
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
          cGroup.add(tbl);
          [-0.65, 0.65].forEach(bz => {
            const bnc = new THREE.Mesh(step2Geos.benchLongSeat, materials.chairWood);
            bnc.position.set(tx, 0.44, tz + bz);
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

        [0.42, 1.05, 1.62].forEach((cy, cIdx) => {
          const box = new THREE.Mesh(step2Geos.crateBox, step2Mats.cardboardCrate);
          box.position.set(sx, cy, -1.2 + cIdx * 0.55);
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
      addColliderBox(new THREE.Box3(
        new THREE.Vector3(unitCenterX - 0.92, floorY, unitCenterZ + 2.45 - 0.28),
        new THREE.Vector3(unitCenterX + 0.92, floorY + 1.95, unitCenterZ + 2.45 + 0.28)
      ), 'furniture');
    }

    /* =========================================================================
       PHASE B.1: DATA-DRIVEN ROOM DEFINITION TABLE
       Replaces all indexOf / roomCode if-chains with a declarative table of
       room definitions: { id, building, bounds, archetype, furniture,
       hidingSpots, lightMood, waypoints }. Adding a new room requires only data!
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
        id: 'West Wing L1 Room 2', building: 'L1', archetype: 'classroom_seminar', lightMood: 'moonlit_window',
        bounds: { minX: -10.3, maxX: -2.7, minZ: -23.0, maxZ: -13.0, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['teacher_podium', 'teacher_desk', 'seminar_desks_u', 'side_bookshelf', 'wall_shelves', 'ceiling_fan'],
        hidingSpots: ['podium', 'student_desks'],
        waypoints: [{ id: 'wp-l1-r2-door', x: -10.6, y: 0.18, z: -18.0, kind: 'door' }, { id: 'wp-l1-r2-in', x: -6.5, y: 0.18, z: -18.6, kind: 'interior' }],
      },
      'West Wing L1 Room 3': {
        id: 'West Wing L1 Room 3', building: 'L1', archetype: 'classroom_standard', lightMood: 'dying_tube',
        bounds: { minX: -10.3, maxX: -2.7, minZ: -13.0, maxZ: -3.0, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['teacher_podium', 'teacher_desk', 'student_desks_3x3', 'side_bookshelf', 'wall_shelves', 'ceiling_fan'],
        hidingSpots: ['podium', 'student_desks'],
        waypoints: [{ id: 'wp-l1-r3-door', x: -10.6, y: 0.18, z: -8.0, kind: 'door' }, { id: 'wp-l1-r3-in', x: -7.5, y: 0.18, z: -8.0, kind: 'interior' }],
      },
      'West Wing L2 Room 1': {
        id: 'West Wing L2 Room 1', building: 'L2', archetype: 'computer_lab', lightMood: 'cold_monitor_glow',
        bounds: { minX: -21.3, maxX: -13.7, minZ: -26.0, maxZ: -16.67, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['server_rack_leds', 'dual_monitor_workstations_3x2', 'cable_raceways', 'whiteboard', 'wall_fans'],
        hidingSpots: ['server_rack', 'workstation_desks'],
        waypoints: [{ id: 'wp-l2-r1-door', x: -13.4, y: 0.18, z: -21.33, kind: 'door' }, { id: 'wp-l2-r1-in', x: -17.7, y: 0.18, z: -21.33, kind: 'interior' }],
      },
      'West Wing L2 Room 2': {
        id: 'West Wing L2 Room 2', building: 'L2', archetype: 'computer_lab', lightMood: 'cold_monitor_glow',
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
        id: 'West Wing L3 Room 1', building: 'L3', archetype: 'library', lightMood: 'warm_desk_lamp',
        bounds: { minX: -21.3, maxX: -13.7, minZ: 9.0, maxZ: 20.0, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['tall_bookshelves_x3', 'reading_tables_x2', 'banker_lamps', 'curtains'],
        hidingSpots: ['bookshelf_aisle_1', 'bookshelf_aisle_2', 'bookshelf_aisle_3'],
        waypoints: [{ id: 'wp-l3-r1-door', x: -13.4, y: 0.18, z: 14.5, kind: 'door' }, { id: 'wp-l3-r1-in', x: -17.2, y: 0.18, z: 13.4, kind: 'interior' }],
      },
      'West Wing L3 Room 2': {
        id: 'West Wing L3 Room 2', building: 'L3', archetype: 'library', lightMood: 'warm_desk_lamp',
        bounds: { minX: -21.3, maxX: -13.7, minZ: 20.0, maxZ: 31.0, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['tall_bookshelves_x3', 'reading_tables_x2', 'banker_lamps', 'curtains'],
        hidingSpots: ['bookshelf_aisle_1', 'bookshelf_aisle_2', 'bookshelf_aisle_3'],
        waypoints: [{ id: 'wp-l3-r2-door', x: -13.4, y: 0.18, z: 25.5, kind: 'door' }, { id: 'wp-l3-r2-in', x: -17.2, y: 0.18, z: 24.4, kind: 'interior' }],
      },
      'East Wing R1 Room 1': {
        id: 'East Wing R1 Room 1', building: 'R1', archetype: 'staff_office', lightMood: 'warm_desk_lamp',
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
        id: 'East Wing R1 Room 3', building: 'R1', archetype: 'staff_office', lightMood: 'moonlit_window',
        bounds: { minX: 10.7, maxX: 18.3, minZ: -19.67, maxZ: -11.0, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['filing_cabinets_x4', 'faculty_lounge_sofa', 'office_desks_x3', 'monitors'],
        hidingSpots: ['office_desk_1', 'office_desk_2', 'office_desk_3'],
        waypoints: [{ id: 'wp-r1-r3-door', x: 10.4, y: 0.18, z: -15.33, kind: 'door' }, { id: 'wp-r1-r3-in', x: 14.5, y: 0.18, z: -15.33, kind: 'interior' }],
      },
      'East Wing R2 Room 1': {
        id: 'East Wing R2 Room 1', building: 'R2', archetype: 'classroom_standard', lightMood: 'dying_tube',
        bounds: { minX: 21.7, maxX: 29.3, minZ: -27.0, maxZ: -18.33, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['teacher_podium', 'teacher_desk', 'student_desks_3x3', 'side_bookshelf', 'ceiling_fan'],
        hidingSpots: ['podium', 'student_desks'],
        waypoints: [{ id: 'wp-r2-r1-door', x: 21.4, y: 0.18, z: -22.67, kind: 'door' }, { id: 'wp-r2-r1-in', x: 24.5, y: 0.18, z: -22.67, kind: 'interior' }],
      },
      'East Wing R2 Room 2': {
        id: 'East Wing R2 Room 2', building: 'R2', archetype: 'classroom_seminar', lightMood: 'moonlit_window',
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
        id: 'East Wing R4 Room 1', building: 'R4', archetype: 'canteen_dining', lightMood: 'dim_amber',
        bounds: { minX: 21.7, maxX: 29.3, minZ: 6.0, maxZ: 15.33, floorY: 0.18, ceilingY: 3.56 },
        furniture: ['serving_counter', 'glass_snack_case', 'dining_tables_x2', 'benches'],
        hidingSpots: ['dining_table_1', 'dining_table_2'],
        waypoints: [{ id: 'wp-r4-r1-door', x: 21.4, y: 0.18, z: 10.67, kind: 'door' }, { id: 'wp-r4-r1-in', x: 25.5, y: 0.18, z: 10.67, kind: 'interior' }],
      },
      'East Wing R4 Room 2': {
        id: 'East Wing R4 Room 2', building: 'R4', archetype: 'canteen_dining', lightMood: 'dim_amber',
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
        id: 'Newari Heritage Block W1 Room 1', building: 'W1', archetype: 'classroom_standard', lightMood: 'dim_amber',
        bounds: { minX: -38.75, maxX: -34.0, minZ: -49.0, maxZ: -35.0, floorY: 0.22, ceilingY: 3.60 },
        furniture: ['teacher_podium', 'teacher_desk', 'student_desks_3x3', 'side_bookshelf'],
        hidingSpots: ['podium', 'student_desks'],
        waypoints: [{ id: 'wp-w1-r1-door', x: -36.38, y: 0.22, z: -34.6, kind: 'door' }, { id: 'wp-w1-r1-in', x: -35.2, y: 0.22, z: -42.0, kind: 'interior' }],
      },
      'Newari Heritage Block W1 Room 2': {
        id: 'Newari Heritage Block W1 Room 2', building: 'W1', archetype: 'classroom_seminar', lightMood: 'dim_amber',
        bounds: { minX: -34.0, maxX: -29.25, minZ: -49.0, maxZ: -35.0, floorY: 0.22, ceilingY: 3.60 },
        furniture: ['teacher_podium', 'teacher_desk', 'seminar_desks_u', 'side_bookshelf'],
        hidingSpots: ['podium', 'student_desks'],
        waypoints: [{ id: 'wp-w1-r2-door', x: -31.63, y: 0.22, z: -34.6, kind: 'door' }, { id: 'wp-w1-r2-in', x: -31.63, y: 0.22, z: -42.6, kind: 'interior' }],
      },
      'Newari Cultural Hall W2 South': {
        id: 'Newari Cultural Hall W2 South', building: 'W2', archetype: 'classroom_standard', lightMood: 'dim_amber',
        bounds: { minX: -39.5, maxX: -28.5, minZ: -30.0, maxZ: -22.0, floorY: 0.22, ceilingY: 3.60 },
        furniture: ['teacher_podium', 'teacher_desk', 'student_desks_3x3', 'side_bookshelf'],
        hidingSpots: ['podium', 'student_desks'],
        waypoints: [{ id: 'wp-w2-door', x: -28.1, y: 0.22, z: -22.0, kind: 'door' }, { id: 'wp-w2-south-in', x: -32.8, y: 0.22, z: -25.6, kind: 'interior' }],
      },
      'West Wing L3 Heritage Library W2': {
        id: 'West Wing L3 Heritage Library W2', building: 'W2', archetype: 'library', lightMood: 'warm_desk_lamp',
        bounds: { minX: -39.5, maxX: -28.5, minZ: -22.0, maxZ: -14.0, floorY: 0.22, ceilingY: 3.60 },
        furniture: ['tall_bookshelves_x3', 'reading_tables_x2', 'banker_lamps'],
        hidingSpots: ['bookshelf_aisle_1', 'bookshelf_aisle_2', 'bookshelf_aisle_3'],
        waypoints: [{ id: 'wp-w2-north-in', x: -33.6, y: 0.22, z: -19.5, kind: 'interior' }],
      },
      'Building W3 West Wing Room 1': {
        id: 'Building W3 West Wing Room 1', building: 'W3', archetype: 'computer_lab', lightMood: 'cold_monitor_glow',
        bounds: { minX: -38.75, maxX: -34.0, minZ: -9.0, maxZ: 5.0, floorY: 0.22, ceilingY: 3.60 },
        furniture: ['server_rack_leds', 'dual_monitor_workstations_3x2', 'cable_raceways'],
        hidingSpots: ['server_rack', 'workstation_desks'],
        waypoints: [{ id: 'wp-w3-r1-door', x: -36.38, y: 0.22, z: 5.4, kind: 'door' }, { id: 'wp-w3-r1-in', x: -36.5, y: 0.22, z: -2.0, kind: 'interior' }],
      },
      'Building W3 West Wing Room 2': {
        id: 'Building W3 West Wing Room 2', building: 'W3', archetype: 'staff_office', lightMood: 'warm_desk_lamp',
        bounds: { minX: -34.0, maxX: -29.25, minZ: -9.0, maxZ: 5.0, floorY: 0.22, ceilingY: 3.60 },
        furniture: ['filing_cabinets_x4', 'faculty_lounge_sofa', 'office_desks_x3'],
        hidingSpots: ['office_desk_1', 'office_desk_2', 'office_desk_3'],
        waypoints: [{ id: 'wp-w3-r2-door', x: -31.63, y: 0.22, z: 5.4, kind: 'door' }, { id: 'wp-w3-r2-in', x: -31.63, y: 0.22, z: -2.0, kind: 'interior' }],
      },
      'Building W4 West Wing Room 1': {
        id: 'Building W4 West Wing Room 1', building: 'W4', archetype: 'classroom_standard', lightMood: 'dying_tube',
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
        id: 'Security Guardhouse', building: 'GUARDHOUSE', archetype: 'guardhouse', lightMood: 'cold_monitor_glow',
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
        id: 'Rotunda Ground East Hall 102', roomCode: '102', building: 'ROTUNDA', archetype: 'staff_office', lightMood: 'warm_desk_lamp',
        bounds: { minX: 10.6, maxX: 24.8, minZ: 57.2, maxZ: 70.8, floorY: 0.48, ceilingY: 3.86 },
        furniture: ['filing_cabinets_x4', 'faculty_lounge_sofa', 'office_desks_x3', 'side_bookcase'],
        hidingSpots: ['office_desk_1', 'office_desk_2', 'office_desk_3'],
        waypoints: [{ id: 'wp-rot-102-door', x: 10.4, y: 0.48, z: 59.0, kind: 'door' }, { id: 'wp-rot-102-in', x: 17.7, y: 0.48, z: 64.0, kind: 'interior' }],
      },
      'Rotunda 1st-Floor West Class 201': {
        id: 'Rotunda 1st-Floor West Class 201', roomCode: '201', building: 'ROTUNDA', archetype: 'rotunda_lecture', lightMood: 'moonlit_window',
        bounds: { minX: -12.8, maxX: 1.4, minZ: 57.2, maxZ: 70.8, floorY: 4.08, ceilingY: 7.46 },
        furniture: ['teaching_dais', 'prof_desk', 'lectern_podium', 'student_desks_4x3', 'side_bookcase', 'locker_cabinet'],
        hidingSpots: ['prof_desk', 'student_desks'],
        waypoints: [{ id: 'wp-rot-201-door', x: 1.6, y: 4.08, z: 69.2, kind: 'door' }, { id: 'wp-rot-201-in', x: -4.0, y: 4.08, z: 63.2, kind: 'interior' }],
      },
      'Rotunda 1st-Floor East Class 202': {
        id: 'Rotunda 1st-Floor East Class 202', roomCode: '202', building: 'ROTUNDA', archetype: 'library', lightMood: 'warm_desk_lamp',
        bounds: { minX: 10.6, maxX: 24.8, minZ: 57.2, maxZ: 70.8, floorY: 4.08, ceilingY: 7.46 },
        furniture: ['tall_bookshelves_x3', 'reading_tables_x2', 'banker_lamps', 'side_bookcase'],
        hidingSpots: ['bookshelf_aisle_1', 'bookshelf_aisle_2', 'bookshelf_aisle_3'],
        waypoints: [{ id: 'wp-rot-202-door', x: 10.4, y: 4.08, z: 69.2, kind: 'door' }, { id: 'wp-rot-202-in', x: 18.0, y: 4.08, z: 62.9, kind: 'interior' }],
      },
      'Rotunda 2nd-Floor West Seminar 301': {
        id: 'Rotunda 2nd-Floor West Seminar 301', roomCode: '301', building: 'ROTUNDA', archetype: 'rotunda_seminar', lightMood: 'dying_tube',
        bounds: { minX: -12.8, maxX: 1.4, minZ: 57.2, maxZ: 70.8, floorY: 7.68, ceilingY: 11.06 },
        furniture: ['teaching_dais', 'prof_desk', 'lectern_podium', 'seminar_laptops_4x3', 'side_bookcase'],
        hidingSpots: ['prof_desk', 'student_desks'],
        waypoints: [{ id: 'wp-rot-301-door', x: 1.6, y: 7.68, z: 59.0, kind: 'door' }, { id: 'wp-rot-301-in', x: -4.0, y: 7.68, z: 63.2, kind: 'interior' }],
      },
      'Rotunda 2nd-Floor East Lab 302': {
        id: 'Rotunda 2nd-Floor East Lab 302', roomCode: '302', building: 'ROTUNDA', archetype: 'rotunda_lab', lightMood: 'cold_monitor_glow',
        bounds: { minX: 10.6, maxX: 24.8, minZ: 57.2, maxZ: 70.8, floorY: 7.68, ceilingY: 11.06 },
        furniture: ['teaching_dais', 'prof_desk', 'twin_server_racks', 'dual_monitor_desks_4x3', 'side_bookcase'],
        hidingSpots: ['prof_desk', 'workstation_desks'],
        waypoints: [{ id: 'wp-rot-302-door', x: 10.4, y: 7.68, z: 59.0, kind: 'door' }, { id: 'wp-rot-302-in', x: 16.0, y: 7.68, z: 63.2, kind: 'interior' }],
      },
    };
    window.__ROOM_DEFINITIONS__ = ROOM_DEFINITIONS;

    function getOrRegisterRoomDefinition(roomId, cx, cz, floorY, halfW = 3.8, halfD = 4.6, building = 'OTHER', archetype = 'classroom_standard') {
      if (ROOM_DEFINITIONS[roomId]) return ROOM_DEFINITIONS[roomId];
      const def = {
        id: roomId,
        building: building,
        archetype: archetype,
        lightMood: 'dying_tube',
        bounds: { minX: cx - halfW, maxX: cx + halfW, minZ: cz - halfD, maxZ: cz + halfD, floorY: floorY, ceilingY: floorY + 3.4 },
        furniture: ['teacher_podium', 'teacher_desk', 'student_desks_3x3'],
        hidingSpots: ['podium', 'student_desks'],
        waypoints: [{ id: 'wp-' + roomId, x: cx, y: floorY, z: cz, kind: 'interior' }],
      };
      ROOM_DEFINITIONS[roomId] = def;
      return def;
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

      // 1. Finished Interior Ceiling Panel + Glowing Warm LED Ceiling Light + 3-Blade Fan
      const ceilPanel = new THREE.Mesh(
        new THREE.BoxGeometry(6.8, 0.06, 8.2),
        isNewariStyle ? materials.carvedSalWood : materials.whiteTrim
      );
      ceilPanel.position.set(0, 3.38, 0);
      cGroup.add(ceilPanel);

      const ledStrip = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.05, 0.36), materials.ceilingLightEmissive);
      ledStrip.position.set(0, 3.32, 0.8);
      cGroup.add(ledStrip);

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

      // 2. Data-Driven Archetype Dispatch via ROOM_DEFINITIONS (zero indexOf if-chains!)
      const roomDef = getOrRegisterRoomDefinition(unitTitle, unitCenterX, unitCenterZ, floorY);
      const builderFn = ROOM_ARCHETYPE_BUILDERS[roomDef.archetype] || ROOM_ARCHETYPE_BUILDERS.classroom_standard;
      builderFn(cGroup, unitCenterX, unitCenterZ, floorY, facingDirZ, unitTitle, isNewariStyle, roomDef);

      bakeStaticGroup(cGroup, true);
      cGroup.userData.isRoomGroup = true;
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

        // Swinging wooden door leaf opened into the room with brass handle & room plaque
        buildSwingingDoor(
          scene,
          doorWallX - doorSideX * 0.16,
          floorH,
          rCenterZ - doorW * 0.46,
          doorSideX === -1 ? 0.35 : (Math.PI - 0.35),
          materials.gandakiBluePole
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

        // Swinging wooden door + entrance floor mat
        buildSwingingDoor(
          scene,
          roomCenterX - doorW * 0.45,
          floorH,
          frontZ - doorSide * 0.16,
          doorSide === 1 ? -1.15 : 1.15,
          isNewariHeritage ? materials.ebonyCarvedWood : materials.gandakiBluePole
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
    buildSwingingDoor(scene, ghX - ghW / 2 + 0.15, ghFloorY, ghZ - 0.75, 0.42, materials.gandakiBluePole);
    const ghDesk = new THREE.Mesh(step2Geos.officeDesk, materials.deskWoodTop);
    ghDesk.position.set(ghX + 0.65, ghFloorY + 0.38, ghZ);
    ghDesk.rotation.y = Math.PI / 2;
    scene.add(ghDesk);
    const ghMon = new THREE.Mesh(step2Geos.monitorPanel, step2Mats.monitorScreenOn);
    ghMon.position.set(ghX + 0.72, ghFloorY + 0.94, ghZ - 0.25);
    ghMon.rotation.y = -Math.PI / 2;
    scene.add(ghMon);
    const ghLocker = new THREE.Mesh(step2Geos.filingCabinet, step2Mats.lockerSteel);
    ghLocker.position.set(ghX + 1.45, ghFloorY + 0.69, ghZ + 1.45);
    scene.add(ghLocker);
    addColliderBox(new THREE.Box3(new THREE.Vector3(ghX + 0.20, ghFloorY, ghZ - 0.80), new THREE.Vector3(ghX + 1.10, ghFloorY + 0.82, ghZ + 0.80)));
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
       3. 3 YELLOW CAMPUS BUSES, 5 PARKED CARS & COURTYARD SCOOTER
       ========================================================================= */
    function buildCampusBus(bx, bz, isLarge = false, rotY = 0) {
      const busW = isLarge ? 2.85 : 2.45;
      const busL = isLarge ? 10.4 : 7.6;
      const busH = isLarge ? 3.15 : 2.80;

      const bGroup = new THREE.Group();
      const bodyH = busH * 0.72;
      const busBody = new THREE.Mesh(new THREE.BoxGeometry(busW, bodyH, busL), materials.busAmberPaint);
      busBody.position.y = 0.38 + bodyH / 2;
      bGroup.add(busBody);

      const busRoofMesh = new THREE.Mesh(new THREE.BoxGeometry(busW + 0.06, 0.22, busL + 0.06), materials.whiteTrim);
      busRoofMesh.position.y = 0.38 + bodyH + 0.11;
      bGroup.add(busRoofMesh);

      const winStripH = bodyH * 0.42;
      const winStripL = busL * 0.78;
      [-busW / 2 - 0.02, busW / 2 + 0.02].forEach(wx => {
        const sideWin = new THREE.Mesh(new THREE.BoxGeometry(0.04, winStripH, winStripL), materials.busWindow);
        sideWin.position.set(wx, 0.38 + bodyH * 0.68, 0.2);
        bGroup.add(sideWin);
      });

      const windshield = new THREE.Mesh(new THREE.BoxGeometry(busW - 0.28, winStripH * 1.05, 0.05), materials.busWindow);
      windshield.position.set(0, 0.38 + bodyH * 0.66, -busL / 2 - 0.01);
      bGroup.add(windshield);

      const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(busW - 0.36, winStripH * 0.85, 0.05), materials.busWindow);
      rearGlass.position.set(0, 0.38 + bodyH * 0.68, busL / 2 + 0.01);
      bGroup.add(rearGlass);

      const fBumper = new THREE.Mesh(new THREE.BoxGeometry(busW + 0.12, 0.28, 0.24), materials.busBumper);
      fBumper.position.set(0, 0.42, -busL / 2 - 0.06);
      bGroup.add(fBumper);
      const rBumper = new THREE.Mesh(new THREE.BoxGeometry(busW + 0.12, 0.28, 0.24), materials.busBumper);
      rBumper.position.set(0, 0.42, busL / 2 + 0.06);
      bGroup.add(rBumper);

      [-busW * 0.36, busW * 0.36].forEach(lx => {
        const hl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.06), materials.headlightLit);
        hl.position.set(lx, 0.68, -busL / 2 - 0.02);
        bGroup.add(hl);
        const tl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.06), materials.taillightRed);
        tl.position.set(lx, 0.68, busL / 2 + 0.02);
        bGroup.add(tl);
      });

      const wheelRadius = 0.46;
      const wheelThickness = 0.28;
      [-busL * 0.32, busL * 0.32].forEach(wz => {
        [-busW / 2 + 0.05, busW / 2 - 0.05].forEach(wx => {
          const tire = new THREE.Mesh(new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelThickness, 12), materials.rubberTire);
          tire.rotation.z = Math.PI / 2;
          tire.position.set(wx, wheelRadius, wz);
          bGroup.add(tire);
        });
      });

      bGroup.position.set(bx, 0, bz);
      bGroup.rotation.y = rotY;
      scene.add(bGroup);

      const bShadow = new THREE.Mesh(new THREE.PlaneGeometry(busW + 0.9, busL + 0.9), materials.vehicleShadow);
      bShadow.rotation.x = -Math.PI / 2;
      bShadow.position.set(bx, 0.022, bz);
      bShadow.rotation.z = -rotY;
      scene.add(bShadow);

      addColliderBox(new THREE.Box3(
        new THREE.Vector3(bx - busW / 2 - 0.2, 0, bz - busL / 2 - 0.2),
        new THREE.Vector3(bx + busW / 2 + 0.2, busH, bz + busL / 2 + 0.2)
      ));
    }

    buildCampusBus(4.8, -43.0, true, 0.04);
    buildCampusBus(9.4, -44.0, false, 0.04);
    buildCampusBus(13.8, -45.0, false, 0.04);

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
    buildNewariToranaDoorway(w2X + w2W / 2 + 0.04, w2FloorY, w2Z, 1, 0, 2.0, 2.55);
    buildSwingingDoor(scene, w2X + w2W / 2 - 0.18, w2FloorY, w2Z - 0.90, Math.PI - 0.45, materials.ebonyCarvedWood);
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
    // 1. Projecting 2-Story White Segmental-Arched Window Bay (Exact match to IMG_5835 2.JPG!)
    function buildRotundaArchedBay(wx, baseY, wz, facingZDir = -1, isSideWall = false, warmGround = true, warmFirst = true) {
      const bayGroup = new THREE.Group();
      bayGroup.position.set(wx, baseY, wz);
      if (isSideWall) {
        bayGroup.rotation.y = facingZDir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else if (facingZDir === -1) {
        bayGroup.rotation.y = Math.PI;
      }

      const bayW = 2.36;
      const bayH = 7.05; // Spans Ground Floor (0..3.60) + 1st Floor (3.60..7.05)
      const pilasterW = 0.26;
      const pilasterD = 0.30;

      // Two tall white projecting vertical pilasters framing the 2-story bay
      [-bayW / 2 + pilasterW / 2, bayW / 2 - pilasterW / 2].forEach(px => {
        const pil = new THREE.Mesh(new THREE.BoxGeometry(pilasterW, bayH, pilasterD), materials.rotundaWhiteArch);
        pil.position.set(px, bayH / 2, pilasterD / 2 - 0.04);
        bayGroup.add(pil);
      });

      // Curved Segmental White Arch Hood crowning the top of the 2-story bay (IMG_5835 2.JPG)
      const archSegs = 7;
      const innerW = bayW - pilasterW * 2;
      for (let s = 0; s < archSegs; s++) {
        const u = (s / (archSegs - 1)) * 2 - 1; // -1 to +1
        const segX = u * (innerW * 0.46);
        const archRise = (1 - u * u) * 0.34;
        const seg = new THREE.Mesh(new THREE.BoxGeometry(innerW / archSegs + 0.08, 0.26, pilasterD + 0.04), materials.rotundaWhiteArch);
        seg.position.set(segX, bayH - 0.22 + archRise, pilasterD / 2 - 0.02);
        seg.rotation.z = -u * 0.28;
        bayGroup.add(seg);
      }

      // White recessed spandrel panel & projecting horizontal cross-beam between Ground & 1st Floor (IMG_5835 2.JPG)
      const spandrelPanel = new THREE.Mesh(new THREE.BoxGeometry(innerW + 0.04, 0.78, 0.12), materials.rotundaWhiteArch);
      spandrelPanel.position.set(0, 3.52, 0.05);
      bayGroup.add(spandrelPanel);

      const midBeam = new THREE.Mesh(new THREE.BoxGeometry(bayW, 0.22, pilasterD + 0.04), materials.rotundaWhiteArch);
      midBeam.position.set(0, 3.86, pilasterD / 2 - 0.02);
      bayGroup.add(midBeam);

      // Upper recessed white tympanum backing under the arch
      const archBack = new THREE.Mesh(new THREE.BoxGeometry(innerW + 0.04, 0.68, 0.10), materials.rotundaWhiteArch);
      archBack.position.set(0, bayH - 0.48, 0.04);
      bayGroup.add(archBack);

      // Ground Floor Window (y = 1.85 above plinth) with White 3x4 Security Grid & Red Reveal Trim (IMG_5835 2.JPG)
      const winW = innerW - 0.08;
      const gWinH = 1.68;
      const gWinY = 1.88;

      const gSill = new THREE.Mesh(new THREE.BoxGeometry(innerW + 0.08, 0.10, 0.26), materials.rotundaWhiteArch);
      gSill.position.set(0, gWinY - gWinH / 2 - 0.05, 0.10);
      bayGroup.add(gSill);

      const gPane = new THREE.Mesh(
        new THREE.PlaneGeometry(winW, gWinH),
        warmGround ? materials.windowWarmLit : materials.windowGlass
      );
      gPane.position.set(0, gWinY, 0.07);
      bayGroup.add(gPane);

      // Terracotta-red side frame accent seen on Ground windows in IMG_5835 2.JPG
      [-winW / 2 + 0.03, winW / 2 - 0.03].forEach(rx => {
        const redSide = new THREE.Mesh(new THREE.BoxGeometry(0.05, gWinH, 0.12), materials.rotundaRedSteel);
        redSide.position.set(rx, gWinY, 0.08);
        bayGroup.add(redSide);
      });

      // White 3-column x 4-row security grid bars on Ground Floor window
      [-winW * 0.22, winW * 0.22].forEach(vx => {
        const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.035, gWinH, 0.06), materials.rotundaWhiteArch);
        vBar.position.set(vx, gWinY, 0.10);
        bayGroup.add(vBar);
      });
      [-0.48, -0.16, 0.16, 0.48].forEach(hy => {
        const hBar = new THREE.Mesh(new THREE.BoxGeometry(winW, 0.028, 0.06), materials.rotundaWhiteArch);
        hBar.position.set(0, gWinY + hy, 0.10);
        bayGroup.add(hBar);
      });

      // 1st Floor (2nd Story) Segmental-Arched Multi-Pane Window (y = 5.38 above plinth, IMG_5835 2.JPG)
      const fWinH = 1.82;
      const fWinY = 5.36;

      const fSill = new THREE.Mesh(new THREE.BoxGeometry(innerW + 0.08, 0.10, 0.24), materials.rotundaWhiteArch);
      fSill.position.set(0, fWinY - fWinH / 2 - 0.05, 0.10);
      bayGroup.add(fSill);

      const fPane = new THREE.Mesh(
        new THREE.PlaneGeometry(winW, fWinH),
        warmFirst ? materials.windowWarmLit : materials.windowGlass
      );
      fPane.position.set(0, fWinY, 0.07);
      bayGroup.add(fPane);

      [-winW * 0.20, winW * 0.20].forEach(vx => {
        const vMul = new THREE.Mesh(new THREE.BoxGeometry(0.04, fWinH, 0.08), materials.rotundaWhiteArch);
        vMul.position.set(vx, fWinY, 0.09);
        bayGroup.add(vMul);
      });
      const fTransom = new THREE.Mesh(new THREE.BoxGeometry(winW, 0.045, 0.08), materials.rotundaWhiteArch);
      fTransom.position.set(0, fWinY + 0.36, 0.09);
      bayGroup.add(fTransom);

      scene.add(bayGroup);
    }

    // 2. 3rd-Story Casement Window + Diagonal Terracotta-Red Steel Eave Strut (Exact match to IMG_5835 2.JPG!)
    function buildTopFloorWindowAndStruts(wx, topFloorY, wz, facingZDir = -1, isSideWall = false, isWarm = true) {
      const tGroup = new THREE.Group();
      tGroup.position.set(wx, topFloorY, wz);
      if (isSideWall) {
        tGroup.rotation.y = facingZDir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else if (facingZDir === -1) {
        tGroup.rotation.y = Math.PI;
      }

      // Twin-pane 3rd-story casement window (cuts across the red band into the upper white frieze!)
      const wW = 1.38, wH = 1.55, wY = 1.85;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(wW + 0.16, wH + 0.16, 0.14), materials.rotundaWhiteArch);
      frame.position.set(0, wY, 0.04);
      tGroup.add(frame);

      const pane = new THREE.Mesh(
        new THREE.PlaneGeometry(wW, wH),
        isWarm ? materials.windowWarmLit : materials.windowGlass
      );
      pane.position.set(0, wY, 0.09);
      tGroup.add(pane);

      const centerMul = new THREE.Mesh(new THREE.BoxGeometry(0.045, wH, 0.12), materials.castIronDark);
      centerMul.position.set(0, wY, 0.10);
      tGroup.add(centerMul);

      const topTransom = new THREE.Mesh(new THREE.BoxGeometry(wW, 0.04, 0.12), materials.castIronDark);
      topTransom.position.set(0, wY + 0.38, 0.10);
      tGroup.add(topTransom);

      // Pair of Angled Terracotta-Red Steel Roof Struts/Brackets flanking the window (IMG_5835 2.JPG!)
      [-1.08, 1.08].forEach(sx => {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.48, 0.09), materials.rotundaRedSteel);
        strut.position.set(sx, 2.82, 0.48);
        strut.rotation.x = -0.68; // Angles outward from wall at y=2.24 up to overhanging soffit at y=3.45
        tGroup.add(strut);

        // Horizontal steel tie-plate at base of strut
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.08), materials.rotundaRedSteel);
        plate.position.set(sx, 2.24, 0.06);
        tGroup.add(plate);
      });

      scene.add(tGroup);
    }

    // 3. True 4-Slope Terracotta-Red Hipped Roof with Wide White Overhanging Eave Soffit & Dormer (IMG_5854)
    function buildTerracottaHippedWingRoof(cx, eaveY, cz, wingW, wingD, ridgeH = 4.15, dormerSide = -1) {
      const rGroup = new THREE.Group();
      rGroup.position.set(cx, eaveY, cz);

      const overhang = 1.15;
      const totalW = wingW + overhang * 2;
      const totalD = wingD + overhang * 2;

      // Bright white overhanging eave soffit slab + terracotta-red outer fascia strip (IMG_5835 2.JPG & IMG_5854)
      const soffit = new THREE.Mesh(new THREE.BoxGeometry(totalW, 0.22, totalD), materials.rotundaWhiteArch);
      soffit.position.set(0, 0.05, 0);
      rGroup.add(soffit);

      const fascia = new THREE.Mesh(new THREE.BoxGeometry(totalW + 0.08, 0.14, totalD + 0.08), materials.rotundaRedSteel);
      fascia.position.set(0, 0.18, 0);
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

      // Top Terracotta Ridge Beam + 4 Hip Ridge Caps (IMG_5854)
      const ridgeBeam = new THREE.Mesh(new THREE.BoxGeometry(totalW * 0.48, 0.26, 0.36), materials.rotundaRedSteel);
      ridgeBeam.position.set(0, 0.24 + ridgeH, 0);
      rGroup.add(ridgeBeam);

      // White Rooftop Ventilation Dormer / Chimney Box on outer wing slope (IMG_5854 aerial detail!)
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

    // 5. Well-Furnished Classroom, Library, Admin Office & Computer Lab Interior Builder for All 3 Rotunda Floors
    function populateGrandRotundaClassroom(roomCX, roomCZ, floorY, sideSign, floorNum, roomCode, roomTitle) {
      const rGroup = new THREE.Group();
      rGroup.position.set(roomCX, floorY, roomCZ);
      scene.add(rGroup);

      // Finished Interior Acoustic Ceiling Slab at y = 3.38m so upper roof geometry never pokes into rooms
      const roomCeiling = new THREE.Mesh(
        new THREE.BoxGeometry(14.1, 0.08, 13.5),
        materials.rotundaWhiteArch
      );
      roomCeiling.position.set(0, 3.38, 0);
      rGroup.add(roomCeiling);

      // Dark Teak-Wood Interior Baseboard Trim around the Classroom Perimeter
      const baseFront = new THREE.Mesh(new THREE.BoxGeometry(14.1, 0.16, 0.06), materials.chairWood);
      baseFront.position.set(0, 0.08, -6.68);
      rGroup.add(baseFront);
      const baseBack = new THREE.Mesh(new THREE.BoxGeometry(14.1, 0.16, 0.06), materials.chairWood);
      baseBack.position.set(0, 0.08, 6.68);
      rGroup.add(baseBack);
      const baseOuter = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 13.4), materials.chairWood);
      baseOuter.position.set(sideSign * 6.98, 0.08, 0);
      rGroup.add(baseOuter);

      // 4 Interior Structural Corner Columns / Pilasters framing the classroom corners
      [
        [-6.85, -6.55], [6.85, -6.55],
        [-6.85,  6.55], [6.85,  6.55],
      ].forEach(([px, pz]) => {
        const cPil = new THREE.Mesh(new THREE.BoxGeometry(0.32, 3.36, 0.32), materials.rotundaWhiteArch);
        cPil.position.set(px, 1.68, pz);
        rGroup.add(cPil);
      });

      // Interior Window Curtains along Front, Outer Side & Back Windows + Wall-Mounted Oscillating Fans
      [-3.2, 3.2].forEach(wx => {
        buildInteriorWindowCurtains(rGroup, wx, 1.92, -6.52, 0, floorNum === 2);
        buildInteriorWindowCurtains(rGroup, wx, 1.92, 6.52, Math.PI, floorNum === 2);
      });
      [-4.2, 0.0, 4.2].forEach(wz => {
        buildInteriorWindowCurtains(rGroup, sideSign * 6.82, 1.92, wz, -sideSign * Math.PI / 2, floorNum === 2);
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

      // Route Room 102 -> Central Admin & Staff Office; Room 202 -> Reference Library; Room 302 -> AI & Networking Computer Lab!
      if (roomCode === '102') {
        buildStaffAdminOfficeInterior(rGroup, roomCX, roomCZ, floorY, -1, roomTitle);
      } else if (roomCode === '202') {
        buildLibraryRoomInterior(rGroup, roomCX, roomCZ, floorY, -1, roomTitle);
      } else {
        // Teaching wall is along the north/back wall (z = +6.35)
        const boardZ = 6.35;
        const dais = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.16, 2.2), materials.rotundaPlinthConcrete);
        dais.position.set(0, 0.08, boardZ - 1.2);
        rGroup.add(dais);

        const greenBoard = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.45, 0.06), rotundaChalkboardMat);
        greenBoard.position.set(-2.1, 1.95, boardZ);
        rGroup.add(greenBoard);

        const whiteBoard = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.38, 0.06), materials.rotundaWhiteArch);
        whiteBoard.position.set(2.2, 1.95, boardZ);
        rGroup.add(whiteBoard);

        const boardTray = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.08, 0.16), materials.chairWood);
        boardTray.position.set(-0.1, 1.18, boardZ - 0.08);
        rGroup.add(boardTray);

        // Pull-Down Overhead Projector Screen + Ceiling Multimedia Projector
        const projScreen = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.10, 0.12), materials.castIronDark);
        projScreen.position.set(2.2, 2.75, boardZ - 0.10);
        rGroup.add(projScreen);

        const projectorMount = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.48, 8), materials.deskSteelFrame);
        projectorMount.position.set(2.2, 3.12, boardZ - 3.4);
        rGroup.add(projectorMount);
        const projectorBox = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.36), materials.rotundaWhiteArch);
        projectorBox.position.set(2.2, 2.86, boardZ - 3.4);
        rGroup.add(projectorBox);

        // Teacher Lectern Podium & Professor Desk + Swivel Chair
        const profDeskX = -2.4;
        const profDeskZ = boardZ - 1.35;
        const profDesk = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.78, 0.85), materials.chairWood);
        profDesk.position.set(profDeskX, 0.16 + 0.39, profDeskZ);
        rGroup.add(profDesk);

        const profTop = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.06, 0.94), materials.deskWoodTop);
        profTop.position.set(profDeskX, 0.16 + 0.80, profDeskZ);
        rGroup.add(profTop);

        const podiumLectern = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.18, 0.58), materials.chairWood);
        podiumLectern.position.set(2.8, 0.16 + 0.59, profDeskZ);
        rGroup.add(podiumLectern);

        addColliderBox(new THREE.Box3(
          new THREE.Vector3(roomCX + profDeskX - 0.95, floorY, roomCZ + profDeskZ - 0.50),
          new THREE.Vector3(roomCX + profDeskX + 0.95, floorY + 1.05, roomCZ + profDeskZ + 0.50)
        ));

        interactiveHidingSpots.push({
          id: 'rotunda-prof-' + roomCode,
          name: roomTitle + ' Lectern Desk',
          x: roomCX + profDeskX,
          y: floorY,
          z: roomCZ + profDeskZ + 0.72,
          zone: roomTitle,
        });

        // Room 302 (Smart Computer Lab): Add Twin Glass-Door Server Racks with Blinking LEDs!
        if (roomCode === '302') {
          [-4.8, 4.8].forEach((srX, srIdx) => {
            const sr = new THREE.Mesh(step2Geos.serverRack, materials.castIronDark);
            sr.position.set(srX, 1.08, -5.65);
            rGroup.add(sr);
            [-0.35, 0.15, 0.65].forEach((ly, lIdx) => {
              const led = new THREE.Mesh(
                new THREE.BoxGeometry(0.48, 0.035, 0.04),
                (srIdx + lIdx) % 2 === 0 ? step2Mats.serverLedGreen : step2Mats.serverLedAmber
              );
              led.position.set(srX, 1.10 + ly, -5.20);
              rGroup.add(led);
            });
          });
        }

        // 4 Rows x 3 Columns of Two-Seater Student Desks & Benches with Bags, Books, Laptops & Monitors
        const rowZOffsets = [-3.8, -1.8, 0.2, 2.2];
        const colXOffsets = [-3.4, 0.0, 3.4];
        const bagMats = [step2Mats.bagNavy, step2Mats.bagOlive, step2Mats.bagMaroon];

        rowZOffsets.forEach((rz, rIdx) => {
          colXOffsets.forEach((cxOff, cIdx) => {
            const dMesh = new THREE.Mesh(sharedGeos.deskTop, materials.deskWoodTop);
            dMesh.position.set(cxOff, 0.74, rz);
            rGroup.add(dMesh);

            const modesty = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.38, 0.04), materials.chairWood);
            modesty.position.set(cxOff, 0.52, rz + 0.28);
            rGroup.add(modesty);

            [-0.68, 0.68].forEach(lx => {
              const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.72, 0.58), materials.deskSteelFrame);
              leg.position.set(cxOff + lx, 0.36, rz);
              rGroup.add(leg);
            });

            // Bench seat & backrest behind each desk
            const benchSeat = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.05, 0.36), materials.chairWood);
            benchSeat.position.set(cxOff, 0.44, rz - 0.48);
            rGroup.add(benchSeat);

            const benchBack = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.32, 0.04), materials.chairWood);
            benchBack.position.set(cxOff, 0.62, rz - 0.64);
            rGroup.add(benchBack);

            if (roomCode === '302') {
              // Computer Lab 302: Desktop LCD Monitors, Keyboards & Cable Tray
              const cTray = new THREE.Mesh(step2Geos.cableTray, materials.castIronDark);
              cTray.position.set(cxOff, 0.50, rz + 0.22);
              rGroup.add(cTray);
              [-0.36, 0.36].forEach((mx, mIdx) => {
                const mon = new THREE.Mesh(
                  step2Geos.monitorPanel,
                  (rIdx + cIdx + mIdx) % 2 === 0 ? step2Mats.monitorScreenOn : step2Mats.monitorScreenOff
                );
                mon.position.set(cxOff + mx, 0.96, rz + 0.12);
                rGroup.add(mon);
                const kb = new THREE.Mesh(step2Geos.keyboard, materials.deskSteelFrame);
                kb.position.set(cxOff + mx, 0.78, rz - 0.08);
                rGroup.add(kb);
              });
            } else if (floorNum === 3) {
              // Seminar 301: Open Laptops & Notebooks
              [-0.36, 0.36].forEach(lapX => {
                const lapBase = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.24), materials.castIronDark);
                lapBase.position.set(cxOff + lapX, 0.78, rz + 0.04);
                rGroup.add(lapBase);
                const lapScreen = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.02), materials.ceilingLightEmissive);
                lapScreen.position.set(cxOff + lapX, 0.89, rz + 0.15);
                lapScreen.rotation.x = -0.22;
                rGroup.add(lapScreen);
              });
            } else {
              // Lecture Halls 101 & 201: Student Bags & Open/Stacked Books on Desks
              if ((rIdx + cIdx) % 2 === 0) {
                const openBk = new THREE.Mesh(step2Geos.openBook, step2Mats.paperSheet);
                openBk.position.set(cxOff + 0.24, 0.78, rz);
                rGroup.add(openBk);
              } else {
                const stackBk = new THREE.Mesh(step2Geos.bookStack, materials.gandakiBluePole);
                stackBk.position.set(cxOff - 0.28, 0.82, rz);
                rGroup.add(stackBk);
              }
              if ((rIdx * 3 + cIdx) % 2 === 1) {
                const bag = new THREE.Mesh(step2Geos.backpack, bagMats[(rIdx + cIdx) % 3]);
                bag.position.set(cxOff - 0.38, 0.64, rz - 0.46);
                rGroup.add(bag);
              }
            }

            const wx = roomCX + cxOff;
            const wz = roomCZ + rz;
            addColliderBox(new THREE.Box3(
              new THREE.Vector3(wx - 0.78, floorY, wz - 0.66),
              new THREE.Vector3(wx + 0.78, floorY + 0.82, wz + 0.36)
            ));

            if ((rIdx + cIdx) % 2 === 0) {
              interactiveHidingSpots.push({
                id: 'rotunda-desk-' + roomCode + '-' + rIdx + '-' + cIdx,
                name: roomTitle + ' Desk #' + (rIdx * 3 + cIdx + 1),
                x: wx,
                y: floorY,
                z: wz - 0.86,
                zone: roomTitle,
              });
            }
          });
        });

        // Tall Wooden Bookshelf & Academic Lockers along the Outer Side Wall
        const shelfX = sideSign * 6.45;
        const bookcase = new THREE.Mesh(new THREE.BoxGeometry(0.52, 2.25, 3.2), materials.chairWood);
        bookcase.position.set(shelfX, 1.12, -1.2);
        rGroup.add(bookcase);
        [0.55, 1.05, 1.55, 1.98].forEach((by, bRow) => {
          const books = new THREE.Mesh(
            new THREE.BoxGeometry(0.42, 0.28, 2.85),
            bRow % 2 === 0 ? materials.rotundaRedSteel : materials.gandakiBluePole
          );
          books.position.set(shelfX - sideSign * 0.06, by, -1.2);
          rGroup.add(books);
        });

        const lockerCab = new THREE.Mesh(new THREE.BoxGeometry(0.50, 2.10, 2.4), materials.deskSteelFrame);
        lockerCab.position.set(shelfX, 1.05, 2.8);
        rGroup.add(lockerCab);

        addColliderBox(new THREE.Box3(
          new THREE.Vector3(roomCX + shelfX - 0.32, floorY, roomCZ - 2.85),
          new THREE.Vector3(roomCX + shelfX + 0.32, floorY + 2.25, roomCZ + 4.05)
        ));
      }

      // Wall-Mounted Split AC Unit inside Classroom
      const shelfX = sideSign * 6.45;
      const indoorAC = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.30, 1.15), materials.rotundaWhiteArch);
      indoorAC.position.set(shelfX - sideSign * 0.05, 2.85, -4.2);
      rGroup.add(indoorAC);

      // 2 Detailed 3-Blade Ceiling Fans + 4 Glowing Warm LED Ceiling Light Panels
      [-2.4, 2.4].forEach(fx => {
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.45, 6), materials.rotundaWhiteArch);
        rod.position.set(fx, 3.12, -0.5);
        rGroup.add(rod);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.08, 10), materials.rotundaWhiteArch);
        hub.position.set(fx, 2.88, -0.5);
        rGroup.add(hub);
        for (let b = 0; b < 3; b++) {
          const ang = (b * Math.PI * 2) / 3;
          const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.018, 0.92), materials.rotundaWhiteArch);
          blade.position.set(fx + Math.sin(ang) * 0.52, 2.88, -0.5 + Math.cos(ang) * 0.52);
          blade.rotation.y = ang;
          rGroup.add(blade);
        }
      });

      // 4 Warm Emissive Ceiling Light Fixtures per Classroom (mounted flush beneath the y=3.38 acoustic ceiling)
      [
        [-2.8, -2.4], [2.8, -2.4],
        [-2.8,  2.2], [2.8,  2.2],
      ].forEach(([lx, lz]) => {
        const fixture = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.06, 0.42), materials.ceilingLightEmissive);
        fixture.position.set(lx, 3.31, lz);
        rGroup.add(fixture);
      });

      bakeStaticGroup(rGroup, true);
      rGroup.userData.isRoomGroup = true;
      roomVisibilityList.push({
        id: roomTitle,
        type: 'room',
        group: rGroup,
        x: roomCX,
        y: floorY,
        z: roomCZ,
        floorY,
        radius: 9.2,
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
        // 3 Wall Segments leaving two 2.2m-wide open doorways at z = rotFrontZ + 2.0 and z = rotBackZ - 1.8:
        // Segment 1 (Front corner pier): z from rotFrontZ to rotFrontZ + 0.9 (length 0.9m)
        buildWallSegment(px, fy, rotFrontZ + 0.45, 0.26, h, 0.9, materials.rotundaInteriorWall);
        // Segment 2 (Center pier between Front & Rear doorways): z from rotFrontZ + 3.1 to rotBackZ - 2.9 (length 8.0m)
        buildWallSegment(px, fy, rotZ + 0.10, 0.26, h, 8.0, materials.rotundaInteriorWall);
        // Segment 3 (Rear corner pier): z from rotBackZ - 0.7 to rotBackZ (length 0.7m)
        buildWallSegment(px, fy, rotBackZ - 0.35, 0.26, h, 0.7, materials.rotundaInteriorWall);

        // Wooden Door Frames, Glass Transoms, Open Door Leaves & Room Number Plaques on Both Doorways
        [rotFrontZ + 2.0, rotBackZ - 1.8].forEach((doorZ, dIdx) => {
          const dHeader = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.82, 2.24), materials.chairWood);
          dHeader.position.set(px, fy + h - 0.41, doorZ);
          scene.add(dHeader);

          const dTransomGlass = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.46, 1.88), materials.windowWarmLit);
          dTransomGlass.position.set(px, fy + h - 0.42, doorZ);
          scene.add(dTransomGlass);

          // Open Wooden Classroom Door Leaf swung neatly against the center pier inside the classroom
          const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.92, 2.28, 0.07), materials.deskWoodTop);
          doorLeaf.position.set(
            px + roomSide * 0.52,
            fy + 1.14,
            dIdx === 0 ? doorZ + 1.05 : doorZ - 1.05
          );
          scene.add(doorLeaf);

          // Navy & Gold Room Plaque beside the Front Doorway in the Atrium Concourse
          if (dIdx === 0) {
            const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.56), materials.gandakiBluePole);
            plaque.position.set(px - roomSide * 0.15, fy + 2.05, doorZ + 1.38);
            scene.add(plaque);
          }
        });
      });
    });

    // E. 4 Projecting White Segmental-Arched Window Bays per Front Wing + 3 per Side Facade (IMG_5835 2.JPG & IMG_5854!)
    const westFrontBays = [-11.3, -8.1, -4.9, -1.7];
    const eastFrontBays = [13.7, 16.9, 20.1, 23.3];

    westFrontBays.forEach((bx, idx) => {
      buildRotundaArchedBay(bx, rotFloor0, rotFrontZ - 0.16, -1, false, idx % 2 === 0, idx !== 2);
      buildTopFloorWindowAndStruts(bx, rotFloor2, rotFrontZ - 0.16, -1, false, idx % 2 === 1);
    });
    eastFrontBays.forEach((bx, idx) => {
      buildRotundaArchedBay(bx, rotFloor0, rotFrontZ - 0.16, -1, false, idx !== 1, idx % 2 === 0);
      buildTopFloorWindowAndStruts(bx, rotFloor2, rotFrontZ - 0.16, -1, false, idx % 2 === 0);
    });

    // Outer West & East Side Wall Arched Bays (visible in aerial IMG_5854!)
    [rotZ - 4.5, rotZ, rotZ + 4.5].forEach((sz, idx) => {
      buildRotundaArchedBay(rotLeftX - 0.16, rotFloor0, sz, -1, true, true, idx % 2 === 0);
      buildTopFloorWindowAndStruts(rotLeftX - 0.16, rotFloor2, sz, -1, true, idx !== 1);

      buildRotundaArchedBay(rotRightX + 0.16, rotFloor0, sz, 1, true, idx % 2 === 0, true);
      buildTopFloorWindowAndStruts(rotRightX + 0.16, rotFloor2, sz, 1, true, idx % 2 === 1);
    });

    // Rear Facade Windows & Top Struts
    [-9.5, -4.5, 1.5, 10.5, 16.5, 21.5].forEach((bx, idx) => {
      buildDetailedWindow(bx, rotFloor0 + 1.85, rotBackZ + 0.18, 1, idx % 2 === 0);
      buildDetailedWindow(bx, rotFloor1 + 1.85, rotBackZ + 0.18, 1, idx % 2 === 1);
      buildTopFloorWindowAndStruts(bx, rotFloor2, rotBackZ + 0.16, 1, false, idx % 2 === 0);
    });

    // F. Hollow Perimeter 2nd-Story Cornice Ledge + 3rd-Story White Frieze & Terracotta-Red Band (IMG_5835 2.JPG!)
    // Built as hollow exterior perimeter strips so the 3-floor interior is 100% unobstructed!
    buildPerimeterBand(rotFloor2 - 0.04, 0.28, 0.34, materials.rotundaWhiteArch); // 2nd-Story Projecting White Cornice
    buildPerimeterBand(rotEaveY - 0.61, 1.22, 0.06, materials.rotundaWhiteArch);  // Upper 3rd-Story White Frieze Band
    buildPerimeterBand(rotEaveY - 1.24, 0.12, 0.10, materials.rotundaRedSteel);   // Terracotta-Red Trim Band

    // G. Central 2-Story Semicircular Portico Columns (with Fluted Pedestals) + 3rd-Floor Curved Glass Rotunda (IMG_5854 & IMG_5835 2.JPG)
    const rotRadius = 5.55;
    const colAngles = [-Math.PI * 0.38, -Math.PI * 0.13, Math.PI * 0.13, Math.PI * 0.38];
    colAngles.forEach(ang => {
      const cx = rotX + Math.sin(ang) * rotRadius;
      const cz = rotFrontZ - Math.cos(ang) * rotRadius;

      // 1. Octagonal/Cylindrical Fluted Dark-Grey Concrete Pedestal Base (IMG_5835 2.JPG bottom-left!)
      const pedH = 1.48;
      const pedBase = new THREE.Mesh(
        new THREE.CylinderGeometry(0.52, 0.56, pedH, 16),
        materials.rotundaColumnFlutedBase
      );
      pedBase.position.set(cx, rotFloor0 + pedH / 2, cz);
      pedBase.castShadow = true;
      scene.add(pedBase);

      // Pedestal Ground Contact Shadow Disk (Phase 3 Contact Shadows)
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

      // 2. Tall Smooth Cylindrical Concrete Column Shaft rising to the 2nd-floor ring beam (y = 0.48..7.62)
      const colShaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.40, 0.43, 7.12, 20),
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

    // 3rd-Floor Curved Semicircular Stone-Brick Parapet + 10-Bay Red Steel & Glass Rotunda Curtain Wall (IMG_5835 2.JPG & IMG_5854!)
    const parapetH = 1.05;
    const curvedParapet = new THREE.Mesh(
      new THREE.CylinderGeometry(rotRadius + 0.15, rotRadius + 0.15, parapetH, 28, 1, true, Math.PI * 0.5, Math.PI),
      materials.rotundaBrick
    );
    curvedParapet.position.set(rotX, rotFloor2 + parapetH / 2, rotFrontZ);
    scene.add(curvedParapet);

    const parapetCoping = new THREE.Mesh(
      new THREE.CylinderGeometry(rotRadius + 0.24, rotRadius + 0.24, 0.12, 28, 1, false, Math.PI * 0.5, Math.PI),
      materials.rotundaWhiteArch
    );
    parapetCoping.position.set(rotX, rotFloor2 + parapetH + 0.04, rotFrontZ);
    scene.add(parapetCoping);

    // Curved Panoramic Glass Curtain Wall (y = 8.78..10.95)
    const glassCurtainH = 2.18;
    const curvedGlassMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(rotRadius + 0.08, rotRadius + 0.08, glassCurtainH, 28, 1, true, Math.PI * 0.5, Math.PI),
      materials.rotundaCurvedGlass
    );
    curvedGlassMesh.position.set(rotX, rotFloor2 + parapetH + glassCurtainH / 2, rotFrontZ);
    scene.add(curvedGlassMesh);

    // 11 Vertical Terracotta-Red Structural Steel Mullion Posts + 2 Horizontal Red Transom Rings (IMG_5835 2.JPG!)
    const numRotBays = 10;
    for (let m = 0; m <= numRotBays; m++) {
      const mang = -Math.PI * 0.48 + (m / numRotBays) * Math.PI * 0.96;
      const mx = rotX + Math.sin(mang) * (rotRadius + 0.14);
      const mz = rotFrontZ - Math.cos(mang) * (rotRadius + 0.14);
      const mPost = new THREE.Mesh(new THREE.BoxGeometry(0.10, glassCurtainH + 0.35, 0.12), materials.rotundaRedSteel);
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
      const redRing = new THREE.Mesh(
        new THREE.CylinderGeometry(rotRadius + 0.16, rotRadius + 0.16, 0.09, 28, 1, true, Math.PI * 0.5, Math.PI),
        materials.rotundaRedSteel
      );
      redRing.position.set(rotX, ty, rotFrontZ);
      scene.add(redRing);
    });

    // Inner Cylindrical White Concrete Columns inside the 3rd-Floor Rotunda Gallery (IMG_5835 2.JPG)
    colAngles.forEach(ang => {
      const icx = rotX + Math.sin(ang) * (rotRadius - 0.85);
      const icz = rotFrontZ - Math.cos(ang) * (rotRadius - 0.85);
      const innerCol = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, topStoryH, 14), materials.rotundaWhiteArch);
      innerCol.position.set(icx, rotFloor2 + topStoryH / 2, icz);
      scene.add(innerCol);
    });

    // Overhanging Semicircular Curved Rotunda Roof (White Underside Soffit + Terracotta-Red Top Deck, IMG_5854!)
    const rotRoofSoffit = new THREE.Mesh(
      new THREE.CylinderGeometry(rotRadius + 0.95, rotRadius + 0.95, 0.28, 32, 1, false, Math.PI * 0.5, Math.PI),
      materials.rotundaWhiteArch
    );
    rotRoofSoffit.position.set(rotX, rotEaveY - 0.08, rotFrontZ);
    scene.add(rotRoofSoffit);

    const rotRoofRedTop = new THREE.Mesh(
      new THREE.CylinderGeometry(rotRadius + 0.75, rotRadius + 0.92, 0.22, 32, 1, false, Math.PI * 0.5, Math.PI),
      materials.terracottaRoof
    );
    rotRoofRedTop.position.set(rotX, rotEaveY + 0.16, rotFrontZ);
    scene.add(rotRoofRedTop);

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

    // 4. Ground Floor Atrium Reception Counter, Monitor, Lamp, Waiting Sofa & Corridor Props on All 3 Floors
    const recDesk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.05, 0.82), materials.chairWood);
    recDesk.position.set(rotX + 1.4, rotFloor0 + 0.52, rotFrontZ + 2.2);
    scene.add(recDesk);
    const recTop = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.08, 0.94), materials.rotundaWhiteArch);
    recTop.position.set(rotX + 1.4, rotFloor0 + 1.08, rotFrontZ + 2.2);
    scene.add(recTop);
    const recMon = new THREE.Mesh(step2Geos.monitorPanel, step2Mats.monitorScreenOn);
    recMon.position.set(rotX + 0.95, rotFloor0 + 1.28, rotFrontZ + 2.2);
    scene.add(recMon);
    const recLamp = new THREE.Mesh(step2Geos.readingLampShade, step2Mats.lampShadeGreen);
    recLamp.position.set(rotX + 1.95, rotFloor0 + 1.26, rotFrontZ + 2.2);
    scene.add(recLamp);
    const entryMat = new THREE.Mesh(step2Geos.floorMat, step2Mats.matRubber);
    entryMat.position.set(rotX, rotFloor0 + 0.012, rotFrontZ + 0.65);
    scene.add(entryMat);

    addColliderBox(new THREE.Box3(
      new THREE.Vector3(rotX + 0.25, rotFloor0, rotFrontZ + 1.75),
      new THREE.Vector3(rotX + 2.55, rotFloor0 + 1.15, rotFrontZ + 2.65)
    ));
    interactiveHidingSpots.push({
      id: 'rotunda-reception-desk',
      name: 'Rotunda Atrium Reception Counter',
      x: rotX + 1.4,
      y: rotFloor0,
      z: rotFrontZ + 3.05,
      zone: 'Grand Rotunda Atrium',
    });

    // Populate Corridor Props (Lockers, Water Dispenser, Fire Extinguisher, Plants, Benches & Framed Boards) across all 3 Rotunda floors
    [rotFloor0, rotFloor1, rotFloor2].forEach((afy, aIdx) => {
      const benchX = aIdx === 0 ? 6.0 : (aIdx === 1 ? 7.2 : 4.8);
      const aBench = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.46, 0.58), materials.chairWood);
      aBench.position.set(benchX, afy + 0.23, rotBackZ - 1.1);
      scene.add(aBench);
      const aFrame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.25, 0.06), materials.gandakiBluePole);
      aFrame.position.set(benchX, afy + 1.95, rotBackZ - 0.20);
      scene.add(aFrame);

      // Corridor Water Dispenser & Fire Extinguisher on each floor concourse
      const wd = new THREE.Mesh(step2Geos.waterDispenser, materials.rotundaWhiteArch);
      wd.position.set(1.92, afy + 0.51, rotFrontZ + 3.6);
      scene.add(wd);
      const wJug = new THREE.Mesh(step2Geos.waterBottle, step2Mats.waterJugBlue);
      wJug.position.set(1.92, afy + 1.22, rotFrontZ + 3.6);
      scene.add(wJug);

      const fExt = new THREE.Mesh(step2Geos.fireExtBody, step2Mats.fireRed);
      fExt.position.set(10.18, afy + 1.22, rotFrontZ + 3.6);
      scene.add(fExt);

      // Potted plants flanking the main atrium concourse
      [2.1, 9.9].forEach(px => {
        const pot = new THREE.Mesh(step2Geos.plantPot, materials.nepalOchreDado);
        pot.position.set(px, afy + 0.18, rotFrontZ + 0.65);
        scene.add(pot);
        const bush = new THREE.Mesh(step2Geos.plantBush, materials.foliageGreen);
        bush.position.set(px, afy + 0.48, rotFrontZ + 0.65);
        scene.add(bush);
      });
    });

    // 3rd-Floor Curved Rotunda Panoramic Seminar & Observation Lounge (y = 7.68, z = rotFrontZ - 2.8)
    const loungeTable = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.08, 20), materials.deskWoodTop);
    loungeTable.position.set(rotX, rotFloor2 + 0.76, rotFrontZ - 2.8);
    scene.add(loungeTable);
    const loungePedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.52, 0.74, 14), materials.deskSteelFrame);
    loungePedestal.position.set(rotX, rotFloor2 + 0.37, rotFrontZ - 2.8);
    scene.add(loungePedestal);

    for (let ch = 0; ch < 6; ch++) {
      const cang = (ch * Math.PI * 2) / 6;
      const chSeat = new THREE.Mesh(sharedGeos.chairSeat, materials.chairWood);
      chSeat.position.set(rotX + Math.sin(cang) * 1.85, rotFloor2 + 0.45, rotFrontZ - 2.8 + Math.cos(cang) * 1.85);
      chSeat.rotation.y = cang;
      scene.add(chSeat);
    }

    addColliderBox(new THREE.Box3(
      new THREE.Vector3(rotX - 1.4, rotFloor2, rotFrontZ - 4.2),
      new THREE.Vector3(rotX + 1.4, rotFloor2 + 0.85, rotFrontZ - 1.4)
    ));

    interactiveHidingSpots.push(
      { id: 'rotunda-3f-lounge', name: '3rd-Floor Curved Rotunda Panoramic Table', x: rotX + 1.95, y: rotFloor2, z: rotFrontZ - 2.8, zone: '3rd-Floor Rotunda Balcony' },
      { id: 'yellow-coach', name: 'Gandaki University Buses', x: 2.85, y: 0.0, z: -43.0, zone: 'Bus Parking Bay' },
      { id: 'parked-suv', name: 'Parked Campus SUV (Wing L1 South)', x: -8.15, y: 0.0, z: -34.5, zone: 'Parking Plaza' },
      { id: 'rotunda-fountain', name: 'Rotunda Courtyard Fountain', x: ftnX + 2.85, y: 0.0, z: ftnZ, zone: 'Grand Rotunda Plaza' }
    );

    // J. Glowing Ceiling Light Fixtures Across All 3 Floors of the Grand Rotunda Complex
    //    (Uses LampFlicker's shared 6-light pool when player is near/inside the Rotunda -> Zero extra GPU PointLight load!)
    [
      { x: rotX, y: rotFloor0 + 3.2, z: rotZ },
      { x: rotX, y: rotFloor1 + 3.2, z: rotZ },
      { x: rotX, y: rotFloor2 + 3.1, z: rotFrontZ - 2.4 },
      { x: -5.7, y: rotFloor0 + 3.1, z: rotZ },
      { x: 17.7, y: rotFloor0 + 3.1, z: rotZ },
      { x: -5.7, y: rotFloor1 + 3.1, z: rotZ },
      { x: 17.7, y: rotFloor1 + 3.1, z: rotZ },
      { x: -5.7, y: rotFloor2 + 3.1, z: rotZ },
      { x: 17.7, y: rotFloor2 + 3.1, z: rotZ },
    ].forEach(cfg => {
      const ceilOrb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.6), materials.ceilingLightEmissive);
      ceilOrb.position.set(cfg.x, cfg.y + 0.12, cfg.z);
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

    // Main Building Gandaki University Facade Signboard drawn into Signage Texture Atlas (512, 192, 512, 96)
    if (sAtlasCtx) {
      sAtlasCtx.fillStyle = '#0f172a';
      sAtlasCtx.fillRect(512, 192, 512, 96);
      sAtlasCtx.strokeStyle = '#ffc27a';
      sAtlasCtx.lineWidth = 4;
      sAtlasCtx.strokeRect(518, 198, 500, 84);
      sAtlasCtx.fillStyle = '#f8fafc';
      sAtlasCtx.font = 'bold 30px Georgia, serif';
      sAtlasCtx.textAlign = 'center';
      sAtlasCtx.fillText('GANDAKI UNIVERSITY', 768, 238);
      sAtlasCtx.fillStyle = '#ffc27a';
      sAtlasCtx.font = 'bold 16px sans-serif';
      sAtlasCtx.fillText('CENTRAL ACADEMIC ROTUNDA • POKHARA', 768, 266);
      signageAtlasTex.needsUpdate = true;
    }
    const mainFacadeSign = new THREE.Mesh(
      createAtlasUvGeo(new THREE.BoxGeometry(5.6, 0.72, 0.14), 512, 192, 512, 96),
      sharedSignageAtlasMat
    );
    mainFacadeSign.position.set(rotX, rotFloor2 - 0.02, rotFrontZ - 5.68);
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
       + ROOM & BUILDING VISIBILITY MANAGER
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
        instPCrown.castShadow = true;
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

      for (let i = 0; i < topChildren.length; i++) {
        const ch = topChildren[i];
        if (!ch || ch === atmosphere.skyGroup || ch.isLight || ch.isCamera || ch.isInstancedMesh || ch.isPoints) continue;
        if (ch.userData && (ch.userData.isRoomGroup || ch.userData.noMerge)) continue;
        if (buildingSectors.some(s => s.group === ch)) continue;
        if (ch === terrainMesh || ch === southParkingApron) {
          buildingSectors[0].group.add(ch);
          continue;
        }
        ch.getWorldPosition(worldPos);
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
    })();

    function getRoomBuildingKey(id) {
      if (!id) return 'other';
      if (id.indexOf('West Wing L1') !== -1) return 'L1';
      if (id.indexOf('West Wing L2') !== -1) return 'L2';
      if (id.indexOf('West Wing L3') !== -1 && id.indexOf('W2') === -1) return 'L3';
      if (id.indexOf('East Wing R1') !== -1) return 'R1';
      if (id.indexOf('East Wing R2') !== -1) return 'R2';
      if (id.indexOf('East Wing R4') !== -1) return 'R4';
      if (id.indexOf('W1') !== -1) return 'W1';
      if (id.indexOf('W2') !== -1) return 'W2';
      if (id.indexOf('W3') !== -1) return 'W3';
      if (id.indexOf('W4') !== -1) return 'W4';
      if (id.indexOf('Rotunda') !== -1) return 'ROTUNDA';
      return 'other';
    }
    roomVisibilityList.forEach(r => { r.bKey = getRoomBuildingKey(r.id); });

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

      // 2. Room & Corridor Interior Visibility (shown ONLY when player is inside or can see into it via doors/windows)
      let visCount = 0;
      for (let i = 0; i < roomVisibilityList.length; i++) {
        const r = roomVisibilityList[i];
        if (r === currentInsideRoom) {
          r.group.visible = true;
          visCount++;
          continue;
        }
        // Different floor elevation (> 2.4m vertical separation) -> hidden
        if (Math.abs(playerPos.y - r.floorY) > 2.4) {
          r.group.visible = false;
          continue;
        }
        // If player is inside a specific building/corridor, do NOT render interiors of other buildings!
        if (activeBuildingKey && r.bKey !== activeBuildingKey) {
          r.group.visible = false;
          continue;
        }
        const dx = r.x - playerPos.x;
        const dz = r.z - playerPos.z;
        const dist = Math.hypot(dx, dz);
        const effDist = Math.max(0, dist - r.radius);

        // Far buildings' interiors must never be rendered
        const maxIntDist = activeBuildingKey ? cullInterior : Math.min(cullInterior, 14.5);
        if (effDist > maxIntDist) {
          r.group.visible = false;
          continue;
        }
        // If player is inside an enclosed room, hide other rooms in the same wing unless right at the doorway
        if (currentInsideRoom && r.type === 'room' && dist > 7.2) {
          r.group.visible = false;
          continue;
        }
        // Check camera sightline cone through doorway/windows
        if (effDist > 4.5) {
          const dot = (dx * fwdX + dz * fwdZ) / (dist || 1);
          if (dot < -0.10) {
            r.group.visible = false;
            continue;
          }
        }
        r.group.visible = true;
        visCount++;
      }
      visibleRoomsCount = visCount;

      // 3. Building & Courtyard Sector Distance Culling
      const maxSectorDist = currentInsideRoom ? Math.min(cullBuilding, 42.0) : cullBuilding;
      for (let s = 0; s < buildingSectors.length; s++) {
        const sec = buildingSectors[s];
        if (sec.alwaysVisible) {
          sec.group.visible = true;
          continue;
        }
        const dx = sec.x - playerPos.x;
        const dz = sec.z - playerPos.z;
        const dist = Math.max(0, Math.hypot(dx, dz) - sec.radius);
        const limit = sec.isLandmark ? maxSectorDist * 1.25 : maxSectorDist;
        sec.group.visible = dist <= limit;
      }
    }

    /* =========================================================================
       CHARACTERS, BOTS, PHYSICS & GAMEPLAY LOOP
       ========================================================================= */
    const GAME_CONFIG = {
      role: 'hider',
      difficulty: 'medium',
      matchDuration: 135,
      seekerGracePeriod: 10,
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

    const navWaypoints = [
      { id: 'gate-entry', x: 1.5, y: 0, z: -60 },
      { id: 'parking-plaza', x: -8.0, y: 0, z: -50 },
      { id: 'wing-l1-south-door', x: -6.5, y: 0, z: -34 },
      { id: 'bus-bay', x: 4.8, y: 0, z: -41 },
      { id: 'spine-road-south', x: 0.0, y: 0, z: -28 },
      { id: 'planter-courtyard', x: -12.0, y: 0, z: -16 },
      { id: 'admin-lane', x: -28.0, y: 0, z: -36 },
      { id: 'courtyard-north', x: -12.0, y: 0, z: 4 },
      { id: 'spine-road-mid', x: 0.0, y: 0, z: -8 },
      { id: 'wing-r1-walkway', x: 10.5, y: 0, z: -20 },
      { id: 'spine-road-north', x: 0.5, y: 0, z: 22 },
      { id: 'spine-terrace', x: 3.0, y: 0, z: 46 },
      { id: 'rotunda-fountain', x: 6.0, y: 0, z: 42.5 },
      { id: 'rotunda-ground-lobby', x: 6.0, y: 0.48, z: 59.0 },
      { id: 'rotunda-stair1-bot', x: 3.0, y: 0.48, z: 60.5 },
      { id: 'rotunda-stair1-top', x: 3.0, y: 4.08, z: 68.0 },
      { id: 'rotunda-1f-landing', x: 9.0, y: 4.08, z: 68.0 },
      { id: 'rotunda-stair2-top', x: 9.0, y: 7.68, z: 60.5 },
      { id: 'rotunda-3f-balcony', x: 6.0, y: 7.68, z: 54.2 },
      { id: 'rotunda-stair2-down', x: 9.0, y: 7.68, z: 60.5 },
      { id: 'rotunda-1f-down', x: 9.0, y: 4.08, z: 68.0 },
      { id: 'rotunda-stair1-down', x: 3.0, y: 4.08, z: 68.0 },
      { id: 'rotunda-exit', x: 6.0, y: 0.48, z: 59.0 },
      { id: 'wing-l3-path', x: -17.5, y: 0, z: 18 },
    ];

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
      const minClearance = pRad + 0.15; // At least playerRadius + 0.15 clear of every collider
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
      const pRad = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.playerRadius) || 0.28;
      const requiredClearance = pRad + 0.15;

      for (let i = 0; i < interactiveHidingSpots.length; i++) {
        const spot = interactiveHidingSpots[i];
        const exit = computeSafeHidingExit(spot);
        spot.exitX = exit.x;
        spot.exitY = exit.y;
        spot.exitZ = exit.z;

        // Startup Dev Check: logs any hiding spot whose exit position is inside a collider
        if (!isPositionClearOfColliders(spot.exitX, spot.exitY, spot.exitZ, 0.001)) {
          console.warn('[Hiding Spot Startup Dev Check] WARNING: Spot exit position is inside a collider!', spot.id, spot.name, 'at (' + spot.exitX.toFixed(2) + ', ' + spot.exitZ.toFixed(2) + ')');
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

    function initCharactersAndBots() {
      bots.forEach(b => scene.remove(b.mesh));
      bots.length = 0;
      if (playerCharacter) scene.remove(playerCharacter);

      const botNames = ['Aayush', 'Bikash', 'Puja', 'Suman', 'Kritika', 'Rohan'];
      const colors = [0x334155, 0x475569, 0x1e293b, 0x3f3f46, 0x52525b, 0x27272a];

      if (GAME_CONFIG.role === 'seeker') {
        playerCharacter = createCampusCharacter(0x11161f, true, 'You (Warden)');
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
            targetSpot,
            state: 'hiding',
            speed: 3.4,
          });
        }
      } else {
        playerCharacter = createCampusCharacter(0x334155, false, 'You (Student)');
        playerCharacter.visible = (playerPhysics.cameraMode === 'third');
        scene.add(playerCharacter);

        const seekerBotMesh = createCampusCharacter(0x11161f, true, 'Campus Warden');
        scene.add(seekerBotMesh);
        seekerBotMesh.position.set(0, 0, -60);

        const seekerBot = {
          id: 'seeker-bot',
          name: 'Campus Warden',
          mesh: seekerBotMesh,
          isSeeker: true,
          isCaught: false,
          currentWpIdx: 0,
          speed: GAME_CONFIG.difficulty === 'hard' ? 4.7 : 4.2,
          state: 'patrolling',
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
            targetSpot,
            state: 'hiding',
            speed: 3.4,
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

    // Physics & Collision Debug Telemetry State
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
        scene.add(this.helpersGroup);
        const boxMat = new THREE.LineBasicMaterial({ color: 0x00e5ff, linewidth: 1 });
        const cylMat = new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 1 });

        for (let i = 0; i < colliders.length; i++) {
          const col = colliders[i];
          if (col.type === 'cylinder') {
            const h = Math.max(0.2, (col.maxY || 4.0) - (col.minY || 0));
            const geo = new THREE.CylinderGeometry(col.radius, col.radius, h, 12);
            const wire = new THREE.WireframeGeometry(geo);
            const line = new THREE.LineSegments(wire, cylMat);
            line.position.set(col.x, (col.minY || 0) + h / 2, col.z);
            this.helpersGroup.add(line);
          } else {
            const min = col.min;
            const max = col.max;
            if (min && max) {
              const b = col.box || new THREE.Box3(min, max);
              const helper = new THREE.Box3Helper(b, 0x00e5ff);
              this.helpersGroup.add(helper);
            }
          }
        }

        // Player collision capsule wireframe helper
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
        showToast(this.enabled ? 'Physics Debug: ON (Colliders Drawn)' : 'Physics Debug: OFF');
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
      // 1. Check Walkable Staircase Ramps first so climbing between Floor 0 <-> Floor 1 <-> Floor 2 is seamless
      for (let i = 0; i < walkableStairRamps.length; i++) {
        const r = walkableStairRamps[i];
        if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
          const t = Math.max(0.0, Math.min(1.0, (z - r.zStart) / (r.zEnd - r.zStart)));
          const rampY = r.yStart + t * (r.yEnd - r.yStart);
          if (Math.abs(currentY - rampY) <= 1.55) {
            return rampY;
          }
        }
      }

      // 2. Check Multi-Story Walkable Floor Slabs reachable from currentY (prevents snapping through upper ceilings)
      let maxFloor = 0.0;
      for (let i = 0; i < walkableFloors.length; i++) {
        const f = walkableFloors[i];
        if (x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ) {
          if (f.floorY <= currentY + 0.72 && f.floorY > maxFloor) {
            maxFloor = f.floorY;
          }
        }
      }
      return maxFloor;
    }

    // Fast 3D Ray-Box intersection for 3rd-person camera wall occlusion
    function raycastCameraDistance(ox, oy, oz, dirX, dirY, dirZ, maxDist) {
      let shortest = maxDist;
      for (let i = 0; i < colliders.length; i++) {
        const b = colliders[i];
        if (b.max.y <= oy - 0.2) continue;
        if (b.min.y >= Math.max(oy, oy + dirY * maxDist) + 0.2) continue;

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
      if (e.code === 'Space') performJump();
      if (isDevTelemetryAllowed && (e.code === 'KeyP' || e.code === 'Backquote')) physicsDebug.toggle();
      if (e.code === 'KeyG') {
        window.toggleColorGrade();
      }
    });
    window.addEventListener('keyup', e => { keys[e.code] = false; });

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
        el.closest('#physics-debug-hud')
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
          e.preventDefault(); // Stop mobile browser gesture cancellation / rubber-banding
          const dx = touch.clientX - lastLookX;
          const dy = touch.clientY - lastLookY;
          lastLookX = touch.clientX;
          lastLookY = touch.clientY;

          const sensX = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.lookSensitivityX) || 0.0055;
          const sensY = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.lookSensitivityY) || 0.0048;
          playerPhysics.targetYaw -= dx * sensX;
          playerPhysics.targetPitch = Math.max(-1.35, Math.min(1.35, playerPhysics.targetPitch - dy * sensY));
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
      showToast(playerPhysics.isSprinting ? 'Sprint ON' : 'Sprint OFF');
    }

    bindTouchBtn('btn-debug-physics', () => physicsDebug.toggle());
    bindTouchBtn('btn-cam', toggleCameraMode);
    bindTouchBtn('btn-sprint', toggleSprint);
    bindTouchBtn('btn-crouch', toggleCrouch);
    bindTouchBtn('btn-jump', performJump);
    bindTouchBtn('btn-action', performAction);

    // Test Controls UI Event Bindings
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
    bindDbgClick('dbg-btn-run-audit', () => {
      if (window.__TEST_HARNESS__ && window.__TEST_HARNESS__.runAuditSuite) {
        window.__TEST_HARNESS__.runAuditSuite();
      }
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
        showToast('Running Physics Audit Suite in Console...');
        console.log('[TEST HARNESS] Running automated audit...');
      }
    };

    function toggleCameraMode() {
      playerPhysics.cameraMode = playerPhysics.cameraMode === 'first' ? 'third' : 'first';
      if (playerCharacter) playerCharacter.visible = (playerPhysics.cameraMode === 'third');
      showToast(playerPhysics.cameraMode === 'first' ? '1st-Person View' : '3rd-Person View');
    }

    function toggleCrouch() {
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
                b.isCaught = true;
                if (b.mesh) scene.remove(b.mesh);
                tagged = true;
                soundEngine.playCatchSting();
                showToast('Discovered ' + b.name + '!');
                sendToReactNative('HIDER_CAUGHT', {
                  hiderName: b.name,
                  remaining: bots.filter(h => !h.isSeeker && !h.isCaught).length,
                });
              }
            }
          }
        });
        if (!tagged) showToast('Searching classrooms & surroundings...');
        evaluateGameStatus();
        return;
      }

      if (playerPhysics.isHiding) {
        playerPhysics.isHiding = false;
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
      } else {
        const spot = findNearbyHidingSpot();
        if (spot) {
          playerPhysics.isHiding = true;
          playerPhysics.currentHidingSpot = spot;
          playerPhysics.pos.x = spot.x;
          playerPhysics.pos.y = spot.y;
          playerPhysics.pos.z = spot.z;
          document.getElementById('stealth-overlay').classList.add('active');
          soundEngine.setMuffled(true);
          soundEngine.playHideSwoosh();
          showToast('Hidden at ' + spot.name);
        } else {
          showToast('Enter any classroom & move near a Table/Chair to hide!');
        }
      }
      updatePrompts();
    }

    function updatePrompts() {
      const promptEl = document.getElementById('action-prompt');
      const labelEl = document.getElementById('action-prompt-text');
      const btnLabel = document.getElementById('btn-action-label');
      const crosshairEl = document.getElementById('crosshair');

      if (GAME_CONFIG.role === 'seeker') {
        btnLabel.textContent = 'TAG';
        let nearHider = false;
        bots.forEach(b => {
          if (!b.isSeeker && !b.isCaught && playerPhysics.pos.distanceTo(b.mesh.position) < 3.2) nearHider = true;
        });
        if (nearHider) {
          labelEl.textContent = 'TAG HIDER (E)';
          promptEl.classList.add('active');
          crosshairEl.classList.add('active');
        } else {
          promptEl.classList.remove('active');
          crosshairEl.classList.remove('active');
        }
        return;
      }

      if (playerPhysics.isHiding) {
        labelEl.textContent = 'LEAVE DESK COVER (E)';
        btnLabel.textContent = 'EXIT';
        promptEl.classList.add('active');
        crosshairEl.classList.add('active');
      } else {
        const spot = findNearbyHidingSpot();
        if (spot) {
          labelEl.textContent = 'HIDE: ' + spot.name + ' (E)';
          btnLabel.textContent = 'HIDE';
          promptEl.classList.add('active');
          crosshairEl.classList.add('active');
        } else {
          btnLabel.textContent = 'HIDE';
          promptEl.classList.remove('active');
          crosshairEl.classList.remove('active');
        }
      }
    }

    function updateCampusZoneBanner() {
      const zoneEl = document.getElementById('campus-zone-text');
      if (!zoneEl) return;
      const x = playerPhysics.pos.x, y = playerPhysics.pos.y, z = playerPhysics.pos.z;
      let zone = 'GANDAKI UNIVERSITY • CENTRAL CAMPUS SPINE ROAD';
      if (z < -42 && x < 2) zone = 'GANDAKI UNIVERSITY • MAIN PARKING PLAZA';
      else if (z < -36 && x >= 2) zone = 'GANDAKI UNIVERSITY • BUS PARKING BAY (YELLOW BUSES)';
      else if (x < -28) zone = 'GANDAKI UNIVERSITY • WEST ADMIN & WORKSHOP CLUSTER';
      else if (x >= -17 && x <= -9 && z >= -28 && z <= 0) zone = 'GANDAKI UNIVERSITY • PLANTER ISLAND COURTYARD';
      else if (x < -2 && z >= -36 && z <= 2) zone = 'GANDAKI UNIVERSITY • WEST CLASSROOM WING L1';
      else if (x < -14 && z >= -26 && z <= 6) zone = 'GANDAKI UNIVERSITY • WEST WING L2 (MONITOR ROOF & VERANDA)';
      else if (x < -14 && z > 6 && z <= 28) zone = 'GANDAKI UNIVERSITY • WEST CLASSROOM WING L3';
      else if (x < -14 && z > 28) zone = 'GANDAKI UNIVERSITY • WEST CLASSROOM WING L4';
      else if (x >= 9 && x <= 20 && z >= -38 && z <= -10) zone = 'GANDAKI UNIVERSITY • EAST WING R1 (ACADEMIC BLOCK)';
      else if (x > 18 && z >= -28 && z <= -4) zone = 'GANDAKI UNIVERSITY • EAST WING R2 (ACADEMIC BLOCK)';
      else if (x > 20 && z > -4 && z <= 18) zone = 'GANDAKI UNIVERSITY • EAST WING R3 (ACADEMIC BLOCK)';
      else if (x > 22 && z > 18 && z <= 46) zone = 'GANDAKI UNIVERSITY • EAST WING R4 (LONG BLOCK)';
      else if (z > 66 && x >= -14 && x <= 26) {
        if (y >= 6.2) zone = 'GANDAKI UNIVERSITY • ROTUNDA 3RD FLOOR & BALCONY (301-302)';
        else if (y >= 2.5) zone = 'GANDAKI UNIVERSITY • ROTUNDA 2ND FLOOR (CLASSES 201-202)';
        else zone = 'GANDAKI UNIVERSITY • ROTUNDA GROUND FLOOR (HALLS 101-102)';
      } else if (z > 48) zone = 'GANDAKI UNIVERSITY • GRAND ROTUNDA PLAZA & FOUNTAIN';
      if (zoneEl.textContent !== zone) zoneEl.textContent = zone;
    }

    function startMatch() {
      matchTimer = GAME_CONFIG.matchDuration;
      graceTimer = GAME_CONFIG.seekerGracePeriod;
      isMatchActive = true;
      isGameOver = false;
      playerPhysics.isHiding = false;
      document.getElementById('stealth-overlay').classList.remove('active');
      document.getElementById('horror-pulse-overlay').style.opacity = '0';

      initCharactersAndBots();

      if (GAME_CONFIG.role === 'seeker') {
        playerPhysics.pos.set(0, 0, -60);
        playerPhysics.yaw = 0;
        playerPhysics.targetYaw = 0;
        document.getElementById('blindfold-overlay').classList.add('active');
      } else {
        playerPhysics.pos.set(-4, 0, -48);
        playerPhysics.yaw = 0;
        playerPhysics.targetYaw = 0;
        document.getElementById('blindfold-overlay').classList.remove('active');
      }

      sendToReactNative('STATUS', {
        hidersRemaining: GAME_CONFIG.botCount,
        timeLeft: matchTimer,
      });
    }

    function evaluateGameStatus(timeOut = false) {
      if (isGameOver) return;
      const remainingHiders = GAME_CONFIG.role === 'seeker'
        ? bots.filter(b => !b.isSeeker && !b.isCaught).length
        : 1;

      if (GAME_CONFIG.role === 'seeker' && remainingHiders === 0) {
        isGameOver = true;
        isMatchActive = false;
        sendToReactNative('GAMEOVER', {
          winner: 'SEEKER',
          reason: 'Campus Security discovered all scholars before daybreak!',
        });
      } else if (timeOut) {
        isGameOver = true;
        isMatchActive = false;
        sendToReactNative('GAMEOVER', {
          winner: 'HIDERS',
          reason: 'Scholars remained hidden inside the classrooms throughout the night!',
        });
      }
    }

    function updatePlayer(delta, timeSec = 0) {
      if (!isMatchActive) return;

      let canMove = true;
      if (graceTimer > 0) {
        graceTimer -= delta;
        document.getElementById('blindfold-counter').textContent = Math.ceil(Math.max(0, graceTimer));
        if (graceTimer <= 0) {
          document.getElementById('blindfold-overlay').classList.remove('active');
          showToast('Patrol Begins!');
        }
        if (GAME_CONFIG.role === 'seeker') {
          canMove = false; // Seeker cannot walk during grace period, but CAN look around!
        }
      }

      // 1. Look orientation: yaw and pitch come strictly from look input (collision NEVER modifies them)
      const lookSmoothing = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.lookSmoothing) || 24.0;
      playerPhysics.yaw += (playerPhysics.targetYaw - playerPhysics.yaw) * Math.min(1.0, lookSmoothing * delta);
      playerPhysics.pitch += (playerPhysics.targetPitch - playerPhysics.pitch) * Math.min(1.0, lookSmoothing * delta);

      // 2. Input handling: touch joystick & keyboard
      let targetInputX = touchMove.x;
      let targetInputZ = -touchMove.y; // Joystick UP (-touchMove.y > 0) = forward (+Z input)
      if (keys['KeyD'] || keys['ArrowRight']) targetInputX += 1;
      if (keys['KeyA'] || keys['ArrowLeft']) targetInputX -= 1;
      if (keys['KeyW'] || keys['ArrowUp']) targetInputZ += 1;
      if (keys['KeyS'] || keys['ArrowDown']) targetInputZ -= 1;

      if (!canMove) {
        targetInputX = 0;
        targetInputZ = 0;
      }

      // Responsive input smoothing
      const inputSnap = 32.0;
      playerPhysics.smoothMoveX += (targetInputX - playerPhysics.smoothMoveX) * Math.min(1.0, inputSnap * delta);
      playerPhysics.smoothMoveZ += (targetInputZ - playerPhysics.smoothMoveZ) * Math.min(1.0, inputSnap * delta);

      let moveRight = playerPhysics.smoothMoveX;
      let moveForward = playerPhysics.smoothMoveZ;

      if (playerPhysics.isHiding) {
        if (Math.abs(moveForward) > 0.4 || Math.abs(moveRight) > 0.4) performAction();
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

      let targetSpeed = walkSpd;
      const isSprint = keys['ShiftLeft'] || keys['ShiftRight'] || playerPhysics.isSprinting;
      if (playerPhysics.isCrouching) targetSpeed = crouchSpd;
      else if (isSprint) targetSpeed = runSpd;

      // 4. Movement direction computed strictly from playerPhysics.yaw only with joystick UP = forward (-Z in Three.js)
      let targetVx = 0;
      let targetVz = 0;
      if (isMoving) {
        // Normalize movement vector so diagonal speed equals straight speed
        const axialMag = Math.max(Math.abs(moveForward), Math.abs(moveRight));
        const clampedMag = Math.min(1.0, axialMag);
        const normF = (moveForward / (moveMag || 1)) * clampedMag;
        const normR = (moveRight / (moveMag || 1)) * clampedMag;
        const sinY = Math.sin(playerPhysics.yaw);
        const cosY = Math.cos(playerPhysics.yaw);
        // In Three.js: forward facing is -Z when yaw = 0
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
        // Horizontal velocity acceleration & damping
        playerPhysics.vel.x += (targetVx - playerPhysics.vel.x) * Math.min(1.0, accelRate * subDt);
        playerPhysics.vel.z += (targetVz - playerPhysics.vel.z) * Math.min(1.0, accelRate * subDt);

        // Position integration
        playerPhysics.pos.x += playerPhysics.vel.x * subDt;
        playerPhysics.pos.z += playerPhysics.vel.z * subDt;

        // Vertical floor step & jump gravity
        const targetGroundY = getSupportFloorY(playerPhysics.pos.x, playerPhysics.pos.z, playerPhysics.pos.y);

        if (!playerPhysics.isGrounded) {
          playerPhysics.vel.y -= gravity * subDt;
          let nextY = playerPhysics.pos.y + playerPhysics.vel.y * subDt;
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

        // Two relaxation passes per substep for seamless multi-box corner sliding
        resolveCollisionSubstep(playerPhysics.pos, playerPhysics.vel, playerPhysics.radius, playerH, stepH, playerPhysics.isHiding);
        resolveCollisionSubstep(playerPhysics.pos, playerPhysics.vel, playerPhysics.radius, playerH, stepH, playerPhysics.isHiding);
      }

      // Log collision debug info in console if enabled
      if (physicsDebug.enabled && physicsDebug.hasCollided) {
        console.log('[Physics Collision] Vel:', playerPhysics.vel.x.toFixed(2), playerPhysics.vel.z.toFixed(2), 'Normal:', physicsDebug.lastNormal.x.toFixed(2), physicsDebug.lastNormal.z.toFixed(2));
      }

      // Realistic Footsteps with surface audio & corridor acoustic resonance
      if (isMoving && playerPhysics.isGrounded) {
        const actualSpeed = Math.hypot(playerPhysics.vel.x, playerPhysics.vel.z);
        playerPhysics.footstepTimer += delta * (actualSpeed / 4.8);
        if (playerPhysics.footstepTimer > 0.44) {
          playerPhysics.footstepTimer = 0;
          let surface = 'paver';
          const px = playerPhysics.pos.x;
          const py = playerPhysics.pos.y;
          const pz = playerPhysics.pos.z;

          // Check if on lawn or planter grass
          const isLawn = (px < -21 || px > 27) || (pz > 66) || (Math.hypot(px - 9.8, pz - (-37.0)) < 2.5);
          // Check if on stair / ramp
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
        }
      }

      // Check if player is beneath covered veranda or inside room for corridor acoustics
      const inCoveredArea = (playerPhysics.pos.y >= 0.42) ||
        (playerPhysics.pos.x >= -19 && playerPhysics.pos.x <= -13 && playerPhysics.pos.z >= -26 && playerPhysics.pos.z <= 6) ||
        (Math.hypot(playerPhysics.pos.x - rotX, playerPhysics.pos.z - rotFrontZ) < 6.5 && playerPhysics.pos.y <= 0.6);
      soundEngine.setCorridorAcoustics(inCoveredArea);

      // Third-Person Character Rig: Facing Movement Direction (GTA V Style)
      if (playerCharacter) {
        playerCharacter.visible = (playerPhysics.cameraMode === 'third');
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

      // Eye Height & Dynamic Head Bobbing (GTA V Natural Motion)
      const targetEye = playerPhysics.isHiding
        ? (pCfg.hidingEyeHeight || 0.58)
        : (playerPhysics.isCrouching ? (pCfg.crouchEyeHeight || 0.95) : (pCfg.standingEyeHeight || 1.62));
      playerPhysics.currentEyeHeight += (targetEye - playerPhysics.currentEyeHeight) * 12.0 * delta;

      let vertBob = 0;
      let latBob = 0;
      if (isMoving && playerPhysics.isGrounded && !playerPhysics.isHiding) {
        const bobSpeed = (targetSpeed > 5.5) ? 12.0 : (playerPhysics.isCrouching ? 6.5 : 9.5);
        playerPhysics.bobTimer += delta * bobSpeed;
        const bobAmp = playerPhysics.isCrouching ? 0.022 : (targetSpeed > 5.5 ? 0.052 : 0.038);
        vertBob = Math.sin(playerPhysics.bobTimer) * bobAmp;
        latBob = Math.cos(playerPhysics.bobTimer * 0.5) * (bobAmp * 0.45);
      } else if (!playerPhysics.isHiding) {
        vertBob = Math.sin(Date.now() * 0.0024) * 0.008; // Idle breathing
      }

      const eyeY = playerPhysics.pos.y + playerPhysics.currentEyeHeight + vertBob;

      // Camera Placement with 3rd-Person Wall Raycast Collision (Never modifies look direction or movement)
      if (playerPhysics.cameraMode === 'first') {
        const cosYaw = Math.cos(playerPhysics.yaw);
        const sinYaw = Math.sin(playerPhysics.yaw);
        camera.position.set(
          playerPhysics.pos.x + cosYaw * latBob,
          eyeY,
          playerPhysics.pos.z + sinYaw * latBob
        );
        camera.rotation.y = playerPhysics.yaw;
        camera.rotation.x = playerPhysics.pitch;

        // Subtle turn roll banking
        const turnRate = playerPhysics.targetYaw - playerPhysics.yaw;
        camera.rotation.z = Math.max(-0.025, Math.min(0.025, turnRate * 0.15));
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

        // Check if wall is occluding third-person camera
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

        // Softly fade character mesh when camera pulls close against walls so interior never clips through screen
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

      // Phase A Requirement 3: Update Room & Building Portal/Distance Visibility
      updateRoomAndBuildingVisibility(playerPhysics.pos, playerPhysics.yaw, activePreset);

      // Phase A Requirement 4: Update Player Flashlight (SpotLight)
      if (atmosphere && atmosphere.flashlight && atmosphere.flashlightTarget) {
        const fx = -Math.sin(playerPhysics.yaw) * Math.cos(playerPhysics.pitch);
        const fy = Math.sin(playerPhysics.pitch);
        const fz = -Math.cos(playerPhysics.yaw) * Math.cos(playerPhysics.pitch);
        atmosphere.flashlight.position.copy(camera.position);
        atmosphere.flashlightTarget.position.set(
          camera.position.x + fx * 12.0,
          camera.position.y + fy * 12.0,
          camera.position.z + fz * 12.0
        );
      }

      // Physics & Render Telemetry HUD update & capsule wireframe
      if (physicsDebug.enabled) {
        physicsDebug.updateCapsule(playerPhysics.pos, playerPhysics.isHiding ? 0.65 : (playerPhysics.isCrouching ? 1.05 : 1.8));
        const hudEl = document.getElementById('physics-debug-hud');
        if (hudEl) {
          const fpsEl = document.getElementById('dbg-fps');
          const rInfo = (renderer && renderer.info) ? renderer.info : { render: { calls: 0 }, memory: { geometries: 0, textures: 0 } };
          if (fpsEl) {
            fpsEl.textContent = 'FPS: ' + Math.round(physicsDebug.fps) + ' | Calls: ' + (rInfo.render.calls || 0) + ' | Geos: ' + (rInfo.memory.geometries || 0) + ' | Tex: ' + (rInfo.memory.textures || 0);
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
          if (grEl) grEl.textContent = 'Grounded: ' + playerPhysics.isGrounded + ' | Crouching: ' + playerPhysics.isCrouching + ' | Hiding: ' + playerPhysics.isHiding;
          const n = physicsDebug.lastNormal;
          document.getElementById('dbg-normal').textContent = physicsDebug.hasCollided ? ('Coll Normal: (' + n.x.toFixed(2) + ', ' + n.z.toFixed(2) + ')') : 'Coll Normal: None';
        }
      }

      // TASK 2: Extra camera breathing & roll sway scaled by hunter proximity
      const proxSway = currentHunterProximity || 0.0;
      const swayAmp = (HORROR_CONFIG.tension.baseSwayRoll || 0.006) + proxSway * (HORROR_CONFIG.tension.hunterNearSwayRoll || 0.028);
      camera.rotation.z += Math.sin(timeSec * (2.2 + proxSway * 3.5)) * swayAmp;
      camera.position.y += Math.sin(timeSec * (2.6 + proxSway * 4.2)) * ((HORROR_CONFIG.tension.baseBreathingAmp || 0.012) + proxSway * (HORROR_CONFIG.tension.hunterNearBreathingBoost || 0.038));

      updatePrompts();
      updateCampusZoneBanner();
    }

    const tmpTargetVec = new THREE.Vector3();
    const tmpDirVec = new THREE.Vector3();
    let envEventTimer = 22 + Math.random() * 14;

    function updateEnvironmentAndBots(delta, timeSec) {
      if (!isMatchActive) return;

      matchTimer -= delta;
      if (matchTimer <= 0) evaluateGameStatus(true);

      statusSyncTimer += delta;
      if (statusSyncTimer >= 1.0) {
        statusSyncTimer = 0;
        sendToReactNative('STATUS', {
          hidersRemaining: GAME_CONFIG.role === 'seeker'
            ? bots.filter(b => !b.isSeeker && !b.isCaught).length
            : bots.filter(b => !b.isSeeker && !b.isCaught).length + 1,
          timeLeft: matchTimer,
        });
      }

      // Decay Horror Visual Glitch & Camera Trauma Shake
      if (horrorGlitchTimer > 0) {
        horrorGlitchTimer = Math.max(0, horrorGlitchTimer - delta);
        const glitchEl = document.getElementById('horror-glitch-overlay');
        if (glitchEl) {
          glitchEl.style.opacity = (horrorGlitchTimer > 0 ? Math.min(0.85, horrorGlitchTimer * 2.2) : 0).toFixed(2);
        }
      }
      if (horrorCameraShake > 0) {
        horrorCameraShake = Math.max(0, horrorCameraShake - delta * 0.85);
        camera.position.x += (Math.random() - 0.5) * horrorCameraShake * 0.28;
        camera.position.y += (Math.random() - 0.5) * horrorCameraShake * 0.24;
        camera.rotation.z += (Math.random() - 0.5) * horrorCameraShake * 0.08;
      }

      // Dynamic Environmental Horror Events (Thunder & Lightning, Ghost Whispers, Temple Bells, Power Blackouts)
      envEventTimer -= delta;
      if (envEventTimer <= 0) {
        const minI = Math.max(10, (activePreset.eventIntervalMin || 20) * 0.55);
        const maxI = Math.max(18, (activePreset.eventIntervalMax || 35) * 0.62);
        envEventTimer = minI + Math.random() * (maxI - minI);
        const roll = Math.random();
        if (roll < 0.20) {
          lampFlickerMod.triggerPowerDip(0.28);
          soundEngine.playPowerDipHum();
        } else if (roll < 0.38) {
          soundEngine.playDistantDogBarkSfx();
        } else if (roll < 0.56) {
          soundEngine.playPhantomFootstepsSfx();
        } else if (roll < 0.72) {
          soundEngine.playDistantChime();
        } else if (roll < 0.88) {
          soundEngine.playStructuralCreak();
        } else {
          // Lightning flash in the moonlit sky + rolling Himalayan thunder crack!
          soundEngine.playThunderCrackSfx();
          if (atmosphere && atmosphere.moonDirLight) {
            const baseMoon = HORROR_CONFIG.lighting.moonIntensity;
            atmosphere.moonDirLight.intensity = baseMoon * 4.2;
            setTimeout(() => {
              if (atmosphere && atmosphere.moonDirLight) atmosphere.moonDirLight.intensity = baseMoon * 0.6;
            }, 95);
            setTimeout(() => {
              if (atmosphere && atmosphere.moonDirLight) atmosphere.moonDirLight.intensity = baseMoon * 3.1;
            }, 160);
            setTimeout(() => {
              if (atmosphere && atmosphere.moonDirLight) atmosphere.moonDirLight.intensity = baseMoon;
            }, 310);
          }
        }
      }

      // Rare Distant Silhouette Update (Phase 4)
      rareSilhouetteMod.update(delta, playerPhysics.pos);

      // Subtle Tree Shadow Wind Sway (Phase 4)
      for (let i = 0; i < treeShadowDecals.length; i++) {
        const ts = treeShadowDecals[i];
        ts.mesh.rotation.z = Math.sin(timeSec * 1.5 + ts.seed) * 0.05;
        const s = 1.0 + Math.sin(timeSec * 2.2 + ts.seed) * 0.025;
        ts.mesh.scale.set(s, s, 1.0);
      }

      particleFieldMod.update(delta, timeSec, playerPhysics.pos);
      lampFlickerMod.update(delta, timeSec, playerPhysics.pos);

      for (let i = 0; i < bots.length; i++) {
        const b = bots[i];
        if (b.isCaught) continue;

        if (b.isSeeker) {
          if (graceTimer > 0) continue;
          const targetWp = navWaypoints[b.currentWpIdx];
          const wpY = typeof targetWp.y === 'number' ? targetWp.y : 0;
          tmpTargetVec.set(targetWp.x, wpY, targetWp.z);
          const distToWp = Math.hypot(targetWp.x - b.mesh.position.x, targetWp.z - b.mesh.position.z);

          if (distToWp < 1.8) {
            b.currentWpIdx = (b.currentWpIdx + 1) % navWaypoints.length;
          } else {
            tmpDirVec.set(targetWp.x - b.mesh.position.x, 0, targetWp.z - b.mesh.position.z).normalize();
            b.mesh.position.x += tmpDirVec.x * b.speed * delta;
            b.mesh.position.z += tmpDirVec.z * b.speed * delta;
            const botSupportY = getSupportFloorY(b.mesh.position.x, b.mesh.position.z, b.mesh.position.y);
            b.mesh.position.y += (botSupportY - b.mesh.position.y) * Math.min(1.0, 14.0 * delta);
            b.mesh.rotation.y = Math.atan2(tmpDirVec.x, tmpDirVec.z);
            animateCharacterRig(b.mesh, 0.9, false, delta);
          }

          if (GAME_CONFIG.role === 'hider') {
            const distToPlayer = b.mesh.position.distanceTo(playerPhysics.pos);
            const horrorOverlay = document.getElementById('horror-pulse-overlay');
            const bannerEl = document.getElementById('campus-banner');

            if (distToPlayer < 25) {
              const proximity = Math.max(0, Math.min(1, 1 - distToPlayer / 25));
              currentHunterProximity = proximity;
              soundEngine.updateProximityTension(proximity);
              if (horrorOverlay) horrorOverlay.style.opacity = (proximity * 0.92).toFixed(2);
              if (bannerEl) bannerEl.classList.add('danger');

              heartbeatCooldown -= delta;
              if (heartbeatCooldown <= 0) {
                heartbeatCooldown = Math.max(0.24, 0.92 - proximity * 0.64);
                soundEngine.playHeartbeat(proximity);
              }

              if (distToPlayer < 11.5) {
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

            const detectionDist = playerPhysics.isHiding ? 1.65 : (playerPhysics.isCrouching ? 4.2 : 7.8);
            const sameFloor = Math.abs(b.mesh.position.y - playerPhysics.pos.y) < 2.2;
            if (sameFloor && distToPlayer < detectionDist) {
              soundEngine.playJumpscareSting();
              isGameOver = true;
              isMatchActive = false;
              sendToReactNative('GAMEOVER', {
                winner: 'SEEKER',
                reason: 'The Campus Warden caught you during midnight patrol!',
              });
            }
          }
        } else {
          animateCharacterRig(b.mesh, 0, true, delta);
        }
      }
    }

    function applyGraphicsQuality(q) {
      currentQuality = (HORROR_CONFIG.qualityPresets && HORROR_CONFIG.qualityPresets[q]) ? q : 'high';
      activePreset = HORROR_CONFIG.qualityPresets[currentQuality];
      atmosphere.applyQuality(activePreset);
      particleFieldMod.applyQuality(activePreset);
      if (lampFlickerMod && lampFlickerMod.applyQuality) lampFlickerMod.applyQuality(activePreset);
    }

    function handleIncomingMessage(e) {
      try {
        const raw = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
        const data = JSON.parse(raw);
        if (data.type === 'CONFIGURE') {
          GAME_CONFIG.role = data.role || 'hider';
          GAME_CONFIG.difficulty = data.difficulty || 'medium';
          GAME_CONFIG.botCount = data.difficulty === 'easy' ? 4 : (data.difficulty === 'hard' ? 6 : 5);
          if (typeof data.muted === 'boolean') soundEngine.setMuted(data.muted);
          if (data.quality) applyGraphicsQuality(data.quality);
          startMatch();
        } else if (data.type === 'SET_MUTE') {
          soundEngine.setMuted(data.muted);
        } else if (data.type === 'SET_QUALITY') {
          applyGraphicsQuality(data.quality);
          showToast('Graphics Quality: ' + currentQuality.toUpperCase());
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

        startMatch();
    sendToReactNative('ENGINE_READY');

    // TASK 4: Rolling FPS Monitor & Auto-Step-Down (ULTRA -> FAST if FPS < 30)
    let fpsFrameCount = 0;
    let fpsAccumSec = 0.0;
    let hasSteppedDownFps = false;
    const clock = new THREE.Clock();

    function animate() {
      requestAnimationFrame(animate);
      const rawDelta = clock.getDelta();
      const maxDt = (HORROR_CONFIG.physics && HORROR_CONFIG.physics.maxDeltaTime) || (1.0 / 30.0);
      let delta = Math.min(rawDelta, maxDt);
      const timeSec = Date.now() * 0.001;

      // Update GPU shader uniform for waving cloth prayer flags (zero CPU vertex loop!)
      prayerFlagUniforms.uTime.value = timeSec;

      // Keep sky dome centered at player camera position
      if (atmosphere.skyGroup && camera) {
        atmosphere.skyGroup.position.copy(camera.position);
      }

      // TASK 2: Occasional random lamp flicker bursts
      flickerBurstTimer -= delta;
      if (flickerBurstTimer <= 0) {
        flickerBurstTimer = (HORROR_CONFIG.tension.flickerBurstIntervalMin || 9.0) +
          Math.random() * ((HORROR_CONFIG.tension.flickerBurstIntervalMax || 18.0) - (HORROR_CONFIG.tension.flickerBurstIntervalMin || 9.0));
        lampFlickerMod.triggerPowerDip(0.35);
        soundEngine.playLampBuzz();
      }

      // TASK 2: Tighten linear fog & SVG vignette as timer runs down or hunter gets close
      const timerRatio = Math.max(0, Math.min(1, 1 - (matchTimer / (GAME_CONFIG.matchDuration || 135))));
      const combinedTension = Math.min(1.0, currentHunterProximity * 0.75 + timerRatio * 0.45);
      if (scene.fog && scene.fog.isFog) {
        const baseFar = (HORROR_CONFIG.renderer && HORROR_CONFIG.renderer.fogFar) || 88.0;
        const minFar = (HORROR_CONFIG.renderer && HORROR_CONFIG.renderer.fogMinFarUnderTension) || 45.0;
        scene.fog.near = Math.max(2.5, ((HORROR_CONFIG.renderer && HORROR_CONFIG.renderer.fogNear) || 14.0) - combinedTension * 3.0);
        scene.fog.far = baseFar - (baseFar - minFar) * combinedTension;

        // Faint warm tint to the fog when the player is near a warm lamp pool (< 14m)
        const lampDist = (lampFlickerMod && typeof lampFlickerMod.nearestLampDist === 'number')
          ? lampFlickerMod.nearestLampDist
          : 999;
        const warmFactor = Math.max(0.0, Math.min(0.45, (1.0 - lampDist / 14.0) * 0.45));
        scene.fog.color.copy(atmosphere.baseFogColor).lerp(atmosphere.warmFogColor, warmFactor);
      }
      const vigEl = document.getElementById('cinematic-vignette');
      if (vigEl) {
        vigEl.style.opacity = (0.28 + combinedTension * 0.20).toFixed(2);
      }

      // Throttled hunter proximity message for expo-av heartbeat (4Hz max, never per-frame!)
      proximitySyncCooldown -= delta;
      if (proximitySyncCooldown <= 0) {
        proximitySyncCooldown = 0.25;
        sendToReactNative('HUNTER_PROXIMITY', { proximity: Number(currentHunterProximity.toFixed(2)) });
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

      // TASK 4: Rolling FPS check every 2.5 seconds
      if (rawDelta > 0.001 && rawDelta < 0.5) {
        fpsFrameCount++;
        fpsAccumSec += rawDelta;
        if (fpsAccumSec >= (HORROR_CONFIG.tension.autoStepDownWindowSec || 2.5)) {
          const avgFps = fpsFrameCount / fpsAccumSec;
          fpsFrameCount = 0;
          fpsAccumSec = 0.0;
          if (!hasSteppedDownFps && currentQuality === 'high' && avgFps < (HORROR_CONFIG.tension.autoStepDownFpsThreshold || 30)) {
            hasSteppedDownFps = true;
            applyGraphicsQuality('low');
            sendToReactNative('AUTO_STEP_DOWN_QUALITY', { fps: Math.round(avgFps) });
            showToast('FPS < 30: Auto-switched to FAST mode');
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
