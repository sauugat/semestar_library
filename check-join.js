const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: 'postgresql://neondb_owner:npg_uslBjvpGL1N5@ep-fancy-mud-awd6zxph.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require' });
async function run() {
  const res = await pool.query(`
    SELECT f.id, f."storedName", b.filename 
    FROM files f 
    LEFT JOIN file_blobs b ON f."storedName" = b.filename
    LIMIT 5
  `);
  console.log(res.rows);
  process.exit(0);
}
run();
