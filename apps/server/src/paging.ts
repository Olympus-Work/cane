import { BadRequestException } from '@nestjs/common';

/** `limit` query: integer 1-100, default 50. */
export function parseLimit(v: string | undefined): number {
  if (v === undefined) return 50;
  if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 100) throw new BadRequestException({ code: 'bad_limit', message: 'limit must be 1-100' });
  return Number(v);
}

/** `before` query: an id cursor, a positive integer. */
export function parseBefore(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v) || Number(v) < 1) throw new BadRequestException({ code: 'bad_before', message: 'before must be a positive integer' });
  return Number(v);
}
