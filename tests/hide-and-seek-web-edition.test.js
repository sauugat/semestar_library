const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { execSync } = require('node:child_process');
const app = require('../server');
const {
  loadAuthoritativeWebConfig,
  buildWebEditionEngineHtml,
  getWebEditionMetadata,
} = require('../lib/hide-and-seek-web-engine');

/**
 * Helper to invoke Express routes in-memory without binding a TCP port
 */
function invokeExpressRoute(expressApp, method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = urlPath;
    req.originalUrl = urlPath;
    req.path = urlPath.split('?')[0];
    req.headers = { host: 'semester-library.local', accept: '*/*' };
    req.socket = { remoteAddress: '127.0.0.1' };
    req.connection = req.socket;
    req.get = (h) => req.headers[h.toLowerCase()];

    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    const chunks = [];

    res.setHeader = (k, v) => {
      res.headers[k.toLowerCase()] = v;
      return res;
    };
    res.getHeader = (k) => res.headers[k.toLowerCase()];
    res.removeHeader = (k) => {
      delete res.headers[k.toLowerCase()];
    };
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.writeHead = (code, headers) => {
      res.statusCode = code;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          res.setHeader(k, v);
        }
      }
      return res;
    };
    res.write = (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    };
    res.end = (chunk) => {
      if (chunk) res.write(chunk);
      const bodyBuffer = Buffer.concat(chunks);
      resolve({
        status: res.statusCode,
        headers: res.headers,
        text: () => bodyBuffer.toString('utf8'),
        json: () => JSON.parse(bodyBuffer.toString('utf8')),
      });
    };
    res.sendFile = (filePath) => {
      try {
        const content = fs.readFileSync(filePath);
        res.end(content);
      } catch (err) {
        reject(err);
      }
    };
    res.json = (obj) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(obj));
    };
    res.send = (body) => {
      if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) {
        return res.json(body);
      }
      res.end(body);
    };

    expressApp.handle(req, res, (err) => {
      if (err) reject(err);
      else resolve({ status: 404, headers: res.headers, text: () => 'Not Found' });
    });
  });
}

/**
 * Initializes the compiled Web Edition 3D Engine inside an instrumented Desktop Browser VM
 */
function createDesktopWebEngineHarness() {
  const html = buildWebEditionEngineHtml();
  const scripts = [];
  const scriptRegex = /<script>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    scripts.push(match[1]);
  }
  assert.strictEqual(scripts.length, 2, `Expected 2 script blocks in compiled Web Edition HTML, found ${scripts.length}`);

  const elements = new Map();
  const docListeners = {};
  const winListeners = {};
  const postedMessages = [];

  const makeElement = (id = '') => {
    const elListeners = {};
    const el = {
      id,
      tagName: 'DIV',
      innerText: '',
      textContent: '',
      innerHTML: '',
      value: '',
      style: {
        setProperty(k, v) {
          this[k] = v;
        },
      },
      dataset: {},
      children: [],
      classList: {
        _set: new Set(),
        add(...cls) {
          cls.forEach((c) => this._set.add(c));
        },
        remove(...cls) {
          cls.forEach((c) => this._set.delete(c));
        },
        contains(c) {
          return this._set.has(c);
        },
        toggle(c, force) {
          if (force === undefined) {
            if (this._set.has(c)) this._set.delete(c);
            else this._set.add(c);
          } else if (force) {
            this._set.add(c);
          } else {
            this._set.delete(c);
          }
        },
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) this.children.splice(idx, 1);
      },
      addEventListener(type, fn) {
        if (!elListeners[type]) elListeners[type] = [];
        elListeners[type].push(fn);
      },
      removeEventListener(type, fn) {
        if (!elListeners[type]) return;
        elListeners[type] = elListeners[type].filter((f) => f !== fn);
      },
      dispatchEvent(evt) {
        const list = elListeners[evt.type] || [];
        list.forEach((fn) => fn(evt));
      },
      requestPointerLock() {
        documentObj.pointerLockElement = el;
        const lockEv = { type: 'pointerlockchange' };
        (docListeners['pointerlockchange'] || []).forEach((fn) => fn(lockEv));
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 1440, height: 900 };
      },
      querySelector() {
        return makeElement();
      },
      querySelectorAll() {
        return [];
      },
      getContext(type) {
        if (type === '2d') {
          return {
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 1,
            font: '',
            textAlign: 'left',
            textBaseline: 'alphabetic',
            globalAlpha: 1,
            fillRect() {},
            strokeRect() {},
            clearRect() {},
            fillText() {},
            strokeText() {},
            beginPath() {},
            closePath() {},
            moveTo() {},
            lineTo() {},
            arc() {},
            ellipse() {},
            quadraticCurveTo() {},
            bezierCurveTo() {},
            fill() {},
            stroke() {},
            save() {},
            restore() {},
            translate() {},
            rotate() {},
            scale() {},
            setTransform() {},
            resetTransform() {},
            clip() {},
            measureText(t) {
              return { width: String(t).length * 8 };
            },
            getImageData(x, y, w, h) {
              return { data: new Uint8ClampedArray(w * h * 4) };
            },
            putImageData() {},
            drawImage() {},
            createLinearGradient() {
              return { addColorStop() {} };
            },
            createRadialGradient() {
              return { addColorStop() {} };
            },
          };
        }
        return null;
      },
    };
    return el;
  };

  const documentObj = {
    pointerLockElement: null,
    fullscreenElement: null,
    body: makeElement('body'),
    head: makeElement('head'),
    documentElement: makeElement('html'),
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, makeElement(id));
      }
      return elements.get(id);
    },
    createElement(tag) {
      const el = makeElement(tag);
      el.tagName = String(tag).toUpperCase();
      el.width = 256;
      el.height = 256;
      return el;
    },
    querySelector(sel) {
      const id = sel.startsWith('#') ? sel.slice(1) : sel;
      return this.getElementById(id);
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type, fn) {
      if (!docListeners[type]) docListeners[type] = [];
      docListeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (!docListeners[type]) return;
      docListeners[type] = docListeners[type].filter((f) => f !== fn);
    },
    exitPointerLock() {
      documentObj.pointerLockElement = null;
      const lockEv = { type: 'pointerlockchange' };
      (docListeners['pointerlockchange'] || []).forEach((fn) => fn(lockEv));
    },
  };

  let rafCallback = null;
  let nowMs = 1000;

  const windowObj = {
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 2,
    document: documentObj,
    navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36' },
    performance: {
      now: () => nowMs,
    },
    parent: {
      postMessage(msg) {
        postedMessages.push(msg);
      },
    },
    addEventListener(type, fn) {
      if (!winListeners[type]) winListeners[type] = [];
      winListeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (!winListeners[type]) return;
      winListeners[type] = winListeners[type].filter((f) => f !== fn);
    },
    dispatchEvent(evt) {
      const list = winListeners[evt.type] || [];
      list.forEach((fn) => fn(evt));
    },
    requestAnimationFrame(cb) {
      rafCallback = cb;
      return 1;
    },
    cancelAnimationFrame() {},
    setTimeout(fn, delay) {
      if (!delay || delay <= 150) {
        fn();
      }
      return 1;
    },
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
    AudioContext: function () {
      return {
        state: 'running',
        currentTime: 0,
        destination: {},
        resume: () => Promise.resolve(),
        createGain: () => ({
          connect() {},
          gain: { value: 1, setValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
        }),
        createOscillator: () => ({
          type: 'sine',
          connect() {},
          start() {},
          stop() {},
          frequency: { value: 440, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {} },
        }),
        createBiquadFilter: () => ({
          type: 'lowpass',
          connect() {},
          frequency: { value: 800, setValueAtTime() {}, setTargetAtTime() {} },
          Q: { value: 1, setValueAtTime() {} },
        }),
        createBufferSource: () => ({
          connect() {},
          start() {},
          stop() {},
          playbackRate: { value: 1, setValueAtTime() {} },
          buffer: null,
        }),
        createBuffer: (ch, len) => ({
          getChannelData: () => new Float32Array(len || 100),
        }),
      };
    },
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    btoa: (bin) => Buffer.from(bin, 'binary').toString('base64'),
  };
  windowObj.window = windowObj;
  windowObj.self = windowObj;
  windowObj.top = windowObj;

  const sandbox = {
    window: windowObj,
    self: windowObj,
    top: windowObj,
    document: documentObj,
    navigator: windowObj.navigator,
    performance: windowObj.performance,
    AudioContext: windowObj.AudioContext,
    webkitAudioContext: windowObj.AudioContext,
    requestAnimationFrame: windowObj.requestAnimationFrame,
    cancelAnimationFrame: windowObj.cancelAnimationFrame,
    setTimeout: windowObj.setTimeout,
    clearTimeout: windowObj.clearTimeout,
    setInterval: windowObj.setInterval,
    clearInterval: windowObj.clearInterval,
    atob: windowObj.atob,
    btoa: windowObj.btoa,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int8Array,
    Int16Array,
    Int32Array,
    Float32Array,
    Float64Array,
    ArrayBuffer,
    DataView,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Math,
    Date,
    JSON,
    Number,
    String,
    Boolean,
    Object,
    Array,
    RegExp,
    Error,
    TypeError,
    RangeError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    console: {
      log() {},
      warn() {},
      error() {},
      info() {},
    },
  };
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);

  // 1. Run Three.js r128 + GLTFLoader script
  vm.runInContext(scripts[0], ctx);

  // Instrument THREE.WebGLRenderer and THREE.PMREMGenerator for headless node VM
  vm.runInContext(
    `
    (function() {
      THREE.WebGLRenderer = function(opts) {
        this.domElement = (opts && opts.canvas) || document.createElement('canvas');
        this.shadowMap = { enabled: true, type: THREE.PCFSoftShadowMap, autoUpdate: true, needsUpdate: false };
        this.toneMapping = THREE.ACESFilmicToneMapping;
        this.toneMappingExposure = 1.0;
        this.outputEncoding = THREE.sRGBEncoding;
        this.physicallyCorrectLights = true;
        this.capabilities = {
          maxTextures: 16,
          getMaxAnisotropy: function() { return 16; }
        };
        this.info = {
          render: { calls: 142, triangles: 68420, frame: 0, lines: 0, points: 0 },
          memory: { geometries: 215, textures: 38 }
        };
        this._pixelRatio = 1;
        this._width = 1440;
        this._height = 900;
        this.setSize = function(w, h) { this._width = w; this._height = h; };
        this.setPixelRatio = function(pr) { this._pixelRatio = pr; };
        this.getPixelRatio = function() { return this._pixelRatio; };
        this.setRenderTarget = function() {};
        this.clear = function() {};
        this.render = function(sceneObj) {
          this.info.render.frame++;
          if (sceneObj && sceneObj === window.__TEST_SCENE_REF__) {
            let calls = 0;
            let tris = 0;
            sceneObj.traverse(function(o) {
              if (o.isMesh && o.visible && o.geometry) {
                calls++;
                const idx = o.geometry.index;
                const pos = o.geometry.attributes && o.geometry.attributes.position;
                if (idx) tris += Math.floor(idx.count / 3);
                else if (pos) tris += Math.floor(pos.count / 3);
              }
            });
            this.info.render.calls = calls;
            this.info.render.triangles = tris;
          }
        };
        this.dispose = function() {};
      };

      THREE.PMREMGenerator = function() {
        this.compileCubemapShader = function() {};
        this.fromScene = function() {
          return { texture: new THREE.Texture() };
        };
        this.dispose = function() {};
      };
    })();
    `,
    ctx
  );

  // 2. Run main game engine + Web Edition overhaul script, exposing scene & internals
  const mainGameScript =
    scripts[1] +
    `\n;window.__TEST_SCENE_REF__ = scene; window.__TEST_INTERNALS__ = { scene, camera, renderer, atmosphere, playerPhysics, colliders, roomVisibilityList, buildingSectors, qualityPresets: HORROR_CONFIG.qualityPresets };`;
  vm.runInContext(mainGameScript, ctx);

  function stepFrames(count = 1, dtMs = 16.667) {
    for (let i = 0; i < count; i++) {
      nowMs += dtMs;
      if (rafCallback) rafCallback(nowMs);
    }
  }

  return {
    ctx,
    windowObj,
    documentObj,
    docListeners,
    winListeners,
    postedMessages,
    stepFrames,
  };
}

test('Hide & Seek Web Edition — Architecture, Single Source of Truth, Graphics Overhaul & Benchmarks', async (t) => {
  // 1. Verify Strict Restriction: Zero modifications to mobile/ directory
  await t.test('1. Strict Restriction: Zero mobile app files modified in git working tree', () => {
    const diffOut = execSync('git status --porcelain mobile/', {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
    }).trim();
    assert.strictEqual(diffOut, '', `Expected 0 modified files in mobile/, found:\n${diffOut}`);
  });

  // 2. Verify Single-Source-of-Truth Compiler & Campus Map Integrity
  await t.test('2. Single-Source Compiler: 139 campus objects, 128x128 terrain, 32 enterable rooms, and 4 desktop presets', () => {
    const config = loadAuthoritativeWebConfig();
    const meta = getWebEditionMetadata();

    assert.strictEqual(meta.totalObjects, 139, 'Expected all 139 campus layout objects');
    assert.strictEqual(meta.terrainSize, 320, 'Expected 320m campus terrain size');
    assert.strictEqual(meta.terrainSegments, 128, 'Expected 128x128 terrain grid');
    assert.strictEqual(meta.enterableRooms, 32, 'Expected 32 enterable rooms');
    assert.strictEqual(config.qualityPresets.ultra.shadowMapSize, 4096, 'Expected 4096px shadow map on Ultra');
    assert.strictEqual(config.qualityPresets.high.shadowMapSize, 2048, 'Expected 2048px shadow map on High');
    assert.strictEqual(config.qualityPresets.low.shadowMapSize, 1024, 'Expected 1024px shadow map on Balanced');
    assert.strictEqual(config.qualityPresets.fast.shadowMapSize, 512, 'Expected 512px shadow map on Performance');

    const engineHtml = buildWebEditionEngineHtml();
    assert.ok(engineHtml.length > 1500000, 'Expected compiled Web Edition HTML > 1.5MB');
    assert.ok(engineHtml.includes('initWebEditionOverhaul'), 'Expected Web Edition overhaul script injected');
    assert.ok(engineHtml.includes('uSsaoStrength'), 'Expected SSAO shader uniform in post-processing pass');
    assert.ok(engineHtml.includes('RealisticNightSkyDome'), 'Expected realistic night sky dome with drifting clouds');
  });

  // 3. Verify Website HTTP Routes (/games/hide-and-seek, /api/games/hide-and-seek/metadata, /api/games/hide-and-seek/engine)
  await t.test('3. Website & Vercel Routes: /games/hide-and-seek, /api/games/hide-and-seek/metadata, /api/games/hide-and-seek/engine', async () => {
    const lobbyRes = await invokeExpressRoute(app, 'GET', '/games/hide-and-seek');
    assert.strictEqual(lobbyRes.status, 200);
    const lobbyHtml = lobbyRes.text();
    assert.ok(lobbyHtml.includes('GANDAKI UNIVERSITY NIGHT CAMPUS — WEB EDITION'));
    assert.ok(lobbyHtml.includes('/auth.js'), 'Expected SemesterAuth integration in Web Edition page');

    const metaRes = await invokeExpressRoute(app, 'GET', '/api/games/hide-and-seek/metadata');
    assert.strictEqual(metaRes.status, 200);
    const metaJson = metaRes.json();
    assert.strictEqual(metaJson.totalObjects, 139);
    assert.strictEqual(metaJson.enterableRooms, 32);

    const engRes = await invokeExpressRoute(app, 'GET', '/api/games/hide-and-seek/engine');
    assert.strictEqual(engRes.status, 200);
    const engText = engRes.text();
    assert.ok(engText.includes('window.__WEB_EDITION__'));
  });

  // 4. Verify Web Edition Graphics Overhaul, Desktop Controls, Interior Lighting & Measured Benchmarks
  await t.test('4. Desktop Engine Execution: Graphics Presets, SSAO, 50Hz Fluorescents, Pointer Lock, WASD & Benchmarks', () => {
    const harness = createDesktopWebEngineHarness();
    const { windowObj, documentObj, docListeners, winListeners, stepFrames } = harness;

    assert.ok(windowObj.__WEB_EDITION__, 'Expected window.__WEB_EDITION__ controller');
    assert.ok(windowObj.__TERRAIN_MESH_AUDIT__, 'Expected window.__TERRAIN_MESH_AUDIT__');

    // Verify 128x128 320m Terrain Mesh Integrity
    const terrainAudit = windowObj.__TERRAIN_MESH_AUDIT__;
    assert.strictEqual(terrainAudit.size, 320);
    assert.strictEqual(terrainAudit.segments, 128);
    assert.strictEqual(terrainAudit.vertexCount, 16641);

    // Step 5 frames on default desktop startup ('high' 2K shadows), then switch to 'ultra' (4K shadows)
    stepFrames(5, 16.667);
    const defaultTel = windowObj.__WEB_EDITION__.getTelemetry();
    assert.strictEqual(defaultTel.preset, 'high');
    assert.strictEqual(defaultTel.shadowMapSize, 2048);

    windowObj.__WEB_EDITION__.setQualityPreset('ultra');
    stepFrames(5, 16.667);
    const ultraTel = windowObj.__WEB_EDITION__.getTelemetry();
    assert.strictEqual(ultraTel.preset, 'ultra');
    assert.strictEqual(ultraTel.shadowMapSize, 4096);
    assert.strictEqual(ultraTel.ssao, true);
    assert.strictEqual(ultraTel.anisotropy, 16);
    assert.ok(ultraTel.drawCalls > 100, `Expected >100 active scene mesh draw calls, measured ${ultraTel.drawCalls}`);
    assert.ok(ultraTel.triangles > 20000, `Expected >20,000 rendered triangles, measured ${ultraTel.triangles}`);

    // Measure 60-frame CPU update + scene traversal benchmark across all 4 graphics presets
    const presetBenchmarks = {};
    for (const presetName of ['ultra', 'high', 'low', 'fast']) {
      windowObj.__WEB_EDITION__.setQualityPreset(presetName);
      const t0 = performance.now();
      stepFrames(60, 16.667);
      const elapsedMs = performance.now() - t0;
      const avgCpuStepMs = elapsedMs / 60;
      const tel = windowObj.__WEB_EDITION__.getTelemetry();
      presetBenchmarks[presetName] = {
        shadowMapSize: tel.shadowMapSize,
        resScale: tel.resScale,
        drawCalls: tel.drawCalls,
        triangles: tel.triangles,
        avgCpuStepMs: Number(avgCpuStepMs.toFixed(3)),
      };
    }

    assert.strictEqual(presetBenchmarks.ultra.shadowMapSize, 4096);
    assert.strictEqual(presetBenchmarks.high.shadowMapSize, 2048);
    assert.strictEqual(presetBenchmarks.low.shadowMapSize, 1024);
    assert.strictEqual(presetBenchmarks.fast.shadowMapSize, 512);

    // Restore Ultra preset for control & interior lighting tests
    windowObj.__WEB_EDITION__.setQualityPreset('ultra');

    // Verify Desktop Pointer Lock Mouse Look (yaw & pitch response)
    const canvasEl = windowObj.__TEST_INTERNALS__.renderer.domElement;
    canvasEl.requestPointerLock();
    assert.strictEqual(documentObj.pointerLockElement, canvasEl, 'Expected canvas to acquire Pointer Lock');

    const yawBefore = windowObj.__TEST_INTERNALS__.playerPhysics.targetYaw;
    const pitchBefore = windowObj.__TEST_INTERNALS__.playerPhysics.targetPitch;
    (winListeners['mousemove'] || []).forEach((fn) =>
      fn({ movementX: 120, movementY: -45 })
    );
    stepFrames(5, 16.667);
    const yawAfter = windowObj.__TEST_INTERNALS__.playerPhysics.targetYaw;
    const pitchAfter = windowObj.__TEST_INTERNALS__.playerPhysics.targetPitch;
    assert.ok(Math.abs(yawAfter - yawBefore) > 0.15, 'Expected Pointer Lock horizontal mouse movement to rotate camera yaw');
    assert.ok(Math.abs(pitchAfter - pitchBefore) > 0.05, 'Expected Pointer Lock vertical mouse movement to tilt camera pitch');

    // Verify Desktop WASD + Shift Sprint Movement
    const posBefore = { ...windowObj.__WEB_EDITION__.getTelemetry().pos };
    (winListeners['keydown'] || []).forEach((fn) => fn({ code: 'KeyW', preventDefault() {} }));
    (winListeners['keydown'] || []).forEach((fn) => fn({ code: 'ShiftLeft', preventDefault() {} }));
    stepFrames(30, 16.667);
    (winListeners['keyup'] || []).forEach((fn) => fn({ code: 'KeyW', preventDefault() {} }));
    (winListeners['keyup'] || []).forEach((fn) => fn({ code: 'ShiftLeft', preventDefault() {} }));
    const posAfter = { ...windowObj.__WEB_EDITION__.getTelemetry().pos };
    const movedDist = Math.hypot(posAfter.x - posBefore.x, posAfter.z - posBefore.z);
    assert.ok(movedDist > 1.2, `Expected WASD + Shift sprint over 0.5s to move > 1.2m, measured ${movedDist.toFixed(3)}m`);

    // Verify Interior Fluorescent Lighting Rig activation when teleported inside West Wing L1 Classroom 1 (-15.3, 1.62, -9.5)
    windowObj.__WEB_EDITION__.teleport(-15.3, 1.62, -9.5, 3.14);
    stepFrames(15, 16.667);
    const interiorState = vm.runInContext(
      `({
        fillIntensity: atmosphere.webInteriorFillLight ? atmosphere.webInteriorFillLight.intensity : 0,
        bounceIntensity: atmosphere.webCeilingBounceLight ? atmosphere.webCeilingBounceLight.intensity : 0,
        fixtureCount: atmosphere.webFluorescentFixtures ? atmosphere.webFluorescentFixtures.length : 0,
        roomTag: document.getElementById('room-tag') ? document.getElementById('room-tag').innerText : ''
      })`,
      harness.ctx
    );
    assert.ok(interiorState.fixtureCount > 20, `Expected >20 tracked fluorescent light fixtures, found ${interiorState.fixtureCount}`);
    assert.ok(
      interiorState.fillIntensity > 0.5,
      `Expected interior fluorescent fill light intensity > 0.5 inside classroom, measured ${interiorState.fillIntensity.toFixed(3)}`
    );

    console.log('[Web Edition Measured Benchmarks]', JSON.stringify({
      terrainAudit,
      presetBenchmarks,
      interiorState,
      movedDistMeters: Number(movedDist.toFixed(3)),
    }));
  });
});
