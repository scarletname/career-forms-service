'use strict';

const { CHOICE_TYPES, LIMITS, isEmpty, checkValue, validateAnswers } = window.FormSchema;

const app = document.getElementById('app');
const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
const preview = new URLSearchParams(location.search).has('preview');
const DRAFT_KEY = `forms:draft:${slug}`;
const SESSION_KEY = `forms:session:${slug}`;

// localStorage may be unavailable (private mode, blocked storage): the form
// must keep working, just without drafts.
const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* ignore */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      /* ignore */
    }
  },
};

// ---------- analytics ----------

// One session per student per form; it survives reloads so a student who
// comes back later is not counted twice.
function sessionId() {
  let id = storage.get(SESSION_KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
    storage.set(SESSION_KEY, id);
  }
  return id;
}

const sentEvents = new Set();
function track(type, fieldId) {
  if (preview) return;
  const key = `${type}:${fieldId || ''}`;
  if (sentEvents.has(key)) return;
  sentEvents.add(key);
  fetch(`/api/public/forms/${encodeURIComponent(slug)}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, fieldId, sessionId: sessionId() }),
    keepalive: true,
  }).catch(() => {});
}

// ---------- rendering ----------

function renderMessage(title, text) {
  document.title = title;
  fill(app, h('div', { class: 'card empty' }, h('h1', null, title), text && h('p', null, text)));
}

async function load() {
  let form;
  try {
    form = await api('GET', `/api/public/forms/${encodeURIComponent(slug)}${preview ? '?preview' : ''}`);
  } catch (err) {
    if (err.status === 404) return renderMessage('Форма не найдена', 'Проверьте ссылку или обратитесь к тому, кто её прислал.');
    if (err.status === 410) {
      return renderMessage('Приём откликов завершён', err.data && err.data.title ? `Форма «${err.data.title}» больше не принимает ответы.` : null);
    }
    return renderMessage('Не удалось загрузить форму', 'Проверьте подключение к интернету и обновите страницу.');
  }
  renderForm(form);
  track('view');
}

function renderForm(form) {
  document.title = form.title;
  const draft = readDraft();
  const controls = new Map(); // fieldId -> { wrap, get(), set(v) }
  const errors = new Map();

  const progressText = h('span', { class: 'small muted' });
  const progressBar = h('div');
  const progress = h('div', { class: 'progress' }, h('div', { class: 'bar' }, progressBar), progressText);

  function values() {
    const out = {};
    for (const [id, c] of controls) out[id] = c.get();
    return out;
  }

  function updateProgress() {
    const all = values();
    const filled = form.fields.filter((f) => !isEmpty(all[f.id])).length;
    progressBar.style.width = `${form.fields.length ? (filled / form.fields.length) * 100 : 0}%`;
    progressText.textContent = `Заполнено ${filled} из ${form.fields.length}`;
  }

  function showError(field, message) {
    const c = controls.get(field.id);
    c.wrap.classList.toggle('invalid', !!message);
    c.error.textContent = message || '';
    c.error.hidden = !message;
    if (message) errors.set(field.id, message);
    else errors.delete(field.id);
  }

  let draftTimer = null;
  function onInput(field) {
    track('start');
    if (errors.has(field.id)) {
      const r = checkValue(field, controls.get(field.id).get());
      showError(field, r.error);
    }
    updateProgress();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => storage.set(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), answers: values() })), 400);
  }

  // Validate when the student leaves a question, and count it as filled
  // for analytics only if the answer is valid.
  function onLeave(field) {
    const value = controls.get(field.id).get();
    if (isEmpty(value)) return;
    const r = checkValue(field, value);
    showError(field, r.error);
    if (!r.error) track('field', field.id);
  }

  const questions = form.fields.map((field) => {
    const c = buildControl(field, () => onInput(field));
    const labelId = `q-${field.id}`;
    const error = h('div', { class: 'error-text', role: 'alert', hidden: true });
    const wrap = h(
      'div',
      { class: 'question' },
      h('label', { class: 'question-label', id: labelId, for: c.inputId || null }, field.label, field.required && h('span', { class: 'required-mark', 'aria-hidden': 'true' }, ' *')),
      field.help && h('div', { class: 'question-help' }, field.help),
      c.el,
      error
    );
    wrap.addEventListener('focusout', (e) => {
      if (!wrap.contains(e.relatedTarget)) onLeave(field);
    });
    controls.set(field.id, { ...c, wrap, error });
    return wrap;
  });

  if (draft) {
    for (const [id, value] of Object.entries(draft.answers || {})) {
      const c = controls.get(id);
      if (c && !isEmpty(value)) c.set(value);
    }
  }

  const submitBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Отправить');
  const submitError = h('div', { class: 'error-text', hidden: true });
  const requiredCount = form.fields.filter((f) => f.required).length;

  const formEl = h(
    'form',
    { novalidate: true, onsubmit: (e) => submit(e) },
    questions,
    h(
      'div',
      { class: 'submit-row' },
      submitBtn,
      requiredCount > 0 && h('span', { class: 'muted small' }, h('span', { class: 'required-mark' }, '*'), ' — обязательные вопросы')
    ),
    submitError
  );

  const draftNotice =
    draft &&
    h(
      'div',
      { class: 'notice' },
      'Мы восстановили ответы, которые вы начали заполнять ранее. ',
      h(
        'a',
        {
          href: '#',
          onclick: (e) => {
            e.preventDefault();
            storage.remove(DRAFT_KEY);
            location.reload();
          },
        },
        'Начать заново'
      )
    );

  async function submit(e) {
    e.preventDefault();
    submitError.hidden = true;
    const result = validateAnswers(form.fields, values());
    for (const field of form.fields) showError(field, result.errors[field.id]);
    if (!result.ok) {
      focusFirstError();
      return;
    }
    if (preview) {
      toast('Это предпросмотр — ответы не отправляются');
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Отправляем…';
    try {
      const res = await api('POST', `/api/public/forms/${encodeURIComponent(slug)}/responses`, {
        answers: values(),
        sessionId: sessionId(),
      });
      storage.remove(DRAFT_KEY);
      storage.remove(SESSION_KEY);
      renderSuccess(form, res.successMessage);
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Отправить';
      if (err.status === 422 && err.data && err.data.details) {
        for (const field of form.fields) showError(field, err.data.details[field.id]);
        focusFirstError();
      } else if (err.status === 410) {
        submitError.textContent = 'К сожалению, приём ответов уже завершён.';
        submitError.hidden = false;
      } else {
        // The draft is still in localStorage, so nothing is lost.
        submitError.textContent = 'Не удалось отправить. Проверьте интернет и попробуйте ещё раз — ответы сохранены.';
        submitError.hidden = false;
      }
    }
  }

  function focusFirstError() {
    const first = form.fields.find((f) => errors.has(f.id));
    if (!first) return;
    const c = controls.get(first.id);
    c.wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const input = c.wrap.querySelector('input, textarea, select');
    if (input) input.focus({ preventScroll: true });
  }

  fill(app,
    preview && h('div', { class: 'notice warning' }, 'Предпросмотр: так форму увидят студенты. Ответы в этом режиме не сохраняются.'),
    h('h1', null, form.title),
    form.description && h('p', { class: 'muted', style: 'white-space:pre-wrap' }, form.description),
    draftNotice,
    form.fields.length > 2 && progress,
    h('div', { class: 'card' }, formEl)
  );
  updateProgress();
}

function readDraft() {
  if (preview) return null;
  try {
    const draft = JSON.parse(storage.get(DRAFT_KEY));
    return draft && draft.answers && Object.values(draft.answers).some((v) => !isEmpty(v)) ? draft : null;
  } catch (e) {
    return null;
  }
}

let controlSeq = 0;

// Builds the input for one field. Returns { el, inputId, get, set }.
function buildControl(field, onInput) {
  const inputId = `in-${++controlSeq}`;
  const common = { id: inputId, name: field.id, placeholder: field.placeholder || '', oninput: onInput };

  if (field.type === 'long_text') {
    const el = h('textarea', { ...common, rows: 5, maxLength: LIMITS.longAnswer });
    return { el, inputId, get: () => el.value, set: (v) => (el.value = v) };
  }

  if (field.type === 'dropdown') {
    const el = h(
      'select',
      { id: inputId, name: field.id, onchange: onInput },
      h('option', { value: '' }, 'Выберите…'),
      field.options.map((o) => h('option', { value: o }, o))
    );
    return { el, inputId, get: () => el.value, set: (v) => (el.value = field.options.includes(v) ? v : '') };
  }

  if (CHOICE_TYPES.has(field.type)) {
    const multiple = field.type === 'multiple_choice';
    const inputs = field.options.map((o) => h('input', { type: multiple ? 'checkbox' : 'radio', name: field.id, value: o, onchange: onInput }));
    const el = h(
      'fieldset',
      { 'aria-label': field.label },
      h('div', { class: 'options' }, inputs.map((input, i) => h('label', { class: 'option' }, input, field.options[i])))
    );
    return {
      el,
      inputId: null,
      get: () => (multiple ? inputs.filter((i) => i.checked).map((i) => i.value) : (inputs.find((i) => i.checked) || {}).value || ''),
      set: (v) => inputs.forEach((i) => (i.checked = multiple ? Array.isArray(v) && v.includes(i.value) : i.value === v)),
    };
  }

  const inputProps = {
    short_text: { type: 'text', maxLength: LIMITS.shortAnswer },
    email: { type: 'email', autocomplete: 'email', inputMode: 'email' },
    phone: { type: 'tel', autocomplete: 'tel', inputMode: 'tel' },
    url: { type: 'text', inputMode: 'url', autocomplete: 'url' },
    number: { type: 'text', inputMode: 'decimal' },
    date: { type: 'date' },
  }[field.type] || { type: 'text' };

  const el = h('input', { ...common, ...inputProps });
  if (field.type === 'short_text' && /имя|фио|фамили/i.test(field.label)) el.autocomplete = 'name';
  return { el, inputId, get: () => el.value, set: (v) => (el.value = String(v)) };
}

function renderSuccess(form, message) {
  document.title = 'Отклик отправлен';
  fill(app,
    h(
      'div',
      { class: 'card success' },
      h('div', { class: 'check-icon', 'aria-hidden': 'true' }, '✓'),
      h('h1', null, 'Отклик отправлен'),
      h('p', { style: 'white-space:pre-wrap' }, message || 'Спасибо! Ваши ответы получены.'),
      h('p', { class: 'muted small' }, form.title)
    )
  );
  window.scrollTo(0, 0);
}

load();
