// A session that has had no activity for this long is counted as abandoned;
// newer ones may still be filling the form in.
const IDLE_MS = 30 * 60 * 1000;

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function ratio(a, b) {
  return b ? a / b : null;
}

// Funnel for one form: opened -> started -> submitted, plus per-field
// numbers showing where students stop.
function computeStats(form, sessions, responses, nowMs = Date.now()) {
  const started = sessions.filter((s) => s.startedAt);
  const submitted = sessions.filter((s) => s.submittedAt);
  const unfinished = started.filter((s) => !s.submittedAt);
  const abandoned = unfinished.filter((s) => nowMs - Date.parse(s.lastActivityAt) > IDLE_MS);

  // An abandoned session "stopped" at the field right after the furthest one
  // it filled (skipped optional fields before that do not count). If it got
  // past the last field, it stopped at the submit button.
  const stoppedAt = new Map(form.fields.map((f) => [f.id, 0]));
  let stoppedAtSubmit = 0;
  for (const s of abandoned) {
    let furthest = -1;
    form.fields.forEach((f, i) => {
      if (s.filled.includes(f.id)) furthest = i;
    });
    const next = form.fields[furthest + 1];
    if (next) stoppedAt.set(next.id, stoppedAt.get(next.id) + 1);
    else stoppedAtSubmit++;
  }

  const fields = form.fields.map((f) => {
    const filled = started.filter((s) => s.filled.includes(f.id)).length;
    return {
      id: f.id,
      label: f.label,
      type: f.type,
      required: f.required,
      filled,
      filledRate: ratio(filled, started.length),
      abandonedHere: stoppedAt.get(f.id),
    };
  });

  let worstField = null;
  for (const f of fields) {
    if (f.abandonedHere > 0 && (!worstField || f.abandonedHere > worstField.abandonedHere)) worstField = f;
  }

  const durations = submitted
    .map((s) => (Date.parse(s.submittedAt) - Date.parse(s.startedAt || s.viewedAt)) / 1000)
    .filter((d) => d >= 0);

  return {
    views: sessions.length,
    started: started.length,
    submitted: submitted.length,
    responses: responses.length,
    inProgress: unfinished.length - abandoned.length,
    abandoned: abandoned.length,
    bounced: sessions.length - started.length,
    startRate: ratio(started.length, sessions.length),
    completionRate: ratio(submitted.length, started.length),
    conversion: ratio(submitted.length, sessions.length),
    medianSeconds: median(durations),
    stoppedAtSubmit,
    worstField: worstField && { id: worstField.id, label: worstField.label, count: worstField.abandonedHere },
    fields,
  };
}

module.exports = { computeStats, IDLE_MS };
