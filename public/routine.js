(() => {
  'use strict';
  const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  const WORKING_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const FACULTY_TYPE_LABELS = {
    FT: 'Full Time (FT)',
    CC: 'Course Contract (CC)',
    MA: "Master's Assistantship (MA)"
  };
  const BS_MONTHS_DEFAULT = [
    { value: '01', name: 'Baisakh', nepali: 'बैशाख' },
    { value: '02', name: 'Jestha', nepali: 'जेठ' },
    { value: '03', name: 'Ashadh', nepali: 'असार' },
    { value: '04', name: 'Shrawan', nepali: 'साउन' },
    { value: '05', name: 'Bhadra', nepali: 'भदौ' },
    { value: '06', name: 'Ashwin', nepali: 'असोज' },
    { value: '07', name: 'Kartik', nepali: 'कार्तिक' },
    { value: '08', name: 'Mangsir', nepali: 'मंसिर' },
    { value: '09', name: 'Poush', nepali: 'पुष' },
    { value: '10', name: 'Magh', nepali: 'माघ' },
    { value: '11', name: 'Falgun', nepali: 'फागुन' },
    { value: '12', name: 'Chaitra', nepali: 'चैत्र' }
  ];
  // Official BS month day counts (2080..2085 BS), anchored at 2080/01/01 BS = 2023-04-14 AD (Friday)
  const BS_YEAR_DAYS = {
    2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
    2081: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    2082: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2083: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30],
    2084: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2085: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30]
  };
  const BS_ANCHOR_YEAR = 2080;
  const BS_ANCHOR_UTC_MS = Date.UTC(2023, 3, 14); // 2023-04-14 Friday

  function getBsDaysInMonth(year, monthNum) {
    const arr = BS_YEAR_DAYS[Number(year)];
    const m = Number(monthNum);
    if (arr && m >= 1 && m <= 12) return arr[m - 1];
    return 32;
  }

  function getBsWeekday(year, monthNum, day) {
    const y = Number(year);
    const m = Number(monthNum);
    const d = Number(day);
    if (!BS_YEAR_DAYS[y] || m < 1 || m > 12 || d < 1) return '';
    const maxDay = getBsDaysInMonth(y, m);
    if (d > maxDay) return '';
    let totalDays = 0;
    for (let yr = BS_ANCHOR_YEAR; yr < y; yr++) {
      const daysArr = BS_YEAR_DAYS[yr];
      if (!daysArr) return '';
      for (const cnt of daysArr) totalDays += cnt;
    }
    const curArr = BS_YEAR_DAYS[y];
    for (let mo = 0; mo < m - 1; mo++) totalDays += curArr[mo];
    totalDays += d - 1;
    const adDate = new Date(BS_ANCHOR_UTC_MS + totalDays * 86400000);
    return WEEKDAY_NAMES[adDate.getUTCDay()] || '';
  }

  const AD_MONTHS = [
    { value: '01', name: 'January' },
    { value: '02', name: 'February' },
    { value: '03', name: 'March' },
    { value: '04', name: 'April' },
    { value: '05', name: 'May' },
    { value: '06', name: 'June' },
    { value: '07', name: 'July' },
    { value: '08', name: 'August' },
    { value: '09', name: 'September' },
    { value: '10', name: 'October' },
    { value: '11', name: 'November' },
    { value: '12', name: 'December' }
  ];
  const NPT_TIME_POINTS = [
    '6:00 AM', '6:30 AM', '7:00 AM', '7:30 AM', '8:00 AM', '8:30 AM',
    '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
    '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM',
    '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM', '6:00 PM'
  ];
  const EXAM_TYPES_CLEAN = [
    'Final Examination',
    'Pre-board Examination',
    'Midterm Examination',
    'Practical Examination',
    'Makeup Examination'
  ];
  const DEFAULT_OPTIONS = {
    subjectsBySemester: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [] },
    electives: [],
    teachers: [],
    rooms: [
      'Room 101', 'Room 102', 'Room 201', 'Room 202', 'Room 204', 'Room 301',
      'Computer Lab 1', 'Computer Lab 2', 'Hardware Lab', 'Seminar Hall', 'Exam Hall A', 'Exam Hall B'
    ],
    examTypes: EXAM_TYPES_CLEAN,
    classTypes: ['Theory', 'Practical', 'Lab', 'Break', 'Empty'],
    facultyTypes: [
      { value: 'FT', label: 'Full Time (FT)' },
      { value: 'CC', label: 'Course Contract (CC)' },
      { value: 'MA', label: "Master's Assistantship (MA)" }
    ],
    bsMonths: BS_MONTHS_DEFAULT,
    bsYears: [2081, 2082, 2083, 2084, 2085],
    examTimePresets: [
      '7:00 AM – 10:00 AM', '8:00 AM – 11:00 AM', '11:00 AM – 2:00 PM',
      '11:30 AM – 2:30 PM', '12:00 PM – 3:00 PM', '1:00 PM – 4:00 PM', '2:00 PM – 5:00 PM'
    ],
    sessionPresets: [
      '2082 BS (Ashwin–Chaitra)', '2083 BS (Baisakh–Bhadra)', '2083 BS (Ashwin–Chaitra)',
      '2084 BS (Baisakh–Bhadra)', '2084 BS (Ashwin–Chaitra)'
    ]
  };

  const byId = id => document.getElementById(id);
  const schedule = byId('scheduleContainer');
  const classContainer = byId('classRoutineContainer');
  const classSection = byId('classRoutineSection');
  const liveBanner = byId('classLiveBanner');
  const adminPanel = byId('adminRoutinePanel');

  let viewMode = 'class'; // 'class' | 'exam'
  let classRoutine = null;
  let classRoutineMessage = '';
  let classRoutineError = null;
  let selectedMobileDay = null;
  let academicCtx = null;
  let currentModalContext = null; // { entry, slot }
  let routineOptions = DEFAULT_OPTIONS;

  let routines = [];
  let isAdmin = false;
  let busy = false;

  // Exam table state
  let examTableSemester = 1;
  let examTableBsYear = 2083;

  // Class period editor modal state
  let classEditSelectedType = 'Theory';
  let classEditSelectedFacultyType = 'FT';
  let classEditExistingEntryId = null;

  function parseSemester(value) {
    if (value === 'all') return 'all';
    const text = String(value || '').trim().replace(/^(semester|sem)\s*/i, '').toUpperCase();
    const number = /^[1-8]$/.test(text) ? Number(text) : romans.indexOf(text) + 1;
    return number >= 1 && number <= 8 ? number : 'all';
  }
  let selectedSemester = parseSemester(new URLSearchParams(location.search).get('semester'));
  if (selectedSemester !== 'all') examTableSemester = Number(selectedSemester);

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

  function format12HourNpt(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    if (!m) return hhmm || '';
    let h = Number(m[1]);
    const min = m[2];
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${min} ${ampm}`;
  }

  function formatSlotNptLabel(slot) {
    if (!slot) return '';
    if (slot.start_time && slot.end_time) {
      return `${format12HourNpt(slot.start_time)} – ${format12HourNpt(slot.end_time)}`;
    }
    return slot.label || '';
  }

  function formatBsMonthLabel(dateStr, calendar) {
    const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(String(dateStr || '').trim());
    if (!m) return dateStr || '';
    const [, y, mo] = m;
    if (calendar === 'BS') {
      const bsMonth = (routineOptions.bsMonths || BS_MONTHS_DEFAULT).find(x => x.value === mo);
      return bsMonth ? `${bsMonth.name} ${y}` : `${mo} / ${y}`;
    }
    if (calendar === 'AD') {
      const adMonth = AD_MONTHS.find(x => x.value === mo);
      return adMonth ? `${adMonth.name.slice(0, 3)} ${y}` : `${mo} / ${y}`;
    }
    return `${mo} / ${y}`;
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
        if (byId('routineAdminQuickActions')) byId('routineAdminQuickActions').hidden = true;
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
    return WEEKDAY_NAMES[toKathmanduDate(dateInput).getUTCDay()];
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
    currentModalContext = { entry, slot };
    byId('modalSubjectType').textContent = (entry.class_type || 'Theory').toUpperCase();
    byId('modalSubjectTitle').textContent = entry.subject_name || 'Subject';
    byId('modalFacultyName').textContent = entry.faculty_name || 'Not assigned';
    byId('modalFacultyType').textContent = entry.faculty_type
      ? (FACULTY_TYPE_LABELS[entry.faculty_type] || entry.faculty_type)
      : '—';
    byId('modalDay').textContent = entry.day_of_week;
    byId('modalTime').textContent = slot ? `${formatSlotNptLabel(slot)} (${slot.duration_minutes} min)` : (entry.slot_label || '—');
    byId('modalClassification').textContent = entry.class_type || 'Theory';
    const adminFooter = byId('modalAdminFooter');
    if (adminFooter) adminFooter.hidden = !isAdmin;
    modal.hidden = false;
  }

  function closeSubjectModal() {
    const modal = byId('subjectDetailModal');
    if (modal) modal.hidden = true;
  }

  function syncAdminQuickActions() {
    const wrap = byId('routineAdminQuickActions');
    if (!wrap) return;
    wrap.hidden = !isAdmin;
    const isClass = viewMode === 'class';
    const editClassBtn = byId('quickEditClassPeriodBtn');
    const newClassBtn = byId('quickNewClassRoutineBtn');
    const addExamBtn = byId('quickAddExamBtn');
    if (editClassBtn) editClassBtn.hidden = !isClass || !classRoutine;
    if (newClassBtn) newClassBtn.hidden = !isClass;
    if (addExamBtn) {
      addExamBtn.hidden = isClass;
      addExamBtn.textContent = 'Edit Exam Table';
    }
    if (adminPanel) adminPanel.hidden = !isAdmin || isClass;
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
      renderExamTable();
    }
    syncAdminQuickActions();
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
      syncAdminQuickActions();
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
      if (isAdmin) {
        const createBtn = el('button', 'routine-btn routine-btn-primary', '+ Create Class Routine');
        createBtn.type = 'button';
        createBtn.style.marginTop = '12px';
        createBtn.addEventListener('click', () => openNewClassRoutineModal());
        box.append(createBtn);
      }
      classContainer.replaceChildren(box);
      syncAdminQuickActions();
      return;
    }

    byId('routineYears').textContent = classRoutine.academic_session || '—';
    byId('routineSemesters').textContent = `Year ${romans[classRoutine.year - 1]} · Sem ${romans[classRoutine.semester - 1]}`;

    const live = findCurrentOrUpcoming(classRoutine);
    if (liveBanner) {
      if (live) {
        const badge = el('span', `routine-live-badge${live.state === 'upcoming' ? ' is-upcoming' : ''}`, live.state === 'current' ? 'In Progress' : 'Up Next');
        const info = el('div');
        info.append(
          el('p', 'routine-live-title', live.entry.is_break ? 'Break Period' : live.entry.subject_name),
          el('p', 'routine-live-sub', `${live.day} · ${formatSlotNptLabel(live.slot)}${live.entry.faculty_name ? ` · ${live.entry.faculty_name}` : ''}${live.entry.class_type && live.entry.class_type !== 'Break' ? ` · ${live.entry.class_type}` : ''}`)
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
    headRow.append(el('th', '', 'Day / Time (NPT)'));
    slots.forEach(slot => {
      const th = el('th', slot.is_break ? 'is-break-col' : '');
      th.append(document.createTextNode(formatSlotNptLabel(slot)));
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
          const emptyBox = el('div', `class-cell-empty${isAdmin ? ' is-admin-editable' : ''}`, isAdmin ? '+ Add Class' : 'Free Period');
          if (isAdmin) {
            emptyBox.tabIndex = 0;
            emptyBox.setAttribute('role', 'button');
            emptyBox.addEventListener('click', () => openClassPeriodEditor(day, slot.id, entry || null));
          }
          td.append(emptyBox);
          tr.append(td);
          i += 1;
          continue;
        }

        let span = 1;
        const isMergeableType = entry.class_type === 'Lab' || entry.class_type === 'Practical';
        if (isMergeableType && !isAdmin) {
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
        btn.addEventListener('click', () => {
          if (isAdmin) openClassPeriodEditor(day, slot.id, entry);
          else openSubjectModal(entry, mergedSlot);
        });

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
      const clickable = (!isBreak && !isEmpty) || (!isBreak && isAdmin);

      const card = el(clickable ? 'button' : 'div', `class-mobile-card${isBreak ? ' is-break' : ''}${isEmpty ? ' is-empty' : ''}${isEmpty && isAdmin ? ' is-admin-editable' : ''}`);
      if (clickable) {
        card.type = 'button';
        card.addEventListener('click', () => {
          if (isAdmin) openClassPeriodEditor(selectedMobileDay, slot.id, entry || null);
          else openSubjectModal(entry, slot);
        });
      }

      const timeCol = el('div', 'class-mobile-time');
      timeCol.append(document.createTextNode(formatSlotNptLabel(slot)));
      timeCol.append(el('span', 'class-mobile-dur', isBreak ? 'Break' : `${slot.duration_minutes} min`));

      const infoCol = el('div', 'class-mobile-info');
      if (isBreak) {
        infoCol.append(el('p', 'class-mobile-subject', 'Break Period'));
        infoCol.append(el('p', 'class-mobile-faculty', 'Scheduled mid-day break'));
      } else if (isEmpty) {
        infoCol.append(el('p', 'class-mobile-subject', isAdmin ? '+ Tap to Assign Class' : 'Free Period'));
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
        card.append(el('span', badgeClass, isAdmin ? `${cType} · Edit` : cType));
      }
      cardsList.append(card);
    });

    mobileWrap.append(dayPills, cardsList);
    classContainer.replaceChildren(gridWrap, mobileWrap);
    syncAdminQuickActions();
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
  // PICKER HELPERS
  // ==========================================================================

  function populateSelectOptions(selectEl, items, { placeholder, includeCustom = false, customLabel = 'Other / Custom…' } = {}) {
    if (!selectEl) return;
    const opts = [];
    if (placeholder !== undefined) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = placeholder;
      opts.push(o);
    }
    for (const item of items) {
      const o = document.createElement('option');
      if (typeof item === 'string') {
        o.value = item;
        o.textContent = item;
      } else {
        o.value = item.value;
        o.textContent = item.label;
        if (item.code) o.dataset.code = item.code;
      }
      opts.push(o);
    }
    if (includeCustom) {
      const o = document.createElement('option');
      o.value = '__custom__';
      o.textContent = customLabel;
      opts.push(o);
    }
    selectEl.replaceChildren(...opts);
  }

  function getSubjectsForSemester(sem) {
    const semNum = Number(sem) || 1;
    const core = (routineOptions.subjectsBySemester && routineOptions.subjectsBySemester[semNum]) || [];
    const electives = (semNum >= 7 && Array.isArray(routineOptions.electives)) ? routineOptions.electives : [];
    const list = core.map(c => ({
      value: c.title,
      label: c.code ? `${c.title} (${c.code})` : c.title,
      code: c.code || ''
    }));
    for (const e of electives) {
      list.push({
        value: e.title,
        label: `${e.title} (Elective)`,
        code: e.code || 'ELE'
      });
    }
    return list;
  }

  function populateDatePickers(yearEl, monthEl, dayEl, calendar, currentDateStr) {
    if (!yearEl || !monthEl || !dayEl) return;
    const isAd = calendar === 'AD';
    const years = isAd
      ? [2025, 2026, 2027, 2028].map(y => ({ value: String(y), label: `${y} AD` }))
      : (routineOptions.bsYears || [2081, 2082, 2083, 2084, 2085]).map(y => ({ value: String(y), label: `${y} BS` }));
    const months = isAd
      ? AD_MONTHS.map(m => ({ value: m.value, label: `${m.value} · ${m.name}` }))
      : (routineOptions.bsMonths || BS_MONTHS_DEFAULT).map(m => ({ value: m.value, label: `${m.value} · ${m.name}` }));
    const maxDay = isAd ? 31 : 32;
    const days = [];
    for (let d = 1; d <= maxDay; d++) {
      const pad = String(d).padStart(2, '0');
      days.push({ value: pad, label: `${pad}` });
    }

    populateSelectOptions(yearEl, years);
    populateSelectOptions(monthEl, months);
    populateSelectOptions(dayEl, days);

    const parsed = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(String(currentDateStr || '').trim());
    if (parsed) {
      const [, y, m, d] = parsed;
      const yVal = String(y);
      const mVal = String(m).padStart(2, '0');
      const dVal = String(d).padStart(2, '0');
      if (![...yearEl.options].some(o => o.value === yVal)) {
        const extra = document.createElement('option');
        extra.value = yVal;
        extra.textContent = `${yVal} ${isAd ? 'AD' : 'BS'}`;
        yearEl.prepend(extra);
      }
      yearEl.value = yVal;
      monthEl.value = mVal;
      dayEl.value = dVal;
    } else {
      yearEl.value = isAd ? '2026' : '2083';
      monthEl.value = '06';
      dayEl.value = '01';
    }
  }

  // ==========================================================================
  // CLEAN SEMESTER SUBJECT EXAM TABLE (Month, Day, Auto Weekday, Start, End, Type)
  // ==========================================================================

  function populateDaySelectForMonth(daySel, bsYear, monthVal, selectedDayVal) {
    const maxDays = monthVal ? getBsDaysInMonth(bsYear, Number(monthVal)) : 32;
    const items = [];
    for (let d = 1; d <= maxDays; d++) {
      const pad = String(d).padStart(2, '0');
      items.push({ value: pad, label: pad });
    }
    populateSelectOptions(daySel, items, { placeholder: 'Day' });
    if (selectedDayVal) {
      const clamped = Math.min(Number(selectedDayVal), maxDays);
      daySel.value = String(clamped).padStart(2, '0');
    } else {
      daySel.value = '';
    }
  }

  function parseExamTimeParts(timeStr) {
    const parts = String(timeStr || '').split(/\s*[–-]\s*/).map(s => s.trim()).filter(Boolean);
    return {
      start: parts[0] || '11:30 AM',
      end: parts[1] || '2:30 PM'
    };
  }

  function makeSelectWithValue(items, placeholder, value, className, ariaLabel) {
    const sel = document.createElement('select');
    sel.className = className;
    if (ariaLabel) sel.setAttribute('aria-label', ariaLabel);
    populateSelectOptions(sel, items, { placeholder });
    if (value) {
      if (![...sel.options].some(o => o.value === value)) {
        const extra = document.createElement('option');
        extra.value = value;
        extra.textContent = value;
        sel.append(extra);
      }
      sel.value = value;
    }
    return sel;
  }

  function setBusy(value) {
    busy = value;
    if (adminPanel) {
      adminPanel.querySelectorAll('button, select').forEach(node => { node.disabled = value; });
    }
  }

  async function saveSingleExamRow(tr) {
    if (busy || !isAdmin) return false;
    const monthVal = tr.querySelector('[data-field="month"]')?.value || '';
    const dayVal = tr.querySelector('[data-field="day"]')?.value || '';
    const startVal = tr.querySelector('[data-field="start"]')?.value || '';
    const endVal = tr.querySelector('[data-field="end"]')?.value || '';
    const typeVal = tr.querySelector('[data-field="type"]')?.value || 'Final Examination';

    if (!monthVal || !dayVal) {
      status('routineAdminStatus', `Choose both Month and Day for ${tr.dataset.subjectName}.`, true);
      return false;
    }

    const weekday = getBsWeekday(examTableBsYear, Number(monthVal), Number(dayVal)) || null;
    const exam_time = startVal && endVal ? `${startVal} – ${endVal}` : (startVal || null);
    const existingId = tr.dataset.examId ? Number(tr.dataset.examId) : null;

    const payload = {
      semester: examTableSemester,
      subject_name: tr.dataset.subjectName,
      subject_code: tr.dataset.subjectCode || null,
      calendar: 'BS',
      exam_date: `${examTableBsYear}/${monthVal}/${dayVal}`,
      weekday,
      exam_time,
      exam_type: typeVal || null,
      room: tr.dataset.room || null
    };

    const row = await request(`/api/routine${existingId ? `/${existingId}` : ''}`, {
      method: existingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (existingId) {
      routines = routines.map(item => item.id === existingId ? row : item);
    } else {
      routines = [...routines, row];
    }
    return true;
  }

  async function clearSingleExamRow(tr) {
    const existingId = tr.dataset.examId ? Number(tr.dataset.examId) : null;
    if (!existingId) {
      const mSel = tr.querySelector('[data-field="month"]');
      const dSel = tr.querySelector('[data-field="day"]');
      const wdEl = tr.querySelector('[data-field="weekday"]');
      if (mSel) mSel.value = '';
      if (dSel) dSel.value = '';
      if (wdEl) wdEl.textContent = '—';
      return;
    }
    if (busy || !window.confirm(`Remove “${tr.dataset.subjectName}” from the published exam schedule?`)) return;
    setBusy(true);
    status('routineAdminStatus', `Removing ${tr.dataset.subjectName}…`);
    try {
      await request(`/api/routine/${existingId}`, { method: 'DELETE' });
      if (window.SWR) window.SWR.invalidate('/api/routine');
      routines = routines.filter(item => item.id !== existingId);
      renderPublic();
      renderExamTable();
      status('routineAdminStatus', `Removed ${tr.dataset.subjectName}.`);
    } catch (err) {
      status('routineAdminStatus', err.message, true);
    } finally {
      setBusy(false);
    }
  }

  function renderExamTable() {
    if (!isAdmin) return;
    const body = byId('routineAdminRows');
    if (!body) return;

    const semSel = byId('examTableSemester');
    if (semSel) semSel.value = String(examTableSemester);
    const yearSel = byId('examTableBsYear');
    if (yearSel) yearSel.value = String(examTableBsYear);

    const semesterSubjects = getSubjectsForSemester(examTableSemester);
    const semExams = routines.filter(r => Number(r.semester) === examTableSemester);

    // Match existing exams to syllabus subjects, and append any extra exams not in syllabus
    const matchedIds = new Set();
    const tableRows = semesterSubjects.map(sub => {
      const existing = semExams.find(
        r => r.subject_name && r.subject_name.toLowerCase() === sub.value.toLowerCase()
      ) || null;
      if (existing) matchedIds.add(existing.id);
      return {
        subjectName: sub.value,
        subjectCode: existing?.subject_code || sub.code || '',
        existing
      };
    });
    for (const extra of semExams) {
      if (!matchedIds.has(extra.id)) {
        tableRows.push({
          subjectName: extra.subject_name,
          subjectCode: extra.subject_code || '',
          existing: extra
        });
      }
    }

    if (!tableRows.length) {
      const tr = el('tr');
      const td = el('td', 'routine-empty', 'No subjects found for this semester.');
      td.colSpan = 8;
      tr.append(td);
      body.replaceChildren(tr);
      return;
    }

    const monthItems = (routineOptions.bsMonths || BS_MONTHS_DEFAULT).map(m => ({
      value: m.value,
      label: m.name
    }));
    const examTypeItems = EXAM_TYPES_CLEAN;

    body.replaceChildren(...tableRows.map(item => {
      const tr = el('tr');
      tr.dataset.subjectName = item.subjectName;
      tr.dataset.subjectCode = item.subjectCode;
      if (item.existing) {
        tr.dataset.examId = String(item.existing.id);
        if (item.existing.room) tr.dataset.room = item.existing.room;
      }

      // Parse existing BS month/day if present
      let initMonth = '';
      let initDay = '';
      if (item.existing?.exam_date) {
        const parsed = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(String(item.existing.exam_date).trim());
        if (parsed) {
          initMonth = parsed[2].padStart(2, '0');
          initDay = parsed[3].padStart(2, '0');
        }
      }
      const timeParts = item.existing?.exam_time
        ? parseExamTimeParts(item.existing.exam_time)
        : { start: '11:30 AM', end: '2:30 PM' };
      const initType = item.existing?.exam_type || 'Final Examination';

      // 1. Subject
      const subjTd = el('td');
      subjTd.append(el('strong', '', item.subjectName));
      if (item.subjectCode) subjTd.append(el('small', '', item.subjectCode));

      // 2. Month (BS)
      const monthTd = el('td');
      const monthSel = makeSelectWithValue(monthItems, 'Month', initMonth, 'exam-cell-select', `Month for ${item.subjectName}`);
      monthSel.dataset.field = 'month';
      monthTd.append(monthSel);

      // 3. Day (BS)
      const dayTd = el('td');
      const daySel = document.createElement('select');
      daySel.className = 'exam-cell-select exam-cell-select-day';
      daySel.dataset.field = 'day';
      daySel.setAttribute('aria-label', `Day for ${item.subjectName}`);
      populateDaySelectForMonth(daySel, examTableBsYear, initMonth, initDay);
      dayTd.append(daySel);

      // 4. Weekday (Auto-calculated from BS Year + Month + Day)
      const wdTd = el('td');
      const initWd = initMonth && initDay
        ? (getBsWeekday(examTableBsYear, Number(initMonth), Number(initDay)) || item.existing?.weekday || '—')
        : '—';
      const wdPill = el('span', 'exam-weekday-pill', initWd);
      wdPill.dataset.field = 'weekday';
      wdTd.append(wdPill);

      const updateRowWeekday = () => {
        const m = monthSel.value;
        const d = daySel.value;
        wdPill.textContent = m && d ? (getBsWeekday(examTableBsYear, Number(m), Number(d)) || '—') : '—';
      };

      monthSel.addEventListener('change', () => {
        const prevDay = daySel.value;
        populateDaySelectForMonth(daySel, examTableBsYear, monthSel.value, prevDay);
        updateRowWeekday();
      });
      daySel.addEventListener('change', updateRowWeekday);

      // 5. Start Time
      const startTd = el('td');
      const startSel = makeSelectWithValue(NPT_TIME_POINTS, 'Start', timeParts.start, 'exam-cell-select', `Start time for ${item.subjectName}`);
      startSel.dataset.field = 'start';
      startTd.append(startSel);

      // 6. End Time
      const endTd = el('td');
      const endSel = makeSelectWithValue(NPT_TIME_POINTS, 'End', timeParts.end, 'exam-cell-select', `End time for ${item.subjectName}`);
      endSel.dataset.field = 'end';
      endTd.append(endSel);

      // 7. Exam Type
      const typeTd = el('td');
      const typeSel = makeSelectWithValue(examTypeItems, 'Exam Type', initType, 'exam-cell-select', `Exam type for ${item.subjectName}`);
      typeSel.dataset.field = 'type';
      typeTd.append(typeSel);

      // 8. Actions (Save / Clear)
      const actTd = el('td');
      const group = el('div', 'routine-row-actions');
      const saveBtn = el('button', 'routine-btn routine-btn-primary', item.existing ? 'Update' : 'Save');
      saveBtn.type = 'button';
      saveBtn.addEventListener('click', async () => {
        setBusy(true);
        status('routineAdminStatus', `Saving ${item.subjectName}…`);
        try {
          const ok = await saveSingleExamRow(tr);
          if (ok) {
            if (window.SWR) window.SWR.invalidate('/api/routine');
            renderPublic();
            renderExamTable();
            status('routineAdminStatus', `Saved ${item.subjectName}.`);
          }
        } catch (err) {
          status('routineAdminStatus', err.message, true);
        } finally {
          setBusy(false);
        }
      });
      group.append(saveBtn);

      if (item.existing) {
        const clearBtn = el('button', 'routine-btn routine-btn-delete', 'Clear');
        clearBtn.type = 'button';
        clearBtn.addEventListener('click', () => clearSingleExamRow(tr));
        group.append(clearBtn);
      }
      actTd.append(group);

      tr.append(subjTd, monthTd, dayTd, wdTd, startTd, endTd, typeTd, actTd);
      return tr;
    }));
  }

  async function saveAllExamRows() {
    if (busy || !isAdmin) return;
    const body = byId('routineAdminRows');
    if (!body) return;
    const rows = [...body.querySelectorAll('tr[data-subject-name]')];
    const readyRows = rows.filter(tr => {
      const m = tr.querySelector('[data-field="month"]')?.value;
      const d = tr.querySelector('[data-field="day"]')?.value;
      return Boolean(m && d);
    });
    if (!readyRows.length) {
      status('routineAdminStatus', 'Select Month and Day for at least one subject before saving.', true);
      return;
    }

    setBusy(true);
    status('routineAdminStatus', `Saving ${readyRows.length} subject${readyRows.length > 1 ? 's' : ''}…`);
    let savedCount = 0;
    try {
      for (const tr of readyRows) {
        const ok = await saveSingleExamRow(tr);
        if (ok) savedCount += 1;
      }
      if (window.SWR) window.SWR.invalidate('/api/routine');
      renderPublic();
      renderExamTable();
      status('routineAdminStatus', `Saved ${savedCount} exam${savedCount > 1 ? 's' : ''} for Semester ${romans[examTableSemester - 1]}.`);
    } catch (err) {
      status('routineAdminStatus', err.message, true);
    } finally {
      setBusy(false);
    }
  }

  // ==========================================================================
  // ADMIN CLASS PERIOD EDITOR MODAL & NEW CLASS ROUTINE MODAL
  // ==========================================================================

  function renderClassTypeChips() {
    const wrap = byId('classTypeChips');
    if (!wrap) return;
    const types = routineOptions.classTypes || ['Theory', 'Practical', 'Lab', 'Break', 'Empty'];
    wrap.replaceChildren(...types.map(t => {
      const chip = el('button', `routine-chip-btn${classEditSelectedType === t ? ' active' : ''}`, t);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        classEditSelectedType = t;
        renderClassTypeChips();
        syncClassEditorFieldVisibility();
      });
      return chip;
    }));
  }

  function renderFacultyTypeChips() {
    const wrap = byId('classFacultyTypeChips');
    if (!wrap) return;
    const types = routineOptions.facultyTypes || DEFAULT_OPTIONS.facultyTypes;
    wrap.replaceChildren(...types.map(t => {
      const chip = el('button', `routine-chip-btn${classEditSelectedFacultyType === t.value ? ' active' : ''}`, t.label);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        classEditSelectedFacultyType = t.value;
        renderFacultyTypeChips();
      });
      return chip;
    }));
  }

  function syncClassEditorFieldVisibility() {
    const hideDetails = classEditSelectedType === 'Break' || classEditSelectedType === 'Empty';
    if (byId('classEditSubjectWrap')) byId('classEditSubjectWrap').hidden = hideDetails;
    if (byId('classEditFacultyWrap')) byId('classEditFacultyWrap').hidden = hideDetails;
    if (byId('classEditFacultyTypeWrap')) byId('classEditFacultyTypeWrap').hidden = hideDetails;
  }

  function hydrateClassEditorForCell(day, slotId) {
    if (!classRoutine) return;
    const entry = (classRoutine.entries || []).find(
      e => e.day_of_week === day && Number(e.slot_id) === Number(slotId)
    ) || null;
    classEditExistingEntryId = entry ? entry.id : null;
    classEditSelectedType = entry ? (entry.is_empty ? 'Empty' : (entry.class_type || 'Theory')) : 'Theory';
    classEditSelectedFacultyType = entry?.faculty_type || 'FT';

    const clearBtn = byId('classEditorClearBtn');
    if (clearBtn) clearBtn.hidden = !entry;

    const subjSel = byId('classEditSubjectSelect');
    const subjCustom = byId('classEditSubjectCustom');
    const subjects = getSubjectsForSemester(classRoutine.semester);
    populateSelectOptions(subjSel, subjects, {
      placeholder: 'Choose subject…',
      includeCustom: true,
      customLabel: '+ Other / Custom subject…'
    });
    if (entry?.subject_name) {
      const match = subjects.find(s => s.value.toLowerCase() === entry.subject_name.toLowerCase());
      if (match) {
        subjSel.value = match.value;
        subjCustom.hidden = true;
        subjCustom.value = match.value;
      } else {
        subjSel.value = '__custom__';
        subjCustom.hidden = false;
        subjCustom.value = entry.subject_name;
      }
    } else {
      subjSel.value = '';
      subjCustom.hidden = true;
      subjCustom.value = '';
    }

    const facSel = byId('classEditFacultySelect');
    const facCustom = byId('classEditFacultyCustom');
    const teachers = routineOptions.teachers || [];
    populateSelectOptions(facSel, teachers, {
      placeholder: 'Choose teacher (optional)',
      includeCustom: true,
      customLabel: '+ Other / Custom teacher…'
    });
    if (entry?.faculty_name) {
      const match = teachers.find(t => t.toLowerCase() === entry.faculty_name.toLowerCase());
      if (match) {
        facSel.value = match;
        facCustom.hidden = true;
        facCustom.value = match;
      } else {
        facSel.value = '__custom__';
        facCustom.hidden = false;
        facCustom.value = entry.faculty_name;
      }
    } else {
      facSel.value = '';
      facCustom.hidden = true;
      facCustom.value = '';
    }

    renderClassTypeChips();
    renderFacultyTypeChips();
    syncClassEditorFieldVisibility();
    status('classEditorStatus', '');
  }

  function openClassPeriodEditor(day, slotId, entry) {
    if (!isAdmin || !classRoutine) return;
    closeSubjectModal();
    const modal = byId('classPeriodEditorModal');
    if (!modal) return;

    const slots = (classRoutine.slots || []).filter(s => !s.is_break);
    populateSelectOptions(
      byId('classEditSlot'),
      slots.map(s => ({ value: String(s.id), label: `${formatSlotNptLabel(s)} (${s.duration_minutes}m)` }))
    );

    const targetDay = day && WORKING_DAYS.includes(day) ? day : (selectedMobileDay || 'Monday');
    const targetSlotId = slotId || (slots[0] && slots[0].id);
    if (byId('classEditDay')) byId('classEditDay').value = targetDay;
    if (byId('classEditSlot') && targetSlotId) byId('classEditSlot').value = String(targetSlotId);
    if (byId('classEditorKicker')) {
      byId('classEditorKicker').textContent = `ADMIN · SEMESTER ${romans[classRoutine.semester - 1]} CLASS ROUTINE`;
    }
    if (byId('classEditorTitle')) {
      byId('classEditorTitle').textContent = entry && !entry.is_empty ? 'Edit Class Period' : 'Assign Class Period';
    }

    hydrateClassEditorForCell(targetDay, targetSlotId);
    modal.hidden = false;
  }

  function closeClassPeriodEditor() {
    const modal = byId('classPeriodEditorModal');
    if (modal) modal.hidden = true;
  }

  function openNewClassRoutineModal() {
    if (!isAdmin) return;
    const modal = byId('newClassRoutineModal');
    if (!modal) return;
    const targetSem = selectedSemester !== 'all' ? Number(selectedSemester) : 1;
    if (byId('newRoutineSemester')) byId('newRoutineSemester').value = String(targetSem);
    populateSelectOptions(
      byId('newRoutineSessionSelect'),
      routineOptions.sessionPresets || DEFAULT_OPTIONS.sessionPresets,
      { includeCustom: true, customLabel: '+ Custom BS Session…' }
    );
    if (byId('newRoutineSessionSelect')) byId('newRoutineSessionSelect').value = (routineOptions.sessionPresets || DEFAULT_OPTIONS.sessionPresets)[2] || '2083 BS (Ashwin–Chaitra)';
    if (byId('newRoutineSessionCustom')) {
      byId('newRoutineSessionCustom').hidden = true;
      byId('newRoutineSessionCustom').value = '';
    }
    populateDatePickers(byId('newRoutineBsYear'), byId('newRoutineBsMonth'), byId('newRoutineBsDay'), 'BS', '2083/06/01');
    if (byId('newRoutinePublishNow')) byId('newRoutinePublishNow').checked = true;
    status('newClassRoutineStatus', '');
    modal.hidden = false;
  }

  function closeNewClassRoutineModal() {
    const modal = byId('newClassRoutineModal');
    if (modal) modal.hidden = true;
  }

  // ==========================================================================
  // PUBLIC EXAM SCHEDULE & FILTERS
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
        if (value !== 'all') examTableSemester = Number(value);
        const url = new URL(location.href);
        if (value === 'all') url.searchParams.delete('semester');
        else url.searchParams.set('semester', value);
        history.pushState({}, '', url);
        renderFilters();
        if (viewMode === 'class') loadClassRoutine();
        else {
          renderPublic();
          renderExamTable();
        }
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
      dateBox.append(el('span', 'date-month', date ? formatBsMonthLabel(row.exam_date, row.calendar) : 'Date to confirm'));
      dateBox.append(el('span', 'date-weekday', row.weekday || row.calendar || 'BS'));
      const details = el('div', 'exam-details');
      details.append(el('span', 'semester-tag', `Semester ${romans[row.semester - 1]}${row.subject_code ? ` · ${row.subject_code}` : ''}`));
      details.append(el('h2', '', row.subject_name));
      const meta = [row.exam_type, row.weekday, row.room ? `Room ${row.room}` : ''].filter(Boolean).join(' · ');
      if (meta) details.append(el('p', '', meta));
      article.append(dateBox, details, el('div', 'exam-time', row.exam_time || 'Time to be announced'));
      return article;
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
              renderExamTable();
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
      renderExamTable();
    } catch (err) { showPublicError(err.message); }
    finally { schedule.removeAttribute('aria-busy'); }
  }

  async function loadRoutineOptions() {
    try {
      const opts = await request('/api/routine/options');
      if (opts && typeof opts === 'object') {
        routineOptions = { ...DEFAULT_OPTIONS, ...opts };
      }
    } catch (_) {
      routineOptions = DEFAULT_OPTIONS;
    }
  }

  async function checkAdminAccess() {
    try {
      const profile = await request('/api/profile');
      if (profile.role !== 'admin') return;
      isAdmin = true;
      if (byId('routineAdminLink')) byId('routineAdminLink').hidden = false;
      syncAdminQuickActions();
      setBusy(true);
      const [rows] = await Promise.all([
        request('/api/routine/admin'),
        loadRoutineOptions()
      ]);
      if (!Array.isArray(rows)) throw new Error('Could not load the admin list.');
      routines = rows;
      renderClassRoutine();
      renderPublic();
      renderExamTable();
      if (byId('routineAdminRetry')) byId('routineAdminRetry').hidden = true;
      status('routineAdminStatus', '');
    } catch (err) {
      if (isAdmin) {
        status('routineAdminStatus', err.message, true);
        if (byId('routineAdminRetry')) byId('routineAdminRetry').hidden = false;
      }
    } finally { setBusy(false); }
  }

  // Wire Exam Table Toolbar Events
  byId('examTableSemester')?.addEventListener('change', e => {
    examTableSemester = Number(e.target.value) || 1;
    status('routineAdminStatus', '');
    renderExamTable();
  });

  byId('examTableBsYear')?.addEventListener('change', e => {
    examTableBsYear = Number(e.target.value) || 2083;
    renderExamTable();
  });

  byId('examTableSaveAllBtn')?.addEventListener('click', saveAllExamRows);

  // Wire Class Period Editor Modal Events
  byId('classEditDay')?.addEventListener('change', () => {
    hydrateClassEditorForCell(byId('classEditDay').value, Number(byId('classEditSlot').value));
  });
  byId('classEditSlot')?.addEventListener('change', () => {
    hydrateClassEditorForCell(byId('classEditDay').value, Number(byId('classEditSlot').value));
  });
  byId('classEditSubjectSelect')?.addEventListener('change', e => {
    const custom = byId('classEditSubjectCustom');
    if (!custom) return;
    if (e.target.value === '__custom__') {
      custom.hidden = false;
      custom.value = '';
      custom.focus();
    } else {
      custom.hidden = true;
      custom.value = e.target.value;
    }
  });
  byId('classEditFacultySelect')?.addEventListener('change', e => {
    const custom = byId('classEditFacultyCustom');
    if (!custom) return;
    if (e.target.value === '__custom__') {
      custom.hidden = false;
      custom.value = '';
      custom.focus();
    } else {
      custom.hidden = true;
      custom.value = e.target.value;
    }
  });

  byId('classPeriodForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!isAdmin || !classRoutine) return;
    const day_of_week = byId('classEditDay').value;
    const slot_id = Number(byId('classEditSlot').value);
    const isEmpty = classEditSelectedType === 'Empty';
    const isBreak = classEditSelectedType === 'Break';

    const subjSel = byId('classEditSubjectSelect');
    const subject_name = isEmpty
      ? null
      : isBreak
        ? 'Break'
        : (subjSel.value === '__custom__' ? byId('classEditSubjectCustom').value.trim() : subjSel.value.trim());

    if (!isEmpty && !isBreak && !subject_name) {
      status('classEditorStatus', 'Please choose a subject.', true);
      return;
    }

    const facSel = byId('classEditFacultySelect');
    const faculty_name = isEmpty || isBreak
      ? null
      : (facSel.value === '__custom__' ? byId('classEditFacultyCustom').value.trim() : facSel.value.trim()) || null;

    const saveBtn = byId('classEditorSaveBtn');
    if (saveBtn) saveBtn.disabled = true;
    status('classEditorStatus', 'Saving period…');
    try {
      const data = await request(`/api/routine/class/admin/${classRoutine.id}/entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          day_of_week,
          slot_id,
          subject_name,
          faculty_name,
          faculty_type: isEmpty || isBreak ? null : (classEditSelectedFacultyType || null),
          class_type: classEditSelectedType,
          is_empty: isEmpty
        })
      });
      if (data.routine) classRoutine = data.routine;
      if (window.SWR) window.SWR.invalidate('/api/routine');
      renderClassRoutine();
      closeClassPeriodEditor();
    } catch (err) {
      status('classEditorStatus', err.message, true);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

  byId('classEditorClearBtn')?.addEventListener('click', async () => {
    if (!isAdmin || !classRoutine || !classEditExistingEntryId) return;
    const clearBtn = byId('classEditorClearBtn');
    if (clearBtn) clearBtn.disabled = true;
    status('classEditorStatus', 'Clearing period…');
    try {
      const data = await request(`/api/routine/class/admin/${classRoutine.id}/entries/${classEditExistingEntryId}`, {
        method: 'DELETE'
      });
      if (data.routine) classRoutine = data.routine;
      if (window.SWR) window.SWR.invalidate('/api/routine');
      renderClassRoutine();
      closeClassPeriodEditor();
    } catch (err) {
      status('classEditorStatus', err.message, true);
    } finally {
      if (clearBtn) clearBtn.disabled = false;
    }
  });

  // Wire New Class Routine Modal Events
  byId('newRoutineSessionSelect')?.addEventListener('change', e => {
    const custom = byId('newRoutineSessionCustom');
    if (!custom) return;
    if (e.target.value === '__custom__') {
      custom.hidden = false;
      custom.value = '';
      custom.focus();
    } else {
      custom.hidden = true;
      custom.value = e.target.value;
    }
  });

  byId('newClassRoutineForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!isAdmin) return;
    const semester = Number(byId('newRoutineSemester').value);
    const sesSel = byId('newRoutineSessionSelect');
    const academic_session = sesSel.value === '__custom__'
      ? byId('newRoutineSessionCustom').value.trim()
      : sesSel.value.trim();
    if (!academic_session) {
      status('newClassRoutineStatus', 'Please choose an academic session.', true);
      return;
    }
    const y = byId('newRoutineBsYear').value;
    const m = byId('newRoutineBsMonth').value;
    const d = byId('newRoutineBsDay').value;
    const effective_date = y && m && d ? `${y}/${m}/${d} BS` : null;
    const publishNow = Boolean(byId('newRoutinePublishNow')?.checked);

    const saveBtn = byId('newClassRoutineSaveBtn');
    if (saveBtn) saveBtn.disabled = true;
    status('newClassRoutineStatus', 'Creating class routine…');
    try {
      const created = await request('/api/routine/class/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          semester,
          academic_session,
          effective_date,
          status: publishNow ? 'published' : 'draft'
        })
      });
      if (publishNow && created.routine?.id) {
        await request(`/api/routine/class/admin/${created.routine.id}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ replaceExisting: true })
        });
      }
      if (window.SWR) window.SWR.invalidate('/api/routine');
      selectedSemester = semester;
      closeNewClassRoutineModal();
      renderFilters();
      await loadClassRoutine();
    } catch (err) {
      status('newClassRoutineStatus', err.message, true);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

  byId('modeClassBtn')?.addEventListener('click', () => setMode('class'));
  byId('modeExamBtn')?.addEventListener('click', () => setMode('exam'));
  byId('modalSubjectClose')?.addEventListener('click', closeSubjectModal);
  byId('modalEditClassBtn')?.addEventListener('click', () => {
    if (currentModalContext?.entry && currentModalContext?.slot) {
      openClassPeriodEditor(currentModalContext.entry.day_of_week, currentModalContext.slot.id, currentModalContext.entry);
    }
  });
  byId('subjectDetailModal')?.addEventListener('click', e => {
    if (e.target === byId('subjectDetailModal')) closeSubjectModal();
  });

  byId('quickEditClassPeriodBtn')?.addEventListener('click', () => openClassPeriodEditor(selectedMobileDay || 'Monday', null, null));
  byId('quickNewClassRoutineBtn')?.addEventListener('click', () => openNewClassRoutineModal());
  byId('quickAddExamBtn')?.addEventListener('click', () => {
    adminPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  byId('classEditorClose')?.addEventListener('click', closeClassPeriodEditor);
  byId('classEditorCancelBtn')?.addEventListener('click', closeClassPeriodEditor);
  byId('classPeriodEditorModal')?.addEventListener('click', e => {
    if (e.target === byId('classPeriodEditorModal')) closeClassPeriodEditor();
  });

  byId('newClassRoutineClose')?.addEventListener('click', closeNewClassRoutineModal);
  byId('newClassRoutineCancelBtn')?.addEventListener('click', closeNewClassRoutineModal);
  byId('newClassRoutineModal')?.addEventListener('click', e => {
    if (e.target === byId('newClassRoutineModal')) closeNewClassRoutineModal();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeSubjectModal();
      closeClassPeriodEditor();
      closeNewClassRoutineModal();
    }
  });

  byId('routineAdminRetry')?.addEventListener('click', checkAdminAccess);
  window.addEventListener('popstate', () => {
    selectedSemester = parseSemester(new URLSearchParams(location.search).get('semester'));
    if (selectedSemester !== 'all') examTableSemester = Number(selectedSemester);
    renderFilters();
    if (viewMode === 'class') loadClassRoutine();
    else {
      renderPublic();
      renderExamTable();
    }
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
    findCurrentOrUpcoming,
    getBsDaysInMonth,
    getBsWeekday
  };

  initRoutinePage();
})();
