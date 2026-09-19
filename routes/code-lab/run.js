const express = require('express');
const router = express.Router();

router.post('/run', async (req, res) => {
  const { code, stdin } = req.body;

  try {
    // Step 1: submit the code to paiza.io
    const params = new URLSearchParams();
    params.append('source_code', code);
    params.append('language', 'c');
    params.append('input', stdin || '');
    params.append('api_key', 'guest');
    params.append('longpoll', 'true');
    params.append('longpoll_timeout', '10');

    const createResponse = await fetch('https://api.paiza.io/runners/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    const createData = await createResponse.json();

    if (!createData.id) {
      return res.status(500).json({ error: 'Failed to start code execution' });
    }

    // Step 2: fetch the actual output
    const detailsResponse = await fetch(
      `https://api.paiza.io/runners/get_details?id=${createData.id}&api_key=guest`
    );
    const details = await detailsResponse.json();

    // If build failed (compile error), show build_stderr as the error
    const buildFailed = details.build_exit_code && details.build_exit_code !== '0';

    res.json({
      stdout: buildFailed ? '' : (details.stdout || ''),
      stderr: buildFailed ? (details.build_stderr || '') : (details.stderr || ''),
      exitCode: parseInt(details.exit_code || details.build_exit_code || '0', 10)
    });

  } catch (err) {
    console.error('Code Lab run error:', err);
    res.status(500).json({ error: 'Code execution service returned an error. Please try again.' });
  }
});

module.exports = router;