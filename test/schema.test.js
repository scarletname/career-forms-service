const test = require('node:test');
const assert = require('node:assert/strict');
const { checkValue, validateAnswers, validateFormDefinition } = require('../shared/schema');

const field = (type, extra = {}) => ({ id: 'q', type, label: 'Q', required: false, ...extra });

test('required fields reject empty values', () => {
  assert.equal(checkValue(field('short_text', { required: true }), '   ').error, 'Обязательное поле');
  assert.equal(checkValue(field('multiple_choice', { required: true, options: ['a'] }), []).error, 'Обязательное поле');
  assert.deepEqual(checkValue(field('short_text'), ''), { value: null });
});

test('email and phone', () => {
  assert.equal(checkValue(field('email'), 'a@b.ru').value, 'a@b.ru');
  assert.ok(checkValue(field('email'), 'not-an-email').error);
  assert.equal(checkValue(field('phone'), '+7 (999) 123-45-67').value, '+7 (999) 123-45-67');
  assert.ok(checkValue(field('phone'), '12345').error);
  assert.ok(checkValue(field('phone'), '+7 999 abc').error);
});

test('url gets https:// when the scheme is missing', () => {
  assert.equal(checkValue(field('url'), 'github.com/user').value, 'https://github.com/user');
  assert.ok(checkValue(field('url'), 'javascript:alert(1)').error);
  assert.ok(checkValue(field('url'), 'hello').error);
});

test('number accepts a comma, date must exist', () => {
  assert.equal(checkValue(field('number'), '3,5').value, 3.5);
  assert.ok(checkValue(field('number'), 'abc').error);
  assert.equal(checkValue(field('date'), '2026-02-28').value, '2026-02-28');
  assert.ok(checkValue(field('date'), '2026-02-30').error);
});

test('choices must come from the option list', () => {
  const single = field('single_choice', { options: ['a', 'b'] });
  assert.equal(checkValue(single, 'a').value, 'a');
  assert.ok(checkValue(single, 'c').error);
  const multi = field('multiple_choice', { options: ['a', 'b', 'c'] });
  assert.deepEqual(checkValue(multi, ['c', 'a', 'a']).value, ['a', 'c']);
  assert.ok(checkValue(multi, ['a', 'x']).error);
  assert.ok(checkValue(multi, 'a').error);
});

test('validateAnswers drops unknown fields and collects errors', () => {
  const fields = [
    { id: 'name', type: 'short_text', label: 'Имя', required: true },
    { id: 'age', type: 'number', label: 'Возраст', required: false },
  ];
  const ok = validateAnswers(fields, { name: ' Аня ', extra: 'x' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.values, { name: 'Аня' });
  const bad = validateAnswers(fields, { age: 'много' });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['age', 'name']);
});

test('a form without fields or labels cannot be published', () => {
  assert.equal(validateFormDefinition({ title: 'T', fields: [] }).length, 1);
  const problems = validateFormDefinition({
    title: '',
    fields: [{ id: 'a', type: 'dropdown', label: '', options: [] }],
  });
  assert.equal(problems.length, 3);
});
