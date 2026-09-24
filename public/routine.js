(() => {
  'use strict';
  const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  const byId = id => document.getElementById(id);
  const schedule = byId('scheduleContainer');
  const adminPanel = byId('adminRoutinePanel');
  const form = byId('adminRoutineForm');
  const fields = ['subject_name', 'subject_code', 'semester', 'exam_date', 'calendar', 'exam_time', 'room', 'weekday', 'exam_type'];
  let routines = [];
  let editingId = null;
  let isAdmin = false;
  let busy = false;

  function parseSemester(value) {
    if (value === 'all') return 'all';
    const text = String(value || '').trim().replace(/^(semester|sem)\s*/i, '').toUpperCase();
    const number = /^[1-8]$/.test(text) ? Number(text) : romans.indexOf(text) + 1;
    return number >= 1 && number <= 8 ? number : 'all';
  }
  let selectedSemester = parseSemester(new URLSearchParams(location.search).get('semester'));

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function status(id, message, error = false) {
    const node = byId(id);
    node.textContent = message;
    node.classList.toggle('is-error', error);
  }
  async function request(url, options) {
    let response;
    try { response = await fetch(url, options); }
    catch { throw new Error('Could not reach the server. Check your connection and try again.'); }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if ([401, 403].includes(response.status) && options?.method) {
        isAdmin = false;
        adminPanel.hidden = true;
        byId('routineAdminLink').hidden = true;
        showPublicError('Your admin session has ended. Sign in again to manage the routine.');
      }
      throw new Error(data?.error || data?.message || 'The request failed. Please try again.');
    }
    if (data === null) throw new Error('The server returned an unexpected response. Please try again.');
    return data;
  }
  function showPublicError(message) {
    const box = el('div', 'routine-empty');
    const retry = el('button', 'routine-btn', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', () => loadRoutines());
    box.append(el('p', '', message), retry);
    box.setAttribute('role', 'status');
    schedule.replaceChildren(box);
  }
  function renderFilters() {
    const buttons = ['all', 1, 2, 3, 4, 5, 6, 7, 8].map(value => {
      const button = el('button', `semester-btn${value === selectedSemester ? ' active' : ''}`, value === 'all' ? 'All semesters' : `Semester ${romans[value - 1]}`);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(value === selectedSemester));
      button.addEventListener('click', () => {
        selectedSemester = value;
        const url = new URL(location.href);
        if (value === 'all') url.searchParams.delete('semester');
        else url.searchParams.set('semester', value);
        history.pushState({}, '', url);
        renderFilters();
        renderPublic();
      });
      return button;
    });
    byId('routineFilters').replaceChildren(...buttons);
  }
  function sortedRows() {
    return [...routines].sort((a, b) => a.semester - b.semester || String(a.calendar || '').localeCompare(String(b.calendar || '')) || a.exam_date.localeCompare(b.exam_date) || a.id - b.id);
  }
  function renderPublic() {
    const rows = sortedRows().filter(row => selectedSemester === 'all' || row.semester === selectedSemester);
    const semesters = [...new Set(routines.map(row => row.semester))].sort((a, b) => a - b);
    const years = [...new Set(routines.map(row => `${row.exam_date.slice(0, 4)} ${row.calendar || '(calendar unconfirmed)'}`))].sort();
    byId('routineYears').textContent = years.join(' · ') || 'Not published';
    byId('routineSemesters').textContent = semesters.map(n => romans[n - 1]).join(' · ') || '—';
    if (!rows.length) {
      schedule.replaceChildren(el('p', 'routine-empty', selectedSemester === 'all' ? 'No exams have been published yet.' : `No exams scheduled for Semester ${romans[selectedSemester - 1]}.`));
      return;
    }
    schedule.replaceChildren(...rows.map(row => {
      const article = el('article', 'exam-row');
      const dateBox = el('div', 'exam-date');
      const date = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(row.exam_date);
      dateBox.append(el('span', 'date-day', date ? date[3] : row.exam_date));
      dateBox.append(el('span', 'date-month', date ? `${date[2]} / ${date[1]}` : 'Date to confirm'));
      dateBox.append(el('span', 'date-weekday', row.calendar || 'Calendar unconfirmed'));
      const details = el('div', 'exam-details');
      details.append(el('span', 'semester-tag', `Semester ${romans[row.semester - 1]}${row.subject_code ? ` · ${row.subject_code}` : ''}`));
      details.append(el('h2', '', row.subject_name));
      const meta = [row.exam_type, row.weekday, row.room ? `Room ${row.room}` : ''].filter(Boolean).join(' · ');
      if (meta) details.append(el('p', '', meta));
      article.append(dateBox, details, el('div', 'exam-time', row.exam_time || 'Time to be announced'));
      return article;
    }));
  }
  function setBusy(value) {
    busy = value;
    byId('routineFormFields').disabled = value;
    adminPanel.querySelectorAll('button').forEach(button => { button.disabled = value; });
  }
  function resetForm(focus = false) {
    editingId = null;
    form.reset();
    byId('routineFormHeading').textContent = 'Add an exam';
    byId('routineSaveBtn').textContent = 'Add exam';
    byId('routineCancelBtn').hidden = true;
    status('routineFormStatus', '');
    if (focus) byId('routineSubject').focus();
  }
  function editExam(row) {
    if (busy) return;
    editingId = row.id;
    fields.forEach(field => { form.elements.namedItem(field).value = row[field] ?? ''; });
    byId('routineFormHeading').textContent = 'Edit exam';
    byId('routineSaveBtn').textContent = 'Save changes';
    byId('routineCancelBtn').hidden = false;
    status('routineFormStatus', row.calendar ? '' : 'Please confirm whether this existing date is BS or AD before saving.');
    byId('routineSubject').focus();
  }
  async function deleteExam(row) {
    if (busy || !window.confirm(`Delete “${row.subject_name}” on ${row.exam_date}? This removes the exam from the published routine.`)) return;
    setBusy(true);
    status('routineAdminStatus', 'Deleting exam…');
    try {
      await request(`/api/routine/${row.id}`, { method: 'DELETE' });
      routines = routines.filter(item => item.id !== row.id);
      if (editingId === row.id) resetForm();
      renderPublic();
      renderAdmin();
      status('routineAdminStatus', 'Exam deleted. The published routine is updated.');
    } catch (err) { status('routineAdminStatus', err.message, true); }
    finally { setBusy(false); }
  }
  function renderAdmin() {
    if (!isAdmin) return;
    const body = byId('routineAdminRows');
    if (!routines.length) {
      const row = el('tr');
      const cell = el('td', 'routine-empty', 'No exams yet. Add the first exam below.');
      cell.colSpan = 6;
      row.append(cell);
      body.replaceChildren(row);
      return;
    }
    body.replaceChildren(...sortedRows().map(row => {
      const tr = el('tr');
      const subject = el('td');
      subject.append(el('strong', '', row.subject_name));
      if (row.subject_code) subject.append(el('small', '', row.subject_code));
      const date = el('td', '', `${row.exam_date} ${row.calendar || '(confirm calendar)'}`);
      if (row.weekday) date.append(el('small', '', row.weekday));
      const time = el('td', '', row.exam_time || 'Not set');
      if (row.room) time.append(el('small', '', `Room ${row.room}`));
      const actions = el('td');
      const group = el('div', 'routine-row-actions');
      const edit = el('button', 'routine-btn', 'Edit');
      const remove = el('button', 'routine-btn routine-btn-delete', 'Delete');
      edit.type = remove.type = 'button';
      edit.disabled = remove.disabled = busy;
      edit.setAttribute('aria-label', `Edit ${row.subject_name}`);
      remove.setAttribute('aria-label', `Delete ${row.subject_name}`);
      edit.addEventListener('click', () => editExam(row));
      remove.addEventListener('click', () => deleteExam(row));
      group.append(edit, remove);
      actions.append(group);
      tr.append(subject, el('td', '', romans[row.semester - 1]), date, time, el('td', '', row.exam_type || '—'), actions);
      return tr;
    }));
  }
  async function loadRoutines() {
    schedule.setAttribute('aria-busy', 'true');
    try {
      const rows = await request('/api/routine');
      if (!Array.isArray(rows)) throw new Error('Could not read the routine. Please try again.');
      routines = rows;
      renderPublic();
      renderAdmin();
    } catch (err) { showPublicError(err.message); }
    finally { schedule.removeAttribute('aria-busy'); }
  }
  async function checkAdminAccess() {
    try {
      const profile = await request('/api/profile');
      if (profile.role !== 'admin') return;
      isAdmin = true;
      adminPanel.hidden = false;
      byId('routineAdminLink').hidden = false;
      setBusy(true);
      const rows = await request('/api/routine/admin');
      if (!Array.isArray(rows)) throw new Error('Could not load the admin list.');
      routines = rows;
      isAdmin = true;
      adminPanel.hidden = false;
      renderPublic();
      renderAdmin();
      byId('routineAdminRetry').hidden = true;
      status('routineAdminStatus', '');
    } catch (err) {
      // Public visitors can still use the routine; admin state never grants permission.
      if (isAdmin) {
        status('routineAdminStatus', err.message, true);
        byId('routineAdminRetry').hidden = false;
      }
    } finally { setBusy(false); }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !isAdmin || !form.reportValidity()) return;
    const payload = Object.fromEntries(fields.map(field => [field, form.elements.namedItem(field).value.trim() || null]));
    payload.semester = Number(payload.semester);
    const id = editingId;
    setBusy(true);
    status('routineFormStatus', 'Saving exam…');
    try {
      const row = await request(`/api/routine${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      routines = id ? routines.map(item => item.id === id ? row : item) : [...routines, row];
      resetForm();
      renderPublic();
      renderAdmin();
      status('routineFormStatus', 'Saved. The published routine is updated.');
    } catch (err) { status('routineFormStatus', err.message, true); }
    finally { setBusy(false); }
  });
  byId('routineAdminRetry').addEventListener('click', checkAdminAccess);
  byId('routineNewBtn').addEventListener('click', () => resetForm(true));
  byId('routineCancelBtn').addEventListener('click', () => resetForm());
  window.addEventListener('popstate', () => {
    selectedSemester = parseSemester(new URLSearchParams(location.search).get('semester'));
    renderFilters();
    renderPublic();
  });
  renderFilters();
  loadRoutines().then(checkAdminAccess);
})();
