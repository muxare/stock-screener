// help/helpMode.ts — sticky help mode, shared between the provider and the
// button that switches it on.
//
// Help mode is the accessible twin of the summon modifier: while it is on,
// plain hover opens cards everywhere, exactly as it did before the modifier
// existed. That covers anyone who cannot comfortably hold a key while moving a
// pointer, and it gives the hidden gesture a visible home in the TopBar.
//
// It lives in its own module so HelpProvider.tsx keeps exporting nothing but
// its component. Session-only by design: turning it into a stored preference
// would be a different feature (defaulting help mode on), decided then.

import { createContext, useContext } from 'react';

export interface HelpModeApi {
  helpMode: boolean;
  setHelpMode: (on: boolean) => void;
}

const noop = () => {};

export const HelpModeContext = createContext<HelpModeApi>({ helpMode: false, setHelpMode: noop });

/** Read and set help mode. Outside a HelpProvider it reports off and does nothing. */
export function useHelpMode(): HelpModeApi {
  return useContext(HelpModeContext);
}
