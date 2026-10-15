'use strict';
// The application adapter returns arrays; node-postgres returns QueryResult.
// Keep that distinction at one boundary instead of assuming test clients match production.
const adapters = new WeakMap();

function asKnowledgeDb(db) {
  if (!db) return db;
  if (adapters.has(db)) return adapters.get(db);
  const adapter = Object.create(db);
  adapter.isPostgres = Boolean(db.isPostgres || (db.query && !db.all));

  if (typeof db.query === 'function') {
    adapter.query = async (sql, params = []) => {
      const result = await db.query(sql, params);
      return Array.isArray(result) ? { rows: result } : (result?.rows ? result : { rows: [] });
    };
  }

  if (!adapter.get && typeof db.query === 'function') {
    adapter.get = async (sql, ...params) => {
      let idx = 1;
      const pgSql = sql.replace(/\?/g, () => `$${idx++}`);
      const normParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      const res = await db.query(pgSql, normParams);
      const rows = Array.isArray(res) ? res : (res?.rows || []);
      return rows[0] || null;
    };
  }

  if (!adapter.all && typeof db.query === 'function') {
    adapter.all = async (sql, ...params) => {
      let idx = 1;
      const pgSql = sql.replace(/\?/g, () => `$${idx++}`);
      const normParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      const res = await db.query(pgSql, normParams);
      return Array.isArray(res) ? res : (res?.rows || []);
    };
  }

  if (!adapter.exec && typeof db.query === 'function') {
    adapter.exec = async (sql) => {
      await db.query(sql);
    };
  }

  adapters.set(db, adapter);
  adapters.set(adapter, adapter);
  return adapter;
}

module.exports = { asKnowledgeDb };
