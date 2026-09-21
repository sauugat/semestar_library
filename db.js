const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// Load environment variables if .env exists
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.substring(0, eqIdx).trim();
          const val = trimmed.substring(eqIdx + 1).trim();
          if (!process.env[key]) process.env[key] = val;
        }
      }
    });
  }
} catch (e) { }

const isPostgres = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PGHOST);
const isTurso = !!(process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL);

let pgPool = null;
let libsqlClient = null;

if (isPostgres) {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  try {
    const { Pool, neonConfig } = require('@neondatabase/serverless');
    const ws = require('ws');
    neonConfig.webSocketConstructor = ws;
    pgPool = new Pool({
      connectionString
    });
    console.log('[DB Engine]: Connected to PostgreSQL/Neon Database via serverless driver');
  } catch (err) {
    console.error('[DB Engine]: PostgreSQL init error:', err.message);
  }
} else {
  const { createClient } = require('@libsql/client');
  let dbUrl;
  let authToken = process.env.TURSO_AUTH_TOKEN || undefined;

  if (isTurso) {
    dbUrl = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL;
    console.log('[DB Engine]: Connected to Turso/LibSQL Database');
  } else {
    const dbPath = process.env.VERCEL ? path.join('/tmp', 'database.db') : path.join(__dirname, 'database.db');
    dbUrl = `file:${dbPath}`;
    console.log(`[DB Engine]: Connected to local SQLite database at ${dbUrl}`);
  }

  libsqlClient = createClient({
    url: dbUrl,
    authToken
  });
}

function toPostgresSql(sql) {
  let idx = 1;
  return sql.replace(/\?/g, () => `$${idx++}`);
}

function normalizeParams(params) {
  if (!params || params.length === 0) return [];
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

const camelMap = {
  studentid: 'studentId', passwordhash: 'passwordHash', avatarurl: 'avatarUrl',
  githuburl: 'githubUrl', linkedinurl: 'linkedinUrl', followerid: 'followerId',
  followingid: 'followingId', createdat: 'createdAt', storedname: 'storedName',
  originalname: 'originalName', previewname: 'previewName', uploadedby: 'uploadedBy',
  sizebytes: 'sizeBytes', uploadedat: 'uploadedAt', fileid: 'fileId',
  commenttext: 'commentText', attachmentname: 'attachmentName',
  attachmentoriginalname: 'attachmentOriginalName', attachmentmimetype: 'attachmentMimeType',
  recipientstudentid: 'recipientStudentId', relatedfileid: 'relatedFileId',
  isread: 'isRead', mimetype: 'mimeType', filedata: 'fileData',
  lastinsertrowid: 'lastInsertRowid', uploadername: 'uploaderName',
  uploaderavatar: 'uploaderAvatar', uploaderrole: 'uploaderRole',
  likecount: 'likeCount', commentcount: 'commentCount',
  commentername: 'commenterName', isfollowing: 'isFollowing',
  followerscount: 'followersCount', followingcount: 'followingCount',
  replytoid: 'replyToId', linktitle: 'linkTitle', linkdesc: 'linkDesc',
  linkimage: 'linkImage', linkurl: 'linkUrl', messageid: 'messageId',
  lastreadmessageid: 'lastReadMessageId', lasttypedat: 'lastTypedAt',
  replytext: 'replyText', replysender: 'replySender',
  studentname: 'studentName', submittedat: 'submittedAt',
  assignmentid: 'assignmentId', assignmenttitle: 'assignmentTitle', createdby: 'createdBy', teachername: 'teacherName', eventtype: 'eventType', clienttime: 'clientTime',
  serverreceivedat: 'serverReceivedAt',
  questionid: 'questionId', questionnumber: 'questionNumber', questioncount: 'questionCount',
  questiontitle: 'questionTitle', questionlanguage: 'questionLanguage', testcasecount: 'testCaseCount',
  expectedoutput: 'expectedOutput', testresults: 'testResults',
  maxpoints: 'maxPoints', marksobtained: 'marksObtained',
  gradedby: 'gradedBy', gradedat: 'gradedAt', updatedat: 'updatedAt'
};

function formatRow(row) {
  if (!row) return row;
  const formatted = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = camelMap[key] || key;
    formatted[camelKey] = (value instanceof Date) ? value.toISOString() : value;
  }
  return formatted;
}

function formatRows(rows) {
  if (!rows) return rows;
  return rows.map(formatRow);
}

async function query(sql, ...params) {
  const normParams = normalizeParams(params);
  if (isPostgres && pgPool) {
    const pgSql = toPostgresSql(sql);
    const res = await pgPool.query(pgSql, normParams);
    return formatRows(res.rows);
  } else if (libsqlClient) {
    const res = await libsqlClient.execute({ sql, args: normParams });
    return formatRows(res.rows);
  }
  throw new Error('Database client is not initialized.');
}

async function get(sql, ...params) {
  const normParams = normalizeParams(params);
  if (isPostgres && pgPool) {
    const pgSql = toPostgresSql(sql);
    const res = await pgPool.query(pgSql, normParams);
    return formatRow(res.rows[0] || null);
  } else if (libsqlClient) {
    const res = await libsqlClient.execute({ sql, args: normParams });
    return formatRow(res.rows[0] || null);
  }
  throw new Error('Database client is not initialized.');
}

async function all(sql, ...params) {
  const normParams = normalizeParams(params);
  if (isPostgres && pgPool) {
    const pgSql = toPostgresSql(sql);
    const res = await pgPool.query(pgSql, normParams);
    return formatRows(res.rows);
  } else if (libsqlClient) {
    const res = await libsqlClient.execute({ sql, args: normParams });
    return formatRows(res.rows);
  }
  throw new Error('Database client is not initialized.');
}

async function run(sql, ...params) {
  const normParams = normalizeParams(params);
  if (isPostgres && pgPool) {
    let pgSql = sql;
    const isInsert = /^\s*INSERT\s+INTO/i.test(sql);
    const hasReturning = /RETURNING/i.test(sql);

    if (isInsert && !hasReturning) {
      const noIdTables = ['chat_read_receipts', 'chat_typing', 'file_likes', 'follows', 'chat_reactions', 'students', 'submissions', 'submission_events'];
      const isNoIdTable = noIdTables.some(tbl => new RegExp(`INSERT\\s+INTO\\s+${tbl}\\b`, 'i').test(sql));
      if (!isNoIdTable) {
        pgSql += ' RETURNING id';
      }
    }

    const convertedSql = toPostgresSql(pgSql);
    const res = await pgPool.query(convertedSql, normParams);

    const lastInsertRowid = res.rows && res.rows[0] && res.rows[0].id ? res.rows[0].id : null;
    return {
      lastInsertRowid,
      changes: res.rowCount || 0
    };
  } else if (libsqlClient) {
    const res = await libsqlClient.execute({ sql, args: normParams });
    return {
      lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : null,
      changes: res.rowsAffected || 0
    };
  }
  throw new Error('Database client is not initialized.');
}

async function exec(sql) {
  if (isPostgres && pgPool) {
    await pgPool.query(sql);
  } else if (libsqlClient) {
    await libsqlClient.executeMultiple(sql);
  }
}

function prepare(sql) {
  return {
    get: (...args) => get(sql, ...args),
    all: (...args) => all(sql, ...args),
    run: (...args) => run(sql, ...args)
  };
}

function transaction(fn) {
  return async (...args) => {
    if (isPostgres && pgPool) {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        const res = await fn(...args);
        await client.query('COMMIT');
        return res;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      return await fn(...args);
    }
  };
}

const DEFAULT_STUDENTS = [
  { studentId: "26020230", name: "Aashrita Lamichhane", password: "aashrita230", role: "student" },
  { studentId: "26020231", name: "Anisha Gurung", password: "anisha231", role: "student" },
  { studentId: "26020232", name: "Ankit Bhandari", password: "ankit232", role: "student" },
  { studentId: "26020233", name: "Apekshya Shrestha", password: "apekshya233", role: "student" },
  { studentId: "26020234", name: "Avash Acharya", password: "avash234", role: "student" },
  { studentId: "26020235", name: "Diperson B.k.", password: "diperson235", role: "student" },
  { studentId: "26020236", name: "Krish Chhetri", password: "krish236", role: "student" },
  { studentId: "26020237", name: "Madan Adhikari", password: "madan237", role: "student" },
  { studentId: "26020238", name: "Madhab Khanal", password: "madhab238", role: "student" },
  { studentId: "26020239", name: "Manila Adhikari", password: "manila239", role: "student" },
  { studentId: "26020240", name: "Manish Regmi", password: "manish240", role: "student" },
  { studentId: "26020241", name: "Manoram Subedi", password: "manoram241", role: "student" },
  { studentId: "26020242", name: "Milan Lamichhane", password: "milan242", role: "student" },
  { studentId: "26020243", name: "Nirmal Pun", password: "nirmal243", role: "student" },
  { studentId: "26020244", name: "Nisha Sunar", password: "nisha244", role: "student" },
  { studentId: "26020245", name: "Prabhab Tiwari", password: "prabhab245", role: "student" },
  { studentId: "26020246", name: "Prajwal Rai Bantawa", password: "prajwal246", role: "student" },
  { studentId: "26020247", name: "Pratikshya B.k", password: "pratikshya247", role: "student" },
  { studentId: "26020248", name: "Punam Pun Magar", password: "punam248", role: "student" },
  { studentId: "26020249", name: "Raj Dhakal", password: "raj249", role: "student" },
  { studentId: "26020250", name: "Rajib Gharti", password: "rajib250", role: "student" },
  { studentId: "26020251", name: "Rajib Rimal", password: "rajib251", role: "student" },
  { studentId: "26020253", name: "Rakhi Bhujel", password: "rakhi253", role: "student" },
  { studentId: "26020252", name: "Sagar Bhurtel", password: "sagar252", role: "student" },
  { studentId: "26020254", name: "Sahil Thapa", password: "sahil254", role: "student" },
  { studentId: "26020255", name: "Sajan Gurung", password: "sajan255", role: "student" },
  { studentId: "26020256", name: "Sajana Kandel", password: "sajana256", role: "student" },
  { studentId: "26020257", name: "Sakshyam Tiwari", password: "sakshyam257", role: "student" },
  { studentId: "26020258", name: "Salina Banstola", password: "salina258", role: "student" },
  { studentId: "26020259", name: "Sanchita Bhandari", password: "sanchita259", role: "student" },
  { studentId: "26020260", name: "Sandesh Dhakal", password: "sandesh260", role: "student" },
  { studentId: "26020261", name: "Sandesh Ranabhat", password: "sandesh261", role: "student" },
  { studentId: "26020262", name: "Sandhya Sharma", password: "sandhya262", role: "student" },
  { studentId: "26020263", name: "Sangam Bhujel", password: "sangam263", role: "student" },
  { studentId: "26020264", name: "Sanjana Adhikari", password: "sanjana264", role: "student" },
  { studentId: "26020265", name: "Sankalpa Kc", password: "sankalpa265", role: "student" },
  { studentId: "26020266", name: "Saugat Subedi", password: "saugat266", role: "admin" },
  { studentId: "26020267", name: "Sishir Bharati", password: "sishir267", role: "student" },
  { studentId: "26020268", name: "Subarna Poudel", password: "subarna268", role: "student" },
  { studentId: "26020269", name: "Sudarshan Poudel", password: "sudarshan269", role: "student" },
  { studentId: "26020270", name: "Sujan Giri", password: "sujan270", role: "student" },
  { studentId: "26020271", name: "Sujan Shrestha", password: "sujan271", role: "cr" },
  { studentId: "26020272", name: "Suresh Gurung", password: "suresh272", role: "student" },
  { studentId: "26020273", name: "Ujjwal Gurung", password: "ujjwal273", role: "student" },
  { studentId: "26020274", name: "Yujina Bhattarai", password: "yujina274", role: "student" }
];

let initPromise = null;

async function initSchema() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      if (isPostgres) {
        await exec(`
          CREATE TABLE IF NOT EXISTS students (
            studentId TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            passwordHash TEXT NOT NULL,
            avatarUrl TEXT,
            bio TEXT,
            department TEXT DEFAULT 'BIT',
            semester TEXT DEFAULT 'Semester 1',
            githubUrl TEXT,
            linkedinUrl TEXT,
            role TEXT DEFAULT 'student'
          );

          CREATE TABLE IF NOT EXISTS follows (
            followerId TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
            followingId TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
            createdAt TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (followerId, followingId)
          );

          CREATE TABLE IF NOT EXISTS files (
            id SERIAL PRIMARY KEY,
            storedName TEXT NOT NULL,
            originalName TEXT NOT NULL,
            title TEXT,
            subject TEXT,
            chapter TEXT,
            semester TEXT,
            previewName TEXT,
            uploadedBy TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
            sizeBytes BIGINT NOT NULL,
            uploadedAt TIMESTAMPTZ NOT NULL
          );

          CREATE TABLE IF NOT EXISTS file_likes (
            fileId INTEGER NOT NULL,
            studentId TEXT NOT NULL,
            PRIMARY KEY (fileId, studentId)
          );

          CREATE TABLE IF NOT EXISTS file_comments (
            id SERIAL PRIMARY KEY,
            fileId INTEGER NOT NULL,
            studentId TEXT NOT NULL,
            commentText TEXT NOT NULL,
            createdAt TIMESTAMPTZ NOT NULL
          );

          CREATE TABLE IF NOT EXISTS chat_messages (
            id SERIAL PRIMARY KEY,
            studentId TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
            text TEXT,
            attachmentName TEXT,
            attachmentOriginalName TEXT,
            attachmentMimeType TEXT,
            replyToId INTEGER,
            linkUrl TEXT,
            linkTitle TEXT,
            linkDesc TEXT,
            linkImage TEXT,
            createdAt TIMESTAMPTZ NOT NULL
          );

          CREATE TABLE IF NOT EXISTS chat_reactions (
            messageId INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
            studentId TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
            emoji TEXT NOT NULL,
            PRIMARY KEY (messageId, studentId)
          );

          CREATE TABLE IF NOT EXISTS chat_read_receipts (
            studentId TEXT PRIMARY KEY REFERENCES students(studentId) ON DELETE CASCADE,
            lastReadMessageId INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS chat_typing (
            studentId TEXT PRIMARY KEY REFERENCES students(studentId) ON DELETE CASCADE,
            lastTypedAt TIMESTAMPTZ NOT NULL
          );

          CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY,
            recipientStudentId TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
            type TEXT NOT NULL,
            relatedFileId INTEGER,
            message TEXT NOT NULL,
            isRead INTEGER DEFAULT 0,
            createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS file_blobs (
            id SERIAL PRIMARY KEY,
            filename TEXT UNIQUE NOT NULL,
            mimeType TEXT,
            fileData BYTEA NOT NULL,
            createdAt TIMESTAMPTZ NOT NULL
          );

          CREATE TABLE IF NOT EXISTS exam_schedule (
            id SERIAL PRIMARY KEY,
            subject TEXT NOT NULL,
            examDate TEXT NOT NULL,
            day TEXT,
            time TEXT,
            semester TEXT NOT NULL,
            type TEXT
          );

          CREATE TABLE IF NOT EXISTS assignments (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            language TEXT NOT NULL,
            subject TEXT,
            semester TEXT,
            deadline TIMESTAMPTZ,
            createdBy TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
            createdAt TIMESTAMPTZ NOT NULL
          );

          CREATE TABLE IF NOT EXISTS assignment_questions (
            id SERIAL PRIMARY KEY,
            assignmentId INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
            questionNumber INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            language TEXT NOT NULL,
            maxPoints INTEGER DEFAULT 10,
            createdAt TIMESTAMPTZ NOT NULL,
            UNIQUE(assignmentId, questionNumber)
          );

          CREATE TABLE IF NOT EXISTS submissions (
            id SERIAL PRIMARY KEY,
            assignmentId INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
            questionId INTEGER REFERENCES assignment_questions(id) ON DELETE CASCADE,
            studentId TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
            code TEXT NOT NULL,
            stdout TEXT,
            stderr TEXT,
            testResults TEXT,
            submittedAt TIMESTAMPTZ NOT NULL,
            UNIQUE(assignmentId, studentId)
          );
          CREATE TABLE IF NOT EXISTS submission_events (
  id SERIAL PRIMARY KEY,
  assignmentId INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  questionId INTEGER REFERENCES assignment_questions(id) ON DELETE CASCADE,
  studentId TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
  eventType TEXT NOT NULL,
  payload TEXT,
  clientTime TIMESTAMPTZ,
  serverReceivedAt TIMESTAMPTZ,
  createdAt TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submission_events_lookup ON submission_events (assignmentId, studentId);

          CREATE TABLE IF NOT EXISTS question_test_cases (
            id SERIAL PRIMARY KEY,
            questionId INTEGER NOT NULL REFERENCES assignment_questions(id) ON DELETE CASCADE,
            input TEXT,
            expectedOutput TEXT NOT NULL,
            createdAt TIMESTAMPTZ NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_test_cases_question ON question_test_cases (questionId);

          CREATE TABLE IF NOT EXISTS "session" (
            "sid" varchar NOT NULL COLLATE "default",
            "sess" json NOT NULL,
            "expire" timestamp(6) NOT NULL,
            CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
          );
          CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
        `);
      } else {
        await exec(`
          CREATE TABLE IF NOT EXISTS students (
            studentId TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            passwordHash TEXT NOT NULL,
            avatarUrl TEXT,
            bio TEXT,
            department TEXT DEFAULT 'BIT',
            semester TEXT DEFAULT 'Semester 1',
            githubUrl TEXT,
            linkedinUrl TEXT,
            role TEXT DEFAULT 'student'
          );

          CREATE TABLE IF NOT EXISTS follows (
            followerId TEXT NOT NULL,
            followingId TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            PRIMARY KEY (followerId, followingId),
            FOREIGN KEY (followerId) REFERENCES students(studentId),
            FOREIGN KEY (followingId) REFERENCES students(studentId)
          );

          CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            storedName TEXT NOT NULL,
            originalName TEXT NOT NULL,
            title TEXT,
            subject TEXT,
            chapter TEXT,
            semester TEXT,
            previewName TEXT,
            uploadedBy TEXT NOT NULL,
            sizeBytes INTEGER NOT NULL,
            uploadedAt TEXT NOT NULL,
            FOREIGN KEY (uploadedBy) REFERENCES students(studentId)
          );

          CREATE TABLE IF NOT EXISTS file_likes (
            fileId INTEGER NOT NULL,
            studentId TEXT NOT NULL,
            PRIMARY KEY (fileId, studentId)
          );

          CREATE TABLE IF NOT EXISTS file_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fileId INTEGER NOT NULL,
            studentId TEXT NOT NULL,
            commentText TEXT NOT NULL,
            createdAt TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            studentId TEXT NOT NULL,
            text TEXT,
            attachmentName TEXT,
            attachmentOriginalName TEXT,
            attachmentMimeType TEXT,
            replyToId INTEGER,
            linkUrl TEXT,
            linkTitle TEXT,
            linkDesc TEXT,
            linkImage TEXT,
            createdAt TEXT NOT NULL,
            FOREIGN KEY (studentId) REFERENCES students(studentId)
          );

          CREATE TABLE IF NOT EXISTS chat_reactions (
            messageId INTEGER NOT NULL,
            studentId TEXT NOT NULL,
            emoji TEXT NOT NULL,
            PRIMARY KEY (messageId, studentId),
            FOREIGN KEY (messageId) REFERENCES chat_messages(id),
            FOREIGN KEY (studentId) REFERENCES students(studentId)
          );

          CREATE TABLE IF NOT EXISTS chat_read_receipts (
            studentId TEXT PRIMARY KEY,
            lastReadMessageId INTEGER NOT NULL,
            FOREIGN KEY (studentId) REFERENCES students(studentId)
          );

          CREATE TABLE IF NOT EXISTS chat_typing (
            studentId TEXT PRIMARY KEY,
            lastTypedAt TEXT NOT NULL,
            FOREIGN KEY (studentId) REFERENCES students(studentId)
          );

          CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipientStudentId TEXT NOT NULL,
            type TEXT NOT NULL,
            relatedFileId INTEGER,
            message TEXT NOT NULL,
            isRead INTEGER DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipientStudentId) REFERENCES students(studentId)
          );

          CREATE TABLE IF NOT EXISTS file_blobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT UNIQUE NOT NULL,
            mimeType TEXT,
            fileData BLOB NOT NULL,
            createdAt TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS exam_schedule (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject TEXT NOT NULL,
            examDate TEXT NOT NULL,
            day TEXT,
            time TEXT,
            semester TEXT NOT NULL,
            type TEXT
          );

          CREATE TABLE IF NOT EXISTS assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            language TEXT NOT NULL,
            subject TEXT,
            semester TEXT,
            deadline TEXT,
            createdBy TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            FOREIGN KEY (createdBy) REFERENCES students(studentId)
          );

          CREATE TABLE IF NOT EXISTS assignment_questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            assignmentId INTEGER NOT NULL,
            questionNumber INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            language TEXT NOT NULL,
            maxPoints INTEGER DEFAULT 10,
            createdAt TEXT NOT NULL,
            FOREIGN KEY (assignmentId) REFERENCES assignments(id),
            UNIQUE(assignmentId, questionNumber)
          );

          CREATE TABLE IF NOT EXISTS submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            assignmentId INTEGER NOT NULL,
            questionId INTEGER,
            studentId TEXT NOT NULL,
            code TEXT NOT NULL,
            stdout TEXT,
            stderr TEXT,
            testResults TEXT,
            submittedAt TEXT NOT NULL,
            FOREIGN KEY (assignmentId) REFERENCES assignments(id),
            FOREIGN KEY (questionId) REFERENCES assignment_questions(id),
            FOREIGN KEY (studentId) REFERENCES students(studentId),
            UNIQUE(assignmentId, studentId)
          ); 
          CREATE TABLE IF NOT EXISTS submission_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignmentId INTEGER NOT NULL,
  questionId INTEGER,
  studentId TEXT NOT NULL,
  eventType TEXT NOT NULL,
  payload TEXT,
  clientTime TEXT,
  serverReceivedAt TEXT,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (assignmentId) REFERENCES assignments(id),
  FOREIGN KEY (questionId) REFERENCES assignment_questions(id),
  FOREIGN KEY (studentId) REFERENCES students(studentId)
);

          CREATE TABLE IF NOT EXISTS question_test_cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            questionId INTEGER NOT NULL,
            input TEXT,
            expectedOutput TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            FOREIGN KEY (questionId) REFERENCES assignment_questions(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_test_cases_question ON question_test_cases (questionId);
        `);
      }

      // One-time migration for tables that existed before subject/stdout/stderr columns were added
      try {
        if (isPostgres) {
          await exec(`ALTER TABLE assignments ADD COLUMN IF NOT EXISTS subject TEXT;`);
          await exec(`ALTER TABLE assignments ADD COLUMN IF NOT EXISTS semester TEXT;`);
          await exec(`ALTER TABLE assignments ADD COLUMN IF NOT EXISTS deadline TEXT;`);
          await exec(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS stdout TEXT;`);
          await exec(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS stderr TEXT;`);
          await exec(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS testResults TEXT;`);
          await exec(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS questionId INTEGER REFERENCES assignment_questions(id) ON DELETE CASCADE;`);
          await exec(`ALTER TABLE submission_events ADD COLUMN IF NOT EXISTS questionId INTEGER REFERENCES assignment_questions(id) ON DELETE CASCADE;`);
          await exec(`ALTER TABLE submission_events ADD COLUMN IF NOT EXISTS serverReceivedAt TEXT;`);
          await exec(`ALTER TABLE assignment_questions ADD COLUMN IF NOT EXISTS maxPoints INTEGER DEFAULT 10;`);

          await exec(`CREATE TABLE IF NOT EXISTS question_test_cases (
            id SERIAL PRIMARY KEY,
            questionId INTEGER NOT NULL REFERENCES assignment_questions(id) ON DELETE CASCADE,
            input TEXT,
            expectedOutput TEXT NOT NULL,
            createdAt TIMESTAMPTZ NOT NULL
          );`);
          await exec(`CREATE INDEX IF NOT EXISTS idx_test_cases_question ON question_test_cases (questionId);`);

          await exec(`CREATE TABLE IF NOT EXISTS submission_grades (
            id SERIAL PRIMARY KEY,
            questionId INTEGER NOT NULL REFERENCES assignment_questions(id) ON DELETE CASCADE,
            studentId TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
            marksObtained INTEGER,
            remarks TEXT,
            checked BOOLEAN DEFAULT FALSE,
            released BOOLEAN DEFAULT FALSE,
            gradedBy TEXT REFERENCES students(studentId),
            gradedAt TIMESTAMPTZ,
            updatedAt TIMESTAMPTZ NOT NULL,
            UNIQUE(questionId, studentId)
          );`);
          await exec(`CREATE INDEX IF NOT EXISTS idx_submission_grades_lookup ON submission_grades(questionId, studentId);`);

          try {
            await exec(`ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_unique;`);
            await exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_q_student ON submissions(questionId, studentId) WHERE questionId IS NOT NULL;`);
          } catch (constraintErr) {
            console.error('[DB Engine]: Constraint migration warning:', constraintErr.message);
          }
        } else {
          const cols = await all(`PRAGMA table_info(submissions)`);
          const colNames = cols.map(c => c.name);
          if (!colNames.includes('stdout')) await exec(`ALTER TABLE submissions ADD COLUMN stdout TEXT;`);
          if (!colNames.includes('stderr')) await exec(`ALTER TABLE submissions ADD COLUMN stderr TEXT;`);
          if (!colNames.includes('testResults')) await exec(`ALTER TABLE submissions ADD COLUMN testResults TEXT;`);
          if (!colNames.includes('questionId')) await exec(`ALTER TABLE submissions ADD COLUMN questionId INTEGER REFERENCES assignment_questions(id);`);

          const assignCols = await all(`PRAGMA table_info(assignments)`);
          const assignColNames = assignCols.map(c => c.name);
          if (!assignColNames.includes('subject')) await exec(`ALTER TABLE assignments ADD COLUMN subject TEXT;`);
          if (!assignColNames.includes('semester')) await exec(`ALTER TABLE assignments ADD COLUMN semester TEXT;`);
          if (!assignColNames.includes('deadline')) await exec(`ALTER TABLE assignments ADD COLUMN deadline TEXT;`);

          const eventCols = await all(`PRAGMA table_info(submission_events)`);
          const eventColNames = eventCols.map(c => c.name);
          if (!eventColNames.includes('questionId')) await exec(`ALTER TABLE submission_events ADD COLUMN questionId INTEGER REFERENCES assignment_questions(id);`);
          if (!eventColNames.includes('serverReceivedAt')) await exec(`ALTER TABLE submission_events ADD COLUMN serverReceivedAt TEXT;`);

          const qCols = await all(`PRAGMA table_info(assignment_questions)`);
          const qColNames = qCols.map(c => c.name);
          if (!qColNames.includes('maxPoints')) await exec(`ALTER TABLE assignment_questions ADD COLUMN maxPoints INTEGER DEFAULT 10;`);

          await exec(`CREATE TABLE IF NOT EXISTS question_test_cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            questionId INTEGER NOT NULL,
            input TEXT,
            expectedOutput TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            FOREIGN KEY (questionId) REFERENCES assignment_questions(id) ON DELETE CASCADE
          );`);
          await exec(`CREATE INDEX IF NOT EXISTS idx_test_cases_question ON question_test_cases (questionId);`);

          await exec(`CREATE TABLE IF NOT EXISTS submission_grades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            questionId INTEGER NOT NULL,
            studentId TEXT NOT NULL,
            marksObtained INTEGER,
            remarks TEXT,
            checked INTEGER DEFAULT 0,
            released INTEGER DEFAULT 0,
            gradedBy TEXT,
            gradedAt TEXT,
            updatedAt TEXT NOT NULL,
            FOREIGN KEY (questionId) REFERENCES assignment_questions(id) ON DELETE CASCADE,
            FOREIGN KEY (studentId) REFERENCES students(studentId) ON DELETE CASCADE,
            FOREIGN KEY (gradedBy) REFERENCES students(studentId),
            UNIQUE(questionId, studentId)
          );`);
          await exec(`CREATE INDEX IF NOT EXISTS idx_submission_grades_lookup ON submission_grades(questionId, studentId);`);
        }
      } catch (alterErr) {
        console.error('[DB Engine]: Column migration warning:', alterErr.message);
      }

      // Create question-level index (after column is ensured to exist)
      try {
        if (isPostgres) {
          await exec(`CREATE INDEX IF NOT EXISTS idx_submission_events_question ON submission_events (questionId, studentId);`);
        }
      } catch (idxErr) {
        // Index may already exist
      }

      // ── One-time migration: Convert existing single-question assignments ──
      // Creates one assignment_questions row per existing assignment, then
      // backfills questionId on submissions and submission_events.
      try {
        const questionCount = await get('SELECT COUNT(*) AS c FROM assignment_questions');
        const assignmentCount = await get('SELECT COUNT(*) AS c FROM assignments');
        const qCount = Number(questionCount?.c || 0);
        const aCount = Number(assignmentCount?.c || 0);

        if (aCount > 0 && qCount === 0) {
          console.log(`[DB Engine]: Migrating ${aCount} existing assignments to multi-question schema...`);
          const existingAssignments = await all('SELECT id, title, description, language, createdAt FROM assignments');

          for (const a of existingAssignments) {
            const result = await run(
              'INSERT INTO assignment_questions (assignmentId, questionNumber, title, description, language, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
              a.id, 1, a.title, a.description, a.language, a.createdAt
            );
            const newQuestionId = result.lastInsertRowid;

            if (newQuestionId) {
              // Backfill submissions
              await run(
                'UPDATE submissions SET questionId = ? WHERE assignmentId = ? AND questionId IS NULL',
                newQuestionId, a.id
              );
              // Backfill submission_events
              await run(
                'UPDATE submission_events SET questionId = ? WHERE assignmentId = ? AND questionId IS NULL',
                newQuestionId, a.id
              );
            }
          }

          // Verify
          const newQCount = await get('SELECT COUNT(*) AS c FROM assignment_questions');
          console.log(`[DB Engine]: Migration complete! Created ${Number(newQCount?.c || 0)} question rows for ${aCount} assignments.`);
        }
      } catch (migErr) {
        console.error('[DB Engine]: Multi-question migration error:', migErr.message);
      }

      const countRow = await get('SELECT COUNT(*) AS c FROM students');
      const studentCount = Number(countRow?.c || countRow?.count || 0);

      if (studentCount === 0) {
        console.log('[DB Engine]: Fresh database detected. Seeding 60 student accounts...');
        for (const s of DEFAULT_STUDENTS) {
          const hash = bcrypt.hashSync(s.password, 10);
          const role = s.role || 'student';
          if (isPostgres) {
            await run(
              `INSERT INTO students (studentId, name, passwordHash, role) VALUES (?, ?, ?, ?)
               ON CONFLICT (studentId) DO UPDATE SET name = EXCLUDED.name, passwordHash = EXCLUDED.passwordHash, role = EXCLUDED.role`,
              s.studentId, s.name, hash, role
            );
          } else {
            await run(
              `INSERT OR REPLACE INTO students (studentId, name, passwordHash, role) VALUES (?, ?, ?, ?)`,
              s.studentId, s.name, hash, role
            );
          }
        }
        console.log('[DB Engine]: Seeding complete!');
      }

      const countExamsRow = await get('SELECT COUNT(*) AS c FROM exam_schedule');
      const examCount = Number(countExamsRow?.c || countExamsRow?.count || 0);

      if (examCount === 0) {
        console.log('[DB Engine]: Fresh database detected. Seeding exam schedules...');
        const routineExams = [
          { semester: 'II', semNum: 2, date: '2083/05/17', time: 'CIT121', subject: 'Discrete Mathematics', type: 'Examination' },
          { semester: 'II', semNum: 2, date: '2083/05/23', time: 'CIT122', subject: 'Computer Programming II (Java)', type: 'Examination' },
          { semester: 'II', semNum: 2, date: '2083/05/26', time: 'ELX121', subject: 'Digital Logic', type: 'Examination' },
          { semester: 'II', semNum: 2, date: '2083/05/30', time: 'CIT123', subject: 'Web Technology I', type: 'Examination' },
          { semester: 'II', semNum: 2, date: '2083/06/02', time: 'BSM121', subject: 'Mathematics-II', type: 'Examination' },
          { semester: 'IV', semNum: 4, date: '2083/06/05', time: 'CIT222', subject: 'Management Information System', type: 'Examination' },
          { semester: 'IV', semNum: 4, date: '2083/06/09', time: 'CIT221', subject: 'Operating Systems', type: 'Examination' },
          { semester: 'IV', semNum: 4, date: '2083/06/13', time: 'CIT223', subject: 'Data Communication and Computer Networks', type: 'Examination' },
          { semester: 'IV', semNum: 4, date: '2083/06/16', time: 'BSM221', subject: 'Fundamentals of Probability and Statistics', type: 'Examination' },
          { semester: 'IV', semNum: 4, date: '2083/06/21', time: 'CIT224', subject: 'Computer Graphics Technology', type: 'Examination' },
          { semester: 'VI', semNum: 6, date: '2083/05/22', time: 'CIT321', subject: 'Human Computer Interface and UI Design', type: 'Examination' },
          { semester: 'VI', semNum: 6, date: '2083/05/25', time: 'CIT323', subject: 'Artificial Intelligence', type: 'Examination' },
          { semester: 'VI', semNum: 6, date: '2083/05/31', time: 'BCT322', subject: 'Financial Accounting', type: 'Examination' },
          { semester: 'VI', semNum: 6, date: '2083/06/05', time: 'BCT321', subject: 'IT Project Management', type: 'Examination' },
          { semester: 'VI', semNum: 6, date: '2083/06/08', time: 'CIT322', subject: 'Digital Forensic Security Technologies', type: 'Examination' },
          { semester: 'VIII', semNum: 8, date: '2083/05/16', time: 'CIT421', subject: 'Big Data Technologies', type: 'Examination' },
          { semester: 'VIII', semNum: 8, date: '2083/05/18', time: 'BCT421', subject: 'Society, IT and Law', type: 'Examination' },
          { semester: 'VIII', semNum: 8, date: '2083/05/22', time: 'Elective', subject: 'IoT and Smart Technologies / E-Business and E-Commerce', type: 'Examination' }
        ];

        for (const e of routineExams) {
          await run(
            `INSERT INTO exam_schedule (subject, examDate, day, time, semester, type) VALUES (?, ?, ?, ?, ?, ?)`,
            e.subject, e.date, e.day, e.time, e.semester, e.type
          );
        }
        console.log('[DB Engine]: Exam schedules seeded!');
      }
    } catch (err) {
      console.error('[DB Engine]: Schema initialization error:', err);
    }
  })();

  return initPromise;
}

async function saveFileBlob(filename, buffer, mimeType = 'application/octet-stream') {
  try {
    const baseName = path.basename(filename);
    const now = new Date().toISOString();
    if (isPostgres) {
      await run(`
        INSERT INTO file_blobs (filename, mimeType, fileData, createdAt)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (filename) DO UPDATE SET fileData = EXCLUDED.fileData, mimeType = EXCLUDED.mimeType
      `, baseName, mimeType, buffer, now);
    } else {
      await run(`
        INSERT OR REPLACE INTO file_blobs (filename, mimeType, fileData, createdAt)
        VALUES (?, ?, ?, ?)
      `, baseName, mimeType, buffer, now);
    }
    return true;
  } catch (err) {
    console.error(`[DB Engine]: saveFileBlob error for ${filename}:`, err.message);
    return false;
  }
}

async function getFileBlob(filename) {
  try {
    const baseName = path.basename(filename);
    const row = await get('SELECT mimeType, fileData FROM file_blobs WHERE filename = ?', baseName);
    if (!row || !row.filedata && !row.fileData) return null;
    return {
      mimeType: row.mimetype || row.mimeType || 'application/octet-stream',
      fileData: Buffer.from(row.filedata || row.fileData)
    };
  } catch (err) {
    console.error(`[DB Engine]: getFileBlob error for ${filename}:`, err.message);
    return null;
  }
}

async function deleteFileBlob(filename) {
  try {
    const baseName = path.basename(filename);
    await run('DELETE FROM file_blobs WHERE filename = ?', baseName);
    return true;
  } catch (err) {
    console.error(`[DB Engine]: deleteFileBlob error for ${filename}:`, err.message);
    return false;
  }
}

initSchema().catch(err => console.error('[DB Engine]: Schema init fatal error:', err));

module.exports = {
  query,
  get,
  all,
  run,
  exec,
  prepare,
  transaction,
  initSchema,
  saveFileBlob,
  getFileBlob,
  deleteFileBlob,
  isPostgres,
  isTurso,
  pgPool
}; 