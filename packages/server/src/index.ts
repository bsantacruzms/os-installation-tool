import { createApp } from './app.js';
import { config } from './config.js';

const app = await createApp();

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    config.webRoot
      ? `Serving the web app from ${config.webRoot}`
      : 'No built web app found. Run the Vite dev server, or build the web package.',
  );
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
