// routes/portfolio.ts — the portfolio screenshot reader (hardening stage 3,
// phase C of `docs/cca-f-learning-plan.md`).
//
// The route is thin on purpose: everything that decides anything lives under
// `server/claude/`, and this file is the transport around it. What it does own
// is the boundary conditions — what an acceptable image is, how large a body may
// be, and which HTTP status each failure category deserves.
//
// **Nothing here logs a body.** The request body is a picture of a brokerage
// account and the response is its holdings; both are financial data and neither
// may reach a log line. Fastify logs a request's method and url and not its
// body, which is the behaviour this route depends on rather than merely enjoys,
// so the error paths below hand pino a category and a count and never a value.

import type { FastifyPluginAsync } from 'fastify';
import { RequestError } from '../handlers.ts';
import { config } from '../config.ts';
import { ClaudeError, toClaudeError } from '../claude/errors.ts';
import { MODEL } from '../claude/client.ts';
import { extractPortfolio, apiCaller, IMAGE_MEDIA_TYPES } from '../claude/portfolio/extract.ts';
import type { ImageMediaType, ScreenshotImage } from '../claude/portfolio/extract.ts';
import type { RouteDeps } from './deps.ts';

// A base64 screenshot is far larger than the 1 MiB the rest of the service
// allows, and smaller than the dev importer's 64 MiB. 12 MiB leaves room for a
// full-height retina screenshot and its JSON wrapper.
const MAX_BODY_BYTES = 12 << 20;

// The image itself, base64-encoded, before the JSON wrapper. The API's own
// per-image ceiling is the binding constraint; refusing a too-large image here
// with a clear message beats paying to have it refused upstream.
const MAX_IMAGE_BASE64_BYTES = 6 << 20;

// A data URL is what a browser's FileReader produces, and pasting one into this
// field is the obvious mistake to make. Rather than fail on it, strip it.
const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i;

interface ExtractBody {
  image?: { mediaType?: unknown; dataBase64?: unknown };
}

function readImage(body: ExtractBody): ScreenshotImage {
  const image = body.image;
  if (!image || typeof image !== 'object') {
    throw new RequestError('body must carry an "image" object');
  }
  if (typeof image.dataBase64 !== 'string' || image.dataBase64.trim() === '') {
    throw new RequestError('image.dataBase64 must be a non-empty base64 string');
  }
  let data: string = image.dataBase64;
  let mediaType: unknown = image.mediaType;
  const asDataUrl = DATA_URL.exec(data);
  if (asDataUrl) {
    // Trust the data URL's own media type over a caller-supplied one; they came
    // from the same file and the browser is the better witness.
    mediaType = asDataUrl[1].toLowerCase();
    data = data.slice(asDataUrl[0].length);
  }
  if (typeof mediaType !== 'string' || !(IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    throw new RequestError(`image.mediaType must be one of ${IMAGE_MEDIA_TYPES.join(', ')}`);
  }
  if (Buffer.byteLength(data, 'utf8') > MAX_IMAGE_BASE64_BYTES) {
    throw new RequestError('the image is too large — crop the screenshot to the holdings table');
  }
  return { mediaType: mediaType as ImageMediaType, dataBase64: data };
}

export const portfolioRoutes: FastifyPluginAsync<RouteDeps> = async (app, deps) => {
  // Is the feature wired up in this environment? The UI asks before offering a
  // button, the same way the dev tooling asks before showing itself — a feature
  // that answers 503 when clicked is worse than one that is not there.
  app.get('/portfolio/status', async () => ({
    available: config.anthropicApiKey !== null,
    model: MODEL,
  }));

  app.post('/portfolio/extract', { bodyLimit: MAX_BODY_BYTES }, async (request, reply) => {
    const image = readImage((request.body ?? {}) as ExtractBody);
    const started = Date.now();
    try {
      const result = await extractPortfolio(image, deps.store, deps.portfolioCaller ?? apiCaller());
      // Counts and timings only. The rows themselves never appear in a log line.
      request.log.info(
        {
          holdings: result.extraction.holdings.length,
          attempts: result.attempts,
          problems: result.problems.length,
          elapsedMs: Date.now() - started,
        },
        'portfolio extraction complete',
      );
      return result;
    } catch (err) {
      const claudeError: ClaudeError = toClaudeError(err);
      // `category` and `isRetryable`, never the message's cause and never the
      // image. This is also the shape phase E's MCP tools return.
      request.log.warn(
        { category: claudeError.category, isRetryable: claudeError.isRetryable, elapsedMs: Date.now() - started },
        'portfolio extraction failed',
      );
      return reply.code(claudeError.status).send(claudeError.toWire());
    }
  });
};
