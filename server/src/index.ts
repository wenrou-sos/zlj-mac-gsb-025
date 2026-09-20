import Fastify from 'fastify';
import cors from '@fastify/cors';
import { initDb, db, dbKind } from './db.js';
import registrationsRoutes from './routes/registrations.js';
import roomsRoutes from './routes/rooms.js';
import probationRoutes from './routes/probation.js';
import residentsRoutes from './routes/residents.js';
import attendanceRoutes from './routes/attendance.js';
import dashboardRoutes from './routes/dashboard.js';

async function main() {
  await initDb();

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.setErrorHandler((err: unknown, _req, reply) => {
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: e.message });
    }
    if (e.code === '23505') return reply.code(409).send({ error: '数据冲突：唯一约束被违反（可能编号/床位重复）' });
    if (e.code === '23503') return reply.code(409).send({ error: '存在关联数据，无法删除或修改' });
    if (e.code === '23514') return reply.code(400).send({ error: '数据未通过校验规则检查' });
    app.log.error(err);
    return reply.code(500).send({ error: '服务器内部错误' });
  });

  app.get('/api/health', async () => ({ ok: true, db: dbKind }));
  await app.register(registrationsRoutes, { prefix: '/api' });
  await app.register(roomsRoutes, { prefix: '/api' });
  await app.register(probationRoutes, { prefix: '/api' });
  await app.register(residentsRoutes, { prefix: '/api' });
  await app.register(attendanceRoutes, { prefix: '/api' });
  await app.register(dashboardRoutes, { prefix: '/api' });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`[server] 接口地址 http://localhost:${port}/api`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  await db.close();
  process.exit(0);
});
