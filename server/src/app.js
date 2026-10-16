import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCompress from '@fastify/compress';
import fastifyHelmet from '@fastify/helmet';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AppError } from './lib/errors.js';
import { runMigrations } from './db/migrate.js';
import { closeDb } from './db/index.js';

import healthRoutes from './routes/health.js';
import subjectRoutes from './routes/subjects.js';
import examTypeRoutes from './routes/examTypes.js';
import examRoutes from './routes/exams.js';
import aiRoutes from './routes/ai.js';
import statsRoutes from './routes/stats.js';
import analysisRoutes from './routes/analysis.js';
import schoolRoutes from './routes/schools.js';
import configRoutes from './routes/config.js';
import dataRoutes from './routes/data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../../web/dist');

export async function buildApp() {
  // 启动即执行迁移；失败则拒绝启动（对应开发手册 4.6）
  runMigrations();

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL || 'info' },
    bodyLimit: 20 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false, // 单文件 SPA，避免内联样式被拦截
    crossOriginEmbedderPolicy: false,
  });
  await app.register(fastifyCompress, { global: true });

  // 统一错误处理（错误码表见开发手册 5.1）
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.httpStatus).send({ code: err.code, message: err.message, data: err.data ?? null });
    }
    if (err.validation) {
      return reply.status(400).send({ code: 1001, message: `参数校验失败：${err.message}`, data: null });
    }
    if (err.statusCode === 413) {
      return reply.status(413).send({ code: 1001, message: '请求体过大', data: null });
    }
    req.log?.error(err);
    return reply.status(500).send({ code: 5000, message: '服务器内部错误', data: null });
  });

  const hasDist = fs.existsSync(path.join(DIST_DIR, 'index.html'));
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.status(404).send({ code: 2001, message: '资源不存在', data: null });
    }
    if (hasDist) return reply.sendFile('index.html');
    return reply.status(404).send({ code: 2001, message: '资源不存在', data: null });
  });

  await app.register(async (v1) => {
    await v1.register(healthRoutes);
    await v1.register(subjectRoutes);
    await v1.register(examTypeRoutes);
    await v1.register(examRoutes);
    await v1.register(aiRoutes);
    await v1.register(statsRoutes);
    await v1.register(analysisRoutes);
    await v1.register(schoolRoutes);
    await v1.register(configRoutes);
    await v1.register(dataRoutes);
  }, { prefix: '/api/v1' });

  if (hasDist) {
    await app.register(fastifyStatic, { root: DIST_DIR, wildcard: true });
  }

  app.addHook('onClose', async () => { closeDb(); });

  return app;
}
