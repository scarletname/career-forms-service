const path = require('path');
const { Store } = require('./store');
const { createApp } = require('./app');
const { createFormService } = require('./forms');
const { seedOnce } = require('./seed');

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json');

function readPort() {
  const raw = process.env.PORT;
  if (raw === undefined || raw.trim() === '') return 3000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`PORT="${raw}" is not a valid port number (0-65535).`);
    process.exit(1);
  }
  return port;
}

async function main() {
  const port = readPort();
  const store = new Store(DATA_FILE);
  store.load();
  await seedOnce(store, createFormService(store));

  const app = createApp({ store });
  const server = app.listen(port, () => {
    const actual = server.address().port;
    console.log(`Forms service is running: http://localhost:${actual}`);
    console.log(`Admin panel: http://localhost:${actual}/admin`);
    console.log(`Data file: ${DATA_FILE}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Stop the other process or start on another port, e.g. PORT=3001 npm start`);
    } else if (err.code === 'EACCES') {
      console.error(`No permission to listen on port ${port}. Try a port above 1024.`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });

  const shutdown = async () => {
    server.close();
    await store.flush();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
