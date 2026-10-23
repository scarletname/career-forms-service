// CSV tuned for Excel with a Russian locale: ";" as the separator and a UTF-8
// BOM so Cyrillic is not garbled.
const SEP = ';';

function cell(value) {
  let s = value === null || value === undefined ? '' : Array.isArray(value) ? value.join(', ') : String(value);
  // Spreadsheet formula injection: a cell starting with = + - @ would be
  // executed by Excel. Numbers stay as they are.
  if (/^[=+\-@\t\r]/.test(s) && typeof value !== 'number') s = "'" + s;
  if (/[";\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function responsesToCsv(form, responses) {
  const header = ['№', 'Дата отправки', ...form.fields.map((f) => f.label || 'Без названия')];
  const rows = responses.map((r, i) => [
    i + 1,
    new Date(r.createdAt).toLocaleString('ru-RU'),
    ...form.fields.map((f) => r.answers[f.id]),
  ]);
  return '﻿' + [header, ...rows].map((row) => row.map(cell).join(SEP)).join('\r\n') + '\r\n';
}

module.exports = { responsesToCsv };
