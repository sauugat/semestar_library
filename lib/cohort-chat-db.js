'use strict';

// db.js maps academic column names for UI DTOs. Preserve SQL names as well for
// the existing room/epoch service and its transaction adapters.
const aliases = { cohortId:'cohort_id', currentSemester:'current_semester', intakeYear:'intake_year',
  graduatedAt:'graduated_at', messageId:'message_id', mentionedStudentId:'mentioned_student_id' };
function row(value) {
  if (!value) return value;
  const result = { ...value };
  for (const [camel, sql] of Object.entries(aliases)) if (!(sql in result) && camel in result) result[sql] = result[camel];
  return result;
}
function cohortChatDb(db) {
  return { ...db,
    get: async (...args) => row(await db.get(...args)),
    all: async (...args) => (await db.all(...args)).map(row),
    ...(db.withTransaction ? { withTransaction: fn => db.withTransaction(tx => fn(cohortChatDb(tx))) } : {}),
  };
}
module.exports = { cohortChatDb };
