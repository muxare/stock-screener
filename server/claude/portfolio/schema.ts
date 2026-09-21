// claude/portfolio/schema.ts — what a screenshot is allowed to become.
//
// This schema is the contract in three places at once: it is handed to the API
// as the response format, so the model cannot answer in any other shape; it is
// what `messages.parse()` validates the answer against; and it is what the
// retry loop re-checks after a repair attempt. One definition, three uses — the
// alternative is asking for JSON in prose and hoping, which is how a field
// quietly changes name between the prompt and the parser.
//
// Two design rules from phase C of `docs/cca-f-learning-plan.md` are expressed
// here rather than only in the prompt, because a rule the schema cannot state is
// a rule the model can ignore:
//
//   - **Every readable-or-not field is nullable.** `null` is a first-class
//     answer meaning "I could not read this", and it is the only alternative to
//     a correct value. There is no third option in which the model guesses,
//     because there is no field shape that would hold a guess.
//   - **Confidence is a three-way judgement, not a number.** An earlier draft
//     asked for a 0–1 float. A float invites false precision from a model that
//     is not calibrated to two decimal places, and phase D has to be able to ask
//     "what is the mean confidence on the fields that were wrong?" — a question
//     three honest buckets answer better than a hundred dishonest ones.

import { z } from 'zod';

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** Sorts low confidence first, which is the order the confirm UI shows rows in. */
export const CONFIDENCE_ORDER: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export const HoldingSchema = z.object({
  /**
   * The ticker exactly as printed, when the screenshot prints one. Avanza's
   * holdings table often prints only the instrument name, so this is nullable
   * and the name carries the identification.
   */
  ticker: z.string().nullable(),
  /** The instrument name as printed. */
  name: z.string().nullable(),
  /** Share count. Non-null only when every digit is legible. */
  shares: z.number().nullable(),
  /** Average acquisition price per share (Avanza prints this as GAV). */
  averagePrice: z.number().nullable(),
  /** Last price per share, when the row shows one. */
  lastPrice: z.number().nullable(),
  /** Market value of the position as printed, not recomputed. */
  marketValue: z.number().nullable(),
  /**
   * What the *prices* on this row are quoted in — `averagePrice` and
   * `lastPrice` — as an ISO code, or null when the row does not say.
   */
  currency: z.string().nullable(),
  /**
   * What `marketValue` is denominated in, which is **not always the same**.
   *
   * Avanza prints a position's value in the account's currency and its price in
   * the instrument's, so a US holding in a Swedish account prints a price in USD
   * beside a value in SEK. Treating those as one field made the consistency
   * check in `validate.ts` call a correctly-read Tesla row a misread — found on
   * the first real screenshot, 2026-09-21.
   */
  valueCurrency: z.string().nullable(),
  /** How sure the model is about this row as a whole. */
  confidence: z.enum(CONFIDENCE_LEVELS),
  /** Why anything above is null, or what is odd about the row. */
  note: z.string().nullable(),
});

export const ExtractionSchema = z.object({
  /** The account name or tab title, when the screenshot shows one. */
  accountLabel: z.string().nullable(),
  /** One entry per position row. An empty array is a legitimate answer. */
  holdings: z.array(HoldingSchema),
  /**
   * Anything true about the image as a whole rather than about one row: a table
   * cut off at the bottom, a blurred column, a currency the header never names.
   */
  warnings: z.array(z.string()),
});

export type Holding = z.infer<typeof HoldingSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;
