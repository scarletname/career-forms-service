const path = require('path');
const { Store } = require('./store');
const { createApp } = require('./app');
const { createFormService } = require('./forms');
const { seedOnce } = require('./seed');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json');

async function main() {
  const store = new Store(DATA_FILE);
  store.load();
  await seedOnce(store, createFormService(store));

  const app = createApp({ store });
  const server = app.listen(PORT, () => {
    console.log(`Forms service is running: http://localhost:${PORT}/admin`);
    console.log(`Data file: ${DATA_FILE}`);
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
