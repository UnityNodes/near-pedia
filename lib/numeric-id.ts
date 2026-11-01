import { z } from 'zod';

export const numericId = z.union([
  z.number().int(),
  z.string().trim().regex(/^\d{1,15}$/).transform(Number),
]);
