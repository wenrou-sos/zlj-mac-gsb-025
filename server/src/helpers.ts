import type { FastifyReply } from 'fastify';

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg);
export const notFound = (msg = '记录不存在') => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

/** 校验必填字段 */
export function requireFields(body: Record<string, unknown> | null | undefined, fields: string[]): void {
  if (!body || typeof body !== 'object') throw badRequest('请求体格式不正确');
  for (const f of fields) {
    const v = (body as Record<string, unknown>)[f];
    if (v === undefined || v === null || v === '') throw badRequest(`缺少必填字段：${f}`);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function asDate(v: unknown, field: string): string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) throw badRequest(`${field} 须为 YYYY-MM-DD 日期格式`);
  return v;
}

export function asInt(v: unknown, field: string, min?: number, max?: number): number {
  const n = Number(v);
  if (!Number.isInteger(n)) throw badRequest(`${field} 须为整数`);
  if (min !== undefined && n < min) throw badRequest(`${field} 不能小于 ${min}`);
  if (max !== undefined && n > max) throw badRequest(`${field} 不能大于 ${max}`);
  return n;
}

export function asOptionalDate(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  return asDate(v, field);
}

export function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof HttpError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  const code = (err as { code?: string })?.code;
  if (code === '23505') return reply.code(409).send({ error: '数据冲突：唯一约束被违反（可能编号/床位重复）' });
  if (code === '23503') return reply.code(409).send({ error: '存在关联数据，无法删除或修改' });
  if (code === '23514') return reply.code(400).send({ error: '数据未通过校验规则检查' });
  console.error(err);
  return reply.code(500).send({ error: '服务器内部错误' });
}
