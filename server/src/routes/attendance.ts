import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { asDate, badRequest, requireFields, sendError } from '../helpers.js';

type AttStatus = 'present' | 'absent' | 'leave';
const STATUSES: AttStatus[] = ['present', 'absent', 'leave'];

/** 当日在寺人员名单（常住 + 挂单中），带上当次考勤状态 */
async function buildRoster(date: string, session: string) {
  const { rows } = await db.query(
    `SELECT p.person_type, p.person_id, p.dharma_name, p.subtitle,
            att.status, att.note
     FROM (
       SELECT 'registration' AS person_type, r.id AS person_id, r.dharma_name,
              r.home_monastery AS subtitle
       FROM registrations r
       WHERE r.status='挂单中'
         AND r.arrival_date <= $1
         AND COALESCE(r.leave_date, CURRENT_DATE) >= $1
       UNION ALL
       SELECT 'resident', res.id, res.dharma_name,
              '常住 · ' || res.position AS subtitle
       FROM residents res
       WHERE res.status='常住'
     ) p
     LEFT JOIN attendance att
       ON att.person_type=p.person_type
      AND att.attend_date=$1 AND att.session=$2
      AND ((att.person_type='registration' AND att.reg_id=p.person_id)
        OR (att.person_type='resident' AND att.resident_id=p.person_id))
     ORDER BY p.person_type, p.person_id`,
    [date, session],
  );
  return rows;
}

export default async function routes(app: FastifyInstance) {
  /** 考勤名单：GET /attendance/roster?date=YYYY-MM-DD&session=morning|evening */
  app.get('/attendance/roster', async (req, reply) => {
    try {
      const q = req.query as { date?: string; session?: string };
      const date = q.date ?? new Date().toISOString().slice(0, 10);
      const session = q.session ?? 'morning';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('日期格式不正确');
      if (session !== 'morning' && session !== 'evening') throw badRequest('课次不合法');
      const roster = await buildRoster(date, session);
      const { rows: stats } = await db.query(
        `SELECT person_type, person_id, absent_count FROM v_absence_summary`,
      );
      return {
        date,
        session,
        roster,
        stats,
        summary: {
          total: roster.length,
          marked: roster.filter((x) => x.status).length,
          absent: roster.filter((x) => x.status === 'absent').length,
        },
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /**
   * 批量保存考勤
   * body: { date, session, records: [{ person_type, person_id, status, note? }] }
   */
  app.post('/attendance', async (req, reply) => {
    try {
      const b = req.body as Record<string, unknown>;
      requireFields(b, ['date', 'session', 'records']);
      const date = asDate(b.date, '日期');
      const session = String(b.session);
      if (session !== 'morning' && session !== 'evening') throw badRequest('课次不合法');
      const records = b.records as Record<string, unknown>[];
      if (!Array.isArray(records)) throw badRequest('records 须为数组');

      const alerts: Array<{ person_type: string; person_id: number; dharma_name: string; absent_count: number }> = [];

      await db.tx(async (q) => {
        for (const rec of records) {
          const personType = String(rec.person_type);
          const personId = Number(rec.person_id);
          const status = String(rec.status) as AttStatus;
          if (personType !== 'registration' && personType !== 'resident') throw badRequest('人员类型不合法');
          if (!STATUSES.includes(status)) throw badRequest('考勤状态不合法');
          if (!Number.isInteger(personId)) throw badRequest('人员 ID 不合法');

          const regId = personType === 'registration' ? personId : null;
          const residentId = personType === 'resident' ? personId : null;

          // 先校验人员当前是否在寺
          const exists = await q.query(
            personType === 'registration'
              ? `SELECT id FROM registrations WHERE id=$1 AND status='挂单中'`
              : `SELECT id FROM residents WHERE id=$1 AND status='常住'`,
            [personId],
          );
          if (!exists.rows.length) throw badRequest(`人员 ${personId} 当前不在寺，无法登记考勤`);

          await q.query(
            `INSERT INTO attendance (session, attend_date, person_type, reg_id, resident_id, status, note)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (attend_date, session, person_type, reg_id, resident_id)
             DO UPDATE SET status=EXCLUDED.status, note=EXCLUDED.note`,
            [session, date, personType, regId, residentId, status, rec.note ?? null],
          );
        }

        // 缺勤累计满 3 次：自动生成提醒返回，前端弹通知
        if (records.length) {
          const { rows } = await q.query(
            `SELECT s.person_type, s.person_id, s.dharma_name, s.absent_count
             FROM v_absence_alerts s
             WHERE (s.person_type, s.person_id) IN (
               SELECT v.person_type, v.person_id FROM (
                 ${records
                   .filter((r) => Number.isInteger(Number(r.person_id)))
                   .map((r) => `SELECT '${r.person_type === 'resident' ? 'resident' : 'registration'}'::text AS person_type, ${Number(r.person_id)}::bigint AS person_id`)
                   .join(' UNION ALL ')}
               ) v
             )
             ORDER BY s.absent_count DESC`,
          );
          alerts.push(...(rows as typeof alerts));
        }
      });

      return reply.code(201).send({ ok: true, alerts });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** 单人考勤历史 */
  app.get('/attendance/history', async (req, reply) => {
    try {
      const q = req.query as { person_type?: string; person_id?: string };
      if (!q.person_type || !q.person_id) throw badRequest('缺少 person_type/person_id');
      const personType = q.person_type;
      const personId = Number(q.person_id);
      if (personType !== 'registration' && personType !== 'resident') throw badRequest('人员类型不合法');
      const { rows } = await db.query(
        `SELECT id,
                to_char(attend_date,'YYYY-MM-DD') AS attend_date,
                session, status, note
         FROM attendance
         WHERE person_type=$1
           AND ((person_type='registration' AND reg_id=$2)
             OR (person_type='resident' AND resident_id=$2))
         ORDER BY attend_date DESC, session DESC
         LIMIT 100`,
        [personType, personId],
      );
      return rows;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** 缺勤提醒名单（满 3 次） */
  app.get('/attendance/alerts', async () => {
    const { rows } = await db.query(
      `SELECT person_type, person_id, dharma_name, absent_count,
              to_char(last_absent_date,'YYYY-MM-DD') AS last_absent_date
       FROM v_absence_alerts
       ORDER BY absent_count DESC, last_absent_date DESC`,
    );
    return rows;
  });
}
