/* Account-scoped message metadata. Attachment bytes use authenticated HTTP caching. */
(function (root) {
  function createChatCache(storage, studentId) {
    const key = `semester-chat-v2:${studentId}`;
    let messages = [];
    try {
      const saved = JSON.parse(storage.getItem(key) || '[]');
      if (Array.isArray(saved)) messages = saved.filter(m => Number.isSafeInteger(m.id) && m.id > 0);
    } catch { /* Storage may be unavailable or contain an interrupted write. */ }
    function save() {
      messages.sort((a, b) => a.id - b.id);
      messages = messages.slice(-500);
      try { storage.setItem(key, JSON.stringify(messages)); } catch { /* Quota: keep memory cache. */ }
    }
    return {
      get: () => messages.slice(),
      merge(incoming) {
        const byId = new Map(messages.map(m => [m.id, m]));
        incoming.forEach(m => byId.set(m.id, { ...byId.get(m.id), ...m }));
        messages = [...byId.values()]; save();
      },
      replace(incoming) { messages = incoming.slice(); save(); },
      remove(id) { messages = messages.filter(m => m.id !== Number(id)); save(); },
      react(id, studentId, emoji, action) {
        messages = messages.map(m => {
          if (m.id !== Number(id)) return m;
          const reactions = (m.reactions || []).filter(r => String(r.studentId) !== String(studentId));
          if (action !== 'remove') reactions.push({ studentId, emoji });
          return { ...m, reactions };
        });
        save();
      }
    };
  }
  if (typeof module !== 'undefined') module.exports = { createChatCache };
  else root.createChatCache = createChatCache;
})(typeof window !== 'undefined' ? window : globalThis);
