// A migration must run on its transaction's client, never the shared pool.
function createTransactionAdapter(client, isPostgres) {
  const execute = async (sql, args = []) => {
    if (isPostgres) {
      let index = 0;
      return client.query(sql.replace(/\?/g, () => `$${++index}`), args);
    }
    return client.execute({ sql, args });
  };
  return {
    isPostgres,
    exec: sql => isPostgres ? client.query(sql) : client.executeMultiple(sql),
    all: async (sql, ...args) => (await execute(sql, args)).rows,
    get: async (sql, ...args) => (await execute(sql, args)).rows[0] || null,
    run: async (sql, ...args) => {
      if (isPostgres && /^\s*INSERT\b/i.test(sql) && !/\bRETURNING\b/i.test(sql)) sql += ' RETURNING id';
      const result = await execute(sql, args);
      return {
        lastInsertRowid: isPostgres ? result.rows[0]?.id : Number(result.lastInsertRowid),
        changes: isPostgres ? result.rowCount : result.rowsAffected
      };
    }
  };
}

module.exports = { createTransactionAdapter };
