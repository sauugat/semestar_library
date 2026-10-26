'use strict';

/**
 * Replaces positional parameter placeholders (?) with PostgreSQL numbered placeholders ($1, $2, ...)
 * strictly outside single-quoted string literals and double-quoted identifiers.
 *
 * Rules:
 * - Replaces ? with $1, $2, $3, ... in left-to-right order.
 * - Leaves ? inside single-quoted string literals ('...') untouched.
 * - Handles escaped single quotes ('') inside string literals without exiting the literal state.
 * - Leaves ? inside double-quoted identifiers ("...") untouched.
 * - Handles escaped double quotes ("") inside identifiers without exiting the identifier state.
 * - Does NOT alter datetime('now') or modify any other SQL syntax.
 * - Standalone pure function: zero dependencies, never imports db.js.
 *
 * @param {string} sql
 * @returns {string}
 */
function toPostgresPlaceholders(sql) {
  if (typeof sql !== 'string' || !sql) return sql;

  let idx = 1;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let out = '';
  const len = sql.length;

  for (let i = 0; i < len; i++) {
    const ch = sql[i];

    if (ch === "'") {
      if (!inDoubleQuote) {
        if (inSingleQuote) {
          // Check for escaped single quote: ''
          if (i + 1 < len && sql[i + 1] === "'") {
            out += "''";
            i++;
            continue;
          }
          inSingleQuote = false;
        } else {
          inSingleQuote = true;
        }
      }
      out += ch;
    } else if (ch === '"') {
      if (!inSingleQuote) {
        if (inDoubleQuote) {
          // Check for escaped double quote: ""
          if (i + 1 < len && sql[i + 1] === '"') {
            out += '""';
            i++;
            continue;
          }
          inDoubleQuote = false;
        } else {
          inDoubleQuote = true;
        }
      }
      out += ch;
    } else if (ch === '?' && !inSingleQuote && !inDoubleQuote) {
      out += `$${idx++}`;
    } else {
      out += ch;
    }
  }

  return out;
}

module.exports = { toPostgresPlaceholders };
