import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { asDate, asInt, asOptionalDate, badRequest, conflict, notFound, requireFields, sendError } from '../helpers.js';

const STATUS = ['挂单中', '已退单', '转常住'] as const;

export default async function routes(app: FastifyInstance) {
  /** 挂单列表，可按状态筛选 */
  app.get('/registrations', async (req, reply) => {
    try {
      const status = (req.query as { status?: string }).status;
      const params: unknown[] = [];
      let where = '';
      if (status) {
        if (!(STATUS as readonly string[]).includes(status)) throw badRequest('状态不合法');
        params.push(status);
        where = 'WHERE r.status = $1';
      }
      const { rows } = await db.query(
        `SELECT r.id, r.dharma_name, r.home_monastery, r.ordination_no,
                to_char(r.arrival_date,'YYYY-MM-DD') AS arrival_date,
                r.planned_stay_days,
                to_char(r.check_in_date,'YYYY-MM-DD') AS check_in_date,
                to_char(r.leave_date,'YYYY-MM-DD') AS leave_date,
                r.phone, r.status, r.bed_id,
                rm.room_no, b.bed_no,
                (r.arrival_date + (r.planned_stay_days || ' days')::interval)::date AS due_date,
                CASE WHEN r.status='挂单中'
                      AND r.arrival_date + (r.planned_stay_days || ' days')::interval < CURRENT_DATE
                     THEN (CURRENT_DATE - (r.arrival_date + (r.planned_stay_days || ' days')::interval)::date)::int
                     ELSE 0 END AS overdue_days,
                COALESCE(s.absent_count,0)::int AS absent_count
         FROM registrations r
         LEFT JOIN beds b ON b.id = r.bed_id
         LEFT JOIN rooms rm ON rm.id = b.room_id
         LEFT JOIN v_absence_summary s ON s.person_type='registration' AND s.person_id=r.id
         ${where}
         ORDER BY r.created_at DESC`,
        params,
      );
      return rows;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** 新建挂单登记 */
  app.post('/registrations', async (req, reply) => {
    try {
      const b = req.body as Record<string, unknown>;
      requireFields(b, ['dharma_name', 'home_monastery', 'ordination_no', 'arrival_date', 'planned_stay_days']);
      const arrivalDate = asDate(b.arrival_date, '到寺日期');
      const plannedStayDays = asInt(b.planned_stay_days, '预计住几天', 1);
      const phone = b.phone ? String(b.phone) : null;
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO registrations
           (dharma_name, home_monastery, ordination_no, arrival_date, planned_stay_days, phone)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [b.dharma_name, b.home_monastery, b.ordination_no, arrivalDate, plannedStayDays, phone],
      );
      return reply.code(201).send(rows[0]);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** 安排寮房床位（入住） */
  app.post('/registrations/:id/assign-bed', async (req, reply) => {
    try {
      const id = Number((req.params as { id: string }).id);
      const b = req.body as Record<string, unknown>;
      requireFields(b, ['bed_id']);
      const bedId = asInt(b.bed_id, '床位');
      await db.tx(async (q) => {
        const reg = await q.query<{ status: string }>(`SELECT status FROM registrations WHERE id=$1`, [id]);
        if (!reg.rows[0]) throw notFound('挂单记录不存在');
        if (reg.rows[0].status !== '挂单中') throw conflict('只有挂单中的僧人可以安排床位');
        const bed = await q.query(`SELECT id FROM beds WHERE id=$1`, [bedId]);
        if (!bed.rows[0]) throw notFound('床位不存在');
        const occ = await q.query(
          `SELECT id FROM registrations WHERE bed_id=$1 AND status='挂单中'`,
          [bedId],
        );
        if (occ.rows.length) throw conflict('该床位已有僧人入住');
        await q.query(
          `UPDATE registrations
             SET bed_id=$1, check_in_date=COALESCE(check_in_date, CURRENT_DATE)
           WHERE id=$2`,
          [bedId, id],
        );
      });
      return { ok: true };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** 延长挂单（增加预计天数） */
  app.post('/registrations/:id/extend', async (req, reply) => {
    try {
      const id = Number((req.params as { id: string }).id);
      const b = req.body as Record<string, unknown>;
      requireFields(b, ['days']);
      const days = asInt(b.days, '延长天数', 1);
      const { rows } = await db.query<{ status: string }>(
        `UPDATE registrations SET planned_stay_days = planned_stay_days + $1
         WHERE id=$2 RETURNING status`,
        [days, id],
      );
      if (!rows[0]) throw notFound('挂单记录不存在');
      if (rows[0].status !== '挂单中') throw conflict('该僧人已不在挂单状态');
      return { ok: true };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** 退单（离开寺院），释放床位 */
  app.post('/registrations/:id/checkout', async (req, reply) => {
    try {
      const id = Number((req.params as { id: string }).id);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const leaveDate = asOptionalDate(b.leave_date, '退单日期') ?? undefined;
      const { rows } = await db.query<{ status: string }>(
        `UPDATE registrations
           SET status='已退单', bed_id=NULL,
               leave_date=COALESCE($2::date, CURRENT_DATE)
         WHERE id=$1 RETURNING status`,
        [id, leaveDate],
      );
      if (!rows[0]) throw notFound('挂单记录不存在');
      return { ok: true };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** 申请进入常住考察期（3-6 个月） */
  app.post('/registrations/:id/probation', async (req, reply) => {
    try {
      const id = Number((req.params as { id: string }).id);
      const b = req.body as Record<string, unknown>;
      requireFields(b, ['months']);
      const months = asInt(b.months, '考察期月数', 3, 6);
      const startDate = asOptionalDate(b.start_date, '考察开始日期') ?? undefined;
      const result = await db.tx(async (q) => {
        const reg = await q.query<{ status: string }>(
          `SELECT status FROM registrations WHERE id=$1 FOR UPDATE`,
          [id],
        );
        if (!reg.rows[0]) throw notFound('挂单记录不存在');
        if (reg.rows[0].status !== '挂单中') throw conflict('只有挂单中的僧人可以申请考察');
        const dup = await q.query(
          `SELECT id FROM probation WHERE registration_id=$1 AND status='考察中'`,
          [id],
        );
        if (dup.rows.length) throw conflict('该僧人已有进行中的考察期');
        const { rows } = await q.query(
          `INSERT INTO probation (registration_id, start_date, end_date)
           VALUES ($1, COALESCE($2::date, CURRENT_DATE),
                   (COALESCE($2::date, CURRENT_DATE) + ($3 || ' months')::interval)::date)
           RETURNING id`,
          [id, startDate, months],
        );
        return rows[0];
      });
      return reply.code(201).send(result);
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
