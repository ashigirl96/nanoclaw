import { TIMEZONE } from '../../config.js';
import { resolveTimezone } from '../../timezone.js';
import { type Route, ok } from './http.js';

export function settingsRoute(features: { connectedAccounts: boolean }): Route {
  return async (route) =>
    route === 'GET /api/settings' ? ok({ timezone: resolveTimezone(TIMEZONE), ...features }) : null;
}
