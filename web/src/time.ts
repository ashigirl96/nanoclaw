import { createContext, useCallback, useContext, useMemo } from 'react';

/** The install timezone; undefined until the Console tells it, which falls back to the browser's. */
export const TimezoneContext = createContext<string | undefined>(undefined);

export function useFormatTime(): (iso: string) => string {
  const timeZone = useContext(TimezoneContext);
  return useCallback((iso: string) => new Date(iso).toLocaleString(undefined, { timeZone }), [timeZone]);
}

export function useFormatDivider(): (iso: string) => string {
  const timeZone = useContext(TimezoneContext);
  const format = useMemo(
    () =>
      new Intl.DateTimeFormat('ja-JP', {
        month: 'long',
        day: 'numeric',
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone,
      }),
    [timeZone],
  );
  return useCallback((iso: string) => format.format(new Date(iso)), [format]);
}

const DIVIDER_GAP_MS = 15 * 60 * 1000;

export function startsNewStretch(previousIso: string | undefined, iso: string): boolean {
  return !previousIso || Date.parse(iso) - Date.parse(previousIso) > DIVIDER_GAP_MS;
}
