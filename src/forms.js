const crypto = require('crypto');
const {
  TYPES,
  CHOICE_TYPES,
  PLACEHOLDER_TYPES,
  LIMITS,
  validateAnswers,
  validateFormDefinition,
} = require('../shared/schema');

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no look-alikes (l/1, o/0)
const ID_RE = /^[\w-]{1,64}$/;
const SESSION_RE = /^[\w-]{8,64}$/;
const EVENT_TYPES = new Set(['view', 'start', 'field']);

function randomSlug(length = 8) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const b of bytes) out += SLUG_ALPHABET[b % SLUG_ALPHABET.length];
  return out;
}

function newFieldId() {
  return 'f_' + crypto.randomBytes(5).toString('hex');
}

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

// Brings arbitrary client input to the stored field shape. It is lenient on
// purpose (empty labels are allowed) so drafts can be autosaved while the
// manager is still typing; strict checks happen on publish.
function sanitizeFields(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of input.slice(0, LIMITS.fields)) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw.id === 'string' && ID_RE.test(raw.id) && !seen.has(raw.id) ? raw.id : newFieldId();
    seen.add(id);
    const type = TYPES.has(raw.type) ? raw.type : 'short_text';
    const field = {
      id,
      type,
      label: str(raw.label, LIMITS.label).trim(),
      help: str(raw.help, LIMITS.help).trim(),
      required: raw.required === true,
    };
    if (PLACEHOLDER_TYPES.has(type)) field.placeholder = str(raw.placeholder, LIMITS.placeholder).trim();
    if (CHOICE_TYPES.has(type)) {
      const options = (Array.isArray(raw.options) ? raw.options : [])
        .filter((o) => typeof o === 'string')
        .map((o) => o.trim().slice(0, LIMITS.option))
        .filter(Boolean);
      field.options = [...new Set(options)].slice(0, LIMITS.options);
    }
    out.push(field);
  }
  return out;
}

function createFormService(store) {
  const db = () => store.data;
  const now = () => new Date().toISOString();

  function get(id) {
    return db().forms.find((f) => f.id === id) || null;
  }

  function getOrThrow(id) {
    const form = get(id);
    if (!form) throw new HttpError(404, 'Форма не найдена');
    return form;
  }

  function getBySlug(slug) {
    return db().forms.find((f) => f.slug === slug) || null;
  }

  function uniqueSlug() {
    for (;;) {
      const slug = randomSlug();
      if (!getBySlug(slug)) return slug;
    }
  }

  function sessionsOf(formId) {
    return Object.values(db().sessions).filter((s) => s.formId === formId);
  }

  function responsesOf(formId) {
    return db().responses.filter((r) => r.formId === formId);
  }

  function assertPublishable(form) {
    const problems = validateFormDefinition(form);
    if (problems.length) throw new HttpError(422, 'Форму нельзя опубликовать', problems);
  }

  return {
    get,
    getOrThrow,
    getBySlug,
    sessionsOf,
    responsesOf,

    list() {
      return db()
        .forms.map((form) => {
          const responses = responsesOf(form.id).length;
          const sessions = sessionsOf(form.id);
          const views = sessions.length;
          // Same definition as the analytics tab: visitors who submitted / visitors.
          const submitted = sessions.filter((s) => s.submittedAt).length;
          return {
            id: form.id,
            slug: form.slug,
            title: form.title,
            status: form.status,
            fieldsCount: form.fields.length,
            responsesCount: responses,
            views,
            conversion: views ? submitted / views : null,
            createdAt: form.createdAt,
            updatedAt: form.updatedAt,
          };
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async create(input = {}) {
      const ts = now();
      const form = {
        id: crypto.randomUUID(),
        slug: uniqueSlug(),
        title: str(input.title, LIMITS.title).trim() || 'Новая форма',
        description: str(input.description, LIMITS.description).trim(),
        successMessage: str(input.successMessage, LIMITS.successMessage).trim(),
        fields: input.fields
          ? sanitizeFields(input.fields)
          : sanitizeFields([
              { type: 'short_text', label: 'Имя и фамилия', required: true },
              { type: 'email', label: 'Email', required: true, placeholder: 'name@mail.ru' },
            ]),
        status: 'draft',
        createdAt: ts,
        updatedAt: ts,
        publishedAt: null,
      };
      db().forms.push(form);
      await store.save();
      return form;
    },

    async update(id, input) {
      const form = getOrThrow(id);
      const next = {
        ...form,
        title: input.title !== undefined ? str(input.title, LIMITS.title).trim() : form.title,
        description:
          input.description !== undefined ? str(input.description, LIMITS.description).trim() : form.description,
        successMessage:
          input.successMessage !== undefined
            ? str(input.successMessage, LIMITS.successMessage).trim()
            : form.successMessage,
        fields: input.fields !== undefined ? sanitizeFields(input.fields) : form.fields,
      };
      // A live form must stay valid, otherwise students would see a broken page.
      if (form.status === 'published') assertPublishable(next);
      next.updatedAt = now();
      Object.assign(form, next);
      await store.save();
      return form;
    },

    async publish(id) {
      const form = getOrThrow(id);
      assertPublishable(form);
      form.status = 'published';
      form.publishedAt = form.publishedAt || now();
      form.updatedAt = now();
      await store.save();
      return form;
    },

    async close(id) {
      const form = getOrThrow(id);
      if (form.status !== 'published') throw new HttpError(409, 'Форма не опубликована');
      form.status = 'closed';
      form.updatedAt = now();
      await store.save();
      return form;
    },

    async duplicate(id) {
      const src = getOrThrow(id);
      return this.create({
        title: `${src.title} (копия)`,
        description: src.description,
        successMessage: src.successMessage,
        // New ids so analytics of the copy never mixes with the original.
        fields: src.fields.map((f) => ({ ...f, id: undefined })),
      });
    },

    async remove(id) {
      getOrThrow(id);
      const data = db();
      data.forms = data.forms.filter((f) => f.id !== id);
      data.responses = data.responses.filter((r) => r.formId !== id);
      for (const [key, s] of Object.entries(data.sessions)) if (s.formId === id) delete data.sessions[key];
      await store.save();
    },

    async submit(form, answers, sessionId) {
      const { ok, values, errors } = validateAnswers(form.fields, answers);
      if (!ok) throw new HttpError(422, 'Проверьте ответы', errors);
      const ts = now();
      // Every response belongs to a session. If the browser did not send one
      // (tracking failed, old client), the response still counts as a visit,
      // so "submitted" can never exceed "opened" in the funnel.
      const session = touchSession(
        form,
        typeof sessionId === 'string' && SESSION_RE.test(sessionId) ? sessionId : `anon-${crypto.randomUUID()}`,
        ts
      );
      session.startedAt = session.startedAt || ts;
      session.submittedAt = ts;
      for (const id of Object.keys(values)) if (!session.filled.includes(id)) session.filled.push(id);
      const response = {
        id: crypto.randomUUID(),
        formId: form.id,
        sessionId: session.sessionId,
        createdAt: ts,
        answers: values,
      };
      db().responses.push(response);
      await store.save();
      return response;
    },

    // Records a student's progress through the form. Silently ignores
    // malformed events: analytics must never break the form itself.
    async track(form, event) {
      if (!event || !SESSION_RE.test(event.sessionId || '') || !EVENT_TYPES.has(event.type)) return;
      const ts = now();
      const session = touchSession(form, event.sessionId, ts);
      if (event.type === 'start') session.startedAt = session.startedAt || ts;
      if (event.type === 'field') {
        if (!form.fields.some((f) => f.id === event.fieldId)) return;
        session.startedAt = session.startedAt || ts;
        if (!session.filled.includes(event.fieldId)) session.filled.push(event.fieldId);
      }
      await store.save();
    },
  };

  function touchSession(form, sessionId, ts) {
    const key = `${form.id}:${sessionId}`;
    const sessions = db().sessions;
    if (!sessions[key]) {
      sessions[key] = {
        formId: form.id,
        sessionId,
        viewedAt: ts,
        startedAt: null,
        submittedAt: null,
        lastActivityAt: ts,
        filled: [],
      };
    }
    sessions[key].lastActivityAt = ts;
    return sessions[key];
  }
}

module.exports = { createFormService, sanitizeFields, HttpError };
