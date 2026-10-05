// dom-events.d.ts — the two DOM event types `src/help/trigger.ts` names.
//
// The glossary resource imports `src/help/glossary.ts`, which imports
// `trigger.ts` for the summon-key label, and one function there is typed against
// browser events. The server project compiles without the DOM library on
// purpose, so a server module cannot reach for `window` by accident; declaring
// only the three flags that function reads keeps it that way instead of
// widening the whole server to DOM types for a label string.

interface KeyboardEvent { readonly ctrlKey: boolean; readonly metaKey: boolean; readonly shiftKey: boolean }
interface MouseEvent { readonly ctrlKey: boolean; readonly metaKey: boolean; readonly shiftKey: boolean }
