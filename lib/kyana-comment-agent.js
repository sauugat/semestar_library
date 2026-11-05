'use strict';

/**
 * Kyana AI — Context-Aware Comment Agent
 *
 * Allows students to mention @kyana in comments across:
 * 1. Posts & Notices (post_comments)
 * 2. Assignments (assignment_comments)
 * 3. Notes & Study Materials (file_comments)
 *
 * Capabilities:
 * - Summarize post/notice/assignment/note content and key dates/requirements.
 * - Answer user questions grounded in the specific post context.
 * - Provide thoughtful opinions, suggestions, and study tips when asked.
 * - Cross-reference other university app data (routines, syllabus, related notices/assignments).
 * - Match language (English, Romanized Nepali / Nepanglish, Devanagari).
 * - Reply as a threaded comment under the user's comment authored by Kyana AI.
 * - Enqueue in-app and push notifications for the mentioning user.
 */

const { generateReply } = require('./chat-provider');
const { extractPostTitle } = require('./ai-search-tools');

const KYANA_BOT_ID = 'KYANA_AI';
const KYANA_BOT_NAME = 'Kyana AI';
const KYANA_BOT_ROLE = 'assistant';
const KYANA_BOT_AVATAR = '/images/kyana-mono-thinking.png';

// WeakSet to avoid re-inserting the bot account on every single comment check
const verifiedBotDbs = new WeakSet();

/**
 * Detects if a text contains an @kyana mention.
 * Matches: @kyana, @Kyana, @kyana_ai, @KYANA
 */
function hasKyanaMention(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  return /(?:^|\s)@kyana(?:_ai)?\b/i.test(text);
}

/**
 * Extracts the user's query/demand by stripping the @kyana mention.
 * If empty or just salutation, defaults to a request for summary and key takeaways.
 */
function extractMentionQuery(text) {
  if (typeof text !== 'string') return '';
  const cleaned = text
    .replace(/(?:^|\s)@kyana(?:_ai)?(?::|,)?(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /^(?:hi|hello|hey|namaste|oi|dai|bro)\b/i.test(cleaned) && cleaned.length < 10) {
    return 'Summarize this post and highlight the key points, dates, and requirements.';
  }
  return cleaned;
}

/**
 * Ensures the Kyana AI bot account exists in the `students` table.
 * Fully compatible with SQLite and PostgreSQL.
 */
async function ensureKyanaBotAccount(db) {
  if (!db || typeof db !== 'object') return;
  if (verifiedBotDbs.has(db)) return;

  try {
    const existing = await db.get(
      'SELECT studentId, name FROM students WHERE studentId = ?',
      KYANA_BOT_ID
    );
    if (!existing) {
      const isPg = Boolean(db.isPostgres || (db.query && !db.run));
      if (isPg) {
        await db.run(
          `INSERT INTO students (
             studentId, name, role, email, avatarUrl, bio, department, semester, account_status, verification_status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (studentId) DO NOTHING`,
          KYANA_BOT_ID,
          KYANA_BOT_NAME,
          KYANA_BOT_ROLE,
          'kyana@gandaki.edu.np',
          KYANA_BOT_AVATAR,
          'Official AI Campus Companion for Gandaki University',
          'BIT',
          'Semester 1',
          'active',
          'verified'
        );
      } else {
        await db.run(
          `INSERT OR IGNORE INTO students (
             studentId, name, role, email, avatarUrl, bio, department, semester, account_status, verification_status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          KYANA_BOT_ID,
          KYANA_BOT_NAME,
          KYANA_BOT_ROLE,
          'kyana@gandaki.edu.np',
          KYANA_BOT_AVATAR,
          'Official AI Campus Companion for Gandaki University',
          'BIT',
          'Semester 1',
          'active',
          'verified'
        );
      }
    }
    verifiedBotDbs.add(db);
  } catch (err) {
    console.warn('[Kyana Bot Account Warning]:', err.message);
  }
}

/**
 * Resolves full context of the entity being commented on.
 * Supports: 'post', 'assignment', 'file' / 'note'.
 */
async function resolveEntityContext(db, entityType, entityId) {
  const normType = String(entityType || 'post').toLowerCase();
  const id = Number(entityId);
  if (!Number.isFinite(id) || id <= 0) return null;

  try {
    if (normType === 'post' || normType === 'notice' || normType === 'announcement') {
      const row = await db.get(
        `SELECT p.*, s.name AS author_name, s.role AS author_role, s.department AS author_dept
         FROM posts p
         LEFT JOIN students s ON s.studentId = p.user_id
         WHERE p.id = ?`,
        id
      );
      if (!row) return null;

      const title = row.title && row.title.trim() ? row.title.trim() : extractPostTitle(row.content, null);

      // Optional attachments
      let attachments = [];
      try {
        attachments = (await db.all(
          'SELECT original_name, file_size, mime_type FROM post_attachments WHERE post_id = ?',
          id
        )) || [];
      } catch (_) {}

      // Optional target semesters
      let targetSemesters = [];
      try {
        const pt = (await db.all(
          'SELECT semester FROM post_target_semesters WHERE post_id = ? ORDER BY semester ASC',
          id
        )) || [];
        targetSemesters = pt.map(r => r.semester);
      } catch (_) {}

      return {
        id,
        entityType: 'post',
        postType: row.type || 'post',
        category: row.category || 'general',
        title: title || 'Campus Update',
        content: row.content || '',
        subject: row.subject || null,
        semester: row.semester || row.semester_no || null,
        targetSemesters,
        authorName: row.author_name || 'Campus Member',
        authorRole: row.author_role || 'student',
        createdAt: row.created_at || row.createdAt || null,
        attachments: attachments.map(a => a.original_name).filter(Boolean)
      };
    }

    if (normType === 'assignment') {
      let row = await db.get(`SELECT * FROM assignments WHERE id = ?`, id);
      let authorName = 'Faculty / Teacher';
      let authorRole = 'teacher';

      if (row) {
        const creatorId = row.createdBy || row.created_by || row.userId || row.user_id;
        if (creatorId) {
          try {
            const s = await db.get(`SELECT name, role FROM students WHERE studentId = ?`, creatorId);
            if (s) {
              authorName = s.name || authorName;
              authorRole = s.role || authorRole;
            }
          } catch (_) {}
        }
      } else {
        // Fallback: check if stored as a post with type='assignment'
        const postRow = await db.get(
          `SELECT p.*, s.name AS author_name, s.role AS author_role
           FROM posts p
           LEFT JOIN students s ON s.studentId = p.user_id
           WHERE p.id = ? AND LOWER(p.type) = 'assignment'`,
          id
        );
        if (postRow) {
          row = {
            id: postRow.id,
            title: postRow.title || extractPostTitle(postRow.content, null),
            description: postRow.content,
            subject: postRow.subject,
            semester: postRow.semester || postRow.semester_no,
            dueDate: null,
            totalMarks: null,
            author_name: postRow.author_name,
            author_role: postRow.author_role
          };
          authorName = postRow.author_name || authorName;
          authorRole = postRow.author_role || authorRole;
        }
      }
      if (!row) return null;

      return {
        id,
        entityType: 'assignment',
        title: row.title || 'Assignment',
        description: row.description || row.content || '',
        subject: row.subject || null,
        semester: row.semester || null,
        dueDate: row.dueDate || row.due_date || null,
        totalMarks: row.totalMarks || row.total_marks || null,
        instructions: row.instructions || null,
        starterCode: row.starterCode || row.starter_code || null,
        authorName,
        authorRole,
        createdAt: row.createdAt || row.created_at || null
      };
    }

    if (normType === 'file' || normType === 'note' || normType === 'material') {
      const row = await db.get(`SELECT * FROM files WHERE id = ?`, id);
      if (!row) return null;

      let authorName = 'Contributor';
      let authorRole = 'student';
      const uploaderId = row.uploadedBy || row.uploaded_by || row.userId || row.user_id;
      if (uploaderId) {
        try {
          const s = await db.get(`SELECT name, role FROM students WHERE studentId = ?`, uploaderId);
          if (s) {
            authorName = s.name || authorName;
            authorRole = s.role || authorRole;
          }
        } catch (_) {}
      }

      return {
        id,
        entityType: 'file',
        title: row.title || row.originalName || 'Study Material',
        originalName: row.originalName || null,
        subject: row.subject || null,
        semester: row.semester || null,
        chapter: row.chapter || null,
        description: row.description || '',
        authorName,
        authorRole,
        createdAt: row.createdAt || row.created_at || null
      };
    }
  } catch (err) {
    console.warn('[Resolve Entity Context Warning]:', err.message);
  }
  return null;
}

/**
 * Resolves context of the comment thread (e.g. parent comment).
 */
async function resolveThreadContext(db, entityType, entityId, parentCommentId) {
  if (!parentCommentId) return null;
  const pid = Number(parentCommentId);
  if (!Number.isFinite(pid) || pid <= 0) return null;

  try {
    const normType = String(entityType || 'post').toLowerCase();
    let row = null;
    if (normType === 'post') {
      row = await db.get(
        `SELECT c.id, c.content, c.user_id, s.name AS author_name
         FROM post_comments c
         LEFT JOIN students s ON s.studentId = c.user_id
         WHERE c.id = ?`,
        pid
      );
    } else if (normType === 'assignment') {
      row = await db.get(
        `SELECT c.id, c.commentText AS content, c.studentId AS user_id, s.name AS author_name
         FROM assignment_comments c
         LEFT JOIN students s ON s.studentId = c.studentId
         WHERE c.id = ?`,
        pid
      );
    } else if (normType === 'file') {
      row = await db.get(
        `SELECT c.id, c.commentText AS content, c.studentId AS user_id, s.name AS author_name
         FROM file_comments c
         LEFT JOIN students s ON s.studentId = c.studentId
         WHERE c.id = ?`,
        pid
      );
    }

    if (row && row.content) {
      return {
        parentCommentId: row.id,
        content: row.content,
        authorName: row.author_name || 'Classmate',
        authorId: row.user_id
      };
    }
  } catch (_) {}
  return null;
}

/**
 * Cross-references other relevant app data if the student's question asks for it:
 * - Routine / schedule / exam timetable
 * - Syllabus topics
 * - Upcoming assignments or related notices
 */
async function retrieveRelatedAppData(db, query, entity, user) {
  const q = String(query || '').toLowerCase();
  const related = {};

  // 1. Routine / Schedule lookup
  if (/\b(routine|schedule|timetable|class(?:es)?|time|baje|day|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|रुटिन|तालिका|कक्षा/i.test(q)) {
    try {
      const sem = entity?.semester || user?.semester;
      const parsedSem = sem ? Number(String(sem).replace(/\D+/g, '')) : null;
      if (parsedSem) {
        const rows = (await db.all(
          `SELECT subject_name AS subject, exam_date AS date, weekday AS day, exam_time AS time, room, exam_type AS type
           FROM routine
           WHERE semester = ?
           ORDER BY exam_date ASC
           LIMIT 6`,
          parsedSem
        )) || [];
        if (rows.length > 0) {
          related.routine = rows;
        }
      }
    } catch (_) {}
  }

  // 2. Syllabus reference lookup
  if (/\b(syllabus|unit|chapter|topic|module|course|contents?)\b|पाठ्यक्रम|युनिट|अध्याय/i.test(q) && entity?.subject) {
    try {
      const fs = require('fs');
      const path = require('path');
      const sylPath = path.join(__dirname, '../syllabus-data.json');
      if (fs.existsSync(sylPath)) {
        const sylData = JSON.parse(fs.readFileSync(sylPath, 'utf8'));
        const subLower = String(entity.subject).toLowerCase();
        const matched = Array.isArray(sylData)
          ? sylData.find(s => String(s.subject || s.title || s.name || '').toLowerCase().includes(subLower) || subLower.includes(String(s.subject || s.title || s.name || '').toLowerCase()))
          : null;
        if (matched) {
          related.syllabus = {
            subject: matched.subject || matched.title,
            units: Array.isArray(matched.units) ? matched.units.slice(0, 5) : matched.description || null
          };
        }
      }
    } catch (_) {}
  }

  // 3. Related notices or deadlines
  if (/\b(notice|notices|announcement|resum\w*|reopen\w*|holiday|bida|chutti|vacation|dashain|tihar)\b/i.test(q)) {
    try {
      const notices = (await db.all(
        `SELECT id, title, content, created_at
         FROM posts
         WHERE (LOWER(type) IN ('notice', 'announcement') OR LOWER(category) IN ('notice', 'announcement'))
           AND id != ?
         ORDER BY created_at DESC
         LIMIT 2`,
        entity?.id || 0
      )) || [];
      if (notices.length > 0) {
        related.recentNotices = notices.map(n => ({
          title: n.title || extractPostTitle(n.content, null),
          date: String(n.created_at || '').slice(0, 10),
          snippet: String(n.content || '').slice(0, 120)
        }));
      }
    } catch (_) {}
  }

  return related;
}

/**
 * Intelligent deterministic fallback generator if LLM provider is offline,
 * mocked, or timed out. Ensures 100% reliable responses in tests and network drops.
 */
function generateDeterministicFallbackReply({ query, entityContext, threadContext, relatedAppData, commentingUser }) {
  const q = String(query || '').toLowerCase();
  const userName = commentingUser?.name ? commentingUser.name.split(' ')[0] : 'there';
  const entityTitle = entityContext?.title || 'this post';
  const content = entityContext?.content || entityContext?.description || '';
  const author = entityContext?.authorName ? `${entityContext.authorName} (${entityContext.authorRole || 'Faculty'})` : 'the author';
  const dateStr = entityContext?.createdAt ? String(entityContext.createdAt).slice(0, 10) : '';

  const isNepali = /\b(yo|kina|kasari|kaile|k|kasto|cha|vanya|bhaneko|deu|gara|hamro|mero|timro)\b|कहिले|के|कसरी|छ|हुन्/i.test(q);

  // Check for summary requests
  const isSummary = /\b(summar\w*|tldr|overview|brief|gist|k\s+vanya|k\s+cha|short)\b|सारांश|के\s*छ/i.test(q);
  // Check for suggestion / opinion requests
  const isAdvice = /\b(opinion|suggest\w*|advice|recommend\w*|tips?|how\s+to|prepare|idea|sallah|sujhab)\b|सुझाव|सल्लाह/i.test(q);
  // Check for deadline / date questions
  const isDeadline = /\b(deadline|date|when|kaile|due|last\s+day|submission)\b|मिति|अन्तिम/i.test(q);

  if (isSummary) {
    const sentences = content.split(/[.\n।!?]+/).map(s => s.trim()).filter(s => s.length > 15).slice(0, 4);
    if (isNepali) {
      return `**${entityTitle} को मुख्य सारांश:**\n\n` +
        `• **प्रकाशक/लेखक:** ${author}${dateStr ? ` (${dateStr})` : ''}\n` +
        (sentences.length > 0 ? sentences.map(s => `• ${s}`).join('\n') : `• ${content.slice(0, 240)}…`) +
        `\n\nथप केही बुझ्न मन लागेमा मलाई सोध्न सक्नुहुन्छ!`;
    }
    return `**Key Summary of ${entityTitle}:**\n\n` +
      `• **Author / Source:** ${author}${dateStr ? ` (Published: ${dateStr})` : ''}\n` +
      (sentences.length > 0 ? sentences.map(s => `• ${s}`).join('\n') : `• ${content.slice(0, 240)}…`) +
      `\n\nLet me know if you need specific details or have follow-up questions!`;
  }

  if (isAdvice) {
    const subject = entityContext?.subject || 'this course';
    if (isNepali) {
      return `**${entityTitle} सम्बन्धी मेरो सुझाव:**\n\n` +
        `1. **अवधारणा बुझ्नुहोस्:** पहिले यसका आधारभूत सिद्धान्तहरू र आवश्यकताहरू राम्रोसँग अध्ययन गर्नुहोस्।\n` +
        `2. **व्यावहारिक अभ्यास:** केवल थ्योरीमा सीमित नभई कोडिङ वा लिखित अभ्यासमा ध्यान दिनुहोस्।\n` +
        `3. **समय व्यवस्थापन:** अन्तिम मितिसम्म नपर्खिकन समयमै काम पूरा गर्नुहोस्।\n\n` +
        `कुनै विशेष भागमा समस्या भए मलाई निसङ्कोच सोध्नुहोस्!`;
    }
    return `**My suggestions for ${entityTitle} (${subject}):**\n\n` +
      `1. **Focus on Core Fundamentals:** Make sure you clearly grasp the main objectives and requirements outlined by ${author}.\n` +
      `2. **Hands-On Implementation:** Practice practically rather than just memorizing theoretical concepts.\n` +
      `3. **Early Start:** Don't wait until the last minute—tackle the toughest components first.\n\n` +
      `Feel free to tag me if you get stuck on a particular problem!`;
  }

  if (isDeadline) {
    const due = entityContext?.dueDate || entityContext?.due_date;
    const dateMatch = content.match(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|[A-Za-z]+))\b/i);
    const resolvedDate = due || (dateMatch ? dateMatch[0] : null);

    if (resolvedDate) {
      return isNepali
        ? `यसको समय/मिति **${resolvedDate}** तोकिएको छ (लेखक: ${author})। समयमै तयारी पूरा गर्नुहोस्!`
        : `Based on the details provided by ${author}, the specified date/deadline is **${resolvedDate}**.`;
    }
    return isNepali
      ? `यस पोष्टमा कुनै निश्चित मिति वा डेडलाइन तोकिएको छैन। आधिकारिक तालिका अनुसार अगाडि बढ्नुहोस्।`
      : `No explicit calendar date or deadline is specified in this post. Please follow the updated department schedule or consult ${author}.`;
  }

  // Cross-referenced routine data
  if (relatedAppData?.routine && relatedAppData.routine.length > 0) {
    const items = relatedAppData.routine.slice(0, 3).map(r => `• **${r.subject}** (${r.date}${r.day ? `, ${r.day}` : ''}${r.time ? ` at ${r.time}` : ''})`).join('\n');
    return isNepali
      ? `यस पोष्टको सन्दर्भमा सम्बन्धित कक्षा/परीक्षा तालिका यस्तो छ:\n\n${items}\n\nअरु केही स्पष्ट पार्नु पर्ने भए भन्नुहोस्!`
      : `In connection with this post, here is the upcoming schedule:\n\n${items}\n\nLet me know if you need further clarification!`;
  }

  // Default contextual answer
  if (isNepali) {
    return `नमस्ते ${userName}! **${entityTitle}** को विवरण अनुसार:\n\n` +
      `लेखक (${author}) ले उल्लेख गर्नुभएको जानकारी: ${content.slice(0, 200)}…\n\n` +
      `यसबारे थप केही जान्न वा छलफल गर्न परे म सधैं तयार छु!`;
  }

  return `Hey ${userName}! Regarding **${entityTitle}**:\n\n` +
    `According to ${author}, ${content.slice(0, 250)}…\n\n` +
    `Let me know if you need further breakdown, opinions, or practical suggestions!`;
}

/**
 * Generates Kyana AI's reply text using multi-provider LLM with fallback.
 */
async function generateKyanaCommentReply({
  db,
  entityType,
  entityId,
  query,
  entityContext,
  threadContext,
  relatedAppData,
  commentingUser,
  generateReplyFn
}) {
  const entityTitle = entityContext?.title || 'Campus Post';
  const entityAuthor = entityContext?.authorName ? `${entityContext.authorName} (${entityContext.authorRole || 'Faculty'})` : 'Author';
  const entityContent = entityContext?.content || entityContext?.description || '';
  const entitySubject = entityContext?.subject ? `Subject: ${entityContext.subject}` : '';
  const entitySem = entityContext?.semester ? `Semester: ${entityContext.semester}` : '';
  const entityDate = entityContext?.createdAt ? `Published Date: ${String(entityContext.createdAt).slice(0, 10)}` : '';

  const parentSnippet = threadContext?.content ? `Parent comment by ${threadContext.authorName}: "${threadContext.content}"` : '';

  let appDataBlock = '';
  if (relatedAppData?.routine && relatedAppData.routine.length > 0) {
    appDataBlock += `\n[VERIFIED TIMETABLE / ROUTINE]:\n` +
      relatedAppData.routine.map(r => `- ${r.subject}: ${r.date} (${r.day || ''} ${r.time || ''}) Room: ${r.room || 'TBD'}`).join('\n');
  }
  if (relatedAppData?.syllabus) {
    appDataBlock += `\n[VERIFIED SYLLABUS DATA]:\nSubject: ${relatedAppData.syllabus.subject}\n` +
      JSON.stringify(relatedAppData.syllabus.units || '').slice(0, 400);
  }
  if (relatedAppData?.recentNotices && relatedAppData.recentNotices.length > 0) {
    appDataBlock += `\n[RECENT RELATED NOTICES]:\n` +
      relatedAppData.recentNotices.map(n => `- ${n.title} (${n.date}): ${n.snippet}`).join('\n');
  }

  const systemPrompt = `You are Kyana AI, the official intelligent, sharp, and helpful campus companion for Gandaki University students.
A student (${commentingUser?.name || 'Student'}) tagged you (@kyana) in the comment section of a campus ${entityType}.

YOUR OBJECTIVES:
1. Directly answer what the student asked for (summary, explanation, question answer, opinion, suggestions, or advice).
2. Ground your response in the specific ${entityType} context provided below.
3. If the user asks for suggestions or opinions (e.g. how to study, advice on approaching an assignment, project ideas), provide well-structured, insightful, practical, and academically sound advice tailored to BIT students.
4. If the user asks about schedules, routines, syllabus, or other university data, incorporate the verified campus data provided.
5. Tone: Witty, sharp, helpful, supportive senior vibe (classic Kyana personality), concise for comment threads.
6. Language: Match the student's language (English, Romanized Nepali / Nepanglish, or Devanagari).
7. Format with clean, readable Markdown (bullet points, bold highlights). Keep it concise and suitable for a comment thread (1-3 short paragraphs or bullet points).
8. Do NOT start your response with "@kyana" or self-tag.

CAMPUS CONTEXT:
[Entity Type]: ${entityType}
[Title]: ${entityTitle}
[Author]: ${entityAuthor}
${entityDate}
${entitySubject}
${entitySem}
${entityContext?.dueDate ? `[Due Date]: ${entityContext.dueDate}` : ''}
${entityContext?.totalMarks ? `[Total Marks]: ${entityContext.totalMarks}` : ''}
[Content]:
${entityContent}
${parentSnippet ? `\n[THREAD CONTEXT]:\n${parentSnippet}` : ''}
${appDataBlock ? `\n[CAMPUS APP DATA]:${appDataBlock}` : ''}
`;

  const userMessage = query || 'Please summarize this post and explain the key takeaways.';

  const callFn = generateReplyFn || generateReply;
  try {
    const res = await callFn({
      message: userMessage,
      history: [],
      systemPrompt,
      tools: []
    });

    if (res && res.reply && res.reply.trim()) {
      return res.reply.trim();
    }
  } catch (err) {
    console.warn('[Kyana Comment LLM Fallback]:', err.message);
  }

  // Graceful deterministic fallback
  return generateDeterministicFallbackReply({
    query: userMessage,
    entityContext,
    threadContext,
    relatedAppData,
    commentingUser
  });
}

/**
 * Saves Kyana AI's reply to the appropriate comment table
 * and dispatches in-app / push notifications to the mentioning user.
 */
async function postKyanaCommentReply(db, {
  entityType,
  entityId,
  replyText,
  parentCommentId,
  replyToUserId,
  mentioningUser,
  targetComment
}) {
  const normType = String(entityType || 'post').toLowerCase();
  const id = Number(entityId);
  const now = new Date().toISOString();

  await ensureKyanaBotAccount(db);

  let replyRecord = null;

  if (normType === 'post') {
    // Determine root parent comment for flattening
    let resolvedParentId = parentCommentId ? Number(parentCommentId) : null;
    if (targetComment && targetComment.parent_comment_id) {
      resolvedParentId = Number(targetComment.parent_comment_id);
    }

    const res = await db.run(
      `INSERT INTO post_comments (post_id, user_id, content, parent_comment_id, reply_to_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      KYANA_BOT_ID,
      replyText.trim(),
      resolvedParentId,
      replyToUserId || mentioningUser?.studentId || null,
      now
    );

    const commentId = res.lastInsertRowid;
    replyRecord = {
      id: Number(commentId),
      postId: id,
      userId: KYANA_BOT_ID,
      studentId: KYANA_BOT_ID,
      name: KYANA_BOT_NAME,
      role: KYANA_BOT_ROLE,
      avatarUrl: KYANA_BOT_AVATAR,
      content: replyText.trim(),
      parentCommentId: resolvedParentId,
      replyToUserId: replyToUserId || mentioningUser?.studentId || null,
      createdAt: now
    };

    // Dispatch push notification to mentioning user
    try {
      const { handleCommentOrReplyNotification } = require('./push-notifications');
      await handleCommentOrReplyNotification(db, {
        postId: id,
        commentId,
        authorStudentId: KYANA_BOT_ID,
        authorName: KYANA_BOT_NAME,
        content: replyText.trim(),
        targetParentId: resolvedParentId,
        targetComment: targetComment || { id: parentCommentId, user_id: replyToUserId || mentioningUser?.studentId },
        postAuthorId: null
      });
    } catch (notifErr) {
      console.warn('[Kyana Push Notification Isolated Warning]:', notifErr.message);
    }

    // Knowledge Engine sync
    try {
      const { onCommentSaved } = require('./knowledge-sync');
      await onCommentSaved(db, replyRecord, { id });
    } catch (_) {}

  } else if (normType === 'assignment') {
    let resolvedParentId = parentCommentId ? Number(parentCommentId) : null;
    const res = await db.run(
      `INSERT INTO assignment_comments (assignmentId, studentId, commentText, parent_comment_id, reply_to_user_id, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      KYANA_BOT_ID,
      replyText.trim(),
      resolvedParentId,
      replyToUserId || mentioningUser?.studentId || null,
      now
    );

    const commentId = res.lastInsertRowid;
    replyRecord = {
      id: Number(commentId),
      assignmentId: id,
      studentId: KYANA_BOT_ID,
      name: KYANA_BOT_NAME,
      role: KYANA_BOT_ROLE,
      avatarUrl: KYANA_BOT_AVATAR,
      content: replyText.trim(),
      commentText: replyText.trim(),
      parentCommentId: resolvedParentId,
      replyToUserId: replyToUserId || mentioningUser?.studentId || null,
      createdAt: now
    };

    // Dispatch in-app notification
    try {
      const notifService = require('./notifications-service');
      const recipientId = replyToUserId || mentioningUser?.studentId;
      if (recipientId && recipientId !== KYANA_BOT_ID) {
        await notifService.createNotification(db, {
          type: 'comment_reply',
          actorId: KYANA_BOT_ID,
          actorName: KYANA_BOT_NAME,
          actorAvatar: KYANA_BOT_AVATAR,
          title: 'Kyana AI',
          body: `Replied to your comment: ${replyText.slice(0, 90)}`,
          entityType: 'assignment',
          entityId: String(id),
          secondaryEntityId: String(commentId),
          deepLink: `/assignments/${id}`,
          webPath: `code-lab/assignment.html?id=${id}`,
          groupKey: `assignment:${id}:comments`,
          recipientUserIds: [recipientId]
        });
      }
    } catch (notifErr) {
      console.warn('[Kyana Assignment Notification Warning]:', notifErr.message);
    }

  } else if (normType === 'file' || normType === 'note' || normType === 'material') {
    let resolvedParentId = parentCommentId ? Number(parentCommentId) : null;
    const res = await db.run(
      `INSERT INTO file_comments (fileId, studentId, commentText, parent_comment_id, reply_to_user_id, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      KYANA_BOT_ID,
      replyText.trim(),
      resolvedParentId,
      replyToUserId || mentioningUser?.studentId || null,
      now
    );

    const commentId = res.lastInsertRowid;
    replyRecord = {
      id: Number(commentId),
      fileId: id,
      studentId: KYANA_BOT_ID,
      name: KYANA_BOT_NAME,
      role: KYANA_BOT_ROLE,
      avatarUrl: KYANA_BOT_AVATAR,
      content: replyText.trim(),
      commentText: replyText.trim(),
      parentCommentId: resolvedParentId,
      replyToUserId: replyToUserId || mentioningUser?.studentId || null,
      createdAt: now
    };

    // Dispatch in-app notification
    try {
      const notifService = require('./notifications-service');
      const recipientId = replyToUserId || mentioningUser?.studentId;
      if (recipientId && recipientId !== KYANA_BOT_ID) {
        await notifService.createNotification(db, {
          type: 'comment_reply',
          actorId: KYANA_BOT_ID,
          actorName: KYANA_BOT_NAME,
          actorAvatar: KYANA_BOT_AVATAR,
          title: 'Kyana AI',
          body: `Replied to your comment: ${replyText.slice(0, 90)}`,
          entityType: 'material',
          entityId: String(id),
          secondaryEntityId: String(commentId),
          deepLink: `/material/${id}`,
          webPath: `files.html?highlight=${id}`,
          groupKey: `material:${id}:comments`,
          recipientUserIds: [recipientId]
        });
      }
    } catch (notifErr) {
      console.warn('[Kyana File Notification Warning]:', notifErr.message);
    }
  }

  return replyRecord;
}

/**
 * Main entry point: process a newly posted comment for @kyana mention.
 *
 * @param {object} db - database adapter
 * @param {object} opts
 * @param {string} opts.entityType - 'post', 'assignment', or 'file'
 * @param {number} opts.entityId - ID of the entity
 * @param {number} opts.commentId - ID of the comment containing the mention
 * @param {string} opts.commentText - text of the comment
 * @param {object} opts.user - commenting user profile
 * @param {number} [opts.parentCommentId] - parent comment ID if nested
 * @param {object} [opts.targetComment] - target comment object if available
 * @param {boolean} [opts.awaitReply=false] - whether to synchronously await and return the reply
 * @param {function} [opts.generateReplyFn] - optional override for testing
 */
async function handleCommentMention(db, {
  entityType = 'post',
  entityId,
  commentId,
  commentText = '',
  user = {},
  parentCommentId = null,
  targetComment = null,
  awaitReply = false,
  generateReplyFn = null
} = {}) {
  // Prevent infinite loops: never process comments authored by Kyana AI
  const authorId = user?.studentId || user?.user_id || user?.userId;
  if (authorId === KYANA_BOT_ID) return null;

  if (!hasKyanaMention(commentText)) return null;

  const runTask = async () => {
    try {
      const query = extractMentionQuery(commentText);
      const entityContext = await resolveEntityContext(db, entityType, entityId);
      if (!entityContext) {
        console.warn(`[Kyana Comment Agent]: Entity ${entityType}:${entityId} not found.`);
        return null;
      }

      const threadContext = await resolveThreadContext(db, entityType, entityId, parentCommentId);
      const relatedAppData = await retrieveRelatedAppData(db, query, entityContext, user);

      const replyText = await generateKyanaCommentReply({
        db,
        entityType,
        entityId,
        query,
        entityContext,
        threadContext,
        relatedAppData,
        commentingUser: user,
        generateReplyFn
      });

      if (!replyText || !replyText.trim()) return null;

      const replyRecord = await postKyanaCommentReply(db, {
        entityType,
        entityId,
        replyText,
        parentCommentId: parentCommentId || commentId,
        replyToUserId: authorId,
        mentioningUser: user,
        targetComment: targetComment || { id: commentId, user_id: authorId }
      });

      return {
        replyComment: replyRecord,
        replyText
      };
    } catch (err) {
      console.error('[Kyana Comment Mention Execution Error]:', err);
      return null;
    }
  };

  if (awaitReply) {
    return await runTask();
  }

  // Asynchronous background execution
  setImmediate(() => {
    runTask().catch(err => {
      console.warn('[Kyana Comment Mention Background Error]:', err.message);
    });
  });

  return null;
}

module.exports = {
  KYANA_BOT_ID,
  KYANA_BOT_NAME,
  KYANA_BOT_ROLE,
  KYANA_BOT_AVATAR,
  hasKyanaMention,
  extractMentionQuery,
  ensureKyanaBotAccount,
  resolveEntityContext,
  resolveThreadContext,
  retrieveRelatedAppData,
  generateKyanaCommentReply,
  postKyanaCommentReply,
  handleCommentMention
};
