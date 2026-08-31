const db = require('./db');
const ai = require('./ai-assistant');

async function test(query) {
  console.log(`\n\n--- TESTING: "${query}" ---`);
  const result = await ai.handleChat(db, query, { studentId: 'guest', name: 'Student' }, []);
  console.log("REPLY TEXT:");
  console.log(result.reply);
  console.log("------------------------");
}

async function runTests() {
  await test("do we have any notes for operating systems unit 2?");
  await test("I literally cannot focus on studying today, my brain is completely fried");
  await test("got any notes on quantum machine learning for sem 1?");
  await test("when is the math 2 exam?");
  process.exit(0);
}

runTests();
