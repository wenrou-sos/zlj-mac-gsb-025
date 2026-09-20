import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';

export default async function routes(app: FastifyInstance) {
  /** 首页概览统计与待办提醒 */
  app.get('/dashboard', async () => {
    const [stats, alerts, overdue, due, occupancy] = await Promise.all([
      db.query(
        `SELECT
           (SELECT COUNT(*) FROM registrations WHERE status='挂单中')::int AS active_guests,
           (SELECT COUNT(*) FROM probation WHERE status='考察中')::int AS on_probation,
           (SELECT COUNT(*) FROM residents WHERE status='常住')::int AS residents,
           (SELECT COUNT(*) FROM beds)::int AS beds_total,
           (SELECT COUNT(*) FROM registrations WHERE status='挂单中' AND bed_id IS NOT NULL)::int AS beds_used`,
      ),
      db.query(
        `SELECT person_type, person_id, dharma_name, absent_count,
                to_char(last_absent_date,'YYYY-MM-DD') AS last_absent_date
         FROM v_absence_alerts ORDER BY absent_count DESC`,
      ),
      db.query(
        `SELECT id, dharma_name,
                to_char(arrival_date,'YYYY-MM-DD') AS arrival_date,
                planned_stay_days,
                to_char(due_date,'YYYY-MM-DD') AS due_date,
                overdue_days::int
         FROM v_overdue_registrations ORDER BY overdue_days DESC`,
      ),
      db.query(
        `SELECT id, registration_id, dharma_name,
                to_char(start_date,'YYYY-MM-DD') AS start_date,
                to_char(end_date,'YYYY-MM-DD') AS end_date,
                days_left::int
         FROM v_probation_due
         ORDER BY days_left ASC`,
      ),
      db.query(
        `SELECT r.room_no, COUNT(b.id)::int AS total,
                COUNT(reg.id)::int AS used
         FROM rooms r
         JOIN beds b ON b.room_id=r.id
         LEFT JOIN registrations reg ON reg.bed_id=b.id AND reg.status='挂单中'
         GROUP BY r.id ORDER BY r.room_no`,
      ),
    ]);

    return {
      stats: stats.rows[0],
      absenceAlerts: alerts.rows,
      overdue: overdue.rows,
      probationDue: due.rows,
      occupancy: occupancy.rows,
    };
  });
}
