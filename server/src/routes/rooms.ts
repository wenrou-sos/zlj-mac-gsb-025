import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { asInt, conflict, notFound, requireFields, sendError } from '../helpers.js';

export default async function routes(app: FastifyInstance) {
  /** 寮房列表（含床位总数/已占用数） */
  app.get('/rooms', async () => {
    const { rows } = await db.query(
      `SELECT r.id, r.room_no, r.building, r.remark,
              COUNT(DISTINCT b.id)::int AS bed_total,
              COUNT(DISTINCT reg.id)::int AS bed_used
       FROM rooms r
       LEFT JOIN beds b ON b.room_id = r.id
       LEFT JOIN registrations reg ON reg.bed_id = b.id AND reg.status='挂单中'
       GROUP BY r.id
       ORDER BY r.room_no`,
    );
    return rows;
  });

  /** 房间详情：床位清单及当前住众 */
  app.get('/rooms/:id/beds', async (req, reply) => {
    try {
      const id = Number((req.params as { id: string }).id);
      const { rows } = await db.query(
        `SELECT b.id, b.bed_no,
                reg.id AS reg_id, reg.dharma_name, reg.status AS occupant_status
         FROM beds b
         LEFT JOIN registrations reg ON reg.bed_id = b.id AND reg.status='挂单中'
         WHERE b.room_id=$1
         ORDER BY b.bed_no`,
        [id],
      );
      if (!rows.length) {
        const room = await db.query('SELECT id FROM rooms WHERE id=$1', [id]);
        if (!room.rows.length) throw notFound('房间不存在');
      }
      return rows;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** 新建寮房，可一次性生成指定数量床位 */
  app.post('/rooms', async (req, reply) => {
    try {
      const b = req.body as Record<string, unknown>;
      requireFields(b, ['room_no']);
      const bedCount = asInt(b.bed_count ?? 1, '床位数', 1, 50);
      const result = await db.tx(async (q) => {
        const ins = await q.query<{ id: number }>(
          `INSERT INTO rooms (room_no, building, remark)
           VALUES ($1,$2,$3) RETURNING id`,
          [b.room_no, b.building ?? null, b.remark ?? null],
        );
        const roomId = ins.rows[0].id;
        for (let i = 1; i <= bedCount; i++) {
          await q.query(`INSERT INTO beds (room_id, bed_no) VALUES ($1,$2)`, [
            roomId,
            `${i}号床`,
          ]);
        }
        return { id: roomId };
      });
      return reply.code(201).send(result);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** 为已有房间追加床位 */
  app.post('/rooms/:id/beds', async (req, reply) => {
    try {
      const id = Number((req.params as { id: string }).id);
      const b = req.body as Record<string, unknown>;
      requireFields(b, ['bed_no']);
      const room = await db.query('SELECT id FROM rooms WHERE id=$1', [id]);
      if (!room.rows.length) throw notFound('房间不存在');
      await db.query(`INSERT INTO beds (room_id, bed_no) VALUES ($1,$2)`, [id, b.bed_no]);
      return reply.code(201).send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** 删除空寮房（仍有在住僧人时拒绝） */
  app.delete('/rooms/:id', async (req, reply) => {
    try {
      const id = Number((req.params as { id: string }).id);
      const occ = await db.query(
        `SELECT COUNT(*)::int AS n FROM registrations r
         JOIN beds b ON b.id=r.bed_id
         WHERE b.room_id=$1 AND r.status='挂单中'`,
        [id],
      );
      if ((occ.rows[0] as { n: number }).n > 0) throw conflict('该寮房仍有僧人入住，无法删除');
      const del = await db.query(`DELETE FROM rooms WHERE id=$1`, [id]);
      if (!del.rowCount) throw notFound('房间不存在');
      return { ok: true };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** 空闲床位下拉数据（供安排床位使用） */
  app.get('/beds/available', async () => {
    const { rows } = await db.query(
      `SELECT b.id, b.bed_no, r.id AS room_id, r.room_no
       FROM beds b
       JOIN rooms r ON r.id=b.room_id
       WHERE NOT EXISTS (
         SELECT 1 FROM registrations reg
         WHERE reg.bed_id=b.id AND reg.status='挂单中'
       )
       ORDER BY r.room_no, b.bed_no`,
    );
    return rows;
  });
}
