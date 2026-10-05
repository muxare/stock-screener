// schemas/dev.ts — the DEV_TOOLS-gated data tooling (STORY-031 import, STORY-035
// DB-selector).
//
// These routes exist only when the flag registers them, and so do their entries
// in the OpenAPI document. The request schemas check shape; whether a config
// name is one the importer discovered, whether a path is one the selector
// listed, and whether `path` and `synthetic` were both given are the handlers'
// own checks in `devImport.ts` and `devDataset.ts`, unchanged.

import { z } from 'zod';

export const ImportOptionsResponseSchema = z.object({
  configs: z.array(z.object({
    name: z.string().describe('Config file name; the import request echoes it back.'),
    json: z.unknown().describe('The parsed config, shown verbatim in the editor.'),
  })),
  dataDir: z.string().describe('The browsable root for CSV input.'),
  dataEntries: z.array(z.object({
    name: z.string(),
    type: z.enum(['file', 'dir']),
    path: z.string(),
  })),
  targetDb: z.string().describe('Where an import writes by default.'),
});

export const DevImportRequestSchema = z.object({
  // Same wording the handler used for an absent name, so an empty body reads
  // the same as it did before the schema existed.
  configName: z.string({ error: (iss) => (iss.input === undefined ? 'configName is required' : undefined) }),
  configJson: z.unknown().optional().describe('An inline-edited config that overrides the named file.'),
  inputPath: z.string().optional().describe('A server-side CSV file or directory (browse).'),
  uploads: z.array(z.object({ name: z.string(), content: z.string() })).optional()
    .describe('CSV contents uploaded inline, instead of inputPath.'),
  targetDb: z.string().optional(),
});

export const DevImportResponseSchema = z.object({
  files: z.number(),
  instruments: z.number(),
  bars: z.number(),
  skipped: z.number(),
  errors: z.array(z.object({ file: z.string(), line: z.number(), reason: z.string(), sample: z.string() })),
  targetDb: z.string(),
  universe: z.number().describe('Warm-universe size after the reload.'),
});

const datasetKind = z.enum(['synthetic', 'sqlite']);

export const DatabasesResponseSchema = z.object({
  activeKind: datasetKind,
  activePath: z.string().nullable(),
  scanDir: z.string(),
  databases: z.array(z.object({
    name: z.string(),
    path: z.string().describe('Absolute path, passed back verbatim to activate.'),
    sizeBytes: z.number(),
    instruments: z.number().nullable().describe('Name count, or null when the file is not a readable market-data DB.'),
    valid: z.boolean(),
    active: z.boolean(),
  })),
});

export const ActivateRequestSchema = z.object({
  path: z.string().optional().describe('Switch to this SQLite DB (one the list surfaced).'),
  synthetic: z.boolean().optional().describe('Or switch back to the synthetic generator.'),
});

export const ActivateResponseSchema = z.object({
  activeKind: datasetKind,
  activePath: z.string().nullable(),
  universe: z.number(),
});

export type ImportOptionsResponse = z.output<typeof ImportOptionsResponseSchema>;
export type DevImportRequest = z.input<typeof DevImportRequestSchema>;
export type DevImportResponse = z.output<typeof DevImportResponseSchema>;
export type DatabasesResponse = z.output<typeof DatabasesResponseSchema>;
export type ActivateRequest = z.input<typeof ActivateRequestSchema>;
export type ActivateResponse = z.output<typeof ActivateResponseSchema>;
