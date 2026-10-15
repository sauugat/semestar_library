'use strict';
// Fully synthetic academic corpus. Dates, people and policies here are test data,
// not claims about Gandaki University. Every positive has explicit relevance IDs.
const topics = [
 ['css', 'CSS Layout Workshop', 'CSS flexbox grid selectors responsive layout workshop in lab A.'],
 ['normalization', 'Database Normalization', 'Database normalization removes redundant data using 1NF 2NF 3NF and BCNF.'],
 ['python', 'Python Inheritance Lab', 'Python inheritance polymorphism classes object oriented programming lab.'],
 ['java', 'Java Collections Assignment', 'Java collections arrays lists sets maps coding lab.'],
 ['network', 'Network Security Seminar', 'Network security firewall routing encryption seminar.'],
 ['scholarship', 'Merit Scholarship Registration', 'Merit scholarship registration application opens October 16.'],
 ['fee', 'Tuition Fee Payment', 'Tuition fee payment deadline October 20 at the accounts office.'],
 ['library', 'Library Opening Hours', 'Library opening hours are 8 AM to 5 PM during weekdays.'],
 ['holiday', 'Festival Holiday Notice', 'Festival holiday begins October 22 and classes resume October 27.'],
 ['exam', 'Midterm Exam Routine', 'Midterm exam routine begins October 18 at 8 AM in Hall A.'],
 ['javascript', 'JavaScript DOM Practice', 'JavaScript DOM events browser forms practice examples.'],
 ['registration', 'Sports Registration', 'Sports registration for football basketball badminton closes October 19.']
];
const records = topics.map(([topic, title, content], i) => ({ id: i + 1, topic, title, content,
  type: 'notice', category: 'general', user_id: 'teacher', author_role: 'teacher',
  cohort_id: 'current', semester_no: 2, audience_scope: 'cohort', visibility: 'everyone', target_all_semesters: 0 }));
const nepali = { css: 'CSS', normalization: 'सामान्यीकरण', python: 'पाइथन', java: 'जाभा', network: 'नेटवर्क', scholarship: 'छात्रवृत्ति', fee: 'शुल्क', library: 'पुस्तकालय', holiday: 'छुट्टी', exam: 'परीक्षा', javascript: 'JavaScript', registration: 'दर्ता' };
const queries = [];
for (const r of records) {
 const expected = records.filter(x => x.topic === r.topic || r.topic === 'registration' && x.topic === 'scholarship').map(x => `post:${x.id}`);
 for (const [language, kind, query] of [
  ['en', 'exact_title', r.title],
  ['en', 'short', r.topic],
  ['romanized_ne', 'natural', `${r.topic} ko barema information deu`],
  ['ne', 'multilingual', `${nepali[r.topic]} बारे सूचना देखाउनुहोस्`],
  ['mixed', 'long', `Please find ${r.topic} ko uploaded information ani tesko main topics explain gara`]
 ]) queries.push({ query, language, kind, expected, provenance: 'synthetic' });
}
queries.push({ query: 'Database normaliztion', language: 'en', kind: 'typo', expected: ['post:2'], provenance: 'synthetic' });
queries.push({ query: 'exam timetable', language: 'en', kind: 'semantic_alias', expected: ['post:10'], provenance: 'synthetic' });
queries.push({ query: 'registration', language: 'en', kind: 'multi_source', expected: ['post:6', 'post:12'], provenance: 'synthetic' });
queries.push({ query: 'find it', language: 'en', kind: 'ambiguous', expected: [], provenance: 'synthetic' });
queries.push({ query: 'tyo wala', language: 'romanized_ne', kind: 'ambiguous', expected: [], provenance: 'synthetic' });
const missing = ['Dumbledore', 'Hogwarts', 'Quidditch', 'Atlantis', 'Voldemort', 'Narnia', 'Wakanda', 'Asgard', 'Mordor', 'Gotham'];
for (const name of missing) {
 for (const [language, query] of [
  ['en', `Professor ${name} office hours`],
  ['romanized_ne', `${name} ko exam notice deu`],
  ['en', `${name} scholarship registration deadline`],
  ['mixed', `${name} ko CSS notes khojdeu`],
  ['en', `Find ${name} network security seminar`],
  ['ne', `${name} परीक्षा सूचना देखाउनुहोस्`]
 ]) queries.push({ query, language, kind: 'no_answer', expected: [], provenance: 'synthetic' });
}
module.exports = { records, queries };
