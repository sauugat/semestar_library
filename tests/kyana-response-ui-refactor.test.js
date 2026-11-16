'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

describe('Kyana AI — Response UI & Resource Cards Refactor (Phase 1)', () => {
  const cssPath = path.join(__dirname, '..', 'public', 'chatbot.css');
  const jsPath = path.join(__dirname, '..', 'public', 'chatbot.js');
  const cssContent = fs.readFileSync(cssPath, 'utf8');
  const jsContent = fs.readFileSync(jsPath, 'utf8');

  describe('1. CSS Specificity & Underline Isolation', () => {
    test('Markdown links are specifically scoped to avoid leaking onto resource cards', () => {
      assert.ok(
        cssContent.includes('.kyana-response-doc a:not(.kyana-source-card):not(.ky-res-card)'),
        'Must scope Markdown link selector to exclude resource cards'
      );
    });

    test('Resource cards have explicit text-decoration: none and color: inherit resets', () => {
      const cardResetMatch = cssContent.match(/\.kyana-response-doc a\.kyana-source-card[\s\S]*?text-decoration:\s*none\s*!important/);
      assert.ok(cardResetMatch, 'Resource card anchors must explicitly reset text-decoration');

      const colorResetMatch = cssContent.match(/\.kyana-response-doc a\.kyana-source-card[\s\S]*?color:\s*inherit\s*!important/);
      assert.ok(colorResetMatch, 'Resource card anchors must explicitly reset color to inherit');
    });

    test('Wildcard descendant rule prevents underlines on all resource card child elements', () => {
      const childResetMatch = cssContent.match(/\.kyana-response-doc a\.kyana-source-card \*,[\s\S]*?text-decoration:\s*none\s*!important/);
      assert.ok(childResetMatch, 'Child elements of resource cards must have text-decoration: none !important');
    });
  });

  describe('2. Anti-Wrapping, Sizing & Hierarchy Invariants', () => {
    test('.kyana-source-icon has flex-shrink: 0, fixed width/height and contains vector SVGs', () => {
      assert.ok(cssContent.includes('.kyana-source-icon'), 'Must define .kyana-source-icon');
      assert.ok(cssContent.includes('flex-shrink: 0 !important'), 'Icon container must have flex-shrink: 0 !important');
      assert.ok(cssContent.includes('width: 36px !important'), 'Icon container width must be 36px !important');
      assert.ok(cssContent.includes('height: 36px !important'), 'Icon container height must be 36px !important');
      assert.ok(cssContent.includes('.kyana-source-icon svg'), 'Must style vector SVG inside .kyana-source-icon');
    });

    test('.kyana-source-badge has white-space: nowrap and flex-shrink: 0', () => {
      assert.ok(cssContent.includes('.kyana-source-badge'), 'Must define .kyana-source-badge rule block');
      assert.ok(cssContent.includes('white-space: nowrap !important'), 'Badge must have white-space: nowrap !important');
      assert.ok(cssContent.includes('flex-shrink: 0 !important'), 'Badge must have flex-shrink: 0 !important');
      assert.ok(cssContent.includes('text-transform: uppercase !important'), 'Badge must be uppercase');
    });

    test('.kyana-source-title is clamped to 2 lines max', () => {
      assert.ok(cssContent.includes('.kyana-source-title'), 'Must define .kyana-source-title rule block');
      assert.ok(cssContent.includes('-webkit-line-clamp: 2 !important'), 'Title must clamp to 2 lines');
      assert.ok(cssContent.includes('display: -webkit-box !important'), 'Title must use webkit-box for clamping');
    });

    test('.kyana-source-action pill provides aligned action text and arrow icon', () => {
      assert.ok(cssContent.includes('.kyana-source-action'), 'Must define .kyana-source-action rule block');
      assert.ok(cssContent.includes('flex-shrink: 0 !important'), 'Action pill must not shrink');
      assert.ok(cssContent.includes('white-space: nowrap !important'), 'Action text must not wrap');
    });
  });

  describe('3. Resource Card Grid & Responsive Constraints', () => {
    test('.kyana-sources-list uses auto-fit with max-width ~380px and start alignment', () => {
      assert.ok(cssContent.includes('repeat(auto-fit, minmax(280px, 380px)) !important'), 'Grid must auto-fit between 280px and 380px');
      assert.ok(cssContent.includes('justify-content: start !important'), 'Grid must align to start to prevent single-item stretching');
    });

    test('Mobile breakpoint collapses grid to single column', () => {
      assert.ok(cssContent.includes('grid-template-columns: 1fr !important'), 'Mobile grid must collapse to 1fr');
    });
  });

  describe('4. Response Typography Scale', () => {
    test('H3 heading scale is 17px with 650 weight to clearly separate from body text', () => {
      assert.ok(cssContent.includes('font-size: 17px !important'), 'H3 must be 17px');
      assert.ok(cssContent.includes('font-weight: 650 !important'), 'H3 must have weight 650');
    });
  });

  describe('5. Light Theme Overrides', () => {
    test('Light theme defines styling for resource card, icon, badge, title, and action', () => {
      assert.ok(cssContent.includes('html[data-theme="light"] .kyana-source-card'), 'Light theme card style must exist');
      assert.ok(cssContent.includes('html[data-theme="light"] .kyana-source-icon'), 'Light theme icon style must exist');
      assert.ok(cssContent.includes('html[data-theme="light"] .kyana-source-badge'), 'Light theme badge style must exist');
      assert.ok(cssContent.includes('html[data-theme="light"] .kyana-source-title'), 'Light theme title style must exist');
      assert.ok(cssContent.includes('html[data-theme="light"] .kyana-source-action'), 'Light theme action style must exist');
    });
  });

  describe('6. Client-Side KyanaSourceCard Component Execution', () => {
    function createMockDom() {
      function makeEl(tagName) {
        return {
          tagName: tagName.toUpperCase(),
          className: '',
          href: '',
          target: '',
          rel: '',
          innerHTML: '',
          children: [],
          attributes: {},
          setAttribute(k, v) { this.attributes[k] = v; },
          getAttribute(k) { return this.attributes[k]; },
          appendChild(child) {
            this.children.push(child);
            return child;
          },
          querySelector(sel) {
            if (sel === '.kyana-sources-list') {
              let found = this.children.find(c => c.className === 'kyana-sources-list');
              if (!found) {
                found = makeEl('div');
                found.className = 'kyana-sources-list';
                this.children.push(found);
              }
              return found;
            }
            return null;
          },
          querySelectorAll() { return []; }
        };
      }

      const container = makeEl('div');
      container.className = 'kyana-response-doc';

      const sandbox = {
        document: {
          createElement(tag) {
            return makeEl(tag);
          }
        },
        window: {
          location: { href: '' },
          SemesterAuth: {
            attachAuthTokenToUrl: (u) => u
          }
        },
        escapeHtml: (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
        safeLink: (url) => url,
        console
      };

      // Extract KyanaSourceCard definition from public/chatbot.js
      const sourceCardMatch = jsContent.match(/\/\/\s*KyanaSourceCard Component[\s\S]*?const KyanaSourceCard = \{[\s\S]*?\n  \};/);
      assert.ok(sourceCardMatch, 'KyanaSourceCard component must exist in public/chatbot.js');

      const code = `${sourceCardMatch[0]}; this.KyanaSourceCard = KyanaSourceCard;`;
      vm.runInNewContext(code, sandbox);

      return { container, KyanaSourceCard: sandbox.KyanaSourceCard };
    }

    test('KyanaSourceCard.getIconSvg returns SVG vectors for all resource types', () => {
      const { KyanaSourceCard } = createMockDom();
      const types = ['note', 'notice', 'post', 'assignment', 'post_assignment', 'routine', 'file', 'pyq', 'syllabus', 'web'];
      for (const t of types) {
        const svg = KyanaSourceCard.getIconSvg(t);
        assert.ok(svg.includes('<svg'), `Type ${t} must return an SVG element`);
        assert.ok(svg.includes('viewBox="0 0 24 24"'), `Type ${t} SVG must have viewBox`);
        assert.ok(svg.includes('width="16"'), `Type ${t} SVG must be 16px wide`);
        assert.ok(svg.includes('height="16"'), `Type ${t} SVG must be 16px high`);
      }
    });

    test('KyanaSourceCard renders primary resourceCards with badges, titles, metadata and action buttons', () => {
      const { container, KyanaSourceCard } = createMockDom();
      const mockData = {
        resourceCards: [
          {
            type: 'note',
            id: 101,
            title: '02. Introduction to Java — Platform Independence',
            subject: 'Computer Programming II (Java)',
            semester: 2,
            page: 12,
            action: 'open_note'
          },
          {
            type: 'notice',
            id: 202,
            title: 'Regular BIT classes resume from 30th Kartik',
            subject: 'Gandaki University Notice',
            semester: 'All Semesters',
            publishedDate: '2026-10-14',
            action: 'view_notice'
          },
          {
            type: 'assignment',
            id: 303,
            title: 'Object Oriented Programming Assignment 1',
            subject: 'Java',
            deadline: '2026-11-20',
            action: 'view_assignment'
          }
        ]
      };

      KyanaSourceCard.renderSources(container, mockData);

      const wrap = container.children[0];
      assert.ok(wrap, 'Must append .kyana-sources-wrap');
      assert.equal(wrap.className, 'kyana-sources-wrap');

      const list = wrap.children.find(c => c.className === 'kyana-sources-list');
      assert.ok(list, 'Must have .kyana-sources-list');
      assert.equal(list.children.length, 3, 'Must render 3 resource cards');

      // Card 0: Note
      const noteCard = list.children[0];
      assert.equal(noteCard.className, 'kyana-source-card');
      assert.equal(noteCard.href, '/api/ai/resources/note/101/open');
      assert.equal(noteCard.target, '_blank');
      assert.equal(noteCard.rel, 'noopener noreferrer');
      assert.ok(noteCard.innerHTML.includes('<span class="kyana-source-badge">NOTE</span>'), 'Must contain NOTE badge');
      assert.ok(noteCard.innerHTML.includes('02. Introduction to Java — Platform Independence'), 'Must contain title');
      assert.ok(noteCard.innerHTML.includes('Computer Programming II (Java) · Sem 2'), 'Must contain subject context');
      assert.ok(noteCard.innerHTML.includes('Page 12'), 'Must contain page number');
      assert.ok(noteCard.innerHTML.includes('Open Note'), 'Must contain Open Note action text');
      assert.ok(noteCard.innerHTML.includes('kyana-source-action-icon'), 'Must contain action arrow icon');

      // Card 1: Notice
      const noticeCard = list.children[1];
      assert.equal(noticeCard.className, 'kyana-source-card');
      assert.equal(noticeCard.href, '/api/ai/resources/notice/202/open');
      assert.ok(noticeCard.innerHTML.includes('<span class="kyana-source-badge">NOTICE</span>'), 'Must contain NOTICE badge');
      assert.ok(noticeCard.innerHTML.includes('Regular BIT classes resume from 30th Kartik'), 'Must contain notice title');
      assert.ok(noticeCard.innerHTML.includes('2026-10-14'), 'Must contain published date');
      assert.ok(noticeCard.innerHTML.includes('View Notice'), 'Must contain View Notice action text');

      // Card 2: Assignment
      const assignCard = list.children[2];
      assert.equal(assignCard.className, 'kyana-source-card');
      assert.equal(assignCard.href, '/api/ai/resources/assignment/303/open');
      assert.ok(assignCard.innerHTML.includes('<span class="kyana-source-badge">ASSIGNMENT</span>'), 'Must contain ASSIGNMENT badge');
      assert.ok(assignCard.innerHTML.includes('Due: 2026-11-20'), 'Must contain deadline');
      assert.ok(assignCard.innerHTML.includes('Open Assignment'), 'Must contain Open Assignment action text');
    });

    test('KyanaSourceCard renders fallback matchedFiles, matchedCourses, matchedRoutine, and webSources cleanly', () => {
      const { container, KyanaSourceCard } = createMockDom();
      const fallbackData = {
        matchedFiles: [
          { id: 404, title: 'Discrete_Math_Ch1.pdf', originalName: 'Discrete_Math_Ch1.pdf', subject: 'Discrete Mathematics', semester: 2, chapter: 1 }
        ],
        webSources: [
          { url: 'https://docs.oracle.com/javase/tutorial/', title: 'The Java Tutorials', domain: 'docs.oracle.com' }
        ]
      };

      KyanaSourceCard.renderSources(container, fallbackData);

      const wrap = container.children[0];
      const list = wrap.children.find(c => c.className === 'kyana-sources-list');
      assert.ok(list);
      assert.equal(list.children.length, 2);

      const fileCard = list.children[0];
      assert.ok(fileCard.innerHTML.includes('Discrete_Math_Ch1.pdf'), 'Must render file title');
      assert.ok(fileCard.innerHTML.includes('Ch. 1'), 'Must render chapter metadata');
      assert.ok(fileCard.innerHTML.includes('View Note'), 'Must render View Note action');

      const webCard = list.children[1];
      assert.equal(webCard.href, 'https://docs.oracle.com/javase/tutorial/');
      assert.equal(webCard.target, '_blank');
      assert.ok(webCard.innerHTML.includes('<span class="kyana-source-badge">WEB</span>'), 'Must render WEB badge');
      assert.ok(webCard.innerHTML.includes('docs.oracle.com'), 'Must render domain');
      assert.ok(webCard.innerHTML.includes('Visit'), 'Must render Visit action');
    });

    test('KyanaSourceCard does nothing when no resources or sources are present', () => {
      const { container, KyanaSourceCard } = createMockDom();
      KyanaSourceCard.renderSources(container, {});
      assert.equal(container.children.length, 0, 'No wrapper should be appended');
    });
  });
});
