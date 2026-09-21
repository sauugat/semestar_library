const express = require('express');
const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session || !req.session.studentId) {
    return res.status(401).json({ message: 'Authentication required.' });
  }
  next();
}

router.post('/explain-error', requireLogin, async (req, res) => {
  try {
    const { code, stderr, language } = req.body;

    if (!stderr || typeof stderr !== 'string' || !stderr.trim()) {
      return res.status(400).json({ message: 'No error to explain.' });
    }
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ message: 'Code is required.' });
    }

    // Cap sizes defensively
    const safeCode = code.slice(0, 6000);
    const safeStderr = stderr.slice(0, 2000);
    const safeLanguage = (language || 'code').slice(0, 20);

    const systemPrompt = `You are a patient teaching assistant helping a first-year programming student understand a compiler/runtime error.

STRICT RULES — follow these exactly:
1. Explain WHAT is wrong and WHY, in plain, simple English a beginner can follow.
2. You MAY quote the student's own existing line(s) back to them in a small code block to point at exactly where the mistake is.
3. You MAY show a tiny corrected snippet (a single word or short fragment, in inline code formatting like \`void\`) if it directly illustrates the concept — but do NOT rewrite the whole line or show it already fixed in context. Point at what's missing/wrong, don't hand over the finished line.
4. You must NOT write or output a complete corrected version of their program, a full function, or a full corrected line. Naming the missing piece (e.g. "a \`void\` return type") is fine; writing the whole corrected line (e.g. "\`public static void main(String[] args){\`") is NOT fine.

OUTPUT FORMAT — always use exactly this structure, with a blank line between each section so it renders as separate paragraphs:

**What's wrong:** <one short sentence naming the category of mistake>

**Where:** Line <N> —
\`\`\`
<the student's own line, quoted exactly as they wrote it>
\`\`\`

**Why:** <1-2 short sentences explaining the underlying concept, beginner-friendly>

**What to look for:** <one short sentence naming the missing/wrong piece by name, without writing the full corrected line — e.g. "a return type keyword" or "a semicolon" or "the correct spelling of the function name">

Example of a well-formatted response (for reference — match this structure and length, don't copy this content):

**What's wrong:** The method declaration is missing a return type.

**Where:** Line 3 —
\`\`\`
public static main(String[] args){
\`\`\`

**Why:** In Java, every method must declare what type of value it returns, even if it returns nothing. The compiler doesn't know what "main" is supposed to give back.

**What to look for:** A return type keyword (like \`void\`) needs to go right before the method name.

Keep the whole response concise — a beginner should be able to read it in a few seconds. Do not add any text before "**What's wrong:**" or after the last section.`;

    const userPrompt = `Language: ${safeLanguage}

Student's code:
\`\`\`${safeLanguage}
${safeCode}
\`\`\`

Compiler/runtime error:
\`\`\`
${safeStderr}
\`\`\`

Explain what's wrong in plain English, following the rules above.`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        max_tokens: 300,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Code Lab] AI explain error:', errText);
      return res.status(502).json({ message: 'Could not get an explanation right now. Try again in a moment.' });
    }

    const data = await response.json();
    const explanation = data.choices?.[0]?.message?.content?.trim() || 'Could not generate an explanation.';

    res.json({ explanation });
  } catch (err) {
    console.error('[Code Lab] Explain route error:', err);
    res.status(500).json({ message: 'Failed to explain the error.' });
  }
});

module.exports = router;
