import { loadConfig } from './config.js';
import { buildApp } from './app.js';

const config = loadConfig();
const app = await buildApp(config);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });
console.log(`ShopWiz listening on ${config.host}:${config.port}`);
