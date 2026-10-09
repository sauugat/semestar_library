const { measure } = require('./request-timing');
// A migration must run on its transaction's client, never the shared pool.
function createTransactionAdapter(client, isPostgres, formatRow, formatRows) {
  const execute = async (sql, args = []) => {
    if (isPostgres) {
      let index = 0;
      return measure('db', () => client.query(sql.replace(/\?/g, () => `$${++index}`), args));
    }
    return measure('db', () => client.execute({ sql, args }));
  };
  return {
    isPostgres,
    exec: sql => isPostgres ? client.query(sql) : client.executeMultiple(sql),
    all: async (sql, ...args) => {
      const res = await execute(sql, args);
      const rows = res.rows || [];
      return formatRows ? formatRows(rows) : rows;
    },
    get: async (sql, ...args) => {
      const res = await execute(sql, args);
      const row = (res.rows && res.rows[0]) || null;
      return formatRow ? formatRow(row) : row;
    },
    run: async (sql, ...args) => {
      let runSql = sql;
      if (isPostgres && /^\s*INSERT\s+INTO/i.test(sql) && !/RETURNING/i.test(sql)) {
        const noIdTables = ['chat_read_receipts', 'chat_typing', 'file_likes', 'follows', 'chat_reactions', 'students', 'submissions', 'submission_events', 'post_likes', 'post_submissions', 'mobile_tokens', 'login_attempts', 'student_device_tokens', 'student_notification_preferences', 'push_receipt_tickets', 'cohort_semester_history', 'cohort_audit_logs', 'dm_participants', 'dm_blocks', 'dm_message_deletions', 'dm_rate_limits'];
        const isNoId = noIdTables.some(t => new RegExp(`INSERT\\s+INTO\\s+${t}\\b`, 'i').test(sql));
        if (!isNoId) {
          runSql += ' RETURNING id';
        }
      }
      const result = await execute(runSql, args);
      return {
        lastInsertRowid: isPostgres ? result.rows?.[0]?.id : Number(result.rows?.[0]?.id ?? result.lastInsertRowid),
        changes: isPostgres ? result.rowCount : (result.rowsAffected || result.rows?.length || 0)
      };
    }
  };
}

module.exports = { createTransactionAdapter };
