/**
 * Semester Library — Syllabus & Curriculum Extraction Helper
 * Extracts Semesters, Subjects, and Chapters/Units from syllabus-data.json
 */
(function(window) {
  let _syllabusCache = null;

  async function loadSyllabusData() {
    if (_syllabusCache) return _syllabusCache;
    try {
      const res = await fetch('syllabus-data.json');
      if (!res.ok) throw new Error('Failed to load syllabus-data.json');
      _syllabusCache = await res.json();
      return _syllabusCache;
    } catch (err) {
      console.error('Error loading syllabus data:', err);
      return { semesters: [], electives: [], clusters: [] };
    }
  }

  function parseCourseUnits(rawContents) {
    if (!rawContents) return [];
    const lines = rawContents.split('\n');
    const units = [];
    let currentUnit = null;

    for (let line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Stop if bibliography / textbooks header reached
      if (/^(?:Text\s*books?|Reference\s*books?|References?|Suggested\s*Readings?|Recommended\s*Books?):/i.test(trimmed)) {
        break;
      }

      // Unit match regex like "1. Introduction  5 hrs" or "Unit 1: Introduction"
      const unitMatch = trimmed.match(/^(?:Unit\s*)?(\d+)[\.\:]\s+([A-Za-z].*?)(?:\s+[\(\[]?(\d+\s*hrs?|\d+\s*hours?)[\)\]]?)?$/i);
      const isSubtopic = /^\d+\.\d+/.test(trimmed);

      if (unitMatch && !isSubtopic) {
        if (currentUnit) units.push(currentUnit);
        currentUnit = {
          num: unitMatch[1],
          title: unitMatch[2].replace(/\s+\d+\s*(?:hrs?|hours?)$/i, '').replace(/[\(\[\)\]]/g, '').trim(),
          hrs: unitMatch[3] || '',
          topics: []
        };
      } else if (currentUnit) {
        currentUnit.topics.push(trimmed);
      } else {
        if (!currentUnit) {
          currentUnit = { num: '1', title: 'Curriculum Contents', hrs: '', topics: [trimmed] };
        }
      }
    }
    if (currentUnit) units.push(currentUnit);

    return units.map(u => ({
      ...u,
      displayName: `Unit ${u.num}: ${u.title}${u.hrs ? ` (${u.hrs})` : ''}`
    }));
  }

  function getFormattedSemesters(data) {
    if (!data || !data.semesters) return [];
    const list = [];

    data.semesters.forEach(s => {
      list.push({
        id: `Sem_${s.semester}`.replace(/\s+/g, '_'),
        rawSemester: s.semester,
        year: s.year,
        semester: s.semester,
        title: `${s.year} &middot; Semester ${s.semester}`,
        shortName: `Semester ${s.semester}`,
        displayPill: `Sem ${s.semester}`,
        fullLabel: `${s.year} — Semester ${s.semester}`,
        courses: s.courses || []
      });
    });

    if (data.electives && data.electives.length > 0) {
      list.push({
        id: 'Electives',
        rawSemester: 'Electives',
        year: 'Electives',
        semester: 'Electives',
        title: 'Electives & Specializations',
        shortName: 'Electives',
        displayPill: 'Electives',
        fullLabel: 'Electives (Specialization Tracks)',
        courses: data.electives
      });
    }

    return list;
  }

  function findCourse(data, courseTitleOrCode) {
    if (!data) return null;
    const query = String(courseTitleOrCode).toLowerCase().trim().replace(/_/g, ' ');
    
    // Check in semesters
    for (const sem of (data.semesters || [])) {
      for (const c of (sem.courses || [])) {
        const cTitle = c.title.toLowerCase().trim();
        const cCode = c.code ? c.code.toLowerCase().trim() : '';
        const cCombo = `${cCode} ${cTitle}`.trim();
        const cSlug = `${cCode}-${cTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const qSlug = query.replace(/[^a-z0-9]+/g, '-');

        if (cTitle === query || cCode === query || cCombo === query || cSlug === qSlug || cTitle.includes(query)) {
          return { ...c, semester: `Semester ${sem.semester}`, rawSemester: sem.semester, year: sem.year };
        }
      }
    }
    // Check in electives
    for (const c of (data.electives || [])) {
      const cTitle = c.title.toLowerCase().trim();
      const cCode = c.code ? c.code.toLowerCase().trim() : '';
      if (cTitle === query || cCode === query || cTitle.includes(query)) {
        return { ...c, semester: 'Electives', rawSemester: 'Electives', year: 'Electives' };
      }
    }
    return null;
  }

  function getAllCourses(data) {
    if (!data) return [];
    const courses = [];
    (data.semesters || []).forEach(s => {
      (s.courses || []).forEach(c => {
        courses.push({
          ...c,
          year: s.year,
          semester: `Semester ${s.semester}`,
          rawSemester: s.semester,
          semId: `Sem_${s.semester}`
        });
      });
    });
    (data.electives || []).forEach(c => {
      courses.push({
        ...c,
        year: 'Electives',
        semester: 'Electives',
        rawSemester: 'Electives',
        semId: 'Electives'
      });
    });
    return courses;
  }

  function normalizeSemester(val) {
    if (!val) return 'I';
    const str = String(val).trim().toUpperCase();
    if (str === 'ELECTIVES' || str.includes('ELECTIVE')) return 'Electives';
    if (str === 'GENERAL' || str.includes('GENERAL')) return 'General';
    
    if (str === 'VIII' || str.includes('VIII') || str === '8' || str.includes(' 8') || str.endsWith('_8') || str.endsWith('-8')) return 'VIII';
    if (str === 'VII' || str.includes('VII') || str === '7' || str.includes(' 7') || str.endsWith('_7') || str.endsWith('-7')) return 'VII';
    if (str === 'VI' || str.includes('VI') || str === '6' || str.includes(' 6') || str.endsWith('_6') || str.endsWith('-6')) return 'VI';
    if (str === 'IV' || str.includes('IV') || str === '4' || str.includes(' 4') || str.endsWith('_4') || str.endsWith('-4')) return 'IV';
    if (str === 'V' || str.includes('V') || str === '5' || str.includes(' 5') || str.endsWith('_5') || str.endsWith('-5')) return 'V';
    if (str === 'III' || str.includes('III') || str === '3' || str.includes(' 3') || str.endsWith('_3') || str.endsWith('-3')) return 'III';
    if (str === 'II' || str.includes('II') || str === '2' || str.includes(' 2') || str.endsWith('_2') || str.endsWith('-2')) return 'II';
    if (str === 'I' || str.includes('I') || str === '1' || str.includes(' 1') || str.endsWith('_1') || str.endsWith('-1')) return 'I';
    
    return val;
  }

  window.SyllabusHelper = {
    loadSyllabusData,
    parseCourseUnits,
    getFormattedSemesters,
    findCourse,
    getAllCourses,
    normalizeSemester
  };
})(window);
