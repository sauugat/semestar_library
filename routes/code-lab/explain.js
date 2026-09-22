const express = require('express');
const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session || !req.session.studentId) {
    return res.status(401).json({ message: 'Authentication required.' });
  }
  next();
}

const SYSTEM_PROMPT = `You are a patient teaching assistant helping a first-year programming student understand a compiler/runtime error.

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

async function callGemini(systemPrompt, userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const models = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: {
            maxOutputTokens: 800,
            temperature: 0.2,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim()) return text.trim();
      } else {
        const errBody = await res.text();
        console.warn(`[Code Lab Explain] Gemini ${model} failed (${res.status}):`, errBody.slice(0, 160));
      }
    } catch (err) {
      console.warn(`[Code Lab Explain] Gemini ${model} request error:`, err.message);
    }
  }
  return null;
}

async function callGroq(systemPrompt, userPrompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const models = ['openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
  for (const model of models) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          max_tokens: 400,
          temperature: 0.25,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        })
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text && text.trim()) return text.trim();
      } else {
        const errBody = await res.text();
        console.warn(`[Code Lab Explain] Groq ${model} failed (${res.status}):`, errBody.slice(0, 160));
      }
    } catch (err) {
      console.warn(`[Code Lab Explain] Groq ${model} request error:`, err.message);
    }
  }
  return null;
}

async function callOpenRouter(systemPrompt, userPrompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const models = ['google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-chat'];
  for (const model of models) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'X-Title': 'Semester Library Code Lab'
        },
        body: JSON.stringify({
          model,
          max_tokens: 400,
          temperature: 0.25,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        })
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text && text.trim()) return text.trim();
      } else {
        const errBody = await res.text();
        console.warn(`[Code Lab Explain] OpenRouter ${model} failed (${res.status}):`, errBody.slice(0, 160));
      }
    } catch (err) {
      console.warn(`[Code Lab Explain] OpenRouter ${model} request error:`, err.message);
    }
  }
  return null;
}

function ruleBasedExplanation(code, stderr, language) {
  let lineNum = null;
  const lineMatch = stderr.match(/(?:line|:)\s*(\d+)/i);
  if (lineMatch) lineNum = lineMatch[1];

  let studentLine = '';
  if (lineNum && code) {
    const lines = code.split('\n');
    const idx = parseInt(lineNum, 10) - 1;
    if (idx >= 0 && idx < lines.length) {
      studentLine = lines[idx].trim();
    }
  }

  const errLower = stderr.toLowerCase();

  let whatsWrong = 'A syntax or runtime error occurred in your program.';
  let why = 'The compiler or interpreter encountered code that does not follow the language rules.';
  let lookFor = 'Check the highlighted line for missing punctuation, spelling errors, or mismatched brackets.';

  if (errLower.includes("';' expected") || errLower.includes("expected ';'") || errLower.includes("expected ';' before")) {
    whatsWrong = 'A statement is missing a closing semicolon.';
    why = `In ${language || 'this language'}, every instruction statement must end with a semicolon (;) to tell the compiler where the instruction finishes.`;
    lookFor = 'Add a semicolon (;) at the end of the line or right before the next token.';
  } else if (errLower.includes('cannot find symbol') || errLower.includes('not declared in this scope') || errLower.includes('is not defined') || errLower.includes('nameerror')) {
    whatsWrong = 'An unknown variable, method, or name was used.';
    why = 'The program tried to use a name that has not been declared, imported, or has a spelling/capitalization difference.';
    lookFor = 'Double check the spelling, upper/lowercase letters, and make sure the variable is declared before this line.';
  } else if (errLower.includes('class, interface, or enum expected') || errLower.includes('reached end of file while parsing') || errLower.includes('expected declaration')) {
    whatsWrong = 'There is an unclosed or mismatched curly brace ({ or }).';
    why = 'The compiler reached the end of the file or encountered code outside of class/function boundaries because braces do not match.';
    lookFor = 'Count your opening { and closing } braces to make sure each { has a matching }.';
  } else if (errLower.includes('incompatible types') || errLower.includes('type mismatch') || errLower.includes('typeerror')) {
    whatsWrong = 'Data types do not match.';
    why = 'You are trying to store or pass a value of one type into a variable or function expecting a different type.';
    lookFor = 'Check the types of the values being assigned or passed (e.g. String vs int).';
  } else if (errLower.includes('missing return statement') || errLower.includes('must return a result')) {
    whatsWrong = 'The function or method is missing a return statement.';
    why = 'The method was declared to return a specific data type, but not all paths through the code return a value.';
    lookFor = 'Make sure there is a return statement with a value of the declared return type.';
  } else if (errLower.includes('unclosed string literal') || errLower.includes('eol while scanning string literal') || errLower.includes('unterminated string')) {
    whatsWrong = 'A text string was opened but never closed.';
    why = 'Quotes around a text string must come in pairs on the same line.';
    lookFor = 'Check for a missing closing quotation mark (") or (\').';
  } else if (errLower.includes('indentationerror') || errLower.includes('unexpected indent')) {
    whatsWrong = 'Indentation is inconsistent or invalid.';
    why = 'Python relies on exact whitespace indentation to determine code blocks.';
    lookFor = 'Make sure lines inside functions, loops, and if-statements are indented with 4 spaces.';
  }

  let res = `**What's wrong:** ${whatsWrong}\n\n`;
  if (lineNum) {
    res += `**Where:** Line ${lineNum} —\n\`\`\`\n${studentLine || '(at line ' + lineNum + ')'}\n\`\`\`\n\n`;
  }
  res += `**Why:** ${why}\n\n`;
  res += `**What to look for:** ${lookFor}`;

  return res;
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

    let explanation = null;

    // 1. Try Gemini (Primary AI provider for Semester Library)
    if (process.env.GEMINI_API_KEY) {
      explanation = await callGemini(SYSTEM_PROMPT, userPrompt);
    }

    // 2. Try Groq (Secondary fallback)
    if (!explanation && process.env.GROQ_API_KEY) {
      explanation = await callGroq(SYSTEM_PROMPT, userPrompt);
    }

    // 3. Try OpenRouter (Tertiary fallback)
    if (!explanation && process.env.OPENROUTER_API_KEY) {
      explanation = await callOpenRouter(SYSTEM_PROMPT, userPrompt);
    }

    // 4. Graceful rule-based heuristic fallback (Never leave student stranded)
    if (!explanation) {
      explanation = ruleBasedExplanation(safeCode, safeStderr, safeLanguage);
    }

    res.json({ explanation });
  } catch (err) {
    console.error('[Code Lab] Explain route error:', err);
    // Even on unexpected error, provide heuristic explanation if code & stderr were provided
    try {
      const fallback = ruleBasedExplanation(req.body?.code || '', req.body?.stderr || '', req.body?.language || 'code');
      return res.json({ explanation: fallback });
    } catch (_) {
      res.status(500).json({ message: 'Failed to explain the error.' });
    }
  }
});

module.exports = router;
