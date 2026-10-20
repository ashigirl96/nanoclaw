import { createContext, useContext } from 'react';

import {
  siCloudflare,
  siConfluence,
  siDatadog,
  siDocker,
  siDropbox,
  siFathom,
  siFlydotio,
  siGithub,
  siGitlab,
  siGmail,
  siGoogleanalytics,
  siGooglecalendar,
  siGooglechat,
  siGoogleclassroom,
  siGooglecloud,
  siGoogledocs,
  siGoogledrive,
  siGoogleforms,
  siGooglemeet,
  siGooglephotos,
  siGooglesearchconsole,
  siGooglesheets,
  siGoogleslides,
  siGoogletasks,
  siHubspot,
  siJfrog,
  siJira,
  siLinear,
  siMongodb,
  siNotion,
  siResend,
  siSentry,
  siSupabase,
  siTodoist,
  siTrello,
  siVercel,
  siX,
  siYoutube,
  siZoom,
  type SimpleIcon,
} from 'simple-icons';

import type { ConnectedApp } from './api';

export const CATEGORIES = ['生産性', 'コミュニケーション', 'コード', 'クラウド', 'データ', 'その他'] as const;
export type Category = (typeof CATEGORIES)[number];

interface AppLook {
  category: Category;
  /** simple-icons drops some brands over trademark requests; those get a lettered tile in `color`. */
  icon?: SimpleIcon;
  color?: string;
}

// OneCLI's /v1/apps carries no icon or category, so the Console keeps its own.
const LOOKS: Record<string, AppLook> = {
  gmail: { category: 'コミュニケーション', icon: siGmail },
  'google-chat': { category: 'コミュニケーション', icon: siGooglechat },
  'google-meet': { category: 'コミュニケーション', icon: siGooglemeet },
  resend: { category: 'コミュニケーション', icon: siResend },
  linkedin: { category: 'コミュニケーション', color: '#0a66c2' },
  'outlook-mail': { category: 'コミュニケーション', color: '#0078d4' },
  slack: { category: 'コミュニケーション', color: '#4a154b' },
  x: { category: 'コミュニケーション', icon: siX },
  zoom: { category: 'コミュニケーション', icon: siZoom },
  'google-calendar': { category: '生産性', icon: siGooglecalendar },
  'google-drive': { category: '生産性', icon: siGoogledrive },
  'google-docs': { category: '生産性', icon: siGoogledocs },
  'google-sheets': { category: '生産性', icon: siGooglesheets },
  'google-slides': { category: '生産性', icon: siGoogleslides },
  'google-forms': { category: '生産性', icon: siGoogleforms },
  'google-tasks': { category: '生産性', icon: siGoogletasks },
  'google-contacts': { category: '生産性', color: '#1a73e8' },
  'google-photos': { category: '生産性', icon: siGooglephotos },
  'google-classroom': { category: '生産性', icon: siGoogleclassroom },
  notion: { category: '生産性', icon: siNotion },
  jira: { category: '生産性', icon: siJira },
  confluence: { category: '生産性', icon: siConfluence },
  todoist: { category: '生産性', icon: siTodoist },
  dropbox: { category: '生産性', icon: siDropbox },
  monday: { category: '生産性', color: '#ff3d57' },
  trello: { category: '生産性', icon: siTrello },
  'outlook-calendar': { category: '生産性', color: '#0078d4' },
  'microsoft-word': { category: '生産性', color: '#185abd' },
  'microsoft-onenote': { category: '生産性', color: '#7719aa' },
  linear: { category: '生産性', icon: siLinear },
  attio: { category: '生産性', color: '#3f3f46' },
  hubspot: { category: '生産性', icon: siHubspot },
  affinity: { category: '生産性', color: '#2a6ef0' },
  fathom: { category: '生産性', icon: siFathom },
  fireflies: { category: '生産性', color: '#e5139a' },
  granola: { category: '生産性', color: '#7a8c2e' },
  github: { category: 'コード', icon: siGithub },
  'github-app': { category: 'コード', icon: siGithub },
  gitlab: { category: 'コード', icon: siGitlab },
  docker: { category: 'コード', icon: siDocker },
  'jfrog-artifactory': { category: 'コード', icon: siJfrog },
  sentry: { category: 'コード', icon: siSentry },
  vercel: { category: 'クラウド', icon: siVercel },
  cloudflare: { category: 'クラウド', icon: siCloudflare },
  flyio: { category: 'クラウド', icon: siFlydotio },
  aws: { category: 'クラウド', color: '#ff9900' },
  'aws-role': { category: 'クラウド', color: '#ff9900' },
  'vertex-ai': { category: 'クラウド', icon: siGooglecloud },
  supabase: { category: 'クラウド', icon: siSupabase },
  'mongodb-atlas': { category: 'クラウド', icon: siMongodb },
  'google-admin': { category: 'クラウド', color: '#1a73e8' },
  'google-analytics': { category: 'データ', icon: siGoogleanalytics },
  'google-search-console': { category: 'データ', icon: siGooglesearchconsole },
  datadog: { category: 'データ', icon: siDatadog },
  youtube: { category: 'データ', icon: siYoutube },
};

export function lookOf(provider: string): AppLook {
  return LOOKS[provider] ?? { category: 'その他', color: '#525252' };
}

export const isConnected = (app: ConnectedApp) => app.accounts.length > 0;

export interface ConnectLink {
  provider: string;
  url: string;
}

const CODE = /((?:`{3,}|~{3,})[\s\S]*?(?:`{3,}|~{3,}|$)|``[^\n]*?``|`[^`\n]*`)/;
const U = String.raw`[^\s<>()\[\]"'` + '`' + String.raw`、。「」（）！？]`;
const CONNECT_URL = String.raw`https?://${U}+/connections\?${U}*\bconnect=${U}+`;
// A markdown link or autolink goes whole, so no empty `[label]()` or `<>` is left behind.
const CONNECT_MENTION = new RegExp(
  String.raw`\[[^\]\n]*\]\(\s*(${CONNECT_URL})\s*\)|<(${CONNECT_URL})>|(${CONNECT_URL})`,
  'g',
);
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

// Only a link to a known app on OneCLI's own origin earns the trusted card; anything else stays visible text.
export function connectLinksIn(text: string, apps: ConnectedApp[]): { links: ConnectLink[]; rest: string } {
  const links: ConnectLink[] = [];
  const take = (match: string, ...urls: Array<string | undefined>) => {
    const raw = urls.find(Boolean) ?? match;
    const trailing = raw.match(TRAILING_PUNCTUATION)?.[0] ?? '';
    const url = raw.slice(0, raw.length - trailing.length);
    const provider = providerOf(url, apps);
    if (!provider) return match;
    if (!links.some((l) => l.provider === provider)) links.push({ provider, url });
    return trailing;
  };
  // Odd segments are code, where a URL is something the Agent is showing, not offering.
  const segments = text.split(CODE).map((segment, i) =>
    i % 2 === 1
      ? segment
      : segment
          .replace(CONNECT_MENTION, (match, md, auto, bare) => take(match, md, auto, bare))
          .replace(/[ \t]+$/gm, '')
          .replace(/\n{3,}/g, '\n\n'),
  );
  if (links.length === 0) return { links, rest: text };
  return { links, rest: segments.join('').trim() };
}

function providerOf(url: string, apps: ConnectedApp[]): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const app = apps.find((a) => a.provider === parsed.searchParams.get('connect'));
  return app && new URL(app.connectUrl).origin === parsed.origin ? app.provider : null;
}

/** null until OneCLI's list loads, and always on an Install whose Gateway is not OneCLI. */
export const ConnectedAppsContext = createContext<ConnectedApp[] | null>(null);

export const useConnectedApps = () => useContext(ConnectedAppsContext);
