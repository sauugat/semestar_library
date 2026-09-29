/* Small, local interactions for the homepage's explicitly labeled examples. */
(() => {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const activeTransitions = new Set();
  const updateTransitions = new WeakMap();

  function animateUpdate(element) {
    if (reducedMotion.matches || !element.animate) return;
    updateTransitions.get(element)?.cancel();
    const animation = element.animate([
      { opacity: 0, transform: 'translateY(8px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' });
    activeTransitions.add(animation);
    updateTransitions.set(element, animation);
    const cleanup = () => activeTransitions.delete(animation);
    animation.finished.then(cleanup, cleanup);
  }

  const questions = {
    dbms: {
      question: 'Can you make database normalization simpler?',
      answer: 'Think of it as giving every fact a home.<br><strong>1NF:</strong> One value in each cell.<br><strong>2NF:</strong> Every non-key attribute depends on the whole key.<br><strong>3NF:</strong> Remove transitive dependencies between non-key attributes.'
    },
    code: {
      question: 'When should I use a for loop instead of a while loop?',
      answer: '<strong>Use a for loop</strong> when you want to go through a collection or a known range.<br><strong>Use a while loop</strong> when you want to repeat until a condition changes.<br>Reading every item in a list? Start with a for loop.'
    },
    revision: {
      question: 'How can I break my revision into smaller steps?',
      answer: '<strong>Start with one topic.</strong> Review the key ideas, then close your notes and explain them in your own words.<br>Try a practice question, check what you missed, and revisit that part. Leave time for a short break before the next topic.'
    }
  };
  const promptButtons = [...document.querySelectorAll('[data-prompt]')];
  promptButtons.forEach(button => {
    button.addEventListener('click', () => {
      const example = questions[button.dataset.prompt];
      promptButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      document.getElementById('ai-question').textContent = example.question;
      // These responses are authored, static examples, never user-provided HTML.
      document.getElementById('ai-answer').innerHTML = example.answer;
      animateUpdate(document.getElementById('ai-example'));
    });
  });

  const codeExamples = {
    python: {
      filename: 'hello.py',
      source: [
        '# A small start. Endless possibilities.',
        '',
        'def say_hello(name):',
        '    return f"Hello, {name}!"',
        '',
        'message = say_hello("Gandaki")',
        'print(message)',
        'print("Let’s build something.")'
      ]
    },
    c: {
      filename: 'hello.c',
      source: [
        '// A small start. Endless possibilities.',
        '#include <stdio.h>',
        '',
        'int main(void) {',
        '    puts("Hello, Gandaki!");',
        '    puts("Let’s build something.");',
        '    return 0;',
        '}'
      ]
    },
    java: {
      filename: 'Hello.java',
      source: [
        '// A small start. Endless possibilities.',
        'public class Hello {',
        '  public static void main(String[] args) {',
        '    System.out.println("Hello, Gandaki!");',
        '    System.out.println(',
        '      "Let’s build something.");',
        '  }',
        '}'
      ]
    }
  };
  const languageButtons = [...document.querySelectorAll('[data-language]')];
  const codeOutput = document.getElementById('code-output');
  const runLabel = document.getElementById('code-run-label');

  // Render known samples as text nodes; token coloring never evaluates code.
  function renderCode(lines) {
    const fragment = document.createDocumentFragment();
    lines.forEach((line, index) => {
      const row = document.createElement('span');
      row.className = 'home-code-line';
      row.dataset.line = index + 1;
      row.style.setProperty('--motion-delay', `${.12 + index * .075}s`);
      const tokens = line.split(/("[^"\n]*"|\/\/.*|#.*|\b(?:public|class|static|void|int|return|def)\b|\b(?:print|puts|printf|say_hello|println|main)\b|\b\d+\b)/g);
      tokens.forEach(token => {
        if (!token) return;
        const part = document.createElement('span');
        part.textContent = token;
        if (/^(#|\/\/)/.test(token)) part.className = 'home-token-comment';
        else if (token.startsWith('"')) part.className = 'home-token-string';
        else if (/^(public|class|static|void|int|return|def)$/.test(token)) part.className = 'home-token-keyword';
        else if (/^(print|puts|printf|say_hello|println|main)$/.test(token)) part.className = 'home-token-function';
        else if (/^\d+$/.test(token)) part.className = 'home-token-number';
        row.append(part);
      });
      fragment.append(row);
    });
    document.getElementById('code-example').replaceChildren(fragment);
  }

  languageButtons.forEach(button => {
    button.addEventListener('click', () => {
      const example = codeExamples[button.dataset.language];
      languageButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      document.getElementById('code-filename').textContent = example.filename;
      renderCode(example.source);
      codeOutput.textContent = 'Select “Preview output” to see the result.';
      delete codeOutput.dataset.outputVisible;
      runLabel.textContent = 'Preview output';
    });
  });
  document.getElementById('code-preview-run').addEventListener('click', () => {
    codeOutput.textContent = 'Hello, Gandaki!\nLet’s build something.';
    runLabel.textContent = 'Preview again';
    codeOutput.dataset.outputVisible = 'true';
    animateUpdate(codeOutput);
  });

  const campusTabs = [...document.querySelectorAll('[data-campus]')];
  const campusLinks = {
    feed: ['/dashboard.html', 'Explore the feed'],
    notices: ['/notices.html', 'Read university notices'],
    exams: ['/routine.html', 'View exam schedules']
  };
  function selectCampusTab(tab) {
    campusTabs.forEach(item => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
    });
    const link = document.getElementById('campus-feature-link');
    const [href, label] = campusLinks[tab.dataset.campus];
    link.href = href;
    link.querySelector('span').textContent = label;
  }
  campusTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectCampusTab(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % campusTabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + campusTabs.length) % campusTabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = campusTabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      campusTabs[next].focus();
      selectCampusTab(campusTabs[next]);
    });
  });

  if ('IntersectionObserver' in window) {
    const featureLinks = [...document.querySelectorAll('.home-feature-nav a')];
    const activeFeatures = new Map();
    const sectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => activeFeatures.set(entry.target.id, entry.intersectionRatio));
      const visible = [...activeFeatures].filter(([, ratio]) => ratio > 0).sort((a, b) => b[1] - a[1])[0];
      if (!visible) return;
      featureLinks.forEach(link => {
        if (link.hash === `#${visible[0]}`) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }, { rootMargin: '-140px 0px -15% 0px', threshold: [0, .2, .4, .6, .8, 1] });
    document.querySelectorAll('.home-feature').forEach(section => sectionObserver.observe(section));

    if (!reducedMotion.matches) {
      const revealObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('home-visible');
          revealObserver.unobserve(entry.target);
        });
      }, { threshold: .08 });
      document.querySelectorAll('[data-reveal]').forEach(element => {
        // Content is visible by default when JavaScript or observers are unavailable.
        element.classList.add('home-reveal-ready');
        revealObserver.observe(element);
      });
    }
  }

  // Short, feature-specific sequences replay when a preview re-enters the viewport.
  // Pointer movement is sampled once per frame; nothing runs on an idle page.
  const stages = [...document.querySelectorAll('.home-stage')];
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const resetPointers = [];
  const staggerGroups = [
    ['.home-file-row', .25, .18],
    ['.home-code-line', .25, .09],
    ['.home-assignment-steps span', .35, .28],
    ['.home-exam-row', .25, .2],
    ['.home-message', .35, .55]
  ];
  stages.forEach(stage => {
    staggerGroups.forEach(([selector, start, step]) => {
      stage.querySelectorAll(selector).forEach((element, index) => {
        element.style.setProperty('--motion-delay', `${start + index * step}s`);
      });
    });

    let pointerFrame = 0;
    let pointerX = 0;
    let pointerY = 0;
    const resetPointer = () => {
      cancelAnimationFrame(pointerFrame);
      pointerFrame = 0;
      delete stage.dataset.pointerActive;
      ['--tilt-x', '--tilt-y', '--pointer-x', '--pointer-y'].forEach(property => stage.style.removeProperty(property));
    };
    resetPointers.push(resetPointer);
    stage.addEventListener('pointermove', event => {
      if (reducedMotion.matches || !finePointer.matches || event.pointerType !== 'mouse') return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (pointerFrame) return;
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = 0;
        const bounds = stage.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (pointerX - bounds.left) / bounds.width));
        const y = Math.min(1, Math.max(0, (pointerY - bounds.top) / bounds.height));
        stage.dataset.pointerActive = 'true';
        stage.style.setProperty('--pointer-x', `${x * 100}%`);
        stage.style.setProperty('--pointer-y', `${y * 100}%`);
        stage.style.setProperty('--tilt-x', `${(0.5 - y) * 3.2}deg`);
        stage.style.setProperty('--tilt-y', `${(x - 0.5) * 3.2}deg`);
      });
    }, { passive: true });
    stage.addEventListener('pointerleave', resetPointer);
    stage.addEventListener('pointercancel', resetPointer);
  });

  // Meet the Developers Interactive Showcase
  const devProfiles = {
    saugat: {
      name: 'Saugat Subedi',
      path: 'saugat-subedi',
      role: 'Full-Stack & UI/UX'
    },
    sandesh: {
      name: 'Sandesh Dhakal',
      path: 'sandesh-dhakal',
      role: 'Backend & Features'
    },
    subarna: {
      name: 'Subarna Poudel',
      path: 'subarna-poudel',
      role: 'Content, Docs & SEO'
    }
  };

  const devCards = [...document.querySelectorAll('.home-dev-card')];
  const devStage = document.getElementById('dev-stage');
  const devPanels = [...document.querySelectorAll('.home-dev-panel')];
  const stagePathDev = document.getElementById('dev-stage-path-dev');
  const stageLiveBadge = document.getElementById('dev-stage-live-badge');

  function activateDev(devId) {
    const profile = devProfiles[devId];
    if (!profile) return;

    devCards.forEach(card => {
      const isCurrent = card.dataset.dev === devId;
      card.classList.toggle('is-active', isCurrent);
      card.setAttribute('aria-selected', String(isCurrent));
    });

    if (devStage) {
      devStage.dataset.activeDev = devId;
    }

    if (stagePathDev) stagePathDev.textContent = profile.path;
    if (stageLiveBadge) stageLiveBadge.textContent = profile.role;

    devPanels.forEach(panel => {
      const isTarget = panel.dataset.panel === devId;
      panel.hidden = !isTarget;
      panel.classList.toggle('is-active', isTarget);

      if (isTarget) {
        animateUpdate(panel);
      }
    });
  }

  devCards.forEach(card => {
    card.addEventListener('click', () => {
      activateDev(card.dataset.dev);
    });

    card.addEventListener('pointermove', event => {
      if (reducedMotion.matches || !finePointer.matches) return;
      const rect = card.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      card.style.setProperty('--card-x', `${x}px`);
      card.style.setProperty('--card-y', `${y}px`);
    });
  });

  if (devStage) {
    let devFrame = 0;
    let devX = 0;
    let devY = 0;
    const resetDevPointer = () => {
      cancelAnimationFrame(devFrame);
      devFrame = 0;
      delete devStage.dataset.pointerActive;
      ['--tilt-x', '--tilt-y', '--pointer-x', '--pointer-y'].forEach(p => devStage.style.removeProperty(p));
    };
    devStage.addEventListener('pointermove', event => {
      if (reducedMotion.matches || !finePointer.matches || event.pointerType !== 'mouse') return;
      devX = event.clientX;
      devY = event.clientY;
      if (devFrame) return;
      devFrame = requestAnimationFrame(() => {
        devFrame = 0;
        const bounds = devStage.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (devX - bounds.left) / bounds.width));
        const y = Math.min(1, Math.max(0, (devY - bounds.top) / bounds.height));
        devStage.dataset.pointerActive = 'true';
        devStage.style.setProperty('--pointer-x', `${x * 100}%`);
        devStage.style.setProperty('--pointer-y', `${y * 100}%`);
        devStage.style.setProperty('--tilt-x', `${(0.5 - y) * 2.8}deg`);
        devStage.style.setProperty('--tilt-y', `${(x - 0.5) * 2.8}deg`);
      });
    }, { passive: true });
    devStage.addEventListener('pointerleave', resetDevPointer);
    devStage.addEventListener('pointercancel', resetDevPointer);
    resetPointers.push(resetDevPointer);
  }

  const motionObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      entry.target.dataset.motionActive = String(entry.isIntersecting && !reducedMotion.matches && !document.hidden);
    });
  }, { threshold: .12, rootMargin: '-125px 0px 0px 0px' }) : null;

  function syncMotion() {
    resetPointers.forEach(reset => reset());
    activeTransitions.forEach(animation => animation.cancel());
    motionObserver?.disconnect();
    stages.forEach(stage => {
      stage.dataset.motionActive = 'false';
      if (!reducedMotion.matches && !document.hidden) motionObserver?.observe(stage);
    });
  }
  reducedMotion.addEventListener('change', syncMotion);
  finePointer.addEventListener('change', () => resetPointers.forEach(reset => reset()));
  document.addEventListener('visibilitychange', syncMotion);
  syncMotion();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(error => {
        console.warn('[SW Registration Notice]:', error);
      });
    });
  }
})();
