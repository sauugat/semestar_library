const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: 'postgresql://neondb_owner:npg_uslBjvpGL1N5@ep-fancy-mud-awd6zxph.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require' });
async function run() {
  try {
    await pool.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS replyToId INTEGER;`);
    await pool.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS linkUrl TEXT;`);
    await pool.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS linkTitle TEXT;`);
    await pool.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS linkDesc TEXT;`);
    await pool.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS linkImage TEXT;`);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_reactions (
        messageId INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
        studentId TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
        emoji TEXT NOT NULL,
        PRIMARY KEY (messageId, studentId)
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_read_receipts (
        studentId TEXT PRIMARY KEY REFERENCES students(studentId) ON DELETE CASCADE,
        lastReadMessageId INTEGER NOT NULL
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_typing (
        studentId TEXT PRIMARY KEY REFERENCES students(studentId) ON DELETE CASCADE,
        lastTypedAt TEXT NOT NULL
      );
    `);
    console.log("Database chat schema migrated successfully!");
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
run();
