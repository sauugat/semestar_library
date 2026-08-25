const { Pool } = require('pg');
const fs = require('fs');

const envFile = fs.readFileSync('.env', 'utf8');
const dbUrlMatch = envFile.match(/DATABASE_URL=(.*)/);
const dbUrl = dbUrlMatch ? dbUrlMatch[1].trim() : null;

if (!dbUrl) {
  console.error("No DATABASE_URL found in .env");
  process.exit(1);
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false }
});

async function run() {
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
    console.error(e.message);
  } finally {
    await pool.end();
  }
}
run();
