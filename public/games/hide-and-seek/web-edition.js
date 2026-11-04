/**
 * Semester Library — Hide & Seek Web Edition Host Controller
 * ----------------------------------------------------------
 * Coordinates:
 *   1. Semester Library Authentication integration (window.SemesterAuth)
 *   2. Authoritative Campus World metadata loading (/api/games/hide-and-seek/metadata)
 *   3. Lobby configuration (Mode, Graphics Preset, Patrol Intensity, Initial Spawn)
 *   4. Staged Loading Screen & Single-Source 3D Engine iframe initialization
 *   5. Pointer Lock, Fullscreen, Pause/Settings Modal (ESC / Tab), and Live Telemetry HUD
 */

(function () {
  const state = {
    mode: 'explore', // 'explore' | 'match'
    quality: 'ultra', // 'fast' | 'low' | 'high' | 'ultra'
    difficulty: 'medium', // 'easy' | 'medium' | 'hard'
    spawnCoords: '-2.5,1.00,-48.0,0',
    muted: false,
    adaptiveRes: true,
    ssao: true,
    bloomStrength: 0.36,
    flashlightIntensity: 14.5,
    fogDensity: 0.5,
    mouseSensitivity: 1.0,
    volume: 1.0,
    isPlaying: false,
    isPaused: false,
    engineLoaded: false,
    pointerLocked: false,
  };

  const QUALITY_LABELS = {
    fast: 'PERF (512)',
    low: 'BALANCED (1K)',
    high: 'HIGH (2K)',
    ultra: 'ULTRA (4K)',
  };

  // DOM Elements
  const topNavEl = document.getElementById('web-top-nav');
  const lobbyScreenEl = document.getElementById('web-lobby-screen');
  const loadingOverlayEl = document.getElementById('web-loading-overlay');
  const loadingTitleEl = document.getElementById('loading-stage-title');
  const loadingFillEl = document.getElementById('loading-progress-fill');
  const loadingDetailEl = document.getElementById('loading-step-detail');
  const viewportEl = document.getElementById('web-game-viewport');
  const engineFrameEl = document.getElementById('game-engine-frame');
  const pauseModalEl = document.getElementById('web-pause-modal');
  const pointerLockBannerEl = document.getElementById('pointer-lock-banner');

  // HUD Elements
  const hudModeBadgeEl = document.getElementById('hud-mode-badge');
  const hudRoomLabelEl = document.getElementById('hud-room-label');
  const hudCoordsLabelEl = document.getElementById('hud-coords-label');
  const hudFpsValEl = document.getElementById('hud-fps-val');
  const hudMsValEl = document.getElementById('hud-ms-val');
  const hudDrawsValEl = document.getElementById('hud-draws-val');
  const hudScaleValEl = document.getElementById('hud-scale-val');
  const hudQualityLabelEl = document.getElementById('hud-quality-label');
  const hudMuteLabelEl = document.getElementById('hud-mute-label');

  function postToEngine(msg) {
    if (!engineFrameEl || !engineFrameEl.contentWindow) return;
    try {
      engineFrameEl.contentWindow.postMessage(JSON.stringify(msg), '*');
    } catch (e) {}
  }

  // 1. Hydrate Authenticated Student / Faculty User Pill from SemesterAuth
  async function initAuthBadge() {
    try {
      let user = null;
      if (window.SemesterAuth) {
        user = window.SemesterAuth.getUserSync() || (await window.SemesterAuth.getUser());
      } else {
        const res = await fetch('/api/me', { credentials: 'same-origin' });
        if (res.ok) user = await res.json();
      }
      if (user && (user.name || user.username)) {
        const nameEl = document.getElementById('web-auth-name');
        const roleEl = document.getElementById('web-auth-role');
        const avatarEl = document.getElementById('web-auth-avatar');
        const displayName = user.name || user.username;
        if (nameEl) nameEl.textContent = displayName;
        if (roleEl) {
          roleEl.textContent = user.department
            ? `${user.department}${user.semester ? ' • Sem ' + user.semester : ''}`
            : (user.role || 'Student');
        }
        if (avatarEl) {
          if (user.avatarUrl) {
            avatarEl.innerHTML = `<img src="${user.avatarUrl}" alt="${displayName}" style="width:100%;height:100%;object-fit:cover;" />`;
          } else {
            avatarEl.textContent = displayName.charAt(0).toUpperCase();
          }
        }
      }
    } catch (e) {}
  }

  // 2. Fetch Authoritative Single-Source Campus Metadata
  async function loadWorldMetadata() {
    try {
      const res = await fetch('/api/games/hide-and-seek/metadata');
      if (!res.ok) return;
      const meta = await res.json();
      const objEl = document.getElementById('stat-total-objects');
      const roomEl = document.getElementById('stat-total-rooms');
      const terEl = document.getElementById('stat-terrain-res');
      const verEl = document.getElementById('lobby-map-version-pill');
      if (objEl && meta.totalObjects) objEl.textContent = String(meta.totalObjects);
      if (roomEl && meta.enterableRooms) roomEl.textContent = String(meta.enterableRooms);
      if (terEl && meta.terrainSegments) terEl.textContent = `${meta.terrainSegments}×${meta.terrainSegments}`;
      if (verEl && meta.mapVersion) verEl.textContent = `MAP v${meta.mapVersion} • ${meta.totalObjects || 139} OBJECTS`;
    } catch (e) {}
  }

  // 3. Wire Lobby Selectors
  function bindLobbyControls() {
    const modeCards = document.querySelectorAll('#mode-selector .select-card');
    modeCards.forEach((btn) => {
      btn.addEventListener('click', () => {
        modeCards.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.mode = btn.getAttribute('data-mode') || 'explore';
      });
    });

    function syncQualityButtons(q) {
      state.quality = q;
      document.querySelectorAll('#lobby-gfx-selector .seg-item, #pause-gfx-selector .seg-item').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-quality') === q);
      });
      if (hudQualityLabelEl) {
        hudQualityLabelEl.textContent = `GFX: ${QUALITY_LABELS[q] || q.toUpperCase()}`;
      }
    }

    document.querySelectorAll('#lobby-gfx-selector .seg-item, #pause-gfx-selector .seg-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = btn.getAttribute('data-quality') || 'ultra';
        syncQualityButtons(q);
        if (state.engineLoaded) {
          postToEngine({ type: 'SET_QUALITY', quality: q, pinMode: q });
        }
      });
    });

    document.querySelectorAll('#lobby-diff-selector .seg-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#lobby-diff-selector .seg-item').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.difficulty = btn.getAttribute('data-diff') || 'medium';
      });
    });

    const spawnSelect = document.getElementById('lobby-spawn-select');
    if (spawnSelect) {
      spawnSelect.addEventListener('change', () => {
        state.spawnCoords = spawnSelect.value;
      });
    }

    const launchBtn = document.getElementById('btn-launch-game');
    if (launchBtn) {
      launchBtn.addEventListener('click', launchGameSession);
    }

    const lobbyFsBtn = document.getElementById('btn-lobby-fullscreen');
    if (lobbyFsBtn) {
      lobbyFsBtn.addEventListener('click', toggleFullscreen);
    }
  }

  // 4. Launch Game Session with Staged Loading Screen
  function launchGameSession() {
    state.isPlaying = true;
    state.isPaused = false;
    topNavEl.classList.add('hidden');
    lobbyScreenEl.classList.add('hidden');
    loadingOverlayEl.classList.remove('hidden');
    viewportEl.classList.remove('hidden');

    if (hudModeBadgeEl) {
      hudModeBadgeEl.textContent = state.mode === 'explore' ? 'EXPLORE MODE' : 'SURVIVAL MATCH';
    }

    const setStage = (pct, title, detail) => {
      if (loadingFillEl) loadingFillEl.style.width = `${pct}%`;
      if (loadingTitleEl) loadingTitleEl.textContent = title;
      if (loadingDetailEl) loadingDetailEl.textContent = detail;
    };

    setStage(28, 'Loading Gandaki Campus Layout JSON...', 'Reading 139 campus objects & 128×128 terrain heightmap...');
    setTimeout(() => {
      if (!state.engineLoaded) {
        setStage(62, 'Synthesizing 512px PBR Normal & Roughness Maps...', 'Generating 32 enterable rooms, Main Rotunda & University Buses...');
      }
    }, 180);

    if (!engineFrameEl.src || !engineFrameEl.src.includes('/games/hide-and-seek/engine.html')) {
      engineFrameEl.src = '/games/hide-and-seek/engine.html';
    } else if (state.engineLoaded) {
      configureAndStartEngine();
    }
  }

  function configureAndStartEngine() {
    if (loadingFillEl) loadingFillEl.style.width = '100%';
    if (loadingTitleEl) loadingTitleEl.textContent = 'Campus Ready!';
    setTimeout(() => {
      loadingOverlayEl.classList.add('hidden');
      postToEngine({
        type: 'CONFIGURE',
        exploreMode: state.mode === 'explore',
        role: 'hider',
        difficulty: state.difficulty,
        muted: state.muted,
        quality: state.quality,
        pinMode: state.quality,
        flickerReduction: false,
        screenShakeOff: false,
      });
      syncWebOptionsToEngine();
      if (state.spawnCoords) {
        postToEngine({
          type: 'WEB_TELEPORT',
          coords: state.spawnCoords,
          label: 'Selected Spawn',
        });
      }
      requestEnginePointerLock();
    }, 120);
  }

  function syncWebOptionsToEngine() {
    postToEngine({
      type: 'WEB_SET_OPTIONS',
      adaptiveRes: state.adaptiveRes,
      ssao: state.ssao,
      bloomStrength: state.bloomStrength,
      flashlightIntensity: state.flashlightIntensity,
      fogDensity: state.fogDensity,
      mouseSensitivity: state.mouseSensitivity,
    });
  }

  function requestEnginePointerLock() {
    if (!engineFrameEl || !engineFrameEl.contentWindow) return;
    engineFrameEl.focus();
    postToEngine({ type: 'WEB_REQUEST_POINTER_LOCK' });
  }

  // 5. Fullscreen, Pause Modal & HUD Actions
  function toggleFullscreen() {
    const docEl = document.documentElement;
    if (!document.fullscreenElement) {
      if (docEl.requestFullscreen) docEl.requestFullscreen().catch(() => {});
    } else {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    }
  }

  function setPaused(paused) {
    if (!state.isPlaying) return;
    state.isPaused = paused;
    if (pauseModalEl) {
      pauseModalEl.classList.toggle('hidden', !paused);
    }
    if (paused) {
      if (document.pointerLockElement && document.exitPointerLock) {
        try { document.exitPointerLock(); } catch (e) {}
      }
      try {
        const iDoc = engineFrameEl.contentDocument;
        if (iDoc && iDoc.pointerLockElement && iDoc.exitPointerLock) {
          iDoc.exitPointerLock();
        }
      } catch (e) {}
    } else {
      requestEnginePointerLock();
    }
  }

  function bindHudAndPauseEvents() {
    const pauseBtn = document.getElementById('hud-btn-pause');
    if (pauseBtn) pauseBtn.addEventListener('click', () => setPaused(!state.isPaused));

    const resumeBtn = document.getElementById('btn-resume-top');
    if (resumeBtn) resumeBtn.addEventListener('click', () => setPaused(false));

    if (pointerLockBannerEl) {
      pointerLockBannerEl.addEventListener('click', () => {
        setPaused(false);
        requestEnginePointerLock();
      });
    }

    const hudQualityBtn = document.getElementById('hud-btn-quality');
    if (hudQualityBtn) {
      hudQualityBtn.addEventListener('click', () => {
        const order = ['ultra', 'high', 'low', 'fast'];
        const nextQ = order[(order.indexOf(state.quality) + 1) % order.length];
        state.quality = nextQ;
        document.querySelectorAll('#lobby-gfx-selector .seg-item, #pause-gfx-selector .seg-item').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-quality') === nextQ);
        });
        if (hudQualityLabelEl) hudQualityLabelEl.textContent = `GFX: ${QUALITY_LABELS[nextQ]}`;
        postToEngine({ type: 'SET_QUALITY', quality: nextQ, pinMode: nextQ });
      });
    }

    const hudMuteBtn = document.getElementById('hud-btn-mute');
    const optMuteEl = document.getElementById('opt-mute');
    const toggleMute = (forceVal) => {
      state.muted = typeof forceVal === 'boolean' ? forceVal : !state.muted;
      if (hudMuteLabelEl) hudMuteLabelEl.textContent = state.muted ? 'AUDIO: MUTED' : 'AUDIO: ON';
      if (optMuteEl) optMuteEl.checked = state.muted;
      postToEngine({ type: 'SET_MUTE', muted: state.muted });
    };
    if (hudMuteBtn) hudMuteBtn.addEventListener('click', () => toggleMute());
    if (optMuteEl) optMuteEl.addEventListener('change', () => toggleMute(optMuteEl.checked));

    const hudFsBtn = document.getElementById('hud-btn-fullscreen');
    if (hudFsBtn) hudFsBtn.addEventListener('click', toggleFullscreen);

    // Pause Modal Sliders & Checkboxes
    const optAdaptiveEl = document.getElementById('opt-adaptive-res');
    if (optAdaptiveEl) {
      optAdaptiveEl.addEventListener('change', () => {
        state.adaptiveRes = optAdaptiveEl.checked;
        syncWebOptionsToEngine();
      });
    }

    const optSsaoEl = document.getElementById('opt-ssao');
    if (optSsaoEl) {
      optSsaoEl.addEventListener('change', () => {
        state.ssao = optSsaoEl.checked;
        syncWebOptionsToEngine();
      });
    }

    const optBloomEl = document.getElementById('opt-bloom');
    if (optBloomEl) {
      optBloomEl.addEventListener('input', () => {
        state.bloomStrength = Number(optBloomEl.value);
        syncWebOptionsToEngine();
      });
    }

    const optFlashlightEl = document.getElementById('opt-flashlight');
    if (optFlashlightEl) {
      optFlashlightEl.addEventListener('input', () => {
        state.flashlightIntensity = Number(optFlashlightEl.value);
        syncWebOptionsToEngine();
      });
    }

    const optFogEl = document.getElementById('opt-fog');
    if (optFogEl) {
      optFogEl.addEventListener('input', () => {
        state.fogDensity = Number(optFogEl.value);
        syncWebOptionsToEngine();
      });
    }

    const optSensEl = document.getElementById('opt-sensitivity');
    if (optSensEl) {
      optSensEl.addEventListener('input', () => {
        state.mouseSensitivity = Number(optSensEl.value);
        syncWebOptionsToEngine();
      });
    }

    const optVolEl = document.getElementById('opt-volume');
    if (optVolEl) {
      optVolEl.addEventListener('input', () => {
        state.volume = Number(optVolEl.value);
        postToEngine({ type: 'SET_AMBIENCE_VOLUME', volume: state.volume });
      });
    }

    const teleportSelect = document.getElementById('pause-teleport-select');
    if (teleportSelect) {
      teleportSelect.addEventListener('change', () => {
        if (!teleportSelect.value) return;
        const label = teleportSelect.options[teleportSelect.selectedIndex]?.text || 'Landmark';
        postToEngine({
          type: 'WEB_TELEPORT',
          coords: teleportSelect.value,
          label,
        });
        teleportSelect.value = '';
        setPaused(false);
      });
    }

    const inspectorBtn = document.getElementById('btn-toggle-inspector');
    if (inspectorBtn) {
      inspectorBtn.addEventListener('click', () => {
        postToEngine({ type: 'WEB_TOGGLE_DEBUG_HUD' });
        setPaused(false);
      });
    }

    const restartBtn = document.getElementById('btn-restart-match');
    if (restartBtn) {
      restartBtn.addEventListener('click', () => {
        postToEngine({ type: 'RESTART_GAME' });
        setPaused(false);
      });
    }

    const returnLobbyBtn = document.getElementById('btn-return-lobby');
    if (returnLobbyBtn) {
      returnLobbyBtn.addEventListener('click', () => {
        state.isPlaying = false;
        state.isPaused = false;
        pauseModalEl.classList.add('hidden');
        viewportEl.classList.add('hidden');
        topNavEl.classList.remove('hidden');
        lobbyScreenEl.classList.remove('hidden');
      });
    }

    // Global Keyboard Shortcuts (Tab / Escape for Pause Modal)
    window.addEventListener('keydown', (e) => {
      if (!state.isPlaying) return;
      if (e.code === 'Tab' || e.code === 'Escape') {
        e.preventDefault();
        setPaused(!state.isPaused);
      } else if (e.code === 'F11') {
        e.preventDefault();
        toggleFullscreen();
      }
    });
  }

  // 6. Listen to Engine Events & Live WebGL Telemetry
  window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data || data.source !== 'HIDE_AND_SEEK_ENGINE') return;

    if (data.type === 'ENGINE_READY') {
      state.engineLoaded = true;
      if (state.isPlaying) {
        configureAndStartEngine();
      }
    } else if (data.type === 'POINTER_LOCK_CHANGED') {
      state.pointerLocked = !!data.locked;
      if (pointerLockBannerEl) {
        pointerLockBannerEl.classList.toggle('hidden', state.pointerLocked || state.isPaused);
      }
    } else if (data.type === 'WEB_TELEMETRY') {
      if (hudFpsValEl) hudFpsValEl.textContent = `${data.fps || 60} FPS`;
      if (hudMsValEl) hudMsValEl.textContent = `${data.frameMs || '16.6'}ms`;
      if (hudDrawsValEl) hudDrawsValEl.textContent = `${data.drawCalls || 0} draws`;
      if (hudScaleValEl) hudScaleValEl.textContent = `${data.resScale || 1.0}x`;
      if (hudRoomLabelEl && data.room) hudRoomLabelEl.textContent = data.room;
      if (hudCoordsLabelEl && data.pos) {
        hudCoordsLabelEl.textContent = `XYZ: (${data.pos.x}, ${data.pos.y}, ${data.pos.z})`;
      }
    } else if (data.type === 'SCREENSHOT_UI_VISIBILITY') {
      const hide = Boolean(data.hidden);
      document.getElementById('web-hud-top')?.classList.toggle('hidden', hide);
      document.getElementById('web-hud-bottom')?.classList.toggle('hidden', hide);
    }
  });

  // Expose host controller for automated Playwright verification
  window.__HIDE_AND_SEEK_WEB_HOST__ = {
    getState: () => ({ ...state }),
    launchGameSession,
    setPaused,
    toggleFullscreen,
    postToEngine,
  };

  initAuthBadge();
  loadWorldMetadata();
  bindLobbyControls();
  bindHudAndPauseEvents();
})();
