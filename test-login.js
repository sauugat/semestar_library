const { Pool } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');
const pool = new Pool({ connectionString: 'postgresql://neondb_owner:npg_uslBjvpGL1N5@ep-fancy-mud-awd6zxph.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require' });

async function run() {
  const res = await pool.query("SELECT * FROM students WHERE studentId = '26020266'");
  if (res.rows.length === 0) {
    console.log("Student not found");
    process.exit(1);
  }
  const student = res.rows[0];
  console.log("Student found:", student.name);
  const match = bcrypt.compareSync('saugat266', student.passwordhash || student.passwordHash);
  console.log("Password match:", match);
  process.exit(0);
}
run();
