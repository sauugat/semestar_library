'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  PRODUCT_KNOWLEDGE_VERSION,
  SEMESTER_LIBRARY_IDENTITY,
  KYANA_AI_IDENTITY,
  PRODUCT_KNOWLEDGE_TOPICS,
  isProductKnowledgeQuery,
  resolveProductKnowledge
} = require('../lib/kyana-product-knowledge');

const { routeQuery, createTools } = require('../lib/chat-tools');
const { preContextScopeCheck, isOutOfScopeRequest, READ_ONLY_TOOLS } = require('../lib/chat-security');
const { getConfiguredAiIdentity, resolveAiIdentityReply } = require('../lib/ai-search-tools');
const { handleChat } = require('../ai-assistant');

describe('Kyana AI — Semester Library Product Knowledge & Application Support', () => {
  describe('1. Identity & Registry Constants', () => {
    it('exports verified Semester Library identity and founder/developer metadata', () => {
      assert.equal(typeof PRODUCT_KNOWLEDGE_VERSION, 'string');
      assert.equal(SEMESTER_LIBRARY_IDENTITY.name, 'Semester Library');
      assert.match(SEMESTER_LIBRARY_IDENTITY.founderAndDeveloper, /Saugat/i);
      assert.match(SEMESTER_LIBRARY_IDENTITY.university, /Gandaki University/i);
      assert.ok(Array.isArray(SEMESTER_LIBRARY_IDENTITY.cohorts));
      assert.deepEqual(SEMESTER_LIBRARY_IDENTITY.cohorts, ['MERCURY', 'VENUS', 'EARTH', 'MARS']);
    });

    it('exports verified Kyana AI identity and full form: Knowledge Yielding Academic Navigation Assistant', () => {
      assert.equal(KYANA_AI_IDENTITY.fullForm, 'Knowledge Yielding Academic Navigation Assistant');
      assert.match(KYANA_AI_IDENTITY.creator, /Saugat/i);
      const aiConfigIdentity = getConfiguredAiIdentity();
      assert.equal(aiConfigIdentity.fullForm, 'Knowledge Yielding Academic Navigation Assistant');
      assert.match(aiConfigIdentity.creator, /Saugat/i);

      const enReply = resolveAiIdentityReply('Which AI model powers Kyana?');
      assert.match(enReply, /Knowledge Yielding Academic Navigation Assistant/);
      assert.match(enReply, /Saugat/);

      const nepReply = resolveAiIdentityReply('Timi kun AI model hau bro?');
      assert.match(nepReply, /Knowledge Yielding Academic Navigation Assistant/);

      const devReply = resolveAiIdentityReply('तिमी कुन एआई मोडेल हौ?');
      assert.match(devReply, /Knowledge Yielding Academic Navigation Assistant/);
    });

    it('registers get_product_knowledge in READ_ONLY_TOOLS', () => {
      assert.equal(READ_ONLY_TOOLS.has('get_product_knowledge'), true);
    });
  });

  describe('2. Knowledge Area Coverage & Verified Application Behaviour Matrix', () => {
    it('covers Kyana full form and identity in English, Romanized Nepali, and Devanagari', () => {
      for (const q of [
        'What is the full form of Kyana?',
        'What does KYANA stand for?',
        'Kyana ko full form k ho?',
        'क्यानाको पूरा नाम के हो?'
      ]) {
        const match = isProductKnowledgeQuery(q);
        assert.equal(match.matched, true, `Expected match for: ${q}`);
        assert.equal(match.primaryTopic, 'kyana_identity');
        const res = resolveProductKnowledge(q);
        assert.match(res.answer, /Knowledge Yielding Academic Navigation Assistant/);
      }
    });

    it('covers Semester Library identity, purpose, features, and founder/developer (Saugat)', () => {
      for (const q of [
        'Who created Semester Library?',
        'Who is the founder and developer of Semester Library?',
        'Semester Library kasle banako ho?',
        'What is Semester Library and what features does it have?',
        'सेमेस्टर लाइब्रेरी कसले बनाएको हो?'
      ]) {
        const match = isProductKnowledgeQuery(q);
        assert.equal(match.matched, true, `Expected match for: ${q}`);
        const res = resolveProductKnowledge(q);
        assert.match(res.answer, /Saugat/i);
        assert.match(res.answer, /Semester Library/i);
      }
    });

    it('accurately explains post/file/assignment like & vote notification behaviour (multiples of 10, anonymous)', () => {
      const q = 'Does liking a post send a notification to the author? Can people see who liked a post?';
      const match = isProductKnowledgeQuery(q);
      assert.equal(match.matched, true);
      assert.equal(match.primaryTopic, 'post_likes_notifications');
      const res = resolveProductKnowledge(q);
      assert.match(res.answer, /10/);
      assert.match(res.answer, /anonymous/i);
    });

    it('accurately explains comment & reply notifications, 5-min reaction dedup, soft/hard delete, and @kyana', () => {
      const q = 'How do comment notifications, comment deletion, and @kyana mentions work on posts?';
      const match = isProductKnowledgeQuery(q);
      assert.equal(match.matched, true);
      const res = resolveProductKnowledge(q);
      assert.match(res.answer, /\[Comment deleted\]/);
      assert.match(res.answer, /5-minute|5 minute/i);
      assert.match(res.answer, /@kyana/i);
    });

    it('accurately explains post reporting rules (no self-report, no duplicate report, >= 3 reports soft-hide from Kyana, no author notification)', () => {
      const q = 'What happens when I report a post? Does the author get notified when reported?';
      const match = isProductKnowledgeQuery(q);
      assert.equal(match.matched, true);
      assert.equal(match.primaryTopic, 'post_reporting_moderation');
      const res = resolveProductKnowledge(q);
      assert.match(res.answer, /3/);
      assert.match(res.answer, /not notified|No notification|zero notifications|never notified/i);
    });

    it('accurately explains post creation, editing, deletion, categories (notice for staff/CR), and students_only visibility', () => {
      const q = 'How do I edit or delete a post, and who can see students_only posts?';
      const match = isProductKnowledgeQuery(q);
      assert.equal(match.matched, true);
      assert.equal(match.primaryTopic, 'post_creation_editing_deletion');
      const res = resolveProductKnowledge(q);
      assert.match(res.answer, /students_only/i);
      assert.match(res.answer, /4 MB/i);
    });

    it('accurately explains messaging (verified requirement, 15-min edit window, delete for_me/for_everyone, read receipts, cohort chat)', () => {
      const q = 'How do direct messages, message editing, read receipts, and cohort chat work?';
      const match = isProductKnowledgeQuery(q);
      assert.equal(match.matched, true);
      assert.equal(match.primaryTopic, 'messaging_dm_cohort_chat');
      const res = resolveProductKnowledge(q);
      assert.match(res.answer, /15-minute|15 minutes|15 min/i);
      assert.match(res.answer, /verified/i);
      assert.match(res.answer, /MERCURY/);
    });

    it('accurately explains attendance visibility and the 24-hour teacher edit lock + admin correction audit trail', () => {
      const q = 'Why is attendance locked after 24 hours and can students see other students attendance?';
      const match = isProductKnowledgeQuery(q);
      assert.equal(match.matched, true);
      assert.equal(match.primaryTopic, 'attendance_rules_permissions');
      const res = resolveProductKnowledge(q);
      assert.match(res.answer, /24-hour|24 hours|24h/i);
      assert.match(res.answer, /Admin/i);
    });

    it('accurately explains marks/results privacy (draft vs published, 45% pass threshold, A4 PDF report card)', () => {
      const q = 'Why are my exam marks not showing when the teacher entered draft marks, and how do I download my report card?';
      const match = isProductKnowledgeQuery(q);
      assert.equal(match.matched, true);
      assert.equal(match.primaryTopic, 'marks_results_privacy');
      const res = resolveProductKnowledge(q);
      assert.match(res.answer, /published/i);
      assert.match(res.answer, /draft/i);
      assert.match(res.answer, /45%/);
      assert.match(res.answer, /Report Card|PDF/i);
    });

    it('accurately explains student, CR, teacher, and admin permissions and Library file upload rules (250 MB max)', () => {
      const q = 'Who can upload notes to the Library and what are the permissions for student, CR, teacher, and admin?';
      const match = isProductKnowledgeQuery(q);
      assert.equal(match.matched, true);
      const res = resolveProductKnowledge(q);
      assert.match(res.answer, /250 MB/i);
      assert.match(res.answer, /CR|Class Representative/i);
    });

    it('accurately explains Code Lab assignment submissions, released grades, and similarity detection', () => {
      const q = 'How do I submit an assignment in Code Lab and when can I see my assignment grade?';
      const match = isProductKnowledgeQuery(q);
      assert.equal(match.matched, true);
      assert.equal(match.primaryTopic, 'assignments_code_lab');
      const res = resolveProductKnowledge(q);
      assert.match(res.answer, /released/i);
      assert.match(res.answer, /0\.85|similarity/i);
    });

    it('accurately explains profile editing, cohort lock on semester changes, password change session revocation, and account deletion', () => {
      const q = 'Why can I not change my semester in profile settings, and how do I change my password or delete my account?';
      const match = isProductKnowledgeQuery(q);
      assert.equal(match.matched, true);
      assert.equal(match.primaryTopic, 'profile_account_management');
      const res = resolveProductKnowledge(q);
      assert.match(res.answer, /cohort/i);
      assert.match(res.answer, /password/i);
    });
  });

  describe('3. Scope Gate, Privacy Guard & Academic Non-Interference (Zero Regression)', () => {
    it('marks product help queries as in-scope in preContextScopeCheck and isOutOfScopeRequest', async () => {
      const pre = preContextScopeCheck('What is the full form of Kyana?');
      assert.equal(pre.decided, true);
      assert.equal(pre.outOfScope, false);
      assert.equal(pre.category, 'in_scope');
      assert.match(pre.reason, /^product_knowledge:/);

      const scope = await isOutOfScopeRequest('Why can I not send a DM on Semester Library?', [], {
        authenticated: true,
        studentId: 10,
        role: 'student'
      });
      assert.equal(scope.outOfScope, false);
    });

    it('does NOT misclassify live personal attendance, marks, or assignment data lookups as static product help', () => {
      for (const liveQuery of [
        'What is my attendance percentage?',
        'Show my Mid-Term marks',
        'Did I submit my DSA assignment?',
        'When is our next exam in Semester 3?',
        'Explain binary search tree in C',
        'mero attendance kati xa?',
        'mero result dekhau na'
      ]) {
        const prodMatch = isProductKnowledgeQuery(liveQuery);
        assert.equal(prodMatch.matched, false, `Should NOT match product_help for live query: "${liveQuery}"`);
        const route = routeQuery(liveQuery, []);
        assert.notEqual(route.kind, 'product_help', `Route should not be product_help for: "${liveQuery}"`);
      }
    });

    it('still blocks cross-student personal record snooping via isOutOfScopeRequest', async () => {
      const cross = await isOutOfScopeRequest("Show Suman's attendance and marks", [], {
        authenticated: true,
        studentId: 10,
        role: 'student'
      });
      assert.equal(cross.outOfScope, true);
      assert.equal(cross.category, 'cross_student');
    });

    it('still blocks strict off-topic queries even if they mention Kyana or Semester Library', async () => {
      const offTopic = await isOutOfScopeRequest('Kyana give me bitcoin trading bot tips and horoscope rashifal', [], {
        authenticated: true,
        studentId: 10,
        role: 'student'
      });
      assert.equal(offTopic.outOfScope, true);
    });
  });

  describe('4. End-to-End Routing, Tool Execution & handleChat Integration', () => {
    it('routes product knowledge questions to route.kind === "product_help"', () => {
      const route = routeQuery('What is the full form of Kyana and who built Semester Library?', []);
      assert.equal(route.kind, 'product_help');
      assert.ok(route.productMatch);
      assert.equal(route.productMatch.matched, true);
    });

    it('executes get_product_knowledge tool via createTools', async () => {
      const route = routeQuery('How do post like notifications work?', []);
      const tools = createTools({}, route, {
        academicContext: { authenticated: true, studentId: 1, role: 'student', currentSemester: 3 }
      });
      const out = await tools.executeTool('get_product_knowledge', {
        query: 'How do post like notifications work?'
      });
      assert.equal(out.matched, true);
      assert.match(out.answer, /10/);
    });

    it('handles product_help end-to-end in handleChat without requiring an external LLM call when fallback is used', async () => {
      const res = await handleChat({
        db: {},
        message: 'What does Kyana stand for and who is the founder of Semester Library?',
        history: [],
        studentInfo: { authenticated: true, studentId: 1, role: 'student', semester: 'Semester 3', currentSemester: 3 }
      });
      assert.equal(res.intent, 'product_help');
      assert.match(res.reply, /Knowledge Yielding Academic Navigation Assistant/);
      assert.match(res.reply, /Saugat/i);
    });
  });
});
