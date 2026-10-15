'use strict';
const { getAcademicContext } = require('./academic-context');
const { readResource, resourceCard } = require('./kyana-access');
function createResourceHandler(db) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const context = await getAcademicContext(db, req);
      const row = await readResource(db, context, { type: req.params.type, id: req.params.id });
      if (!row) return res.status(404).json({ message: 'This resource is no longer available to your account.' });
      const card = resourceCard(req.params.type, row);
      if (req.query.format === 'json') return res.json(card);
      const id = Number(row.id);
      const url = { post: `/dashboard.html?post=${id}`, notice: `/notices.html?id=${id}`,
        assignment: `/code-lab/assignment.html?id=${id}`, note: `/api/files/${id}/view`,
        routine: `/routine?sem=${Number(row.semester)}` }[card.type];
      return res.redirect(url);
    } catch { return res.status(503).json({ message: 'Could not verify this resource. Please try again.' }); }
  };
}
module.exports = { createResourceHandler };
