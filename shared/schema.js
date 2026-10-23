// Field types and answer validation. Shared between the server (require)
// and the browser (window.FormSchema), so both sides apply the same rules.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FormSchema = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FIELD_TYPES = [
    { type: 'short_text', title: 'Короткий текст' },
    { type: 'long_text', title: 'Длинный текст' },
    { type: 'email', title: 'Email' },
    { type: 'phone', title: 'Телефон' },
    { type: 'url', title: 'Ссылка' },
    { type: 'number', title: 'Число' },
    { type: 'date', title: 'Дата' },
    { type: 'single_choice', title: 'Один вариант' },
    { type: 'multiple_choice', title: 'Несколько вариантов' },
    { type: 'dropdown', title: 'Выпадающий список' },
  ];
  const TYPES = new Set(FIELD_TYPES.map((t) => t.type));
  const CHOICE_TYPES = new Set(['single_choice', 'multiple_choice', 'dropdown']);
  const PLACEHOLDER_TYPES = new Set(['short_text', 'long_text', 'email', 'phone', 'url', 'number']);

  const LIMITS = {
    title: 200,
    description: 2000,
    successMessage: 1000,
    label: 300,
    help: 500,
    placeholder: 200,
    option: 200,
    options: 50,
    fields: 100,
    shortAnswer: 500,
    longAnswer: 5000,
  };

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_RE = /^\+?[\d\s()-]+$/;
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isEmpty(v) {
    return (
      v === undefined ||
      v === null ||
      (typeof v === 'string' && v.trim() === '') ||
      (Array.isArray(v) && v.length === 0)
    );
  }

  // Validates and normalizes one answer. Returns { value } or { error };
  // value is null for an empty optional field.
  function checkValue(field, raw) {
    if (isEmpty(raw)) return field.required ? { error: 'Обязательное поле' } : { value: null };

    switch (field.type) {
      case 'short_text':
      case 'long_text': {
        if (typeof raw !== 'string') return { error: 'Некорректное значение' };
        const v = raw.trim();
        const max = field.type === 'short_text' ? LIMITS.shortAnswer : LIMITS.longAnswer;
        if (v.length > max) return { error: 'Не больше ' + max + ' символов' };
        return { value: v };
      }
      case 'email': {
        const v = String(raw).trim();
        if (v.length > 254 || !EMAIL_RE.test(v)) return { error: 'Введите email, например name@mail.ru' };
        return { value: v };
      }
      case 'phone': {
        const v = String(raw).trim();
        const digits = v.replace(/\D/g, '').length;
        if (!PHONE_RE.test(v) || digits < 10 || digits > 15) {
          return { error: 'Введите телефон, например +7 999 123-45-67' };
        }
        return { value: v };
      }
      case 'url': {
        let v = String(raw).trim();
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = 'https://' + v;
        let url;
        try {
          url = new URL(v);
        } catch (e) {
          return { error: 'Введите ссылку, например github.com/username' };
        }
        if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.') || v.length > 2000) {
          return { error: 'Введите ссылку, например github.com/username' };
        }
        return { value: v };
      }
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(',', '.'));
        if (!Number.isFinite(n)) return { error: 'Введите число' };
        return { value: n };
      }
      case 'date': {
        const m = DATE_RE.exec(String(raw));
        if (!m) return { error: 'Введите дату' };
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
          return { error: 'Такой даты не существует' };
        }
        return { value: m[0] };
      }
      case 'single_choice':
      case 'dropdown': {
        if (typeof raw !== 'string' || !(field.options || []).includes(raw)) {
          return { error: 'Выберите вариант из списка' };
        }
        return { value: raw };
      }
      case 'multiple_choice': {
        const options = field.options || [];
        if (!Array.isArray(raw) || !raw.every((v) => options.includes(v))) {
          return { error: 'Выберите варианты из списка' };
        }
        // Keep the option order, drop duplicates.
        return { value: options.filter((o) => raw.includes(o)) };
      }
      default:
        return { error: 'Неизвестный тип поля' };
    }
  }

  // Validates a whole submission. Answers to unknown fields are dropped.
  function validateAnswers(fields, answers) {
    const src = answers && typeof answers === 'object' ? answers : {};
    const values = {};
    const errors = {};
    for (const field of fields) {
      const r = checkValue(field, src[field.id]);
      if (r.error) errors[field.id] = r.error;
      else if (r.value !== null) values[field.id] = r.value;
    }
    return { ok: Object.keys(errors).length === 0, values, errors };
  }

  // Checks that a form can be shown to students. Returns a list of problems.
  function validateFormDefinition(form) {
    const problems = [];
    if (!form.title || !form.title.trim()) problems.push({ message: 'Укажите название формы' });
    if (!form.fields || form.fields.length === 0) {
      problems.push({ message: 'Добавьте хотя бы одно поле' });
    }
    (form.fields || []).forEach((field, i) => {
      const name = 'Поле ' + (i + 1);
      if (!field.label || !field.label.trim()) {
        problems.push({ fieldId: field.id, message: name + ': укажите текст вопроса' });
      }
      if (CHOICE_TYPES.has(field.type)) {
        const options = (field.options || []).filter((o) => o && o.trim());
        if (options.length === 0) {
          problems.push({ fieldId: field.id, message: name + ': добавьте варианты ответа' });
        }
      }
    });
    return problems;
  }

  return {
    FIELD_TYPES,
    TYPES,
    CHOICE_TYPES,
    PLACEHOLDER_TYPES,
    LIMITS,
    isEmpty,
    checkValue,
    validateAnswers,
    validateFormDefinition,
  };
});
