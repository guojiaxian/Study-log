import { getDb } from '../db/index.js';

export default async function healthRoutes(app) {
  app.get('/health', async () => {
    let dbReady = false;
    try { getDb().prepare('SELECT 1 AS x').get(); dbReady = true; } catch { dbReady = false; }
    return {
      status: dbReady ? 'ok' : 'degraded',
      dbReady,
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      uptimeSec: Math.round(process.uptime()),
      version: '1.1.0',
      time: new Date().toISOString(),
    };
  });
}
