import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { asOptionalDate, badRequest, conflict, notFound, requireFields, sendError } from '../helpers.js';

export default async function routes(app: FastifyInstance) {
  /** 考察期列表 */
  app.get('/probation', async (req) => {
    const status = (req.query as { status?: string }).status ?? '考察中';
    const { rows } = await db.query(
      `SELECT p.id, p.registration_id,
              to_char(p.start_date,'YYYY-MM-DD') AS start_date,
              to_char(p.end_date,'YYYY-MM-DD') AS end_date,
              (p.end_date - CURRENT_DATE)::int AS days_left,
              p.status, p.result_note,
              r.dharma_name, r.home_monastery, r.ordination_no
       FROM probation p
       JOIN registrations r ON r.id=p.registration_id
       WHERE ($1='' OR p.status=$1)
       ORDER BY
         CASE p.status WHEN '考察中' THEN 0 ELSE 1 END,
         p.end_date ASC`,
      [status],
    );
    return rows;
  });

  /** 考察评定：通过 -> 触发羯磨成为常住；未通过 -> 回到挂单/退单 */
  app.post('/probation/:id/decide', async (req, reply) => {
    try {
      const id = Number((req.params as { id: string }).id);
      const b = req.body as Record<string, unknown>;
      requireFields(b, ['result']);
      const result = String(b.result);
      if (result !== '通过' && result !== '未通过') throw badRequest('评定结果须为 通过/未通过');
      const resultNote = b.result_note ? String(b.result_note) : null;
      const karmaDate = asOptionalDate(b.karma_date, '羯磨日期');

      const out = await db.tx(async (q) => {
        const probs = await q.query<{ registration_id: number; status: string }>(
          `SELECT registration_id, status FROM probation WHERE id=$1 FOR UPDATE`,
          [id],
        );
        if (!probs.rows[0]) throw notFound('考察记录不存在');
        if (probs.rows[0].status !== '考察中') throw conflict('该考察期已评定');
        const regId = probs.rows[0].registration_id;

        if (result === '未通过') {
          await q.query(
            `UPDATE probation SET status='未通过', result_note=$1, decided_at=now() WHERE id=$2`,
            [resultNote, id],
          );
          // 考察未通过：仍可挂单，但床位保留；由知客另行安排退单
          return { result, resident_id: null };
        }

        // 考察通过 -> 羯磨仪式 -> 建立常住档案
        const reg = await q.query(
          `SELECT dharma_name, home_monastery, ordination_no, phone, bed_id
           FROM registrations WHERE id=$1 FOR UPDATE`,
          [regId],
        );
        if (!reg.rows[0]) throw notFound('挂单记录不存在');
        const r = reg.rows[0] as {
          dharma_name: string; home_monastery: string; ordination_no: string;
          phone: string | null; bed_id: number | null;
        };

        const generationName = b.generation_name ? String(b.generation_name) : null;
        const tonsureMaster = b.tonsure_master ? String(b.tonsure_master) : null;
        const ordinationDate = asOptionalDate(b.ordination_date, '受戒时间');
        const ordinationPlace = b.ordination_place ? String(b.ordination_place) : null;
        const position = b.position ? String(b.position) : '清众';

        const ins = await q.query<{ id: number }>(
          `INSERT INTO residents
             (registration_id, dharma_name, generation_name, tonsure_master,
              ordination_date, ordination_place, position, ordination_no, phone,
              status, karma_date)
           VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,'常住',COALESCE($10::date, CURRENT_DATE))
           RETURNING id`,
          [
            regId, r.dharma_name, generationName, tonsureMaster,
            ordinationDate, ordinationPlace, position, r.ordination_no, r.phone,
            karmaDate,
          ],
        );
        // 成为常住后释放云水堂床位，标记挂单结束
        await q.query(
          `UPDATE registrations SET status='转常住', bed_id=NULL,
                  leave_date=COALESCE($2::date, CURRENT_DATE)
           WHERE id=$1`,
          [regId, karmaDate],
        );
        await q.query(
          `UPDATE probation SET status='通过', result_note=$1, decided_at=now() WHERE id=$2`,
          [resultNote, id],
        );
        return { result, resident_id: ins.rows[0].id };
      });
      return out;
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
