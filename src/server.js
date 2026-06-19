import Fastify from 'fastify';
import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';
import { postSignal, getSignals } from './signals.js';

dotenv.config();
const API_KEY = process.env.API_KEY || 'change-me';
const PORT = Number(process.env.PORT || 8080);

export function buildApp(options = {}) {
  const app = Fastify({ logger: options.logger ?? { level: 'info' } });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/healthz') return;
    const key = req.headers['x-api-key'];
    if (!key || key !== API_KEY) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.post('/v1/signals', postSignal);
  app.get('/v1/signals', getSignals);

  return app;
}

export async function startServer() {
  const app = buildApp();

  try {
    await app.listen({ host: '0.0.0.0', port: PORT });
  } catch (e) {
    app.log.error(e);
    process.exit(1);
  }

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
