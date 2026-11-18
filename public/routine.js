(() => {
  'use strict';
  const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  const WORKING_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const FACULTY_TYPE_LABELS = {
    FT: 'Full Time (FT)',
    CC: 'Course Contract (CC)',
    MA: "Master's Assistantship (MA)"
  };

  const byId = id => document.getElementById(id);
  const schedule = byId('scheduleContainer');
  const classContainer = byId('classRoutineContainer');
  const classSection = byId('classRoutineSection');
  const liveBanner = byId('classLiveBanner');
  const adminPanel = byId('adminRoutinePanel');
  const form = byId('adminRoutineForm');
  const fields = ['subject_name', 'subject_code', 'semester', 'exam_date', 'calendar', 'exam_time', 'room', 'weekday', 'exam_type'];

  let viewMode = 'class'; // 'class' | 'exam'
  let classRoutine = null;
  let classRoutineMessage = '';
  let classRoutineError = null;
  let selectedMobileDay = null;
  let academicCtx = null;

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
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function status(id, message, error = false) {
    const node = byId(id);
    if (!node) return;
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
        if (adminPanel) adminPanel.hidden = true;
        if (byId('routineAdminLink')) byId('routineAdminLink').hidden = true;
        showPublicError('Your admin session has ended. Sign in again to manage the routine.');
      }
      const err = new Error(data?.error || data?.message || 'The request failed. Please try again.');
      err.status = response.status;
      throw err;
    }
    if (data === null) throw new Error('The server returned an unexpected response. Please try again.');
    return data;
  }

  const KATHMANDU_OFFSET_MS = 345 * 60 * 1000;

  function toKathmanduDate(dateInput = new Date()) {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    return new Date(d.getTime() + KATHMANDU_OFFSET_MS);
  }

  function getTodayWeekday(dateInput = new Date()) {
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return names[toKathmanduDate(dateInput).getUTCDay()];
  }

  function getCurrentKathmanduMinutes(dateInput = new Date()) {
    const ktm = toKathmanduDate(dateInput);
    return ktm.getUTCHours() * 60 + ktm.getUTCMinutes();
  }

  function parseMinutes(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function findCurrentOrUpcoming(routine, dateInput = new Date()) {
    if (!routine || !Array.isArray(routine.slots) || !Array.isArray(routine.entries)) return null;
    const today = getTodayWeekday(dateInput);
    if (!WORKING_DAYS.includes(today)) return null;

    const nowMins = getCurrentKathmanduMinutes(dateInput);
    const todayEntries = routine.entries.filter(e => e.day_of_week === today);

    for (const slot of routine.slots) {
      const start = parseMinutes(slot.start_time);
      const end = parseMinutes(slot.end_time);
      if (start === null || end === null) continue;
      const entry = todayEntries.find(e => Number(e.slot_id) === Number(slot.id));
      if (!entry || entry.is_empty) continue;

      if (nowMins >= start && nowMins < end) {
        return { state: 'current', day: today, slot, entry };
      }
      if (nowMins < start) {
        return { state: 'upcoming', day: today, slot, entry };
      }
    }
    return null;
  }

  function openSubjectModal(entry, slot) {
    const modal = byId('subjectDetailModal');
    if (!modal || !entry || entry.is_empty || entry.class_type === 'Break') return;
    byId('modalSubjectType').textContent = (entry.class_type || 'Theory').toUpperCase();
    byId('modalSubjectTitle').textContent = entry.subject_name || 'Subject';
    byId('modalFacultyName').textContent = entry.faculty_name || 'Not assigned';
    byId('modalFacultyType').textContent = entry.faculty_type
      ? (FACULTY_TYPE_LABELS[entry.faculty_type] || entry.faculty_type)
      : '—';
    byId('modalDay').textContent = entry.day_of_week;
    byId('modalTime').textContent = slot ? `${slot.label} (${slot.duration_minutes} min)` : (entry.slot_label || '—');
    byId('modalClassification').textContent = entry.class_type || 'Theory';
    modal.hidden = false;
  }

  function closeSubjectModal() {
    const modal = byId('subjectDetailModal');
    if (modal) modal.hidden = true;
  }

  function setMode(mode) {
    viewMode = mode;
    const isClass = mode === 'class';
    byId('modeClassBtn')?.classList.toggle('active', isClass);
    byId('modeClassBtn')?.setAttribute('aria-selected', String(isClass));
    byId('modeExamBtn')?.classList.toggle('active', !isClass);
    byId('modeExamBtn')?.setAttribute('aria-selected', String(!isClass));
    if (classSection) classSection.hidden = !isClass;
    if (schedule) schedule.hidden = isClass;

    if (isClass) {
      byId('routineHeroKicker').textContent = 'GANDAKI UNIVERSITY · BIT ACADEMIC ROUTINE';
      byId('routineHeroTitle').textContent = 'Class Schedule';
      byId('routineInfoLabel1').textContent = 'Session';
      byId('routineInfoLabel3').textContent = 'Year / Semester';
      renderFilters();
      renderClassRoutine();
    } else {
      byId('routineHeroKicker').textContent = 'BIT · EXAMINATION ROUTINE';
      byId('routineHeroTitle').textContent = 'Examination Schedule';
      byId('routineInfoLabel1').textContent = 'Routine';
      byId('routineInfoLabel3').textContent = 'Semesters';
      renderFilters();
      renderPublic();
    }
  }

  function renderClassRoutine() {
    if (!classContainer) return;
    const today = getTodayWeekday();
    if (!selectedMobileDay) {
      selectedMobileDay = WORKING_DAYS.includes(today) ? today : 'Monday';
    }

    if (classRoutineError) {
      if (liveBanner) liveBanner.hidden = true;
      byId('routineYears').textContent = '—';
      byId('routineSemesters').textContent = academicCtx?.currentSemester ? `Sem ${romans[academicCtx.currentSemester - 1]}` : '—';
      const box = el('div', 'routine-empty');
      box.append(el('p', '', classRoutineError));
      if (classRoutineError.includes('Sign in')) {
        const loginLink = el('a', 'routine-btn routine-btn-primary', 'Sign in');
        loginLink.href = '/login.html';
        loginLink.style.marginTop = '12px';
        loginLink.style.textDecoration = 'none';
        box.append(loginLink);
      } else {
        const retry = el('button', 'routine-btn', 'Try again');
        retry.type = 'button';
        retry.style.marginTop = '12px';
        retry.addEventListener('click', () => loadClassRoutine());
        box.append(retry);
      }
      classContainer.replaceChildren(box);
      return;
    }

    if (!classRoutine) {
      if (liveBanner) liveBanner.hidden = true;
      byId('routineYears').textContent = 'Not published';
      byId('routineSemesters').textContent = academicCtx?.currentSemester
        ? `Sem ${romans[academicCtx.currentSemester - 1]}`
        : (selectedSemester !== 'all' ? `Sem ${romans[selectedSemester - 1]}` : '—');
      const box = el('div', 'routine-empty');
      box.append(el('p', '', classRoutineMessage || 'No class routine has been published for your semester yet.'));
      classContainer.replaceChildren(box);
      return;
    }

    byId('routineYears').textContent = classRoutine.academic_session || '—';
    byId('routineSemesters').textContent = `Year ${romans[classRoutine.year - 1]} · Sem ${romans[classRoutine.semester - 1]}`;

    // Current / Upcoming Class Banner
    const live = findCurrentOrUpcoming(classRoutine);
    if (liveBanner) {
      if (live) {
        const badge = el('span', `routine-live-badge${live.state === 'upcoming' ? ' is-upcoming' : ''}`, live.state === 'current' ? 'In Progress' : 'Up Next');
        const info = el('div');
        info.append(
          el('p', 'routine-live-title', live.entry.is_break ? 'Break Period' : live.entry.subject_name),
          el('p', 'routine-live-sub', `${live.day} · ${live.slot.label}${live.entry.faculty_name ? ` · ${live.entry.faculty_name}` : ''}${live.entry.class_type && live.entry.class_type !== 'Break' ? ` · ${live.entry.class_type}` : ''}`)
        );
        const meta = el('div', 'routine-live-meta');
        meta.append(badge, info);
        liveBanner.replaceChildren(meta);
        if (!live.entry.is_break) {
          const btn = el('button', 'routine-btn', 'Details');
          btn.type = 'button';
          btn.addEventListener('click', () => openSubjectModal(live.entry, live.slot));
          liveBanner.append(btn);
        }
        liveBanner.hidden = false;
      } else {
        liveBanner.hidden = true;
      }
    }

    const slots = classRoutine.slots || [];
    const entries = classRoutine.entries || [];
    const entryMap = new Map();
    entries.forEach(e => entryMap.set(`${e.day_of_week}:${e.slot_id}`, e));

    // 1. Desktop Timetable Grid
    const gridWrap = el('div', 'class-grid-wrap');
    const table = el('table', 'class-grid-table');
    const thead = el('thead');
    const headRow = el('tr');
    headRow.append(el('th', '', 'Day / Time'));
    slots.forEach(slot => {
      const th = el('th', slot.is_break ? 'is-break-col' : '');
      th.append(document.createTextNode(slot.label));
      th.append(el('span', 'class-grid-slot-dur', slot.is_break ? 'Break' : `${slot.duration_minutes} min`));
      headRow.append(th);
    });
    thead.append(headRow);

    const tbody = el('tbody');
    WORKING_DAYS.forEach(day => {
      const tr = el('tr', `class-grid-row${day === today ? ' is-today' : ''}`);
      const dayTd = el('td', 'class-grid-day');
      dayTd.append(document.createTextNode(day));
      if (day === today) {
        dayTd.append(el('div'));
        dayTd.append(el('span', 'class-grid-today-pill', 'Today'));
      }
      tr.append(dayTd);

      let i = 0;
      while (i < slots.length) {
        const slot = slots[i];
        const entry = entryMap.get(`${day}:${slot.id}`);
        if (slot.is_break || (entry && entry.class_type === 'Break')) {
          tr.append(el('td', 'class-cell-break', 'Break'));
          i += 1;
          continue;
        }
        if (!entry || entry.is_empty || entry.class_type === 'Empty') {
          const td = el('td');
          td.append(el('div', 'class-cell-empty', 'Free Period'));
          tr.append(td);
          i += 1;
          continue;
        }

        let span = 1;
        const isMergeableType = entry.class_type === 'Lab' || entry.class_type === 'Practical';
        if (isMergeableType) {
          while (i + span < slots.length) {
            const nextSlot = slots[i + span];
            const nextEntry = entryMap.get(`${day}:${nextSlot.id}`);
            if (nextSlot.is_break || !nextEntry || nextEntry.is_empty || nextEntry.class_type === 'Break' || nextEntry.class_type === 'Empty') {
              break;
            }
            if (
              nextEntry.class_type === entry.class_type &&
              nextEntry.subject_name === entry.subject_name &&
              (nextEntry.faculty_name || '') === (entry.faculty_name || '')
            ) {
              span += 1;
            } else {
              break;
            }
          }
        }

        const mergedSlot = span > 1
          ? {
              ...slot,
              end_time: slots[i + span - 1].end_time,
              duration_minutes: slots.slice(i, i + span).reduce((sum, s) => sum + Number(s.duration_minutes || 0), 0),
              label: `${String(slot.label).split('–')[0]}–${String(slots[i + span - 1].label).split('–').pop()}`
            }
          : slot;

        const td = el('td', span > 1 ? 'class-cell-merged' : '');
        if (span > 1) td.colSpan = span;

        const btn = el('button', 'class-cell-btn');
        btn.type = 'button';
        btn.addEventListener('click', () => openSubjectModal(entry, mergedSlot));

        const subj = el('span', 'class-cell-subject', entry.subject_name);
        const meta = el('div', 'class-cell-meta');
        const cType = entry.class_type || 'Theory';
        const badgeClass = `class-type-badge${cType === 'Lab' ? ' is-lab' : (cType === 'Practical' ? ' is-practical' : '')}`;
        meta.append(el('span', badgeClass, span > 1 ? `${cType} (${mergedSlot.duration_minutes}m)` : cType));
        if (entry.faculty_type) {
          meta.append(el('span', 'class-type-badge', entry.faculty_type));
        }
        btn.append(subj, meta);
        td.append(btn);
        tr.append(td);
        i += span;
      }

      tbody.append(tr);
    });
    table.append(thead, tbody);
    gridWrap.append(table);

    // 2. Mobile Day-wise Schedule Cards
    const mobileWrap = el('div', 'class-mobile-view');
    const dayPills = el('div', 'class-day-pills');
    WORKING_DAYS.forEach(day => {
      const shortLabel = day === today ? `${day.slice(0, 3)} · Today` : day.slice(0, 3);
      const pill = el('button', `class-day-pill${day === selectedMobileDay ? ' active' : ''}`, shortLabel);
      pill.type = 'button';
      pill.addEventListener('click', () => {
        selectedMobileDay = day;
        renderClassRoutine();
      });
      dayPills.append(pill);
    });

    const cardsList = el('div', 'class-mobile-cards');
    slots.forEach(slot => {
      const entry = entryMap.get(`${selectedMobileDay}:${slot.id}`);
      const isBreak = slot.is_break || (entry && entry.class_type === 'Break');
      const isEmpty = !isBreak && (!entry || entry.is_empty || entry.class_type === 'Empty');

      const card = el(isBreak || isEmpty ? 'div' : 'button', `class-mobile-card${isBreak ? ' is-break' : ''}${isEmpty ? ' is-empty' : ''}`);
      if (!isBreak && !isEmpty) {
        card.type = 'button';
        card.addEventListener('click', () => openSubjectModal(entry, slot));
      }

      const timeCol = el('div', 'class-mobile-time');
      timeCol.append(document.createTextNode(slot.label));
      timeCol.append(el('span', 'class-mobile-dur', isBreak ? 'Break' : `${slot.duration_minutes} min`));

      const infoCol = el('div', 'class-mobile-info');
      if (isBreak) {
        infoCol.append(el('p', 'class-mobile-subject', 'Break Period'));
        infoCol.append(el('p', 'class-mobile-faculty', 'Scheduled mid-day break'));
      } else if (isEmpty) {
        infoCol.append(el('p', 'class-mobile-subject', 'Free Period'));
        infoCol.append(el('p', 'class-mobile-faculty', 'No class scheduled'));
      } else {
        infoCol.append(el('p', 'class-mobile-subject', entry.subject_name));
        const facText = [entry.faculty_name, entry.faculty_type].filter(Boolean).join(' · ');
        if (facText) infoCol.append(el('p', 'class-mobile-faculty', facText));
      }

      card.append(timeCol, infoCol);
      if (!isBreak && !isEmpty) {
        const cType = entry.class_type || 'Theory';
        const badgeClass = `class-type-badge${cType === 'Lab' ? ' is-lab' : (cType === 'Practical' ? ' is-practical' : '')}`;
        card.append(el('span', badgeClass, cType));
      }
      cardsList.append(card);
    });

    mobileWrap.append(dayPills, cardsList);
    classContainer.replaceChildren(gridWrap, mobileWrap);
  }

  async function loadClassRoutine() {
    if (!classContainer) return;
    classRoutineError = null;
    classRoutineMessage = '';

    let url = '/api/routine/class';
    const isStaff = academicCtx && academicCtx.authenticated && (academicCtx.canViewAllCohorts || academicCtx.role === 'teacher' || academicCtx.role === 'admin');
    if (isStaff) {
      const targetSem = selectedSemester === 'all' ? 1 : selectedSemester;
      url = `/api/routine/class?semester=${targetSem}`;
    }

    try {
      const data = await request(url);
      classRoutine = data.routine || null;
      classRoutineMessage = data.message || '';
    } catch (err) {
      classRoutine = null;
      classRoutineError = err.message || 'Could not load class routine.';
    }
    if (viewMode === 'class') {
      renderClassRoutine();
    }
  }

  // ==========================================================================
  // EXAM SCHEDULE LOGIC (Preserved)
  // ==========================================================================

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
    const filtersEl = byId('routineFilters');
    if (!filtersEl) return;

    // Students/CRs only see their own semester (no switching)
    if (academicCtx && academicCtx.authenticated && academicCtx.isStudent) {
      filtersEl.hidden = true;
      return;
    }

    const values = viewMode === 'class' ? [1, 2, 3, 4, 5, 6, 7, 8] : ['all', 1, 2, 3, 4, 5, 6, 7, 8];
    const activeVal = viewMode === 'class' && selectedSemester === 'all' ? 1 : selectedSemester;

    const buttons = values.map(value => {
      const button = el('button', `semester-btn${value === activeVal ? ' active' : ''}`, value === 'all' ? 'All semesters' : `Semester ${romans[value - 1]}`);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(value === activeVal));
      button.addEventListener('click', () => {
        selectedSemester = value;
        const url = new URL(location.href);
        if (value === 'all') url.searchParams.delete('semester');
        else url.searchParams.set('semester', value);
        history.pushState({}, '', url);
        renderFilters();
        if (viewMode === 'class') loadClassRoutine();
        else renderPublic();
      });
      return button;
    });
    filtersEl.hidden = false;
    filtersEl.replaceChildren(...buttons);
  }

  function sortedRows() {
    return [...routines].sort((a, b) => a.semester - b.semester || String(a.calendar || '').localeCompare(String(b.calendar || '')) || a.exam_date.localeCompare(b.exam_date) || a.id - b.id);
  }

  function renderPublic() {
    const rows = sortedRows().filter(row => selectedSemester === 'all' || row.semester === selectedSemester);
    if (viewMode === 'exam') {
      const semesters = [...new Set(routines.map(row => row.semester))].sort((a, b) => a - b);
      const years = [...new Set(routines.map(row => `${row.exam_date.slice(0, 4)} ${row.calendar || '(calendar unconfirmed)'}`))].sort();
      byId('routineYears').textContent = years.join(' · ') || 'Not published';
      byId('routineSemesters').textContent = semesters.map(n => romans[n - 1]).join(' · ') || '—';
    }
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
    if (byId('routineFormFields')) byId('routineFormFields').disabled = value;
    if (adminPanel) adminPanel.querySelectorAll('button').forEach(button => { button.disabled = value; });
  }

  function resetForm(focus = false) {
    editingId = null;
    if (form) form.reset();
    if (byId('routineFormHeading')) byId('routineFormHeading').textContent = 'Add an exam';
    if (byId('routineSaveBtn')) byId('routineSaveBtn').textContent = 'Add exam';
    if (byId('routineCancelBtn')) byId('routineCancelBtn').hidden = true;
    status('routineFormStatus', '');
    if (focus && byId('routineSubject')) byId('routineSubject').focus();
  }

  function editExam(row) {
    if (busy || !form) return;
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
      if (window.SWR) window.SWR.invalidate('/api/routine');
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
    if (!body) return;
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

  async function loadRoutines(opts = {}) {
    schedule.setAttribute('aria-busy', 'true');
    try {
      if (window.SWR && typeof window.SWR.get === 'function') {
        const res = await window.SWR.get('/api/routine', {
          ttl: 15 * 60 * 1000,
          userScoped: true,
          force: Boolean(opts.force),
          fetcher: () => request('/api/routine'),
          onData: (rows, meta) => {
            if (!Array.isArray(rows)) return;
            if (meta.source === 'cache' || meta.changed) {
              routines = rows;
              renderPublic();
              renderAdmin();
            }
          }
        });
        if (!Array.isArray(res.data)) throw new Error('Could not read the routine. Please try again.');
        return;
      }
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
      if (adminPanel) adminPanel.hidden = false;
      if (byId('routineAdminLink')) byId('routineAdminLink').hidden = false;
      setBusy(true);
      const rows = await request('/api/routine/admin');
      if (!Array.isArray(rows)) throw new Error('Could not load the admin list.');
      routines = rows;
      isAdmin = true;
      if (adminPanel) adminPanel.hidden = false;
      renderPublic();
      renderAdmin();
      if (byId('routineAdminRetry')) byId('routineAdminRetry').hidden = true;
      status('routineAdminStatus', '');
    } catch (err) {
      if (isAdmin) {
        status('routineAdminStatus', err.message, true);
        if (byId('routineAdminRetry')) byId('routineAdminRetry').hidden = false;
      }
    } finally { setBusy(false); }
  }

  if (form) {
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
        if (window.SWR) window.SWR.invalidate('/api/routine');
        routines = id ? routines.map(item => item.id === id ? row : item) : [...routines, row];
        resetForm();
        renderPublic();
        renderAdmin();
        status('routineFormStatus', 'Saved. The published routine is updated.');
      } catch (err) { status('routineFormStatus', err.message, true); }
      finally { setBusy(false); }
    });
  }

  byId('modeClassBtn')?.addEventListener('click', () => setMode('class'));
  byId('modeExamBtn')?.addEventListener('click', () => setMode('exam'));
  byId('modalSubjectClose')?.addEventListener('click', closeSubjectModal);
  byId('subjectDetailModal')?.addEventListener('click', e => {
    if (e.target === byId('subjectDetailModal')) closeSubjectModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSubjectModal();
  });

  byId('routineAdminRetry')?.addEventListener('click', checkAdminAccess);
  byId('routineNewBtn')?.addEventListener('click', () => resetForm(true));
  byId('routineCancelBtn')?.addEventListener('click', () => resetForm());
  window.addEventListener('popstate', () => {
    selectedSemester = parseSemester(new URLSearchParams(location.search).get('semester'));
    renderFilters();
    if (viewMode === 'class') loadClassRoutine();
    else renderPublic();
  });

  async function initRoutinePage() {
    if (window.AcademicContext && typeof window.AcademicContext.getAcademicContext === 'function') {
      try {
        academicCtx = await window.AcademicContext.getAcademicContext();
        if (academicCtx && academicCtx.authenticated && academicCtx.isStudent && academicCtx.currentSemester) {
          selectedSemester = Number(academicCtx.currentSemester);
        }
      } catch (_) {}
    }
    renderFilters();
    await Promise.all([loadClassRoutine(), loadRoutines()]);
    await checkAdminAccess();
    if (window.SWR && typeof window.SWR.registerPageRefresh === 'function') {
      window.SWR.registerPageRefresh(() => {
        loadClassRoutine();
        loadRoutines();
      }, {
        endpoints: ['/api/routine', '/api/routine/class'],
        ttl: 15 * 60 * 1000
      });
    }
  }

  window.__routineHelpers = {
    getTodayWeekday,
    getCurrentKathmanduMinutes,
    findCurrentOrUpcoming
  };

  initRoutinePage();
})();
