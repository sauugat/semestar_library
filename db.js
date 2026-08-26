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
} catch (e) {}

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
  // Use @libsql/client (pure JS/Wasm SQLite engine - works everywhere with zero native binaries)
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

// Convert SQLite '?' parameter placeholders to PostgreSQL '$1, $2, $3'
function toPostgresSql(sql) {
  let idx = 1;
  return sql.replace(/\?/g, () => `$${idx++}`);
}

// Flatten parameters if passed as multiple arguments or single array
function normalizeParams(params) {
  if (!params || params.length === 0) return [];
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

// Map PostgreSQL lowercase column names back to expected camelCase
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
  replytext: 'replyText', replysender: 'replySender'
};

function formatRow(row) {
  if (!row) return row;
  const formatted = {};
  for (const [key, value] of Object.entries(row)) {
    formatted[camelMap[key] || key] = value;
  }
  return formatted;
}

function formatRows(rows) {
  if (!rows) return rows;
  return rows.map(formatRow);
}

// Universal Query Executor
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

// Fetch single row
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

// Fetch multiple rows
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

// Execute write mutation (INSERT, UPDATE, DELETE)
async function run(sql, ...params) {
  const normParams = normalizeParams(params);

  if (isPostgres && pgPool) {
    let pgSql = sql;
    const isInsert = /^\s*INSERT\s+INTO/i.test(sql);
    const hasReturning = /RETURNING/i.test(sql);

    // Auto-append RETURNING id for inserts so lastInsertRowid is available
    if (isInsert && !hasReturning) {
      pgSql += ' RETURNING id';
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

// Execute raw multi-statement DDL script
async function exec(sql) {
  if (isPostgres && pgPool) {
    await pgPool.query(sql);
  } else if (libsqlClient) {
    await libsqlClient.executeMultiple(sql);
  }
}

// Backwards-compatible prepare() helper returning async methods
function prepare(sql) {
  return {
    get: (...args) => get(sql, ...args),
    all: (...args) => all(sql, ...args),
    run: (...args) => run(sql, ...args)
  };
}

// Transaction wrapper
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
      // LibSQL / SQLite transaction
      return await fn(...args);
    }
  };
}

// ============================================================================
// AUTOMATIC DATABASE SCHEMA INITIALIZATION & INITIAL SEEDING
// ============================================================================
const DEFAULT_STUDENTS = [
  { studentId: "26020230", name: "Aashrita Lamichhane", password: "aashrita230", role: "admin" },
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
  { studentId: "26020271", name: "Sujan Shrestha", password: "sujan271", role: "student" },
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
            createdAt TEXT NOT NULL,
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
            uploadedAt TEXT NOT NULL
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
            createdAt TEXT NOT NULL
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
            createdAt TEXT NOT NULL
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
            lastTypedAt TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY,
            recipientStudentId TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
            type TEXT NOT NULL,
            relatedFileId INTEGER,
            message TEXT NOT NULL,
            isRead INTEGER DEFAULT 0,
            createdAt TEXT DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS file_blobs (
            id SERIAL PRIMARY KEY,
            filename TEXT UNIQUE NOT NULL,
            mimeType TEXT,
            fileData BYTEA NOT NULL,
            createdAt TEXT NOT NULL
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
        `);
      }

      // Auto-seed students if table is empty
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

      // Auto-seed exams if table is empty
      const countExamsRow = await get('SELECT COUNT(*) AS c FROM exam_schedule');
      const examCount = Number(countExamsRow?.c || countExamsRow?.count || 0);

      if (examCount === 0) {
        console.log('[DB Engine]: Fresh database detected. Seeding exam schedules...');
        const routineExams = [
          // Semester II
          { semester: 'II', semNum: 2, date: '2083/05/17', time: 'CIT121', subject: 'Discrete Mathematics', type: 'Examination' },
          { semester: 'II', semNum: 2, date: '2083/05/23', time: 'CIT122', subject: 'Computer Programming II (Java)', type: 'Examination' },
          { semester: 'II', semNum: 2, date: '2083/05/26', time: 'ELX121', subject: 'Digital Logic', type: 'Examination' },
          { semester: 'II', semNum: 2, date: '2083/05/30', time: 'CIT123', subject: 'Web Technology I', type: 'Examination' },
          { semester: 'II', semNum: 2, date: '2083/06/02', time: 'BSM121', subject: 'Mathematics-II', type: 'Examination' },

          // Semester IV
          { semester: 'IV', semNum: 4, date: '2083/06/05', time: 'CIT222', subject: 'Management Information System', type: 'Examination' },
          { semester: 'IV', semNum: 4, date: '2083/06/09', time: 'CIT221', subject: 'Operating Systems', type: 'Examination' },
          { semester: 'IV', semNum: 4, date: '2083/06/13', time: 'CIT223', subject: 'Data Communication and Computer Networks', type: 'Examination' },
          { semester: 'IV', semNum: 4, date: '2083/06/16', time: 'BSM221', subject: 'Fundamentals of Probability and Statistics', type: 'Examination' },
          { semester: 'IV', semNum: 4, date: '2083/06/21', time: 'CIT224', subject: 'Computer Graphics Technology', type: 'Examination' },

          // Semester VI
          { semester: 'VI', semNum: 6, date: '2083/05/22', time: 'CIT321', subject: 'Human Computer Interface and UI Design', type: 'Examination' },
          { semester: 'VI', semNum: 6, date: '2083/05/25', time: 'CIT323', subject: 'Artificial Intelligence', type: 'Examination' },
          { semester: 'VI', semNum: 6, date: '2083/05/31', time: 'BCT322', subject: 'Financial Accounting', type: 'Examination' },
          { semester: 'VI', semNum: 6, date: '2083/06/05', time: 'BCT321', subject: 'IT Project Management', type: 'Examination' },
          { semester: 'VI', semNum: 6, date: '2083/06/08', time: 'CIT322', subject: 'Digital Forensic Security Technologies', type: 'Examination' },

          // Semester VIII
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

// Persistent File Blob Storage (Ensures uploaded notes, previews, avatars & chat attachments survive across serverless instances)
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

// Auto-trigger schema initialization on load
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
