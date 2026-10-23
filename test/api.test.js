const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/store');
const { createApp } = require('../src/app');

async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-test-'));
  const store = new Store(path.join(dir, 'db.json'));
  store.load();
  const server = createApp({ store }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch (e) {
      /* not JSON */
    }
    return { status: res.status, data, headers: res.headers };
  };
  const stop = async () => {
    server.close();
    await store.flush();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { call, stop, store, base };
}

test('manager builds a form, student submits, manager sees the response', async (t) => {
  const { call, stop, store } = await startServer();
  t.after(stop);

  const created = await call('POST', '/api/forms', {});
  assert.equal(created.status, 201);
  const form = created.data;
  assert.equal(form.status, 'draft');

  // Drafts are hidden from students.
  assert.equal((await call('GET', `/api/public/forms/${form.slug}`)).status, 404);
  assert.equal((await call('GET', `/api/public/forms/${form.slug}?preview`)).status, 200);

  const updated = await call('PUT', `/api/forms/${form.id}`, {
    title: 'Стажировка',
    fields: [
      { id: 'name', type: 'short_text', label: 'Имя', required: true },
      { id: 'track', type: 'single_choice', label: 'Направление', required: true, options: ['Frontend', 'Backend', 'Frontend'] },
      { id: 'note', type: 'long_text', label: '', required: false },
    ],
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.data.fields[1].options, ['Frontend', 'Backend']);

  // Empty label blocks publishing.
  const blocked = await call('POST', `/api/forms/${form.id}/publish`);
  assert.equal(blocked.status, 422);
  assert.equal(blocked.data.details[0].fieldId, 'note');

  await call('PUT', `/api/forms/${form.id}`, {
    fields: [...updated.data.fields.slice(0, 2), { id: 'note', type: 'long_text', label: 'Комментарий' }],
  });
  assert.equal((await call('POST', `/api/forms/${form.id}/publish`)).status, 200);

  // A live form cannot be broken by an edit.
  const broken = await call('PUT', `/api/forms/${form.id}`, { title: '  ' });
  assert.equal(broken.status, 422);

  const pub = await call('GET', `/api/public/forms/${form.slug}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.createdAt, undefined, 'internal fields are not exposed');

  const invalid = await call('POST', `/api/public/forms/${form.slug}/responses`, { answers: { track: 'Design' } });
  assert.equal(invalid.status, 422);
  assert.deepEqual(Object.keys(invalid.data.details).sort(), ['name', 'track']);

  const session = 'session-123456';
  await call('POST', `/api/public/forms/${form.slug}/events`, { type: 'view', sessionId: session });
  await call('POST', `/api/public/forms/${form.slug}/events`, { type: 'field', fieldId: 'name', sessionId: session });
  const ok = await call('POST', `/api/public/forms/${form.slug}/responses`, {
    answers: { name: '=HYPERLINK("x")', track: 'Backend' },
    sessionId: session,
  });
  assert.equal(ok.status, 201);

  const responses = await call('GET', `/api/forms/${form.id}/responses`);
  assert.equal(responses.data.responses.length, 1);
  assert.equal(responses.data.responses[0].answers.track, 'Backend');

  const csv = await call('GET', `/api/forms/${form.id}/responses.csv`);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.ok(csv.data.includes(`"'=HYPERLINK(""x"")"`), 'formula is neutralized');

  const stats = await call('GET', `/api/forms/${form.id}/stats`);
  assert.equal(stats.data.views, 1);
  assert.equal(stats.data.submitted, 1);
  assert.equal(stats.data.conversion, 1);

  // Closing stops new submissions.
  assert.equal((await call('POST', `/api/forms/${form.id}/close`)).status, 200);
  assert.equal((await call('GET', `/api/public/forms/${form.slug}`)).status, 410);
  const late = await call('POST', `/api/public/forms/${form.slug}/responses`, { answers: { name: 'A', track: 'Backend' } });
  assert.equal(late.status, 410);

  // Everything is persisted to disk.
  await store.flush();
  const onDisk = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  assert.equal(onDisk.responses.length, 1);
});

test('analytics shows the field where students stop', async (t) => {
  const { computeStats } = require('../src/analytics');
  const form = {
    fields: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ],
  };
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const s = (filled, submitted) => ({
    viewedAt: old,
    startedAt: filled.length ? old : null,
    submittedAt: submitted ? old : null,
    lastActivityAt: old,
    filled,
  });
  const stats = computeStats(form, [s([], false), s(['a'], false), s(['a'], false), s(['a', 'c'], false), s(['a', 'b', 'c'], true)], [{}]);
  assert.equal(stats.views, 5);
  assert.equal(stats.started, 4);
  assert.equal(stats.abandoned, 3);
  assert.equal(stats.worstField.id, 'b');
  assert.equal(stats.worstField.count, 2);
  assert.equal(stats.stoppedAtSubmit, 1);
});

test('unknown routes and bad JSON', async (t) => {
  const { call, stop, base } = await startServer();
  t.after(stop);
  assert.equal((await call('GET', '/api/forms/nope')).status, 404);
  assert.equal((await call('GET', '/api/public/forms/nope')).status, 404);
  const res = await fetch(`${base}/api/forms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);
});
