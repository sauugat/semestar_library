document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const studentId = document.getElementById('studentId').value.trim();
  const password = document.getElementById('password').value;
  const errorMsg = document.getElementById('errorMsg');
  errorMsg.textContent = '';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, password })
    });

    const data = await res.json();

    if (res.ok) {
      window.location.href = 'dashboard.html';
    } else {
      errorMsg.textContent = data.message || 'Invalid Student ID or Password';
    }
  } catch (err) {
    errorMsg.textContent = 'Something went wrong. Try again.';
  }
});
