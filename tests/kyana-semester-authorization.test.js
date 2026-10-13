'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const aiAssistant = require('../ai-assistant');
const { createTools, routeQuery } = require('../lib/chat-tools');
const aiSearch = require('../lib/ai-search-tools');

describe('Kyana AI Platform Intelligence & Semester Authorization', () => {
  // Mock DB helper
  function createMockDb() {
    return {
      isPostgres: false,
      async get(sql, ...params) {
        return null;
      },
      async all(sql, ...params) {
        return [];
      },
      async run(sql, ...params) {
        return { lastInsertRowid: 1 };
      },
      async exec(sql) {
        return true;
      }
    };
  }

  test('1. Student registered in Semester 2 is blocked from requesting Semester 4 notes', async () => {
    const db = createMockDb();
    const route = routeQuery('find me 4th-semester notes on database');

    const academicContext = {
      authenticated: true,
      role: 'student',
      semester: 'Semester 2',
      cohort: { id: 'cohort_sem2', currentSemester: 2 }
    };

    let searchCalledWith = null;
    const mockSearchNotes = async (db, params) => {
      searchCalledWith = params;
      return [];
    };

    const toolkit = createTools(db, route, {
      academicContext,
      searchNotes: mockSearchNotes
    });

    const result = await toolkit.executeTool('search_notes', { query: 'database' });

    // Must return clarification refusing cross-semester access
    assert.ok(result.clarification, 'Expected clarification message blocking cross-semester access');
    assert.match(result.clarification, /Semester 2/i, 'Should mention student semester');
    assert.strictEqual(searchCalledWith, null, 'searchNotes must not be called when cross-semester request is rejected');
  });

  test('2. Student in Semester 2 asking for a Semester 4 subject (DBMS) receives semester boundary clarification', async () => {
    const db = createMockDb();
    const route = routeQuery('find me DBMS notes');

    const academicContext = {
      authenticated: true,
      role: 'student',
      semester: 'Semester 2',
      cohort: { id: 'cohort_sem2', currentSemester: 2 }
    };

    let searchCalledWith = null;
    const mockSearchNotes = async (db, params) => {
      searchCalledWith = params;
      return [];
    };

    const toolkit = createTools(db, route, {
      academicContext,
      searchNotes: mockSearchNotes
    });

    const result = await toolkit.executeTool('search_notes', { query: 'dbms' });

    assert.ok(result.clarification, 'Expected clarification explaining subject belongs to a different semester');
    assert.match(result.clarification, /Database Management System/i);
    assert.match(result.clarification, /Semester 3/i);
    assert.match(result.clarification, /Semester 2/i);
    assert.strictEqual(searchCalledWith, null, 'Database should not be queried for cross-semester subject');
  });

  test('3. Student in Semester 2 asking for Semester 2 notes is allowed and scoped to semester 2', async () => {
    const db = createMockDb();
    const route = routeQuery('give me Web Technology I notes');

    const academicContext = {
      authenticated: true,
      role: 'student',
      semester: 'Semester 2',
      cohort: { id: 'cohort_sem2', currentSemester: 2 }
    };

    let searchCalledWith = null;
    const mockSearchNotes = async (db, params) => {
      searchCalledWith = params;
      return [
        {
          id: 42,
          title: 'HTML & CSS Intro',
          originalName: 'web_tech_1.pdf',
          subject: 'Web Technology I',
          semester: 'Semester 2',
          matchType: 'metadata',
          score: 100
        }
      ];
    };

    const toolkit = createTools(db, route, {
      academicContext,
      searchNotes: mockSearchNotes
    });

    const result = await toolkit.executeTool('search_notes', { query: 'web technology 1' });

    assert.ok(result.files, 'Should return matching files');
    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(searchCalledWith.semester, 2, 'Search must be strictly bound to Semester 2');

    // Verify rich resourceCard attached
    const card = result.files[0].resourceCard;
    assert.ok(card, 'resourceCard must be present');
    assert.strictEqual(card.type, 'note');
    assert.strictEqual(card.id, 42);
    assert.strictEqual(card.action, 'open_note');
    assert.strictEqual(card.mobileRoute, '/material/42');
  });

  test('4. Student in Semester 2 asking for routine is restricted to Semester 2', async () => {
    const db = createMockDb();
    // Asking for semester 4 routine
    const route = routeQuery('show me semester 4 exam routine');

    const academicContext = {
      authenticated: true,
      role: 'student',
      semester: 'Semester 2',
      cohort: { id: 'cohort_sem2', currentSemester: 2 }
    };

    const toolkit = createTools(db, route, { academicContext });
    const result = await toolkit.executeTool('get_routine', { semester: 4 });

    assert.ok(result.clarification, 'Expected clarification blocking semester 4 routine for semester 2 student');
    assert.match(result.clarification, /Semester 2/i);
  });

  test('5. Teacher or Admin can query any semester without restriction', async () => {
    const db = createMockDb();
    const route = routeQuery('find me 4th-semester DBMS notes');

    const teacherContext = {
      authenticated: true,
      role: 'teacher',
      canViewAllCohorts: true
    };

    let searchCalledWith = null;
    const mockSearchNotes = async (db, params) => {
      searchCalledWith = params;
      return [
        {
          id: 99,
          title: 'DBMS Chapter 1',
          subject: 'Database Management System',
          semester: 'Semester 4'
        }
      ];
    };

    const toolkit = createTools(db, route, {
      academicContext: teacherContext,
      searchNotes: mockSearchNotes
    });

    const result = await toolkit.executeTool('search_notes', { query: 'dbms' });
    assert.ok(result.files, 'Teacher should successfully retrieve notes');
    assert.strictEqual(searchCalledWith.semester, 4, 'Teacher allowed to query requested semester');
  });

  test('6. Post & notice semester filter enforces cohort and target semester isolation', () => {
    const studentContext = {
      authenticated: true,
      role: 'student',
      semester: 'Semester 2',
      cohort: { id: 'cohort_mercury', currentSemester: 2 }
    };

    const filter = aiSearch.buildPostSemesterFilter(studentContext, { tableAlias: 'p' });
    assert.ok(filter.sql.includes('target_all_semesters = 1'), 'Must include global all-semesters posts');
    assert.ok(filter.sql.includes('post_target_semesters WHERE semester = ?'), 'Must check post_target_semesters for student semester');
    assert.ok(filter.params.includes(2), 'Must parameterize student semester 2');
    assert.ok(filter.params.includes('cohort_mercury'), 'Must parameterize student cohort');
  });

  test('7. Assignment semester filter enforces student semester and cohort isolation', () => {
    const studentContext = {
      authenticated: true,
      role: 'student',
      semester: 'Semester 2',
      cohort: { id: 'cohort_mercury', currentSemester: 2 }
    };

    const filter = aiSearch.buildAssignmentSemesterFilter(studentContext, { tableAlias: 'a' });
    assert.ok(filter.sql.includes('cohort_id = ?'), 'Must check student cohort');
    assert.ok(filter.sql.includes('semester_no = ?'), 'Must check student semester_no');
    assert.ok(filter.params.includes('cohort_mercury'), 'Must include cohort ID param');
    assert.ok(filter.params.includes(2), 'Must include semester number param');
  });

  test('8. handleChat aggregates all resource cards and formats responses with platform cards', async () => {
    const db = createMockDb();
    const studentInfo = {
      studentId: 'std_123',
      role: 'student',
      semester: 'Semester 2'
    };

    const academicContext = {
      authenticated: true,
      role: 'student',
      studentId: 'std_123',
      semester: 'Semester 2',
      cohort: { id: 'c2', currentSemester: 2 }
    };

    const mockSearchNotes = async () => [
      {
        id: 77,
        title: 'OOP Java Notes',
        originalName: 'oop.pdf',
        subject: 'Computer Programming II (Java)',
        semester: 'Semester 2',
        resourceCard: {
          type: 'note',
          id: 77,
          title: 'OOP Java Notes',
          action: 'open_note',
          deepLink: '/material/77',
          mobileRoute: '/material/77'
        }
      }
    ];

    const result = await aiAssistant.handleChat(
      db,
      'notes on java',
      studentInfo,
      [],
      'session_test',
      {
        academicContext,
        toolDependencies: { searchNotes: mockSearchNotes }
      }
    );

    assert.ok(result.reply, 'Should produce a reply');
    assert.ok(Array.isArray(result.resourceCards), 'Should return resourceCards array');
    assert.strictEqual(result.resourceCards.length, 1);
    assert.strictEqual(result.resourceCards[0].id, 77);
    assert.strictEqual(result.resourceCards[0].mobileRoute, '/material/77');
  });
});
