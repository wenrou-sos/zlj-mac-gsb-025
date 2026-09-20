import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { asOptionalDate, badRequest, conflict, notFound, requireFields, sendError } from '../helpers.js';

const POSITIONS = ['住持', '知客', '维那', '典座', '僧值', '寮元', '衣钵', '书记', '汤药', '清众'] as const;
const RES_STATUS = ['常住', '外出', '退住'] as const;

export default async function routes(app: FastifyInstance) {
  /** 常住僧人列表 */
  app.get('/residents', async (req) => {
    const status = (req.query as { status?: string }).status;
    const params: unknown[] = [];
    let where = '';
    if (status) {
      if (!(RES_STATUS as readonly string[]).includes(status)) throw badRequest('状态不合法');
      params.push(status);
      where = 'WHERE res.status=$1';
    }
    const { rows } = await db.query(
      `SELECT res.id, res.dharma_name, res.generation_name, res.tonsure_master,
              to_char(res.ordination_date,'YYYY-MM-DD') AS ordination_date,
              res.ordination_place, res.position, res.ordination_no, res.phone, res.status,
              to_char(res.karma_date,'YYYY-MM-DD') AS karma_date,
              COALESCE(s.absent_count,0)::int AS absent_count
       FROM residents res
       LEFT JOIN v_absence_summary s ON s.person_type='resident' AND s.person_id=res.id
       ${where}
       ORDER BY
         array_position(ARRAY['住持','知客','维那','典座','僧值','寮元','衣钵','书记','汤药','清众'], res.position),
         res.id`,
      params,
    );
    return rows;
  });

  /** 新增常住（特殊情况下直接录入，不经考察流程） */
  app.post('/residents', async (req, reply) => {
    try {
      const b = req.body as Record<string, unknown>;
      requireFields(b, ['dharma_name']);
      if (b.position && !(POSITIONS as readonly string[]).includes(String(b.position))) {
        throw badRequest('职务不合法');
      }
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO residents
           (dharma_name, generation_name, tonsure_master, ordination_date,
            ordination_place, position, ordination_no, phone, karma_date)
         VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9::date)
         RETURNING id`,
        [
          b.dharma_name,
          b.generation_name ?? null,
          b.tonsure_master ?? null,
          asOptionalDate(b.ordination_date, '受戒时间'),
          b.ordination_place ?? null,
          b.position ?? '清众',
          b.ordination_no ?? null,
          b.phone ?? null,
          asOptionalDate(b.karma_date, '羯磨日期'),
        ],
      );
      return reply.code(201).send(rows[0]);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** 更新常住档案（职务变动、补录戒腊信息等） */
  app.put('/residents/:id', async (req, reply) => {
    try {
      const id = Number((req.params as { id: string }).id);
      const b = req.body as Record<string, unknown>;
      if (b.position && !(POSITIONS as readonly string[]).includes(String(b.position))) {
        throw badRequest('职务不合法');
      }
      if (b.status && !(RES_STATUS as readonly string[]).includes(String(b.status))) {
        throw badRequest('状态不合法');
      }
      const { rows } = await db.query<{ id: number }>(
        `UPDATE residents SET
           dharma_name=COALESCE($2,dharma_name),
           generation_name=COALESCE($3,generation_name),
           tonsure_master=COALESCE($4,tonsure_master),
           ordination_date=COALESCE($5::date,ordination_date),
           ordination_place=COALESCE($6,ordination_place),
           position=COALESCE($7,position),
           ordination_no=COALESCE($8,ordination_no),
           phone=COALESCE($9,phone),
           status=COALESCE($10,status),
           karma_date=COALESCE($11::date,karma_date)
         WHERE id=$1 RETURNING id`,
        [
          id,
          b.dharma_name,
          b.generation_name ?? null,
          b.tonsure_master ?? null,
          asOptionalDate(b.ordination_date, '受戒时间'),
          b.ordination_place ?? null,
          b.position ?? null,
          b.ordination_no ?? null,
          b.phone ?? null,
          b.status ?? null,
          asOptionalDate(b.karma_date, '羯磨日期'),
        ],
      );
      if (!rows.length) throw notFound('常住僧人不存在');
      return { ok: true };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** 退住 */
  app.post('/residents/:id/leave', async (req, reply) => {
    try {
      const id = Number((req.params as { id: string }).id);
      const { rows } = await db.query<{ id: number }>(
        `UPDATE residents SET status='退住' WHERE id=$1 AND status<>'退住' RETURNING id`,
        [id],
      );
      if (!rows.length) throw conflict('僧人不存在或已退住');
      return { ok: true };
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
