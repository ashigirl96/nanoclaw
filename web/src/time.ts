import { createContext, useCallback, useContext } from 'react';

/** The install timezone; undefined until the Console tells it, which falls back to the browser's. */
export const TimezoneContext = createContext<string | undefined>(undefined);

export function useFormatTime(): (iso: string) => string {
  const timeZone = useContext(TimezoneContext);
  return useCallback((iso: string) => new Date(iso).toLocaleString(undefined, { timeZone }), [timeZone]);
}
