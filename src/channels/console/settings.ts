import { TIMEZONE } from '../../config.js';
import { resolveTimezone } from '../../timezone.js';
import { type Route, ok } from './http.js';

export const settingsRoute: Route = async (route) =>
  route === 'GET /api/settings' ? ok({ timezone: resolveTimezone(TIMEZONE) }) : null;
