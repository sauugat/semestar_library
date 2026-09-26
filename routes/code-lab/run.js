const express = require('express');
const router = express.Router();

router.post('/run', async (req, res) => {
  const { code, stdin, language = 'c' } = req.body;
  const normLang = String(language || 'c').trim().toLowerCase();
  const lang = normLang === 'c++' ? 'cpp' : (normLang === 'py' ? 'python' : normLang);
  const supportedLanguages = new Set(['c', 'cpp', 'java', 'python']);

  if (typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ error: 'Code is required.' });
  }

  if (!supportedLanguages.has(lang)) {
    return res.status(400).json({ error: 'Unsupported programming language.' });
  }

  try {
    // Step 1: submit the code to paiza.io
    const params = new URLSearchParams();
    params.append('source_code', code);
    params.append('language', lang);
    params.append('input', stdin || '');
    params.append('api_key', 'guest');
    params.append('longpoll', 'true');
    params.append('longpoll_timeout', '10');

    const createResponse = await fetch('https://api.paiza.io/runners/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: AbortSignal.timeout(15000)
    });

    const createData = await createResponse.json();

    if (!createResponse.ok || !createData.id) {
      return res.status(502).json({ error: createData.error || 'Failed to start code execution.' });
    }

    // Paiza may still be compiling after the create request. Wait for the
    // finished result instead of returning an empty output immediately.
    let details = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const detailsResponse = await fetch(
        `https://api.paiza.io/runners/get_details?id=${encodeURIComponent(createData.id)}&api_key=guest`,
        { signal: AbortSignal.timeout(8000) }
      );

      if (!detailsResponse.ok) {
        throw new Error(`Paiza details request failed with ${detailsResponse.status}`);
      }

      details = await detailsResponse.json();
      if (details.status === 'completed') break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (!details || details.status !== 'completed') {
      return res.status(504).json({ error: 'Code execution timed out. Please try again.' });
    }

    // If build failed (compile error), show build_stderr as the error
    const buildFailed = String(details.build_exit_code ?? '0') !== '0';

    res.json({
      stdout: buildFailed ? '' : (details.stdout || ''),
      stderr: buildFailed ? (details.build_stderr || '') : (details.stderr || ''),
      exitCode: Number.parseInt(details.exit_code ?? details.build_exit_code ?? '0', 10),
      status: details.result || details.build_result || 'completed'
    });

  } catch (err) {
    console.error('Code Lab run error:', err);
    res.status(502).json({ error: 'Code execution service returned an error. Please try again.' });
  }
});

module.exports = router;
