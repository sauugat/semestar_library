/* Small, local interactions for the homepage's explicitly labeled examples. */
(() => {
  'use strict';

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
      runLabel.textContent = 'Preview output';
    });
  });
  document.getElementById('code-preview-run').addEventListener('click', () => {
    codeOutput.textContent = 'Hello, Gandaki!\nLet’s build something.';
    runLabel.textContent = 'Preview again';
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

    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
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

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(error => {
        console.warn('[SW Registration Notice]:', error);
      });
    });
  }
})();
