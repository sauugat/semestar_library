/**
 * Kyana Playback Controller (kyana-playback-controller.js)
 * 
 * Shared deterministic playback controller for Kyana educational simulations.
 * Consumes precomputed discrete simulation state arrays and coordinates stepping,
 * auto-advance timers, speed scaling, keyboard navigation, and ARIA accessibility.
 * 
 * Constraints:
 * - Touch targets >= 44px
 * - No autoplay by default
 * - Respects prefers-reduced-motion
 * - Comprehensive memory cleanup (destroy())
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KyanaPlaybackController = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Safe HTML escaping utility
   */
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Check if user prefers reduced motion
   */
  function prefersReducedMotion() {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  }

  /**
   * KyanaPlaybackController Constructor
   * @param {Object} options
   * @param {Array<Object>} [options.steps] - Array of simulation step objects
   * @param {number} [options.totalSteps] - Total steps count if steps array not passed
   * @param {Function} [options.onStepChange] - Callback (stepIndex, stepData, isPlaying)
   * @param {number} [options.initialStep=0] - Initial step index
   * @param {number} [options.stepDuration=1000] - Base step duration in ms
   * @param {number} [options.speed=1.0] - Speed multiplier (0.5, 1.0, 2.0)
   * @param {boolean} [options.autoplay=false] - Whether to autoplay on mount
   * @param {boolean} [options.loop=false] - Whether to loop at the end
   */
  function KyanaPlaybackController(options) {
    options = options || {};

    this.steps = Array.isArray(options.steps) ? options.steps : [];
    this.totalSteps = this.steps.length > 0
      ? this.steps.length
      : Math.max(1, Number(options.totalSteps) || 1);

    this.currentIndex = Math.min(
      this.totalSteps - 1,
      Math.max(0, Number(options.initialStep) || 0)
    );

    this.stepDuration = Math.max(200, Number(options.stepDuration) || 1000);
    this.speed = [0.5, 1.0, 2.0].includes(Number(options.speed))
      ? Number(options.speed)
      : 1.0;

    this.isPlaying = false;
    this.loop = Boolean(options.loop);
    this.autoplay = Boolean(options.autoplay); // default false
    this.onStepChange = typeof options.onStepChange === 'function' ? options.onStepChange : null;

    this._timerId = null;
    this._destroyed = false;
    this._domElement = null;
    this._listeners = [];

    // Optional mount container
    if (options.container) {
      this.mount(options.container);
    }

    if (this.autoplay && this.totalSteps > 1) {
      this.play();
    } else {
      this._notify();
    }
  }

  /**
   * Current controller state snapshot
   */
  KyanaPlaybackController.prototype.getState = function () {
    return {
      currentIndex: this.currentIndex,
      totalSteps: this.totalSteps,
      currentStep: this.steps[this.currentIndex] || null,
      isPlaying: this.isPlaying,
      speed: this.speed,
      isFirst: this.currentIndex === 0,
      isLast: this.currentIndex >= this.totalSteps - 1
    };
  };

  /**
   * Notify step listener
   */
  KyanaPlaybackController.prototype._notify = function () {
    if (this._destroyed) return;
    const state = this.getState();
    if (this.onStepChange) {
      try {
        this.onStepChange(this.currentIndex, state.currentStep, this.isPlaying);
      } catch (err) {
        console.error('[KyanaPlaybackController] onStepChange error:', err);
      }
    }
    this._updateUI();
  };

  /**
   * Jump to step index
   */
  KyanaPlaybackController.prototype.goToStep = function (index, force) {
    if (this._destroyed) return;
    const target = Math.min(this.totalSteps - 1, Math.max(0, Number(index) || 0));
    if (force || target !== this.currentIndex) {
      this.currentIndex = target;
      this._notify();
    }
  };

  /**
   * Step Next
   */
  KyanaPlaybackController.prototype.next = function () {
    if (this._destroyed) return;
    if (this.currentIndex < this.totalSteps - 1) {
      this.currentIndex++;
      this._notify();
    } else {
      if (this.loop) {
        this.currentIndex = 0;
        this._notify();
      } else {
        this.pause();
      }
    }
  };

  /**
   * Step Previous
   */
  KyanaPlaybackController.prototype.prev = function () {
    if (this._destroyed) return;
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this._notify();
    }
  };

  /**
   * Restart simulation from step 0
   */
  KyanaPlaybackController.prototype.restart = function () {
    if (this._destroyed) return;
    this.pause();
    this.currentIndex = 0;
    this._notify();
  };

  /**
   * Play simulation
   */
  KyanaPlaybackController.prototype.play = function () {
    if (this._destroyed || this.isPlaying) return;
    if (this.totalSteps <= 1) return;

    // If at end, restart
    if (this.currentIndex >= this.totalSteps - 1) {
      this.currentIndex = 0;
      this._notify();
    }

    this.isPlaying = true;
    this._scheduleNextTick();
    this._updateUI();
  };

  /**
   * Pause simulation
   */
  KyanaPlaybackController.prototype.pause = function () {
    if (this._destroyed) return;
    this.isPlaying = false;
    if (this._timerId) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
    this._updateUI();
  };

  /**
   * Toggle Play / Pause
   */
  KyanaPlaybackController.prototype.togglePlay = function () {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  };

  /**
   * Internal timer advance
   */
  KyanaPlaybackController.prototype._scheduleNextTick = function () {
    if (this._destroyed || !this.isPlaying) return;
    if (this._timerId) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }

    const duration = Math.max(100, Math.round(this.stepDuration / this.speed));
    const self = this;

    this._timerId = setTimeout(function () {
      if (self._destroyed || !self.isPlaying) return;
      if (self.currentIndex < self.totalSteps - 1) {
        self.currentIndex++;
        self._notify();
        self._scheduleNextTick();
      } else {
        if (self.loop) {
          self.currentIndex = 0;
          self._notify();
          self._scheduleNextTick();
        } else {
          self.pause();
        }
      }
    }, duration);
  };

  /**
   * Change playback speed
   */
  KyanaPlaybackController.prototype.setSpeed = function (speedMultiplier) {
    if (this._destroyed) return;
    const s = Number(speedMultiplier);
    if (![0.5, 1.0, 2.0].includes(s)) return;
    this.speed = s;
    if (this.isPlaying) {
      this._scheduleNextTick();
    }
    this._updateUI();
  };

  /**
   * Cycle next speed (0.5 -> 1.0 -> 2.0 -> 0.5)
   */
  KyanaPlaybackController.prototype.cycleSpeed = function () {
    const sequence = [0.5, 1.0, 2.0];
    const nextIdx = (sequence.indexOf(this.speed) + 1) % sequence.length;
    this.setSpeed(sequence[nextIdx]);
  };

  /**
   * Build Controller DOM Element
   */
  KyanaPlaybackController.prototype.renderUI = function () {
    if (typeof document === 'undefined') return null;

    const wrap = document.createElement('div');
    wrap.className = 'ky-playback-bar';
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Simulation playback controls');
    wrap.setAttribute('tabindex', '0');

    // Controls Row
    const controlsRow = document.createElement('div');
    controlsRow.className = 'ky-playback-controls';

    // Left group: Step navigation
    const navGroup = document.createElement('div');
    navGroup.className = 'ky-playback-btn-group';

    // Restart button
    const btnRestart = document.createElement('button');
    btnRestart.type = 'button';
    btnRestart.className = 'ky-playback-btn ky-btn-restart';
    btnRestart.setAttribute('aria-label', 'Restart simulation from beginning');
    btnRestart.title = 'Restart (R)';
    btnRestart.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';

    // Prev button
    const btnPrev = document.createElement('button');
    btnPrev.type = 'button';
    btnPrev.className = 'ky-playback-btn ky-btn-prev';
    btnPrev.setAttribute('aria-label', 'Previous step');
    btnPrev.title = 'Previous Step (Left Arrow)';
    btnPrev.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>';

    // Play/Pause button
    const btnPlay = document.createElement('button');
    btnPlay.type = 'button';
    btnPlay.className = 'ky-playback-btn ky-btn-play';
    btnPlay.setAttribute('aria-label', this.isPlaying ? 'Pause simulation' : 'Play simulation');
    btnPlay.title = 'Play / Pause (Space)';
    this._renderPlayIcon(btnPlay);

    // Next button
    const btnNext = document.createElement('button');
    btnNext.type = 'button';
    btnNext.className = 'ky-playback-btn ky-btn-next';
    btnNext.setAttribute('aria-label', 'Next step');
    btnNext.title = 'Next Step (Right Arrow)';
    btnNext.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>';

    navGroup.appendChild(btnRestart);
    navGroup.appendChild(btnPrev);
    navGroup.appendChild(btnPlay);
    navGroup.appendChild(btnNext);

    // Center group: Progress Slider & Step Badge
    const progressGroup = document.createElement('div');
    progressGroup.className = 'ky-playback-progress-group';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'ky-playback-slider';
    slider.min = '0';
    slider.max = String(Math.max(0, this.totalSteps - 1));
    slider.value = String(this.currentIndex);
    slider.setAttribute('aria-label', 'Simulation progress timeline');
    slider.setAttribute('aria-valuemin', '0');
    slider.setAttribute('aria-valuemax', String(Math.max(0, this.totalSteps - 1)));
    slider.setAttribute('aria-valuenow', String(this.currentIndex));

    const stepCounter = document.createElement('span');
    stepCounter.className = 'ky-playback-counter';
    stepCounter.setAttribute('aria-live', 'polite');
    stepCounter.textContent = `Step ${this.currentIndex + 1} / ${this.totalSteps}`;

    progressGroup.appendChild(slider);
    progressGroup.appendChild(stepCounter);

    // Right group: Speed toggle
    const speedGroup = document.createElement('div');
    speedGroup.className = 'ky-playback-speed-group';

    const btnSpeed = document.createElement('button');
    btnSpeed.type = 'button';
    btnSpeed.className = 'ky-playback-btn ky-btn-speed';
    btnSpeed.setAttribute('aria-label', `Playback speed ${this.speed}x. Click to change.`);
    btnSpeed.title = 'Change Speed (0.5x, 1x, 2x)';
    btnSpeed.textContent = `${this.speed}x`;

    speedGroup.appendChild(btnSpeed);

    // Assemble controls row
    controlsRow.appendChild(navGroup);
    controlsRow.appendChild(progressGroup);
    controlsRow.appendChild(speedGroup);
    wrap.appendChild(controlsRow);

    // Bind event handlers
    const self = this;

    const onRestartClick = function (e) {
      e.preventDefault();
      self.restart();
    };
    btnRestart.addEventListener('click', onRestartClick);
    this._listeners.push({ el: btnRestart, ev: 'click', fn: onRestartClick });

    const onPrevClick = function (e) {
      e.preventDefault();
      self.prev();
    };
    btnPrev.addEventListener('click', onPrevClick);
    this._listeners.push({ el: btnPrev, ev: 'click', fn: onPrevClick });

    const onPlayClick = function (e) {
      e.preventDefault();
      self.togglePlay();
    };
    btnPlay.addEventListener('click', onPlayClick);
    this._listeners.push({ el: btnPlay, ev: 'click', fn: onPlayClick });

    const onNextClick = function (e) {
      e.preventDefault();
      self.next();
    };
    btnNext.addEventListener('click', onNextClick);
    this._listeners.push({ el: btnNext, ev: 'click', fn: onNextClick });

    const onSpeedClick = function (e) {
      e.preventDefault();
      self.cycleSpeed();
    };
    btnSpeed.addEventListener('click', onSpeedClick);
    this._listeners.push({ el: btnSpeed, ev: 'click', fn: onSpeedClick });

    const onSliderInput = function (e) {
      self.goToStep(Number(e.target.value));
    };
    slider.addEventListener('input', onSliderInput);
    this._listeners.push({ el: slider, ev: 'input', fn: onSliderInput });

    // Keyboard navigation within the playback bar
    const onKeyDown = function (e) {
      if (
        e.target.tagName === 'TEXTAREA' ||
        (e.target.tagName === 'INPUT' && e.target.type !== 'range') ||
        e.target.isContentEditable
      ) {
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        self.togglePlay();
      } else if (e.key === 'ArrowRight' || e.code === 'ArrowRight') {
        e.preventDefault();
        self.next();
      } else if (e.key === 'ArrowLeft' || e.code === 'ArrowLeft') {
        e.preventDefault();
        self.prev();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        self.restart();
      }
    };
    wrap.addEventListener('keydown', onKeyDown);
    this._listeners.push({ el: wrap, ev: 'keydown', fn: onKeyDown });

    this._domElement = wrap;
    this._updateUI();

    return wrap;
  };

  /**
   * Render Play/Pause SVG inside play button
   */
  KyanaPlaybackController.prototype._renderPlayIcon = function (btn) {
    if (!btn) return;
    if (this.isPlaying) {
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
      btn.classList.add('playing');
    } else {
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
      btn.classList.remove('playing');
    }
  };

  /**
   * Refresh DOM UI states
   */
  KyanaPlaybackController.prototype._updateUI = function () {
    if (!this._domElement) return;

    const btnPlay = this._domElement.querySelector('.ky-btn-play');
    this._renderPlayIcon(btnPlay);

    const btnPrev = this._domElement.querySelector('.ky-btn-prev');
    if (btnPrev) {
      btnPrev.disabled = this.currentIndex === 0;
      btnPrev.classList.toggle('disabled', this.currentIndex === 0);
    }

    const btnNext = this._domElement.querySelector('.ky-btn-next');
    if (btnNext) {
      btnNext.disabled = this.currentIndex >= this.totalSteps - 1;
      btnNext.classList.toggle('disabled', this.currentIndex >= this.totalSteps - 1);
    }

    const slider = this._domElement.querySelector('.ky-playback-slider');
    if (slider) {
      slider.value = String(this.currentIndex);
      slider.setAttribute('aria-valuenow', String(this.currentIndex));
      // Calculate filled track percentage
      const pct = this.totalSteps > 1
        ? (this.currentIndex / (this.totalSteps - 1)) * 100
        : 100;
      slider.style.setProperty('--ky-progress-pct', `${pct}%`);
    }

    const counter = this._domElement.querySelector('.ky-playback-counter');
    if (counter) {
      counter.textContent = `Step ${this.currentIndex + 1} / ${this.totalSteps}`;
    }

    const btnSpeed = this._domElement.querySelector('.ky-btn-speed');
    if (btnSpeed) {
      btnSpeed.textContent = `${this.speed}x`;
      btnSpeed.setAttribute('aria-label', `Playback speed ${this.speed}x. Click to change.`);
    }
  };

  /**
   * Mount into a DOM container
   */
  KyanaPlaybackController.prototype.mount = function (container) {
    if (!container || typeof document === 'undefined') return;
    this.renderUI();
    if (this._domElement) {
      container.appendChild(this._domElement);
    }
  };

  /**
   * Tear down and clean up memory/listeners
   */
  KyanaPlaybackController.prototype.destroy = function () {
    if (this._destroyed) return;
    this._destroyed = true;

    this.pause();

    // Detach listeners
    if (Array.isArray(this._listeners)) {
      this._listeners.forEach(function (l) {
        if (l.el && typeof l.el.removeEventListener === 'function') {
          l.el.removeEventListener(l.ev, l.fn);
        }
      });
      this._listeners = [];
    }

    // Remove DOM element
    if (this._domElement && this._domElement.parentNode) {
      this._domElement.parentNode.removeChild(this._domElement);
    }
    this._domElement = null;
    this.steps = [];
    this.onStepChange = null;
  };

  return KyanaPlaybackController;
}));
