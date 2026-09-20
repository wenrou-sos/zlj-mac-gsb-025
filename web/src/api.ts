import { createDiscreteApi } from 'naive-ui';

const { message } = createDiscreteApi(['message']);

const BASE = '/api';

export class ApiError extends Error {}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.error ?? `请求失败（${res.status}）`;
    throw new ApiError(msg);
  }
  return data as T;
}

/** 调用接口并自动弹出成功/失败提示 */
export async function apiAction<T>(
  desc: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    const r = await fn();
    message.success(`${desc}成功`);
    return r;
  } catch (err) {
    message.error(`${desc}失败：${(err as Error).message}`);
    return null;
  }
}

export { message };
