import { loadEnv } from './lib/loadEnv.js';
import { buildApp } from './app.js';
import { selfCheck } from './services/aiService.js';

// 本地直接启动时读取项目根目录 .env（生产由 systemd EnvironmentFile 注入）
loadEnv();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const app = await buildApp();

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// AI 连通性自检（未配置密钥时跳过），仅写日志
selfCheck()
  .then((r) => {
    if (r.configured) app.log.info({ ai: r }, r.ok ? 'AI 连通性自检通过' : 'AI 连通性自检未通过');
    else app.log.info('AI 未配置（AI_API_KEY 为空），AI 能力将降级为手动录入 / 规则分析');
  })
  .catch(() => {});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    app.log.info(`收到 ${sig}，正在优雅退出…`);
    await app.close();
    process.exit(0);
  });
}
