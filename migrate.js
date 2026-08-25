const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createClient } = require('@libsql/client');

// Get the DATABASE_URL either from environment or prompt
const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error("=========================================");
  console.error("ERROR: DATABASE_URL is not set.");
  console.error("Please provide the production PostgreSQL connection string as an environment variable:");
  console.error("export DATABASE_URL='postgres://user:password@host/db'");
  console.error("node migrate.js");
  console.error("=========================================");
  process.exit(1);
}

// 1. Connect to both databases
const sqlitePath = path.join(__dirname, 'database.db');
if (!fs.existsSync(sqlitePath)) {
  console.error(`SQLite database not found at ${sqlitePath}`);
  process.exit(1);
}
const sqliteDb = createClient({
  url: `file:${sqlitePath}`
});

const pgPool = new Pool({
  connectionString: dbUrl,
  ssl: dbUrl.includes('localhost') ? false : { rejectUnauthorized: false }
});

const uploadsDir = path.join(__dirname, 'uploads');

async function runMigration() {
  console.log("Starting Migration from SQLite to PostgreSQL...");
  const client = await pgPool.connect();

  try {
    await client.query('BEGIN');

    // 2. Clear existing PG data (the fake seeded data)
    console.log("Clearing existing fake data from PostgreSQL...");
    // We truncate CASCADE to handle foreign key dependencies
    const tablesToClear = ['notifications', 'chat_messages', 'follows', 'file_comments', 'file_likes', 'files', 'students', 'session', 'file_blobs'];
    for (const table of tablesToClear) {
      await client.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }

    console.log("Recreating tables in PostgreSQL...");
    // Recreate tables with correct schemas for Postgres
    await client.query(`
      CREATE TABLE students (
        studentId VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        passwordHash VARCHAR(255) NOT NULL,
        avatarUrl TEXT,
        bio TEXT,
        department VARCHAR(100) DEFAULT 'BIT',
        semester VARCHAR(50) DEFAULT 'Semester 1',
        githubUrl TEXT,
        linkedinUrl TEXT,
        role VARCHAR(50) DEFAULT 'student'
      );

      CREATE TABLE files (
        id SERIAL PRIMARY KEY,
        storedName VARCHAR(255) NOT NULL,
        originalName VARCHAR(255) NOT NULL,
        title VARCHAR(255),
        uploadedBy VARCHAR(50) NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        sizeBytes BIGINT NOT NULL,
        uploadedAt TIMESTAMP NOT NULL,
        subject VARCHAR(100),
        chapter VARCHAR(100),
        semester VARCHAR(50),
        previewName VARCHAR(255)
      );

      CREATE TABLE file_likes (
        fileId INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        studentId VARCHAR(50) NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        PRIMARY KEY (fileId, studentId)
      );

      CREATE TABLE file_comments (
        id SERIAL PRIMARY KEY,
        fileId INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        studentId VARCHAR(50) NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        commentText TEXT NOT NULL,
        createdAt TIMESTAMP NOT NULL
      );

      CREATE TABLE follows (
        followerId VARCHAR(50) NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        followingId VARCHAR(50) NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        createdAt TIMESTAMP NOT NULL,
        PRIMARY KEY (followerId, followingId)
      );

      CREATE TABLE chat_messages (
        id SERIAL PRIMARY KEY,
        studentId VARCHAR(50) NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        text TEXT,
        attachmentName VARCHAR(255),
        attachmentOriginalName VARCHAR(255),
        attachmentMimeType VARCHAR(100),
        createdAt TIMESTAMP NOT NULL
      );

      CREATE TABLE notifications (
        id SERIAL PRIMARY KEY,
        recipientStudentId VARCHAR(50) NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        relatedFileId INTEGER,
        message TEXT NOT NULL,
        isRead INTEGER DEFAULT 0,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE file_blobs (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        mimeType VARCHAR(100),
        fileData BYTEA NOT NULL,
        createdAt TIMESTAMP NOT NULL
      );

      CREATE TABLE session (
        sid varchar NOT NULL COLLATE "default",
        sess json NOT NULL,
        expire timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      );
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON session ("expire");
    `);

    // 3. Migrate Students
    console.log("Migrating students...");
    const studentsRes = await sqliteDb.execute("SELECT * FROM students");
    const students = studentsRes.rows;
    for (const student of students) {
      await client.query(
        `INSERT INTO students (studentId, name, passwordHash, avatarUrl, bio, department, semester, githubUrl, linkedinUrl, role) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [student.studentId, student.name, student.passwordHash, student.avatarUrl, student.bio, student.department, student.semester, student.githubUrl, student.linkedinUrl, student.role]
      );
    }
    console.log(`- Migrated ${students.length} students.`);

    // 4. Migrate Files
    console.log("Migrating files...");
    const filesRes = await sqliteDb.execute("SELECT * FROM files");
    const files = filesRes.rows;
    for (const file of files) {
      await client.query(
        `INSERT INTO files (id, storedName, originalName, title, uploadedBy, sizeBytes, uploadedAt, subject, chapter, semester, previewName) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [file.id, file.storedName, file.originalName, file.title, file.uploadedBy, file.sizeBytes, new Date(file.uploadedAt), file.subject, file.chapter, file.semester, file.previewName]
      );
    }
    // Update sequence for files
    if (files.length > 0) {
      await client.query(`SELECT setval('files_id_seq', (SELECT MAX(id) FROM files))`);
    }
    console.log(`- Migrated ${files.length} files metadata.`);

    // 5. Migrate File Likes
    console.log("Migrating file_likes...");
    const file_likesRes = await sqliteDb.execute("SELECT * FROM file_likes");
    const file_likes = file_likesRes.rows;
    for (const like of file_likes) {
      await client.query(`INSERT INTO file_likes (fileId, studentId) VALUES ($1, $2)`, [like.fileId, like.studentId]);
    }
    console.log(`- Migrated ${file_likes.length} likes.`);

    // 6. Migrate File Comments
    console.log("Migrating file_comments...");
    const file_commentsRes = await sqliteDb.execute("SELECT * FROM file_comments");
    const file_comments = file_commentsRes.rows;
    for (const comment of file_comments) {
      await client.query(
        `INSERT INTO file_comments (id, fileId, studentId, commentText, createdAt) VALUES ($1, $2, $3, $4, $5)`,
        [comment.id, comment.fileId, comment.studentId, comment.commentText, new Date(comment.createdAt)]
      );
    }
    if (file_comments.length > 0) {
      await client.query(`SELECT setval('file_comments_id_seq', (SELECT MAX(id) FROM file_comments))`);
    }
    console.log(`- Migrated ${file_comments.length} comments.`);

    // 7. Migrate Follows
    console.log("Migrating follows...");
    const followsRes = await sqliteDb.execute("SELECT * FROM follows");
    const follows = followsRes.rows;
    for (const follow of follows) {
      await client.query(`INSERT INTO follows (followerId, followingId, createdAt) VALUES ($1, $2, $3)`, [follow.followerId, follow.followingId, new Date(follow.createdAt)]);
    }
    console.log(`- Migrated ${follows.length} follows.`);

    // 8. Migrate Chat Messages
    console.log("Migrating chat_messages...");
    const chat_messagesRes = await sqliteDb.execute("SELECT * FROM chat_messages");
    const chat_messages = chat_messagesRes.rows;
    for (const msg of chat_messages) {
      await client.query(
        `INSERT INTO chat_messages (id, studentId, text, attachmentName, attachmentOriginalName, attachmentMimeType, createdAt) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [msg.id, msg.studentId, msg.text, msg.attachmentName, msg.attachmentOriginalName, msg.attachmentMimeType, new Date(msg.createdAt)]
      );
    }
    if (chat_messages.length > 0) {
      await client.query(`SELECT setval('chat_messages_id_seq', (SELECT MAX(id) FROM chat_messages))`);
    }
    console.log(`- Migrated ${chat_messages.length} chat messages.`);

    // 9. Migrate Notifications
    console.log("Migrating notifications...");
    const notificationsRes = await sqliteDb.execute("SELECT * FROM notifications");
    const notifications = notificationsRes.rows;
    if (notifications.length > 0) {
      let values = [];
      let params = [];
      let idx = 1;
      for (const notif of notifications) {
        let createdAt = notif.createdAt;
        try {
          createdAt = new Date(createdAt);
          if (isNaN(createdAt.getTime())) createdAt = new Date(); // fallback
        } catch (e) {
          createdAt = new Date();
        }
        
        values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
        params.push(notif.id, notif.recipientStudentId, notif.type, notif.relatedFileId, notif.message, notif.isRead, createdAt);
        
        // Execute in chunks of 500
        if (values.length >= 500) {
          await client.query(
            `INSERT INTO notifications (id, recipientStudentId, type, relatedFileId, message, isRead, createdAt) VALUES ${values.join(',')}`,
            params
          );
          values = [];
          params = [];
          idx = 1;
        }
      }
      // Insert remaining
      if (values.length > 0) {
        await client.query(
          `INSERT INTO notifications (id, recipientStudentId, type, relatedFileId, message, isRead, createdAt) VALUES ${values.join(',')}`,
          params
        );
      }
      await client.query(`SELECT setval('notifications_id_seq', (SELECT MAX(id) FROM notifications))`);
    }
    console.log(`- Migrated ${notifications.length} notifications.`);

    // 10. Migrate File Blobs (from local disk to Postgres BYTEA)
    console.log("Migrating actual files (blobs) to PostgreSQL...");
    let blobCount = 0;
    if (fs.existsSync(uploadsDir)) {
      const physicalFiles = fs.readdirSync(uploadsDir);
      for (const filename of physicalFiles) {
        if (filename.startsWith('.')) continue; // skip hidden files like .DS_Store
        
        const filePath = path.join(uploadsDir, filename);
        if (fs.lstatSync(filePath).isFile()) {
          const fileData = fs.readFileSync(filePath);
          // Guess mimeType based on extension
          let mimeType = 'application/octet-stream';
          if (filename.endsWith('.pdf')) mimeType = 'application/pdf';
          else if (filename.endsWith('.png')) mimeType = 'image/png';
          else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) mimeType = 'image/jpeg';
          else if (filename.endsWith('.pptx')) mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
          else if (filename.endsWith('.docx')) mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          else if (filename.endsWith('.html')) mimeType = 'text/html';

          await client.query(
            `INSERT INTO file_blobs (filename, mimeType, fileData, createdAt) VALUES ($1, $2, $3, $4) ON CONFLICT(filename) DO NOTHING`,
            [filename, mimeType, fileData, new Date()]
          );
          blobCount++;
        }
      }
    }
    console.log(`- Migrated ${blobCount} files into file_blobs.`);

    await client.query('COMMIT');
    console.log("=========================================");
    console.log("✅ MIGRATION COMPLETED SUCCESSFULLY!");
    console.log("All data from SQLite has been moved to PostgreSQL.");
    console.log("=========================================");
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Migration failed, transaction rolled back.");
    console.error(err);
  } finally {
    client.release();
    pgPool.end();
    sqliteDb.close();
  }
}

runMigration().catch(console.error);
