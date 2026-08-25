const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: 'postgresql://neondb_owner:npg_uslBjvpGL1N5@ep-fancy-mud-awd6zxph.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require' });
async function run() {
  const res = await pool.query(`SELECT * FROM files LIMIT 1`);
  console.log("Keys:", Object.keys(res.rows[0]));
  process.exit(0);
}
run();
