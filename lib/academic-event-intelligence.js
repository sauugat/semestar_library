'use strict';

/**
 * Academic Event Intelligence Module for Kyana AI.
 * 
 * Extracts, classifies, resolves, and verifies academic events:
 * - Class resumptions
 * - Examination schedules
 * - Holidays and vacations
 * - Assignment deadlines
 * - Semester schedules
 * 
 * Evaluates authority tiers, chronological supersession, and conflict detection.
 */

const {
  bsToAd,
  adToBs,
  calculateDaysRemaining,
  calculateDaysBetween,
  getTemporalContext,
  formatNepalDate,
  toDevanagariDigits
} = require('./temporal-intelligence');

const EVENT_TYPES = {
  CLASS_RESUMPTION: 'class_resumption',
  PROJECT_DEFENSE: 'project_defense',
  EXAMINATION: 'examination',
  HOLIDAY: 'holiday',
  ASSIGNMENT_DEADLINE: 'assignment_deadline',
  SEMESTER_SCHEDULE: 'semester_schedule',
  ACADEMIC_EVENT: 'academic_event'
};

const AUTHORITY_TIERS = {
  COLLEGE_OFFICIAL: 1, // College administration, campus notice board
  TEACHER: 2,          // Faculty announcements, course assignments
  CR: 3,               // Class Representative messages
  STUDENT: 4           // General student peer posts
};

/**
 * Regex patterns for event classification
 */
const PATTERNS = {
  PROJECT_DEFENSE: /\b(defense|defence|defenses|defences|presentation|proposal|viva|viva-voce|डिफेन्स|प्रस्तुतीकरण)\b/i,
  CLASS_RESUMPTION: /\b(resume|resumption|reopen|reopening|re-opening|regular classes|bida paxi|bida pachi|punahsanchalan|khulne|khulcha|khulxa|khulchha|सञ्चालन|पुनः सञ्चालन|खुल्ने|कक्षा सञ्चालन|classes? (?:will )?resume|college reopens?|classes? start(?:ing)?)\b/i,
  EXAMINATION: /\b(exam|exams|examination|examinations|midterm|mid-term|terminal|assessment|finals|board exam|practical|परीक्षा|प्रयोगात्मक)\b/i,
  HOLIDAY: /\b(holiday|holidays|vacation|vacations|break|tihar|dashain|chhath|bida|vida|chutti|chhuti|बिदा|बन्द)\b/i,
  ASSIGNMENT_DEADLINE: /\b(assignment|assignments|homework|deadline|deadlines|submission|due date|bujhaune antim miti|अन्तिम मिति)\b/i,
  SEMESTER_SCHEDULE: /\b(routine|schedule|timetable|orientation|registration|admission|कार्यतालिका|तालिका)\b/i
};

/**
 * Identifies the primary event type from text.
 * @param {string} text
 * @returns {string|null}
 */
function classifyEventType(text) {
  if (!text || typeof text !== 'string') return null;
  if (PATTERNS.PROJECT_DEFENSE.test(text)) return EVENT_TYPES.PROJECT_DEFENSE;
  if (PATTERNS.CLASS_RESUMPTION.test(text)) return EVENT_TYPES.CLASS_RESUMPTION;
  if (PATTERNS.ASSIGNMENT_DEADLINE.test(text)) return EVENT_TYPES.ASSIGNMENT_DEADLINE;
  if (PATTERNS.EXAMINATION.test(text)) return EVENT_TYPES.EXAMINATION;
  if (PATTERNS.HOLIDAY.test(text)) return EVENT_TYPES.HOLIDAY;
  if (PATTERNS.SEMESTER_SCHEDULE.test(text)) return EVENT_TYPES.SEMESTER_SCHEDULE;
  return EVENT_TYPES.ACADEMIC_EVENT;
}

/**
 * Detects if a user query targets a specific academic event type.
 * @param {string} query
 * @returns {string|null}
 */
function detectRequestedEventType(query) {
  if (!query || typeof query !== 'string') return null;
  if (PATTERNS.PROJECT_DEFENSE.test(query)) return EVENT_TYPES.PROJECT_DEFENSE;
  if (PATTERNS.CLASS_RESUMPTION.test(query)) return EVENT_TYPES.CLASS_RESUMPTION;
  if (PATTERNS.EXAMINATION.test(query)) return EVENT_TYPES.EXAMINATION;
  if (PATTERNS.ASSIGNMENT_DEADLINE.test(query)) return EVENT_TYPES.ASSIGNMENT_DEADLINE;
  if (PATTERNS.HOLIDAY.test(query)) return EVENT_TYPES.HOLIDAY;
  if (PATTERNS.SEMESTER_SCHEDULE.test(query)) return EVENT_TYPES.SEMESTER_SCHEDULE;
  return null;
}

/**
 * Normalizes Devanagari digits to standard English ASCII digits.
 * @param {string} str
 * @returns {string}
 */
function toAsciiDigits(str) {
  if (!str) return '';
  return String(str).replace(/[०-९]/g, d => '०१२३४५६७८९'.indexOf(d));
}

/**
 * Extracts a candidate event date (in both BS and AD) from record text.
 * Handles:
 * - Numeric dates with slash, dot, or hyphen (e.g. "2083/08/07", "2083-08-07", "२०८३/०८/०७")
 * - Nepali BS named dates (e.g. "30 Kartik 2083", "कार्तिक ३०", "Kartik 30, 2083")
 * - Gregorian AD named dates (e.g. "November 23, 2026", "23 Nov 2026")
 * 
 * @param {string} text
 * @param {object} temporalContext
 * @returns {{ eventDateAd: string, eventDateBs: string, eventDateBsFormatted: string, rawMatched: string }|null}
 */
function extractDateFromText(text, temporalContext) {
  if (!text || typeof text !== 'string') return null;
  const refBsYear = temporalContext?.bsYear || 2083;
  const refAdYear = temporalContext?.adYear || 2026;

  // 1. Check numeric slash/hyphen/dot dates: e.g. "2083/08/07", "2083-08-07", "2026-11-23", "२०८३/०८/०७"
  // Normalize Devanagari digits first
  const normalizedText = toAsciiDigits(text);

  // Pattern 1A: YYYY/MM/DD or YYYY-MM-DD or YYYY.MM.DD
  const ymdMatch = normalizedText.match(/\b(20\d{2})[/. -](0?[1-9]|1[0-2])[/. -](0?[1-9]|[12]\d|3[0-2])\b/);
  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const month = Number(ymdMatch[2]);
    const day = Number(ymdMatch[3]);
    const rawMatched = ymdMatch[0];

    // If year is in Bikram Sambat range (2070 - 2095)
    if (year >= 2070 && year <= 2095) {
      try {
        const eventDateAd = bsToAd(year, month, day);
        const bsObj = adToBs(eventDateAd);
        return {
          eventDateAd,
          eventDateBs: bsObj.dateStr,
          eventDateBsFormatted: bsObj.formattedEn,
          rawMatched
        };
      } catch {
        // Fall through to next checks
      }
    } else if (year >= 2013 && year <= 2040) {
      // Gregorian AD
      try {
        const eventDateAd = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const bsObj = adToBs(eventDateAd);
        return {
          eventDateAd,
          eventDateBs: bsObj.dateStr,
          eventDateBsFormatted: bsObj.formattedEn,
          rawMatched
        };
      } catch {
        // Fall through
      }
    }
  }

  // Pattern 1B: DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmyMatch = normalizedText.match(/\b(0?[1-9]|[12]\d|3[0-2])[/. -](0?[1-9]|1[0-2])[/. -](20\d{2})\b/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    const year = Number(dmyMatch[3]);
    const rawMatched = dmyMatch[0];

    if (year >= 2070 && year <= 2095) {
      try {
        const eventDateAd = bsToAd(year, month, day);
        const bsObj = adToBs(eventDateAd);
        return {
          eventDateAd,
          eventDateBs: bsObj.dateStr,
          eventDateBsFormatted: bsObj.formattedEn,
          rawMatched
        };
      } catch {
        // Fall through
      }
    } else if (year >= 2013 && year <= 2040) {
      try {
        const eventDateAd = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const bsObj = adToBs(eventDateAd);
        return {
          eventDateAd,
          eventDateBs: bsObj.dateStr,
          eventDateBsFormatted: bsObj.formattedEn,
          rawMatched
        };
      } catch {
        // Fall through
      }
    }
  }

  // 2. Match Nepali BS Date with named month: e.g. "30 Kartik", "कार्तिक ३०", "2083 Kartik 30", "३० कार्तिक २०८३"
  const bsMonthNames = ['baishakh', 'jestha', 'ashadh', 'shrawan', 'bhadra', 'ashwin', 'kartik', 'mangsir', 'poush', 'magh', 'falgun', 'chaitra'];
  const bsMonthNamesNe = ['वैशाख', 'जेठ', 'असार', 'श्रावण', 'भाद्र', 'आश्विन', 'कार्तिक', 'मंसिर', 'पौष', 'माघ', 'फाल्गुन', 'चैत्र'];
  const bsMonthRegexStr = 'baishakh|jestha|ashadh|shrawan|bhadra|ashwin|kartik|mangsir|poush|magh|falgun|chaitra|वैशाख|जेठ|असार|श्रावण|भाद्र|आश्विन|कार्तिक|मंसिर|पौष|माघ|फाल्गुन|चैत्र';

  // Pattern A: Day Month [Year] e.g. "30 Kartik 2083", "३० कार्तिक २०८३", "30th Kartik"
  const patDayMonth = new RegExp(`(?:(\\d{4}|[०-९]{4})\\s*(?:साल|bs)?\\s*)?(\\d{1,2}|[०-९]{1,2})(?:st|nd|rd|th)?\\s*(?:gate|गते)?\\s*(${bsMonthRegexStr})(?:\\s*,?\\s*(\\d{4}|[०-९]{4}))?`, 'i');

  // Pattern B: Month Day [Year] e.g. "Kartik 30, 2083", "कार्तिक ३० गते", "Kartik 30"
  const patMonthDay = new RegExp(`(${bsMonthRegexStr})\\s+(\\d{1,2}|[०-९]{1,2})(?:st|nd|rd|th)?\\b(?![०-९0-9])(?:\\s*(?:gate|गते))?(?:\\s*,?\\s*(\\d{4}|[०-९]{4}))?`, 'i');

  const toEng = (str) => {
    if (!str) return null;
    return Number(toAsciiDigits(str));
  };

  let matchedMonthStr = null;
  let matchedDay = null;
  let matchedYear = null;
  let rawMatched = '';

  // Check Day-Month first ("30 Kartik 2083")
  const matchDM = text.match(patDayMonth);
  if (matchDM) {
    matchedMonthStr = matchDM[3].toLowerCase();
    matchedDay = toEng(matchDM[2]);
    matchedYear = toEng(matchDM[1] || matchDM[4]) || refBsYear;
    rawMatched = matchDM[0];
  } else {
    // Check Month-Day ("Kartik 30, 2083")
    const matchMD = text.match(patMonthDay);
    if (matchMD) {
      matchedMonthStr = matchMD[1].toLowerCase();
      matchedDay = toEng(matchMD[2]);
      matchedYear = toEng(matchMD[3]) || refBsYear;
      rawMatched = matchMD[0];
    }
  }

  if (matchedMonthStr && matchedDay && matchedDay >= 1 && matchedDay <= 32) {
    let mIdx = bsMonthNames.indexOf(matchedMonthStr);
    if (mIdx === -1) mIdx = bsMonthNamesNe.indexOf(matchedMonthStr);
    if (mIdx !== -1) {
      const bsMonth = mIdx + 1;
      try {
        const eventDateAd = bsToAd(matchedYear, bsMonth, matchedDay);
        const bsObj = adToBs(eventDateAd);
        return {
          eventDateAd,
          eventDateBs: bsObj.dateStr,
          eventDateBsFormatted: bsObj.formattedEn,
          rawMatched
        };
      } catch {
        // Fall through to AD check
      }
    }
  }

  // 3. Match Gregorian AD Date with named month: e.g. "November 16, 2026", "Nov 16"
  const adPat = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/i;
  const adMatch = text.match(adPat);
  if (adMatch) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const mIdx = months.indexOf(adMatch[1].slice(0, 3).toLowerCase());
    const day = Number(adMatch[2]);
    const year = Number(adMatch[3]) || refAdYear;
    if (mIdx !== -1 && day >= 1 && day <= 31) {
      const eventDateAd = `${year}-${String(mIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      try {
        const bsObj = adToBs(eventDateAd);
        return {
          eventDateAd,
          eventDateBs: bsObj.dateStr,
          eventDateBsFormatted: bsObj.formattedEn,
          rawMatched: adMatch[0]
        };
      } catch {
        // Ignored
      }
    }
  }

  return null;
}

/**
 * Extracts structured event object from a single record (notice, post, assignment).
 * @param {object} record
 * @param {object} temporalContext
 * @returns {object|null}
 */
function extractEventFromRecord(record, temporalContext = getTemporalContext()) {
  if (!record) return null;

  const title = record.title || '';
  const content = record.content || record.description || '';
  const combinedText = `${title} ${content}`;

  const eventType = classifyEventType(combinedText);
  if (!eventType) return null;

  const dateMatch = extractDateFromText(combinedText, temporalContext);
  if (!dateMatch && !record.deadline) {
    // No target date found in this record
    return null;
  }

  let eventDateAd = dateMatch ? dateMatch.eventDateAd : null;
  let eventDateBs = dateMatch ? dateMatch.eventDateBs : null;
  let eventDateBsFormatted = dateMatch ? dateMatch.eventDateBsFormatted : null;

  // If assignment with explicit deadline field
  if (!eventDateAd && record.deadline) {
    eventDateAd = String(record.deadline).slice(0, 10);
    try {
      const bsObj = adToBs(eventDateAd);
      eventDateBs = bsObj.dateStr;
      eventDateBsFormatted = bsObj.formattedEn;
    } catch {
      // Keep null
    }
  }

  // Publication date
  const pubRaw = record.created_at || record.createdAt || record.published_at || record.date;
  const publicationDate = pubRaw ? formatNepalDate(pubRaw) : temporalContext.adDate;
  const publicationDateBs = adToBs(publicationDate).formattedEn;

  // Authority Tier
  let authorityTier = Number(record.authorityTier || record.tier);
  if (!authorityTier) {
    if (record.resourceType === 'notice' || record.type === 'notice') authorityTier = AUTHORITY_TIERS.COLLEGE_OFFICIAL;
    else if (record.resourceType === 'assignment' || record.type === 'assignment') authorityTier = AUTHORITY_TEACHER;
    else authorityTier = AUTHORITY_TIERS.STUDENT;
  }

  // Confirmation status
  let confirmationStatus = 'confirmed';
  if (/\b(tentative|tentatively|likely|expected to|probabl?y|सम्भावित)\b/i.test(combinedText)) {
    confirmationStatus = 'tentative';
  } else if (/\b(postponed|cancelled|halted|stopp?ed|स्थगित|रद्द)\b/i.test(combinedText)) {
    confirmationStatus = 'cancelled';
  }

  // Applicable semester
  const applicableSemester = record.semester ? Number(record.semester) : null;

  return {
    id: record.id || `${record.resourceType || 'rec'}:${record.canonicalId || Math.random()}`,
    canonicalId: record.canonicalId || record.id,
    resourceType: record.resourceType || 'notice',
    title,
    content,
    eventType,
    eventDateAd,
    eventDateBs,
    eventDateBsFormatted,
    publicationDate,
    publicationDateBs,
    authorityTier,
    confirmationStatus,
    applicableSemester,
    rawMatched: dateMatch ? dateMatch.rawMatched : null
  };
}

/**
 * Evaluates supersession and detects conflicts among extracted academic events.
 * 
 * Rules:
 * 1. Authority: Higher authority (Tier 1 > Tier 2 > Tier 3 > Tier 4) takes precedence.
 * 2. Recency: Within the same authority tier, a newer confirmed announcement supersedes
 *    an older announcement for the same event type.
 * 3. Conflicts: Announcements of equal authority published simultaneously with contradicting
 *    dates without reference are flagged as conflicting.
 * 
 * @param {Array<object>} events
 * @param {object} temporalContext
 * @returns {object}
 */
function evaluateEventSupersessionAndConflicts(events, temporalContext = getTemporalContext(), preferredEventType = null) {
  if (!events || events.length === 0) {
    return {
      activeEvent: null,
      supersededEvents: [],
      conflictingEvents: [],
      hasConflict: false,
      allEvents: []
    };
  }

  // Group events by eventType
  const byType = new Map();
  for (const ev of events) {
    if (!byType.has(ev.eventType)) byType.set(ev.eventType, []);
    byType.get(ev.eventType).push(ev);
  }

  const processedEvents = [];
  const supersededEvents = [];
  const conflictingEvents = [];
  let primaryActiveEvent = null;

  for (const [type, group] of byType.entries()) {
    // Sort by authority tier (1 highest), then publicationDate descending (newest first)
    group.sort((a, b) => {
      if (a.authorityTier !== b.authorityTier) {
        return a.authorityTier - b.authorityTier;
      }
      return calculateDaysBetween(a.publicationDate, b.publicationDate); // descending: newer first
    });

    const topEvent = group[0];
    const topAuthority = topEvent.authorityTier;
    const topTierEvents = group.filter(e => e.authorityTier === topAuthority);

    if (topTierEvents.length === 1) {
      topEvent.isActive = true;
      topEvent.isSuperseded = false;
      processedEvents.push(topEvent);

      // Remaining events in group of lower tier or older date are superseded
      for (let i = 1; i < group.length; i++) {
        const older = group[i];
        older.isActive = false;
        older.isSuperseded = true;
        older.supersededBy = topEvent.id;
        older.supersessionReason = older.authorityTier > topAuthority
          ? `Lower authority than official announcement (Tier ${older.authorityTier} vs Tier ${topAuthority})`
          : `Superseded by newer announcement published on ${topEvent.publicationDate}`;
        supersededEvents.push(older);
      }
    } else {
      // Multiple events in the top tier
      const newestDate = topTierEvents[0].publicationDate;
      const sameDayTopEvents = topTierEvents.filter(e => e.publicationDate === newestDate);

      // Check if dates differ among same-day top tier announcements
      const distinctDates = [...new Set(sameDayTopEvents.map(e => e.eventDateAd))];
      if (distinctDates.length > 1) {
        // Conflict!
        sameDayTopEvents.forEach(e => {
          e.isActive = false;
          e.hasConflict = true;
        });
        conflictingEvents.push(...sameDayTopEvents);
      } else {
        // The newest one wins, older ones in top tier are superseded
        topEvent.isActive = true;
        topEvent.isSuperseded = false;
        processedEvents.push(topEvent);

        for (let i = 1; i < group.length; i++) {
          const older = group[i];
          older.isActive = false;
          older.isSuperseded = true;
          older.supersededBy = topEvent.id;
          older.supersessionReason = `Superseded by newer announcement published on ${topEvent.publicationDate}`;
          supersededEvents.push(older);
        }
      }
    }
  }

  // Select primary active event, prioritizing preferred event type from query if available
  if (preferredEventType) {
    const matchedPreferred = processedEvents.find(e => e.eventType === preferredEventType && e.isActive);
    if (matchedPreferred) {
      primaryActiveEvent = matchedPreferred;
    }
  }

  if (!primaryActiveEvent) {
    const priorityOrder = [
      EVENT_TYPES.CLASS_RESUMPTION,
      EVENT_TYPES.PROJECT_DEFENSE,
      EVENT_TYPES.EXAMINATION,
      EVENT_TYPES.ASSIGNMENT_DEADLINE,
      EVENT_TYPES.HOLIDAY,
      EVENT_TYPES.SEMESTER_SCHEDULE
    ];

    for (const prio of priorityOrder) {
      const found = processedEvents.find(e => e.eventType === prio && e.isActive);
      if (found) {
        primaryActiveEvent = found;
        break;
      }
    }
  }
  if (!primaryActiveEvent && processedEvents.length > 0) {
    primaryActiveEvent = processedEvents[0];
  }

  return {
    activeEvent: primaryActiveEvent,
    supersededEvents,
    conflictingEvents,
    hasConflict: conflictingEvents.length > 0,
    allEvents: [...processedEvents, ...supersededEvents, ...conflictingEvents]
  };
}

/**
 * Resolves academic events from a collection of records relative to the user query and temporal context.
 * Computes deterministic countdowns and returns a structured resolution.
 * 
 * @param {Array<object>} records
 * @param {string} userQuery
 * @param {object} [temporalContext=getTemporalContext()]
 * @returns {object}
 */
function resolveAcademicEvents(records, userQuery, temporalContext = getTemporalContext()) {
  const preferredEventType = detectRequestedEventType(userQuery);
  const extracted = (records || []).map(r => extractEventFromRecord(r, temporalContext)).filter(Boolean);

  const evaluation = evaluateEventSupersessionAndConflicts(extracted, temporalContext, preferredEventType);
  const activeEvent = evaluation.activeEvent;

  let countdown = null;
  if (activeEvent && activeEvent.eventDateAd) {
    const daysRemaining = calculateDaysRemaining(activeEvent.eventDateAd, temporalContext.adDate);
    const isToday = daysRemaining === 0;
    const isTomorrow = daysRemaining === 1;
    const isPast = daysRemaining < 0;

    let humanSummaryEn;
    let humanSummaryNe;

    if (isToday) {
      humanSummaryEn = `Today (${activeEvent.eventDateBsFormatted} BS / ${activeEvent.eventDateAd} AD)`;
      humanSummaryNe = `आज (${activeEvent.eventDateBsFormatted} / ${activeEvent.eventDateAd} AD)`;
    } else if (isTomorrow) {
      humanSummaryEn = `Tomorrow (${activeEvent.eventDateBsFormatted} BS / ${activeEvent.eventDateAd} AD)`;
      humanSummaryNe = `भोलि (${activeEvent.eventDateBsFormatted} / ${activeEvent.eventDateAd} AD)`;
    } else if (isPast) {
      const elapsed = Math.abs(daysRemaining);
      humanSummaryEn = `${elapsed} day${elapsed === 1 ? '' : 's'} ago (${activeEvent.eventDateBsFormatted} BS / ${activeEvent.eventDateAd} AD)`;
      humanSummaryNe = `${toDevanagariDigits(elapsed)} दिन अघि (${activeEvent.eventDateBsFormatted} / ${activeEvent.eventDateAd} AD)`;
    } else {
      humanSummaryEn = `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining (${activeEvent.eventDateBsFormatted} BS / ${activeEvent.eventDateAd} AD)`;
      humanSummaryNe = `${toDevanagariDigits(daysRemaining)} दिन बाँकी (${activeEvent.eventDateBsFormatted} / ${activeEvent.eventDateAd} AD)`;
    }

    countdown = {
      daysRemaining,
      isToday,
      isTomorrow,
      isPast,
      humanSummaryEn,
      humanSummaryNe
    };
  }

  // Construct deterministic fact sheet string for LLM injection
  let factSheet = `[AUTHORITATIVE DETERMINISTIC FACT SHEET - VERIFIED BY SYSTEM]
- TIMEZONE: Asia/Kathmandu (UTC+05:45)
- TODAY'S CURRENT DATE: ${temporalContext.summaryEn}
`;

  if (activeEvent) {
    factSheet += `- PRIMARY EVENT: ${activeEvent.eventType.toUpperCase().replace(/_/g, ' ')}
  * Status: ${activeEvent.confirmationStatus}
  * Event Date: ${activeEvent.eventDateAd} AD (${activeEvent.eventDateBsFormatted} BS)
  * Source: ${activeEvent.title} (Authority Tier: ${activeEvent.authorityTier}, Published: ${activeEvent.publicationDate})
`;
    if (countdown) {
      factSheet += `  * EXACT DAYS REMAINING: ${countdown.daysRemaining} days (Event Date: ${activeEvent.eventDateAd} minus Today: ${temporalContext.adDate})
  * CRITICAL COMPUTATION RULE: The current server date is ${temporalContext.adDate} (${temporalContext.bsFormattedEn} BS). You MUST state that there are EXACTLY ${countdown.daysRemaining} days remaining from today. Never calculate remaining days using the publication date of the notice (${activeEvent.publicationDate}).
`;
    }
  }

  if (evaluation.supersededEvents.length > 0) {
    factSheet += `- SUPERSEDED / OUTDATED NOTICES (DO NOT USE FOR COUNTDOWN):
${evaluation.supersededEvents.map(s => `  * "${s.title}": date was ${s.eventDateBsFormatted} BS (${s.eventDateAd} AD), published on ${s.publicationDate}. Reason: ${s.supersessionReason}`).join('\n')}
`;
  }

  if (evaluation.hasConflict) {
    factSheet += `- CONFLICTING ANNOUNCEMENTS DETECTED:
${evaluation.conflictingEvents.map(c => `  * "${c.title}" states date: ${c.eventDateBsFormatted} BS (${c.eventDateAd} AD), published: ${c.publicationDate}`).join('\n')}
  * INSTRUCTION: Explicitly inform the student that there are contradictory announcements from equal authorities and advise them to check with the administration.
`;
  }

  return {
    hasEvent: Boolean(activeEvent),
    activeEvent,
    countdown,
    supersededEvents: evaluation.supersededEvents,
    conflictingEvents: evaluation.conflictingEvents,
    hasConflict: evaluation.hasConflict,
    allEvents: evaluation.allEvents,
    factSheet
  };
}

module.exports = {
  EVENT_TYPES,
  AUTHORITY_TIERS,
  classifyEventType,
  extractDateFromText,
  extractEventFromRecord,
  evaluateEventSupersessionAndConflicts,
  resolveAcademicEvents
};
