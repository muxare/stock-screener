// schemas/instrument.ts — one instrument's bars.

import { z } from 'zod';
import { InstrumentBarsSchema } from './rows.ts';

export const TickerParamsSchema = z.object({
  ticker: z.string().describe('The ticker exactly as the dataset lists it; case-sensitive.'),
});

export const InstrumentResponseSchema = InstrumentBarsSchema;

export type InstrumentResponse = z.output<typeof InstrumentResponseSchema>;
