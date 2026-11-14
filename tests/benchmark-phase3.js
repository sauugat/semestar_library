const db = require('../db');
const { handleChat } = require('../ai-assistant');

const REFERENCE_DATE = new Date('2026-11-14T10:00:00.000Z');

const BENCHMARK_QUERIES = [
  { id: 'Query A', text: 'Hamro project defense kaile ho?', note: 'Project defense notice' },
  { id: 'Query B', text: 'Where should I focus my study efforts right now?', note: 'Multi-source attention diagnosis' },
  { id: 'Query C', text: 'Am I on track academically?', note: 'Standing evaluation with data states' },
  { id: 'Query D', text: 'When is my next exam and how many days are left?', note: 'Targeted exam routine query' },
  { id: 'Query E', text: 'Do I have any assignments due before my next class?', note: 'Routine + assignment check' },
  { id: 'Query F', text: 'How did I perform in Pre-Board compared to Mid-Term?', note: 'Exam marks comparison' },
  { id: 'Query G', text: 'College kaile khulxa?', note: 'Notice supersession & temporal comparison' },
  { id: 'Query H', text: 'DSA assignment deadline and what should I prepare?', note: 'Multi-resource academic reasoning' }
];

async function run() {
  console.log('=== PHASE 3 BENCHMARK: MEASURING HARDENED LATENCY & ACCURACY ===\n');

  // Authenticated BIT Semester 2 student context
  const user = {
    userId: 1,
    studentId: 'STU001',
    role: 'student',
    semester: 2,
    authenticated: true
  };

  const results = [];

  for (const q of BENCHMARK_QUERIES) {
    const t0 = Date.now();
    try {
      const res = await handleChat(db, q.text, user, [], `bench-${q.id.replace(/\s+/g, '-').toLowerCase()}`, {
        referenceDate: REFERENCE_DATE,
        timeoutMs: 45000
      });
      const durationMs = Date.now() - t0;
      const tools = res.agentTrace?.toolCalls?.map(t => t.tool) || [];
      const cards = res.resourceCards?.length || 0;
      const states = res.agentTrace?.verification?.dataStates || {};
      const trailCount = res.agentTrace?.verification?.evidenceTrail?.length || 0;

      console.log(`[${q.id}] "${q.text}"`);
      console.log(`  ⏱️ Latency: ${durationMs} ms`);
      console.log(`  🛠️ Tools: [${tools.join(', ')}]`);
      console.log(`  🃏 Cards: ${cards}`);
      console.log(`  📊 Data States: ${JSON.stringify(states)}`);
      console.log(`  🔍 Evidence Trail Items: ${trailCount}`);
      console.log(`  📝 Reply Preview: ${res.reply.slice(0, 120).replace(/\n/g, ' ')}...`);
      console.log('');

      results.push({
        id: q.id,
        query: q.text,
        durationMs,
        tools,
        cards,
        states,
        trailCount,
        reply: res.reply
      });
    } catch (err) {
      console.error(`[${q.id}] FAILED:`, err.message);
      results.push({
        id: q.id,
        query: q.text,
        error: err.message
      });
    }
  }

  const avgMs = Math.round(results.filter(r => !r.error).reduce((sum, r) => sum + r.durationMs, 0) / results.filter(r => !r.error).length);
  console.log(`=== BENCHMARK COMPLETE: AVERAGE LATENCY = ${avgMs} ms ===`);

  if (db && typeof db.close === 'function') {
    await db.close();
  }
}

run().catch(console.error);
