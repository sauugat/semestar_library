const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: 'postgresql://neondb_owner:npg_uslBjvpGL1N5@ep-fancy-mud-awd6zxph.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require' });
async function run() {
  try {
    const expire = new Date().toISOString();
    const sid = "test-sid-12345";
    const sessString = JSON.stringify({ studentId: '26020266' });
    
    await pool.query(
      `INSERT INTO session (sid, sess, expire) VALUES ($1, $2::json, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
      [sid, sessString, expire]
    );
    console.log("Success!");
  } catch (err) {
    console.log("Error:", err.message);
  }
  process.exit(0);
}
run();
