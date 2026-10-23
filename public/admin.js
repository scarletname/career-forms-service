'use strict';

const { FIELD_TYPES, CHOICE_TYPES, PLACEHOLDER_TYPES } = window.FormSchema;
const TYPE_TITLES = Object.fromEntries(FIELD_TYPES.map((t) => [t.type, t.title]));
const STATUS_TITLES = { draft: 'Черновик', published: 'Опубликована', closed: 'Приём закрыт' };

const app = document.getElementById('app');

// Autosave of the editor that is currently open (if any). Navigation waits
// for it so a fast click away does not lose the last edit.
let activeAutosave = null;

// ---------- routing ----------

async function navigate(path, { replace = false } = {}) {
  if (!(await leaveEditor())) return;
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  route();
}

async function leaveEditor() {
  if (!activeAutosave) return true;
  const saved = await activeAutosave.flush();
  if (
    !saved &&
    !(await confirmDialog({
      title: 'Изменения не сохранены',
      message: 'Последние правки не удалось сохранить. Если уйти, они пропадут.',
      confirmText: 'Уйти без сохранения',
      cancelText: 'Остаться',
      danger: true,
    }))
  ) {
    return false;
  }
  activeAutosave = null;
  return true;
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});

window.addEventListener('popstate', () => {
  activeAutosave && activeAutosave.flush();
  activeAutosave = null;
  route();
});

window.addEventListener('beforeunload', (e) => {
  if (activeAutosave && activeAutosave.isDirty()) {
    activeAutosave.flush();
    e.preventDefault();
    e.returnValue = '';
  }
});

async function route() {
  const path = location.pathname.replace(/\/+$/, '');
  const m = path.match(/^\/admin\/forms\/([\w-]+)(?:\/(responses|analytics))?$/);
  try {
    if (path === '/admin' || path === '') await renderList();
    else if (m) await renderFormPage(m[1], m[2] || 'edit');
    else renderMessage('Страница не найдена', 'Вернитесь к списку форм.');
  } catch (err) {
    if (err.status === 404) renderMessage('Форма не найдена', 'Возможно, её удалили.');
    else renderMessage('Что-то пошло не так', err.message);
  }
}

function renderMessage(title, text) {
  document.title = title;
  fill(app,
    h('div', { class: 'card empty' }, h('h2', null, title), h('p', null, text), h('a', { href: '/admin', 'data-link': true }, '← К списку форм'))
  );
}

function loading() {
  return h('p', { class: 'muted' }, 'Загрузка…');
}

function publicUrl(form) {
  return `${location.origin}/f/${form.slug}`;
}

// ---------- forms list ----------

async function renderList() {
  document.title = 'Формы откликов';
  fill(app, loading());
  const { forms } = await api('GET', '/api/forms');

  const createBtn = h('button', { class: 'btn primary', onclick: createForm }, '+ Новая форма');
  const head = h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Формы откликов'), h('p', { class: 'muted' }, 'Соберите форму, опубликуйте и отправьте ссылку студентам.')), createBtn);

  if (!forms.length) {
    fill(app,
      head,
      h('div', { class: 'card empty' }, h('h2', null, 'Пока нет ни одной формы'), h('p', null, 'Создайте первую — это займёт пару минут.'), createBtn.cloneNode(true))
    );
    app.querySelector('.empty .btn').addEventListener('click', createForm);
    return;
  }

  const rows = forms.map((form) =>
    h(
      'tr',
      null,
      h(
        'td',
        null,
        h('a', { class: 'form-title-link', href: `/admin/forms/${form.id}`, 'data-link': true }, form.title || 'Без названия'),
        h('div', { class: 'muted small' }, `${form.fieldsCount} ${plural(form.fieldsCount, 'поле', 'поля', 'полей')}`)
      ),
      h('td', null, h('span', { class: `badge ${form.status}` }, STATUS_TITLES[form.status])),
      h('td', null, h('a', { href: `/admin/forms/${form.id}/responses`, 'data-link': true }, String(form.responsesCount))),
      h('td', null, formatPercent(form.conversion)),
      h('td', { class: 'muted small' }, formatDate(form.updatedAt)),
      h(
        'td',
        { class: 'actions' },
        form.status === 'published' &&
          h('button', { class: 'btn small', title: 'Скопировать ссылку для студентов', onclick: () => copyText(publicUrl(form)) }, 'Ссылка'),
        ' ',
        h('button', { class: 'btn small', onclick: () => duplicateForm(form) }, 'Копия'),
        ' ',
        h('button', { class: 'btn small danger', onclick: () => deleteForm(form) }, 'Удалить')
      )
    )
  );

  fill(app,
    head,
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        null,
        h('thead', null, h('tr', null, h('th', null, 'Форма'), h('th', null, 'Статус'), h('th', null, 'Ответы'), h('th', { title: 'Отправили / открыли' }, 'Конверсия'), h('th', null, 'Изменена'), h('th'))),
        h('tbody', null, rows)
      )
    )
  );
}

async function createForm() {
  const form = await api('POST', '/api/forms', {});
  navigate(`/admin/forms/${form.id}`);
}

async function duplicateForm(form) {
  const copy = await api('POST', `/api/forms/${form.id}/duplicate`);
  toast('Копия создана как черновик');
  navigate(`/admin/forms/${copy.id}`);
}

async function deleteForm(form) {
  const extra = form.responsesCount
    ? `Вместе с ней удалятся ${form.responsesCount} ${plural(form.responsesCount, 'ответ', 'ответа', 'ответов')} и статистика. `
    : '';
  const ok = await confirmDialog({
    title: `Удалить форму «${form.title || 'Без названия'}»?`,
    message: `${extra}Ссылка перестанет работать. Это действие нельзя отменить.`,
    confirmText: 'Удалить',
    danger: true,
  });
  if (!ok) return;
  await api('DELETE', `/api/forms/${form.id}`);
  toast('Форма удалена');
  renderList();
}

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// ---------- form page (header + tabs) ----------

async function renderFormPage(id, tab) {
  fill(app, loading());
  const form = await api('GET', `/api/forms/${id}`);
  document.title = `${form.title || 'Без названия'} — формы`;

  const notice = h('div');
  const header = h('div');
  const content = h('div');

  function renderHeader() {
    const tabs = [
      ['edit', 'Конструктор', ''],
      ['responses', `Ответы (${form.responsesCount})`, '/responses'],
      ['analytics', 'Аналитика', '/analytics'],
    ];
    fill(header,
      h('a', { href: '/admin', 'data-link': true, class: 'small' }, '← Все формы'),
      h('div', { class: 'page-head', style: 'margin-top:8px' }, h('h1', { class: 'form-heading' }, form.title || 'Без названия'), h('span', { class: `badge ${form.status}` }, STATUS_TITLES[form.status])),
      publishBar(form, { onChange: renderHeader, notice }),
      notice,
      h(
        'nav',
        { class: 'tabs' },
        tabs.map(([key, title, suffix]) => h('a', { class: `tab${key === tab ? ' active' : ''}`, href: `/admin/forms/${form.id}${suffix}`, 'data-link': true }, title))
      )
    );
  }

  renderHeader();
  fill(app, header, content);

  if (tab === 'edit') renderEditor(content, form, { onTitle: (t) => (header.querySelector('.form-heading').textContent = t || 'Без названия'), notice });
  if (tab === 'responses') await renderResponses(content, form);
  if (tab === 'analytics') await renderAnalytics(content, form);
}

function publishBar(form, { onChange, notice }) {
  const url = publicUrl(form);
  const showProblems = (err) => {
    const problems = (err.data && err.data.details) || [];
    fill(notice,
      h('div', { class: 'notice error' }, h('strong', null, err.message), problems.length > 0 && h('ul', null, problems.map((p) => h('li', null, p.message))))
    );
    document.querySelectorAll('.field-card.has-error').forEach((el) => el.classList.remove('has-error'));
    for (const p of problems) {
      const card = p.fieldId && document.querySelector(`.field-card[data-id="${p.fieldId}"]`);
      if (card) card.classList.add('has-error');
    }
  };

  async function setStatus(action) {
    if (activeAutosave && !(await activeAutosave.flush())) {
      toast('Сначала исправьте ошибки сохранения');
      return;
    }
    try {
      const updated = await api('POST', `/api/forms/${form.id}/${action}`);
      Object.assign(form, { status: updated.status, publishedAt: updated.publishedAt });
      notice.replaceChildren();
      toast(action === 'publish' ? 'Форма опубликована — ссылка готова' : 'Приём ответов закрыт');
      onChange();
    } catch (err) {
      if (err.status === 422) showProblems(err);
      else toast(err.message);
    }
  }

  const items = [];
  if (form.status === 'draft') {
    items.push(h('span', { class: 'muted small' }, 'Студенты увидят форму после публикации.'));
  } else {
    items.push(
      h('input', { class: 'link-input', readOnly: true, value: url, onfocus: (e) => e.target.select(), 'aria-label': 'Ссылка на форму' }),
      h('button', { class: 'btn', onclick: () => copyText(url) }, 'Копировать')
    );
  }
  items.push(h('a', { class: 'btn', href: `/f/${form.slug}?preview`, target: '_blank', rel: 'noopener' }, 'Предпросмотр'));
  if (form.status === 'published') {
    const closeForm = async () => {
      const ok = await confirmDialog({
        title: 'Закрыть приём ответов?',
        message: 'Студенты увидят, что набор завершён. Ответы сохранятся, а приём можно будет открыть снова.',
        confirmText: 'Закрыть приём',
      });
      if (ok) setStatus('close');
    };
    items.push(h('button', { class: 'btn', onclick: closeForm }, 'Закрыть приём'));
  } else {
    items.push(h('button', { class: 'btn primary', onclick: () => setStatus('publish') }, form.status === 'closed' ? 'Открыть снова' : 'Опубликовать'));
  }
  return h('div', { class: 'publish-bar' }, items);
}

// ---------- editor ----------

function createAutosave(form, onState) {
  let timer = null;
  let inflight = null;
  let dirty = false;

  async function run() {
    clearTimeout(timer);
    timer = null;
    while (inflight) await inflight;
    if (!dirty) return;
    dirty = false;
    onState('saving');
    const payload = {
      title: form.title,
      description: form.description,
      successMessage: form.successMessage,
      fields: form.fields,
    };
    inflight = api('PUT', `/api/forms/${form.id}`, payload)
      .then((saved) => {
        form.updatedAt = saved.updatedAt;
        onState(dirty ? 'dirty' : 'saved');
      })
      .catch((err) => {
        dirty = true;
        onState('error', err);
      })
      .finally(() => {
        inflight = null;
      });
    await inflight;
  }

  return {
    schedule() {
      dirty = true;
      onState('dirty');
      clearTimeout(timer);
      timer = setTimeout(run, 600);
    },
    async flush() {
      await run();
      return !dirty;
    },
    isDirty: () => dirty || !!inflight,
  };
}

function newFieldId() {
  return 'f_' + Math.random().toString(16).slice(2, 12);
}

function newField(type) {
  const field = { id: newFieldId(), type, label: '', help: '', required: false };
  if (PLACEHOLDER_TYPES.has(type)) field.placeholder = '';
  if (CHOICE_TYPES.has(type)) field.options = ['Вариант 1', 'Вариант 2'];
  return field;
}

function renderEditor(container, form, { onTitle, notice }) {
  const status = h('div', { class: 'save-status' }, 'Изменения сохраняются автоматически');
  const autosave = createAutosave(form, (state, err) => {
    status.classList.toggle('error', state === 'error');
    const problems = state === 'error' ? (err.data && err.data.details) || [] : [];
    container.querySelectorAll('.field-card').forEach((card) => {
      card.classList.toggle('has-error', problems.some((p) => p.fieldId === card.dataset.id));
    });
    if (state === 'saving') status.textContent = 'Сохранение…';
    if (state === 'dirty') status.textContent = 'Есть несохранённые изменения';
    if (state === 'saved') {
      status.textContent = 'Все изменения сохранены';
      if (notice.querySelector('.notice.error')) notice.replaceChildren();
    }
    if (state === 'error') {
      const details = (err.data && err.data.details) || [];
      status.textContent = details.length
        ? `Не сохранено: ${details.map((d) => d.message).join('; ')}`
        : `Не сохранено: ${err.message}`;
    }
  });
  activeAutosave = autosave;
  const changed = () => autosave.schedule();

  const hasResponses = form.responsesCount > 0;
  const fieldsList = h('div', { class: 'editor' });

  function renderFields() {
    fill(fieldsList,
      ...form.fields.map((field, i) => fieldCard(field, i)),
      form.fields.length === 0 && h('div', { class: 'card empty' }, 'В форме пока нет полей. Добавьте первое ниже.')
    );
  }

  function move(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= form.fields.length) return;
    [form.fields[i], form.fields[j]] = [form.fields[j], form.fields[i]];
    renderFields();
    changed();
  }

  function fieldCard(field, i) {
    const total = form.fields.length;
    const typeSelect = h(
      'select',
      {
        value: field.type,
        'aria-label': 'Тип поля',
        onchange: (e) => {
          field.type = e.target.value;
          if (CHOICE_TYPES.has(field.type) && !(field.options && field.options.length)) field.options = ['Вариант 1', 'Вариант 2'];
          if (PLACEHOLDER_TYPES.has(field.type) && field.placeholder === undefined) field.placeholder = '';
          renderFields();
          changed();
        },
      },
      FIELD_TYPES.map((t) => h('option', { value: t.type }, t.title))
    );

    const textInput = (key, label, placeholder, multiline = false) =>
      h(
        'label',
        { class: 'field-row' },
        h('span', null, label),
        h(multiline ? 'textarea' : 'input', {
          value: field[key] || '',
          placeholder,
          rows: multiline ? 4 : undefined,
          oninput: (e) => {
            field[key] = e.target.value;
            changed();
          },
        })
      );

    return h(
      'div',
      { class: 'field-card', dataset: { id: field.id } },
      h(
        'div',
        { class: 'field-card-head' },
        h('span', { class: 'num' }, `${i + 1}.`),
        typeSelect,
        h(
          'label',
          { class: 'check' },
          h('input', {
            type: 'checkbox',
            checked: field.required,
            onchange: (e) => {
              field.required = e.target.checked;
              changed();
            },
          }),
          'Обязательное'
        ),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn icon', title: 'Выше', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
        h('button', { class: 'btn icon', title: 'Ниже', disabled: i === total - 1, onclick: () => move(i, 1) }, '↓'),
        h(
          'button',
          {
            class: 'btn icon',
            title: 'Дублировать',
            onclick: () => {
              form.fields.splice(i + 1, 0, { ...structuredClone(field), id: newFieldId() });
              renderFields();
              changed();
            },
          },
          '⧉'
        ),
        h(
          'button',
          {
            class: 'btn icon danger',
            title: 'Удалить поле',
            onclick: async () => {
              const ok = await confirmDialog({
                title: `Удалить поле «${field.label || TYPE_TITLES[field.type]}»?`,
                message: hasResponses ? 'Ответы на этот вопрос пропадут из таблицы и выгрузки.' : null,
                confirmText: 'Удалить',
                danger: true,
              });
              if (!ok) return;
              const index = form.fields.indexOf(field);
              if (index === -1) return;
              form.fields.splice(index, 1);
              renderFields();
              changed();
            },
          },
          '✕'
        )
      ),
      textInput('label', 'Вопрос', 'Например: Ваш вуз и курс'),
      textInput('help', 'Подсказка для студента (необязательно)', 'Поясните, что ожидаете в ответе'),
      PLACEHOLDER_TYPES.has(field.type) && textInput('placeholder', 'Пример ответа внутри поля (необязательно)', ''),
      CHOICE_TYPES.has(field.type) &&
        h(
          'label',
          { class: 'field-row' },
          h('span', null, 'Варианты ответа — каждый с новой строки'),
          h('textarea', {
            value: (field.options || []).join('\n'),
            rows: Math.max(3, (field.options || []).length + 1),
            oninput: (e) => {
              field.options = e.target.value.split('\n');
              changed();
            },
          })
        )
    );
  }

  const palette = h(
    'div',
    { class: 'palette' },
    FIELD_TYPES.map((t) =>
      h(
        'button',
        {
          class: 'btn small',
          onclick: () => {
            form.fields.push(newField(t.type));
            renderFields();
            changed();
            const cards = fieldsList.querySelectorAll('.field-card');
            const last = cards[cards.length - 1];
            last.scrollIntoView({ behavior: 'smooth', block: 'center' });
            last.querySelector('.field-row input').focus({ preventScroll: true });
          },
        },
        '+ ' + t.title
      )
    )
  );

  const settings = h(
    'div',
    { class: 'card' },
    h('label', { class: 'field-row' }, h('span', null, 'Название формы'), h('input', {
      value: form.title,
      placeholder: 'Например: Стажировка в отделе аналитики',
      oninput: (e) => {
        form.title = e.target.value;
        onTitle(form.title);
        changed();
      },
    })),
    h('label', { class: 'field-row' }, h('span', null, 'Описание для студентов'), h('textarea', {
      value: form.description,
      rows: 3,
      placeholder: 'Что за стажировка, сроки, сколько займёт заполнение',
      oninput: (e) => {
        form.description = e.target.value;
        changed();
      },
    })),
    h('label', { class: 'field-row', style: 'margin-bottom:0' }, h('span', null, 'Сообщение после отправки'), h('textarea', {
      value: form.successMessage,
      rows: 2,
      placeholder: 'Спасибо! Ваш отклик отправлен.',
      oninput: (e) => {
        form.successMessage = e.target.value;
        changed();
      },
    }))
  );

  renderFields();
  fill(container,
    form.status === 'published' && hasResponses &&
      h('div', { class: 'notice warning' }, 'Форма уже собирает ответы. Правки сразу увидят новые студенты; старые ответы сохранятся.'),
    h('div', { class: 'editor' }, settings, h('h2', { style: 'margin-top:8px' }, 'Поля'), fieldsList, h('div', { class: 'card' }, h('div', { class: 'muted small', style: 'margin-bottom:8px' }, 'Добавить поле'), palette), status)
  );
}

// ---------- responses ----------

async function renderResponses(container, form) {
  fill(container, loading());
  const { fields, responses } = await api('GET', `/api/forms/${form.id}/responses`);

  if (!responses.length) {
    fill(container,
      h(
        'div',
        { class: 'card empty' },
        h('h2', null, 'Ответов пока нет'),
        h('p', null, form.status === 'published' ? 'Отправьте ссылку студентам — ответы появятся здесь.' : 'Опубликуйте форму, чтобы начать собирать ответы.')
      )
    );
    return;
  }

  const dialog = h('dialog');
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());

  function openResponse(r, n) {
    fill(dialog,
      h(
        'div',
        { class: 'dialog-body' },
        h('div', { class: 'page-head', style: 'margin-bottom:0' }, h('h2', null, `Ответ №${n}`), h('button', { class: 'btn small', onclick: () => dialog.close() }, 'Закрыть')),
        h('div', { class: 'muted small' }, new Date(r.createdAt).toLocaleString('ru-RU')),
        h('dl', null, fields.map((f) => [h('dt', null, f.label || 'Без названия'), h('dd', null, formatAnswer(r.answers[f.id]) || '—')]))
      )
    );
    dialog.showModal();
  }

  // Newest first, but numbering follows submission order.
  const rows = responses
    .map((r, i) => ({ r, n: i + 1 }))
    .reverse()
    .map(({ r, n }) =>
      h(
        'tr',
        { onclick: () => openResponse(r, n), title: 'Открыть ответ целиком' },
        h('td', { class: 'muted' }, String(n)),
        h('td', { class: 'muted small' }, formatDate(r.createdAt)),
        fields.map((f) => h('td', null, formatAnswer(r.answers[f.id])))
      )
    );

  fill(container,
    h(
      'div',
      { class: 'page-head' },
      h('div', { class: 'muted' }, `Всего ${responses.length} ${plural(responses.length, 'ответ', 'ответа', 'ответов')}. Нажмите на строку, чтобы прочитать ответ целиком.`),
      h('a', { class: 'btn', href: `/api/forms/${form.id}/responses.csv`, download: '' }, 'Скачать CSV (Excel)')
    ),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'responses-table' },
        h('thead', null, h('tr', null, h('th', null, '№'), h('th', null, 'Дата'), fields.map((f) => h('th', null, f.label || 'Без названия')))),
        h('tbody', null, rows)
      )
    ),
    dialog
  );
}

// ---------- analytics ----------

async function renderAnalytics(container, form) {
  fill(container, loading());
  const s = await api('GET', `/api/forms/${form.id}/stats`);

  if (!s.views) {
    fill(container,
      h(
        'div',
        { class: 'card empty' },
        h('h2', null, 'Данных пока нет'),
        h('p', null, 'Здесь появится воронка: сколько студентов открыли форму, начали заполнять и отправили — и на каком вопросе уходят.')
      )
    );
    return;
  }

  const stat = (value, label, hint) => h('div', { class: 'card stat', title: hint || '' }, h('div', { class: 'value' }, value), h('div', { class: 'label' }, label));
  const maxFilled = Math.max(1, s.started);

  const insight = s.worstField
    ? h('div', { class: 'notice warning' }, h('strong', null, 'Больше всего студентов уходят на вопросе «', s.worstField.label || 'Без названия', '»'), ` — ${s.worstField.count} ${plural(s.worstField.count, 'человек', 'человека', 'человек')}. Попробуйте сделать его необязательным, упростить формулировку или перенести ближе к концу.`)
    : s.abandoned === 0 && h('div', { class: 'notice' }, 'Пока никто не бросил форму на середине.');

  fill(container,
    h(
      'div',
      { class: 'stats-grid' },
      stat(String(s.views), 'открыли форму', 'Уникальные посетители ссылки'),
      stat(`${s.started} · ${formatPercent(s.startRate)}`, 'начали заполнять', 'Ввели хоть что-то'),
      stat(`${s.submitted} · ${formatPercent(s.completionRate)}`, 'отправили из начавших'),
      stat(formatPercent(s.conversion), 'конверсия', 'Отправили / открыли'),
      stat(formatDuration(s.medianSeconds), 'медианное время заполнения')
    ),
    insight,
    h(
      'div',
      { class: 'card' },
      h('h2', null, 'Где уходят студенты'),
      h(
        'p',
        { class: 'muted small' },
        `Начали заполнять: ${s.started}. Бросили (нет активности 30+ минут): ${s.abandoned}. Заполняют прямо сейчас: ${s.inProgress}. Открыли и сразу ушли: ${s.bounced}.`
      ),
      s.fields.map((f, i) =>
        h(
          'div',
          { class: 'funnel-row' },
          h('div', null, h('div', null, `${i + 1}. ${f.label || 'Без названия'}`, f.required ? h('span', { class: 'muted' }, ' *') : null), h('div', { class: 'muted small' }, `${TYPE_TITLES[f.type]} · заполнили ${f.filled} (${formatPercent(f.filledRate)})`)),
          h('div', { class: 'bar' }, h('div', { style: `width:${(f.filled / maxFilled) * 100}%` })),
          h('div', { class: f.abandonedHere ? 'drop' : 'drop none' }, f.abandonedHere ? `ушли здесь: ${f.abandonedHere}` : '—')
        )
      ),
      s.stoppedAtSubmit > 0 && h('div', { class: 'funnel-row' }, h('div', null, 'Кнопка «Отправить»'), h('div'), h('div', { class: 'drop' }, `ушли здесь: ${s.stoppedAtSubmit}`)),
      h('p', { class: 'muted small', style: 'margin:12px 0 0' }, 'Студент «ушёл на вопросе», если последним заполнил вопрос перед ним и форму так и не отправил.')
    )
  );
}

route();
