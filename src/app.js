const path = require('path');
const express = require('express');
const { createFormService, HttpError } = require('./forms');
const { computeStats } = require('./analytics');
const { responsesToCsv } = require('./csv');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SHARED_DIR = path.join(__dirname, '..', 'shared');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function publicForm(form) {
  const { id, slug, title, description, successMessage, fields, status } = form;
  return { id, slug, title, description, successMessage, fields, status };
}

function createApp({ store }) {
  const forms = createFormService(store);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  // ---------- Admin API (no auth by the task requirements) ----------

  app.get('/api/forms', (req, res) => {
    res.json({ forms: forms.list() });
  });

  app.post(
    '/api/forms',
    wrap(async (req, res) => {
      res.status(201).json(await forms.create(req.body || {}));
    })
  );

  app.get('/api/forms/:id', (req, res) => {
    const form = forms.getOrThrow(req.params.id);
    res.json({ ...form, responsesCount: forms.responsesOf(form.id).length });
  });

  app.put(
    '/api/forms/:id',
    wrap(async (req, res) => {
      res.json(await forms.update(req.params.id, req.body || {}));
    })
  );

  app.post(
    '/api/forms/:id/publish',
    wrap(async (req, res) => {
      res.json(await forms.publish(req.params.id));
    })
  );

  app.post(
    '/api/forms/:id/close',
    wrap(async (req, res) => {
      res.json(await forms.close(req.params.id));
    })
  );

  app.post(
    '/api/forms/:id/duplicate',
    wrap(async (req, res) => {
      res.status(201).json(await forms.duplicate(req.params.id));
    })
  );

  app.delete(
    '/api/forms/:id',
    wrap(async (req, res) => {
      await forms.remove(req.params.id);
      res.status(204).end();
    })
  );

  app.get('/api/forms/:id/responses', (req, res) => {
    const form = forms.getOrThrow(req.params.id);
    const responses = forms.responsesOf(form.id).map(({ id, createdAt, answers }) => ({ id, createdAt, answers }));
    res.json({ fields: form.fields, responses });
  });

  app.get('/api/forms/:id/responses.csv', (req, res) => {
    const form = forms.getOrThrow(req.params.id);
    const filename = `responses-${form.slug}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(responsesToCsv(form, forms.responsesOf(form.id)));
  });

  app.get('/api/forms/:id/stats', (req, res) => {
    const form = forms.getOrThrow(req.params.id);
    res.json(computeStats(form, forms.sessionsOf(form.id), forms.responsesOf(form.id)));
  });

  // ---------- Public API (students) ----------

  // Drafts are visible only in preview mode, which the admin panel links to.
  function findPublic(req, { allowPreview = false } = {}) {
    const form = forms.getBySlug(req.params.slug);
    const preview = allowPreview && req.query.preview !== undefined;
    if (!form || (form.status === 'draft' && !preview)) throw new HttpError(404, 'Форма не найдена');
    return form;
  }

  app.get('/api/public/forms/:slug', (req, res) => {
    const form = findPublic(req, { allowPreview: true });
    if (form.status === 'closed') {
      return res.status(410).json({ error: 'Приём ответов завершён', title: form.title });
    }
    res.json(publicForm(form));
  });

  app.post(
    '/api/public/forms/:slug/responses',
    wrap(async (req, res) => {
      const form = findPublic(req);
      if (form.status !== 'published') throw new HttpError(410, 'Приём ответов завершён');
      const body = req.body || {};
      const response = await forms.submit(form, body.answers, body.sessionId);
      res.status(201).json({ id: response.id, successMessage: form.successMessage });
    })
  );

  app.post(
    '/api/public/forms/:slug/events',
    wrap(async (req, res) => {
      const form = forms.getBySlug(req.params.slug);
      if (form && form.status === 'published') await forms.track(form, req.body);
      res.status(204).end();
    })
  );

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Не найдено' });
  });

  // ---------- Pages ----------

  app.use('/static', express.static(PUBLIC_DIR, { index: false }));
  app.use('/shared', express.static(SHARED_DIR, { index: false }));
  app.get('/', (req, res) => res.redirect('/admin'));
  app.get(['/admin', '/admin/*'], (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
  app.get('/f/:slug', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'form.html')));

  app.use((req, res) => {
    res.status(404).type('text/plain; charset=utf-8').send('Страница не найдена');
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос' });
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({
      error: status >= 500 ? 'Внутренняя ошибка сервера' : err.message,
      details: err.details,
    });
  });

  return app;
}

module.exports = { createApp };
