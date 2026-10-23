const fs = require('fs');
const path = require('path');

const EMPTY = () => ({ meta: {}, forms: [], responses: [], sessions: {} });

// Whole database lives in memory and is persisted to one JSON file.
// Writes are coalesced: many save() calls during one write produce one more write.
// Each write goes to a temp file first and is then renamed, so a crash
// never leaves a half-written db.json.
class Store {
  constructor(file) {
    this.file = file;
    this.data = null;
    this.dirty = false;
    this.pending = null;
  }

  load() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) {
      this.data = EMPTY();
      return;
    }
    const raw = fs.readFileSync(this.file, 'utf8');
    try {
      this.data = { ...EMPTY(), ...JSON.parse(raw) };
    } catch (err) {
      const backup = `${this.file}.corrupt-${Date.now()}`;
      fs.renameSync(this.file, backup);
      console.warn(`[store] ${this.file} is not valid JSON, moved to ${backup}, starting empty`);
      this.data = EMPTY();
    }
  }

  save() {
    this.dirty = true;
    if (!this.pending) this.pending = this._flushLoop();
    return this.pending;
  }

  async _flushLoop() {
    try {
      while (this.dirty) {
        this.dirty = false;
        await writeAtomic(this.file, JSON.stringify(this.data, null, 2));
      }
    } finally {
      this.pending = null;
    }
  }

  async flush() {
    while (this.pending) await this.pending;
  }
}

async function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, content, 'utf8');
  // On Windows rename can briefly fail with EPERM/EBUSY while another process
  // (antivirus, indexer) holds the target file open.
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(tmp, file);
      return;
    } catch (err) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
}

module.exports = { Store };
