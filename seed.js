// Run this once (node seed.js) to populate the database with your 60 students.
// Edit the `students` array below with real names/IDs, or generate IDs/passwords programmatically.

const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'database.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    studentId TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    passwordHash TEXT NOT NULL
  )
`);

// Students loaded from Gandaki University BIT batch 2025 transcript (BIT-I.pdf)
// studentId = Symbol No. | password = firstname (lowercase) + last 3 digits of symbol no.
const students = [
  { studentId: "26020230", name: "Aashrita Lamichhane", password: "aashrita230" },
  { studentId: "26020231", name: "Anisha Gurung", password: "anisha231" },
  { studentId: "26020232", name: "Ankit Bhandari", password: "ankit232" },
  { studentId: "26020233", name: "Apekshya Shrestha", password: "apekshya233" },
  { studentId: "26020234", name: "Avash Acharya", password: "avash234" },
  { studentId: "26020235", name: "Diperson B.k.", password: "diperson235" },
  { studentId: "26020236", name: "Krish Chhetri", password: "krish236" },
  { studentId: "26020237", name: "Madan Adhikari", password: "madan237" },
  { studentId: "26020238", name: "Madhab Khanal", password: "madhab238" },
  { studentId: "26020239", name: "Manila Adhikari", password: "manila239" },
  { studentId: "26020240", name: "Manish Regmi", password: "manish240" },
  { studentId: "26020241", name: "Manoram Subedi", password: "manoram241" },
  { studentId: "26020242", name: "Milan Lamichhane", password: "milan242" },
  { studentId: "26020243", name: "Nirmal Pun", password: "nirmal243" },
  { studentId: "26020244", name: "Nisha Sunar", password: "nisha244" },
  { studentId: "26020245", name: "Prabhab Tiwari", password: "prabhab245" },
  { studentId: "26020246", name: "Prajwal Rai Bantawa", password: "prajwal246" },
  { studentId: "26020247", name: "Pratikshya B.k", password: "pratikshya247" },
  { studentId: "26020248", name: "Punam Pun Magar", password: "punam248" },
  { studentId: "26020249", name: "Raj Dhakal", password: "raj249" },
  { studentId: "26020250", name: "Rajib Gharti", password: "rajib250" },
  { studentId: "26020251", name: "Rajib Rimal", password: "rajib251" },
  { studentId: "26020253", name: "Rakhi Bhujel", password: "rakhi253" },
  { studentId: "26020252", name: "Sagar Bhurtel", password: "sagar252" },
  { studentId: "26020254", name: "Sahil Thapa", password: "sahil254" },
  { studentId: "26020255", name: "Sajan Gurung", password: "sajan255" },
  { studentId: "26020256", name: "Sajana Kandel", password: "sajana256" },
  { studentId: "26020257", name: "Sakshyam Tiwari", password: "sakshyam257" },
  { studentId: "26020258", name: "Salina Banstola", password: "salina258" },
  { studentId: "26020259", name: "Sanchita Bhandari", password: "sanchita259" },
  { studentId: "26020260", name: "Sandesh Dhakal", password: "sandesh260" },
  { studentId: "26020261", name: "Sandesh Ranabhat", password: "sandesh261" },
  { studentId: "26020262", name: "Sandhya Sharma", password: "sandhya262" },
  { studentId: "26020263", name: "Sangam Bhujel", password: "sangam263" },
  { studentId: "26020264", name: "Sanjana Adhikari", password: "sanjana264" },
  { studentId: "26020265", name: "Sankalpa Kc", password: "sankalpa265" },
  { studentId: "26020266", name: "Saugat Subedi", password: "saugat266" },
  { studentId: "26020267", name: "Sishir Bharati", password: "sishir267" },
  { studentId: "26020268", name: "Subarna Poudel", password: "subarna268" },
  { studentId: "26020269", name: "Sudarshan Poudel", password: "sudarshan269" },
  { studentId: "26020270", name: "Sujan Giri", password: "sujan270" },
  { studentId: "26020271", name: "Sujan Shrestha", password: "sujan271" },
  { studentId: "26020272", name: "Suresh Gurung", password: "suresh272" },
  { studentId: "26020273", name: "Ujjwal Gurung", password: "ujjwal273" },
  { studentId: "26020274", name: "Yujina Bhattarai", password: "yujina274" },
];

const insert = db.prepare('INSERT OR REPLACE INTO students (studentId, name, passwordHash) VALUES (?, ?, ?)');

for (const s of students) {
  const hash = bcrypt.hashSync(s.password, 10);
  insert.run(s.studentId, s.name, hash);
  console.log(`Seeded ${s.studentId} (${s.name}) - password: ${s.password}`);
}

console.log('\nDone! You can now log in with any of the above credentials.');
