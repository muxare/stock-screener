// routes/deps.ts — what every route plugin is handed.
//
// The routes are Fastify plugins and take their collaborators through the
// register options rather than reaching for a module singleton, which is what
// lets a test drive the real app over a fixture universe. The shape is one
// interface so a new dependency is added in one place rather than four.

import type { UniverseStore } from '../universe.ts';

export interface RouteDeps {
  store: UniverseStore;
}
