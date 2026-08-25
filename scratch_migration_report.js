const Database = require('better-sqlite3');
const { Pool } = require('pg');
require('dotenv').config();

async function run() {
  console.log('--- SQLite Database ---');
  try {
    const sqlite = new Database('./database.db', { readonly: true });
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    for (const table of tables) {
      if (table.name === 'sqlite_sequence') continue;
      const count = sqlite.prepare(`SELECT count(*) as c FROM "${table.name}"`).get();
      console.log(`- ${table.name}: ${count.c}`);
    }
    sqlite.close();
  } catch(e) {
    console.error('SQLite error:', e.message);
  }

  console.log('\n--- PostgreSQL Database ---');
  if (process.env.DATABASE_URL) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    try {
      const res = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      for (const row of res.rows) {
        const table = row.table_name;
        const countRes = await pool.query(`SELECT count(*) as c FROM "${table}"`);
        console.log(`- ${table}: ${countRes.rows[0].c}`);
      }
    } catch(e) {
      console.error('PostgreSQL error:', e.message);
    } finally {
      await pool.end();
    }
  } else {
    console.log('DATABASE_URL not found in .env');
  }
}
run();
