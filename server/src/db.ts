/**
 * 数据库适配层：
 * - 配置了 DATABASE_URL 时使用真实 PostgreSQL（pg 驱动）
 * - 未配置时使用内置 PGlite（WASM PostgreSQL），零配置演示，SQL 方言一致
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL;
const SEED = process.env.SEED === '1' || process.env.SEED === 'true';

/**
 * 将 SQL 脚本拆成单条语句（PGlite 的多语句解析器对某些表达式支持不佳）。
 * 正确处理：单引号字符串、标识符双引号、-- 行注释、/* 块注释 *​/、$$ 美元引用。
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  const isIdStart = (c: string) => /[A-Za-z_]/.test(c);
  while (i < sql.length) {
    const c = sql[i];
    const rest = sql.slice(i);
    // 行注释
    if (rest.startsWith('--')) {
      const nl = sql.indexOf('\n', i);
      const end = nl === -1 ? sql.length : nl + 1;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    // 块注释
    if (rest.startsWith('/*')) {
      const close = sql.indexOf('*/', i + 2);
      const end = close === -1 ? sql.length : close + 2;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    // 单引号字符串（含 '' 转义）
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      buf += sql.slice(i, j);
      i = j;
      continue;
    }
    // 双引号标识符
    if (c === '"') {
      const close = sql.indexOf('"', i + 1);
      const end = close === -1 ? sql.length : close + 1;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    // 美元引用 $tag$ ... $tag$
    if (c === '$' && isIdStart(sql[i + 1] ?? '')) {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$/.exec(rest);
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        const end = close === -1 ? sql.length : close + tag.length;
        buf += sql.slice(i, end);
        i = end;
        continue;
      }
    }
    if (c === ';') {
      const stmt = buf.trim();
      // 纯注释语句跳过
      if (stmt && stmt.split('\n').some((l) => l.trim() && !l.trim().startsWith('--'))) {
        out.push(stmt);
      }
      buf = '';
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  const tail = buf.trim();
  if (tail && tail.split('\n').some((l) => l.trim() && !l.trim().startsWith('--'))) out.push(tail);
  return out;
}

export type QueryParams = unknown[];

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

interface DbDriver {
  query<T = Record<string, unknown>>(sql: string, params?: QueryParams): Promise<QueryResult<T>>;
  tx<T>(fn: (q: DbDriver) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PgDriver implements DbDriver {
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url });
  }
  async query<T>(sql: string, params: QueryParams = []): Promise<QueryResult<T>> {
    return this.pool.query(sql, params) as unknown as Promise<QueryResult<T>>;
  }
  async tx<T>(fn: (q: DbDriver) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const q: DbDriver = {
        query: <T2 = Record<string, unknown>>(s: string, p?: QueryParams) =>
          client.query(s, p) as unknown as Promise<QueryResult<T2>>,
        tx: () => {
          throw new Error('不支持嵌套事务');
        },
        close: async () => {},
      };
      const result = await fn(q);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}

class PGliteDriver implements DbDriver {
  constructor(private db: PGlite) {}
  async query<T>(sql: string, params: QueryParams = []): Promise<QueryResult<T>> {
    // 带参数时必须单语句；无参数时自动拆分多语句脚本
    if (params.length === 0) {
      const stmts = splitStatements(sql);
      if (stmts.length > 1) {
        await this.db.exec(stmts.join(';\n'));
        return { rows: [], rowCount: 0 };
      }
      const res = await this.db.query<T>(stmts[0] ?? sql);
      return { rows: res.rows ?? [], rowCount: res.rows?.length ?? 0 };
    }
    const res = await this.db.query<T>(sql, params);
    return { rows: res.rows ?? [], rowCount: res.rows?.length ?? 0 };
  }
  async tx<T>(fn: (q: DbDriver) => Promise<T>): Promise<T> {
    // PGlite 的 exec 事务在单连接下直接使用 BEGIN/COMMIT 即可
    await this.db.exec('BEGIN');
    try {
      const result = await fn(this);
      await this.db.exec('COMMIT');
      return result;
    } catch (err) {
      await this.db.exec('ROLLBACK');
      throw err;
    }
  }
  async close() {
    await this.db.close();
  }
}

export let db: DbDriver;
export let dbKind: 'postgres' | 'pglite';

export async function initDb(): Promise<void> {
  const schemaPath = resolve(__dirname, '../../db/schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  if (DATABASE_URL) {
    dbKind = 'postgres';
    const driver = new PgDriver(DATABASE_URL);
    // pg 支持一次执行多条语句
    await driver.query(schema);
    db = driver;
    console.log(`[db] 已连接 PostgreSQL: ${DATABASE_URL.replace(/:[^:@/]*@/, ':***@')}`);
  } else {
    dbKind = 'pglite';
    const pgdata = resolve(process.cwd(), '.pgdata');
    const instance = new PGlite(pgdata);
    await instance.waitReady;
    const driver = new PGliteDriver(instance);
    for (const stmt of splitStatements(schema)) {
      await instance.exec(stmt);
    }
    db = driver;
    const count = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM rooms');
    if (count.rows[0].n === 0) {
      await seed(driver);
      console.log('[db] PGlite 首次启动，已写入演示数据（SEED 可显式控制）');
    }
    console.log(`[db] 使用内置 PGlite: ${pgdata}`);
  }

  if (SEED) {
    await seed(db);
    console.log('[db] 已重新写入演示数据');
  }
}

/** 演示数据：3 间寮房、若干挂单/考察/常住僧人、一周考勤（含缺勤满 3 次示例） */
async function seed(d: DbDriver): Promise<void> {
  // ---- 常住 ----
  const residentSeed = [
    ['智明', '隆字辈', '上净下慧长老', '2010-10-15', '江西云居山真如寺', '知客', 'JD2010001', '2011-04-20'],
    ['慧光', '宗字辈', '上绍下云法师', '2015-05-08', '江苏宝华山隆昌寺', '维那', 'JD2015028', '2016-02-19'],
    ['德清', '湛字辈', '上明下乘和尚', '2018-11-02', '福建莆田广化寺', '典座', 'JD2018116', '2019-06-15'],
  ] as const;
  for (const r of residentSeed) {
    const exists = await d.query(
      `SELECT 1 FROM residents WHERE ordination_no=$1`,
      [r[6]],
    );
    if (!exists.rows.length) {
      await d.query(
        `INSERT INTO residents
           (dharma_name, generation_name, tonsure_master, ordination_date,
            ordination_place, position, ordination_no, status, karma_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'常住',$8)`,
        [...r],
      );
    }
  }

  // ---- 寮房与床位 ----
  const roomSeed = [
    ['东单-101', '东单寮', '云水堂'],
    ['东单-102', '东单寮', null],
    ['西单-201', '西单寮', '老参寮'],
  ] as const;
  for (const [roomNo, building, remark] of roomSeed) {
    const roomExists = await d.query(
      `SELECT id FROM rooms WHERE room_no=$1`,
      [roomNo],
    );
    let roomId: number;
    if (roomExists.rows.length) {
      roomId = (roomExists.rows[0] as { id: number }).id;
    } else {
      const ins = await d.query<{ id: number }>(
        `INSERT INTO rooms (room_no, building, remark) VALUES ($1,$2,$3) RETURNING id`,
        [roomNo, building, remark],
      );
      roomId = ins.rows[0].id;
    }
    for (let i = 1; i <= 4; i++) {
      const bedNo = `${i}号床`;
      const bedExists = await d.query(
        `SELECT 1 FROM beds WHERE room_id=$1 AND bed_no=$2`,
        [roomId, bedNo],
      );
      if (!bedExists.rows.length) {
        await d.query(
          `INSERT INTO beds (room_id, bed_no) VALUES ($1,$2)`,
          [roomId, bedNo],
        );
      }
    }
  }

  // ---- 挂单：一位正常、一位超期、一位进入考察 ----
  async function ensureReg(o: {
    name: string; home: string; no: string; ago: number; days: number;
    phone?: string | null; bedRoom?: string; bedOffset?: number; status?: string;
  }): Promise<number> {
    const existing = await d.query<{ id: number }>(
      `SELECT id FROM registrations WHERE ordination_no=$1`,
      [o.no],
    );
    if (existing.rows[0]) return existing.rows[0].id;

    let bedId: number | null = null;
    if (o.bedRoom) {
      const bed = await d.query<{ id: number }>(
        `SELECT b.id FROM beds b JOIN rooms r ON r.id=b.room_id
         WHERE r.room_no=$1 ORDER BY b.bed_no LIMIT 1 OFFSET $2`,
        [o.bedRoom, o.bedOffset ?? 0],
      );
      bedId = bed.rows[0]?.id ?? null;
    }
    const status = o.status ?? '挂单中';
    const ins = await d.query<{ id: number }>(
      `INSERT INTO registrations
         (dharma_name, home_monastery, ordination_no, arrival_date, planned_stay_days,
          phone, bed_id, status, check_in_date, leave_date)
       VALUES ($1,$2,$3, CURRENT_DATE - $4::int, $5, $6, $7::bigint, $8::varchar,
               CURRENT_DATE - $4::int,
               CASE WHEN $8::varchar='转常住' THEN CURRENT_DATE - $4::int + 3 END)
       RETURNING id`,
      [o.name, o.home, o.no, o.ago, o.days, o.phone ?? null, bedId, status],
    );
    return ins.rows[0].id;
  }

  const idFakong = await ensureReg({
    name: '法空', home: '河南嵩山少林寺', no: 'JD2024071', ago: 4, days: 15,
    phone: '13800000001', bedRoom: '东单-101', bedOffset: 0,
  });
  await ensureReg({
    name: '行远', home: '浙江天台山国清寺', no: 'JD2023980', ago: 20, days: 10,
    phone: '13800000002', bedRoom: '东单-101', bedOffset: 1,
  });
  const idChangzhao = await ensureReg({
    name: '常照', home: '广东韶关南华寺', no: 'JD2024120', ago: 95, days: 180,
    status: '挂单中',
  });

  const probExists = await d.query(
    `SELECT 1 FROM probation WHERE registration_id=$1 AND status='考察中'`,
    [idChangzhao],
  );
  if (!probExists.rows.length) {
    await d.query(
      `INSERT INTO probation (registration_id, start_date, end_date, status)
       VALUES ($1, CURRENT_DATE - 92, CURRENT_DATE, '考察中')`,
      [idChangzhao],
    );
  }

  // ---- 考勤：法空 3 次缺勤（前天晚课 + 大前天/上前天早课）；智明 2 次 ----
  const fakongAbsent: Array<[string, number]> = [
    ['morning', 3], ['evening', 2], ['morning', 1],
  ];
  for (const [session, ago] of fakongAbsent) {
    const exists = await d.query(
      `SELECT 1 FROM attendance
       WHERE session=$1 AND attend_date=CURRENT_DATE - $2::int
         AND person_type='registration' AND reg_id=$3`,
      [session, ago, idFakong],
    );
    if (!exists.rows.length) {
      await d.query(
        `INSERT INTO attendance (session, attend_date, person_type, reg_id, resident_id, status)
         VALUES ($1, CURRENT_DATE - $2::int, 'registration', $3, NULL, 'absent')`,
        [session, ago, idFakong],
      );
    }
  }
  const zhiming = await d.query<{ id: number }>(
    `SELECT id FROM residents WHERE dharma_name='智明'`,
  );
  if (zhiming.rows[0]) {
    for (const ago of [3, 2]) {
      const exists = await d.query(
        `SELECT 1 FROM attendance
         WHERE session='morning' AND attend_date=CURRENT_DATE - $1::int
           AND person_type='resident' AND resident_id=$2`,
        [ago, zhiming.rows[0].id],
      );
      if (!exists.rows.length) {
        await d.query(
          `INSERT INTO attendance (session, attend_date, person_type, reg_id, resident_id, status)
           VALUES ('morning', CURRENT_DATE - $1::int, 'resident', NULL, $2, 'absent')`,
          [ago, zhiming.rows[0].id],
        );
      }
    }
  }
}