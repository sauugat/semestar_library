const scheduleContainer = document.getElementById('scheduleContainer');
const semesterButtons = document.querySelectorAll('.semester-btn');
let allRoutines = [];

async function loadRoutines() {
  try {
    const res = await fetch('/api/routine');
    allRoutines = await res.json();
    
    // Auto-filter from URL or default to first active button
    const params = new URLSearchParams(window.location.search);
    const sem = params.get('semester');
    
    if (sem) {
      const targetBtn = Array.from(semesterButtons).find(btn => btn.dataset.semester === sem);
      if (targetBtn) {
        updateActiveButton(targetBtn);
        renderRoutines(sem);
      } else {
        renderRoutines('II'); // default
      }
    } else {
      renderRoutines('II'); // default
    }
    
    checkAdminAccess();
  } catch(e) {
    if (scheduleContainer) {
      scheduleContainer.innerHTML = '<p style="padding: 2rem; text-align: center; color: var(--text-secondary);">Failed to load routine data.</p>';
    }
  }
}

function updateActiveButton(activeBtn) {
  semesterButtons.forEach(btn => btn.classList.remove("active"));
  if (activeBtn) activeBtn.classList.add("active");
}

function renderRoutines(semesterFilter) {
  if (!scheduleContainer) return;
  const filtered = semesterFilter === 'all' 
    ? allRoutines 
    : allRoutines.filter(r => r.semester === semesterFilter);
    
  if (filtered.length === 0) {
    scheduleContainer.innerHTML = `<p style="padding: 2rem; text-align: center; color: var(--text-secondary);">No exams scheduled for Semester ${semesterFilter}.</p>`;
    return;
  }
  
  let html = '';
  filtered.forEach(r => {
    // try to parse day and month (supporting both PostgreSQL examdate and camelCase examDate)
    const dateStr = r.examdate || r.examDate || '';
    let day = '??';
    let monthYear = '?? / ????';
    
    if (dateStr) {
      const parts = dateStr.split('/'); // expecting YYYY/MM/DD
      const dashParts = dateStr.split('-');
      
      if (parts.length === 3) {
        day = parts[2];
        monthYear = `${parts[1]} / ${parts[0]}`;
      } else if (dashParts.length === 3) {
        day = dashParts[2];
        monthYear = `${dashParts[1]} / ${dashParts[0]}`;
      } else {
        const d = new Date(dateStr);
        day = isNaN(d.getDate()) ? '??' : String(d.getDate()).padStart(2, '0');
        monthYear = dateStr; // fallback
      }
    }
    
    const subtext = r.time && r.day ? `${r.time} · ${r.day}` : (r.time || r.day || '');
    
    html += `
      <article class="exam-row" data-semester="${r.semester}">
        <div class="exam-date">
          <span class="date-day">${day}</span>
          <span class="date-month">${monthYear}</span>
        </div>
        <div class="exam-details">
          <span class="semester-tag">Semester ${r.semester}</span>
          <h2>${r.subject}</h2>
          <p>${subtext}</p>
        </div>
      </article>
    `;
  });
  
  scheduleContainer.innerHTML = html;
}

semesterButtons.forEach(button => {
  button.addEventListener("click", () => {
    const selectedSemester = button.dataset.semester;
    updateActiveButton(button);
    renderRoutines(selectedSemester);
    
    // update URL
    const url = new URL(window.location);
    url.searchParams.set('semester', selectedSemester);
    window.history.pushState({}, '', url);
  });
});

async function checkAdminAccess() {
  try {
    const res = await fetch('/api/profile');
    if (res.ok) {
      const p = await res.json();
      if (p.role === 'admin') {
        const adminContainer = document.getElementById('adminRoutineFormContainer');
        if (adminContainer) adminContainer.style.display = 'block';
      }
    }
  } catch(e) {}
}

const adminForm = document.getElementById('adminRoutineForm');
if (adminForm) {
  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = adminForm.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Adding...';
    
    try {
      const res = await fetch('/api/routine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: document.getElementById('addRoutineSubject').value,
          examDate: document.getElementById('addRoutineDate').value,
          time: document.getElementById('addRoutineTime').value,
          semester: document.getElementById('addRoutineSemester').value,
          type: document.getElementById('addRoutineType').value,
        })
      });
      if (res.ok) {
        adminForm.reset();
        await loadRoutines(); // reload list
      } else {
        const d = await res.json();
        alert(d.error || 'Failed to add exam');
      }
    } catch(err) {
      alert('Network error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Add to Routine';
    }
  });
}

loadRoutines();