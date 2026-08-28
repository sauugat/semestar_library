// Run this once (node seed.js) to populate the database with your 60 students.
// Edit the `students` array below with real names/IDs, or generate IDs/passwords programmatically.

const bcrypt = require('bcryptjs');
const db = require('./db');

async function seed() {
  await db.initSchema();

  // Students loaded from Gandaki University BIT batch 2025 transcript (BIT-I.pdf)
  const students = [
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
    { studentId: "26020274", name: "Yujina Bhattarai", password: "yujina274", role: "student" },
  ];

  for (const s of students) {
    const hash = bcrypt.hashSync(s.password, 10);
    const role = s.role || 'student';
    if (db.isPostgres) {
      await db.run(
        `INSERT INTO students (studentId, name, passwordHash, role) VALUES (?, ?, ?, ?)
         ON CONFLICT (studentId) DO UPDATE SET name = EXCLUDED.name, passwordHash = EXCLUDED.passwordHash, role = EXCLUDED.role`,
        s.studentId, s.name, hash, role
      );
    } else {
      await db.run(
        `INSERT OR REPLACE INTO students (studentId, name, passwordHash, role) VALUES (?, ?, ?, ?)`,
        s.studentId, s.name, hash, role
      );
    }
    console.log(`Seeded ${s.studentId} (${s.name}) [${role}] - password: ${s.password}`);
  }

  console.log('\nDone! You can now log in with any of the above credentials.');
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
