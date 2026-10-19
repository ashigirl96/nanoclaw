export interface StoredFile {
  id: string;
  name: string;
  mimeType: string;
}

export interface ChatMessage {
  id: string;
  agentGroupId: string;
  role: 'owner' | 'agent';
  text: string;
  reactions: string[];
  files: StoredFile[];
  createdAt: string;
  editedAt: string | null;
}

export interface Activity {
  working: boolean;
  tool: string | null;
}

export interface AgentGroupSummary {
  id: string;
  name: string;
  lastMessage: ChatMessage | null;
  activity: Activity;
  unread: number;
}

export interface Notice {
  kind: 'reply' | 'question' | 'approval';
  agentGroupId: string | null;
  body: string;
}

export interface Upload {
  name: string;
  mimeType: string;
  data: string;
}

export interface AgentGroupDetails {
  id: string;
  name: string;
  folder: string;
  createdAt: string;
}

export interface LibraryFile extends StoredFile {
  messageId: string;
  createdAt: string;
}

export interface Routine {
  seriesId: string;
  prompt: string;
  status: 'pending' | 'paused';
  schedule: string;
  nextRun: string | null;
  lastRun: string | null;
  runs: number;
  failedRuns: number;
  lastResult: string | null;
}

export interface Template {
  ref: string;
  name: string;
  description: string;
}

export type CreateAgentOutcome = { status: 'created'; agentGroup: { id: string; name: string } } | { status: 'held' };

export type ConsoleEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'activity'; agentGroupId: string; activity: Activity }
  | { type: 'unread'; agentGroupId: string; unread: number }
  | ({ type: 'notify' } & Notice)
  | { type: 'agent-groups' };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!res.ok) throw new Error(`${res.status} ${(await res.json().catch(() => ({}))).error ?? res.statusText}`);
  return (await res.json()) as T;
}

export const api = {
  agentGroups: () => request<AgentGroupSummary[]>('/api/agent-groups'),
  open: (agentGroupId: string) =>
    request<{ messages: ChatMessage[] }>(`/api/agent-groups/${encodeURIComponent(agentGroupId)}/open`, {
      method: 'POST',
      body: '{}',
    }),
  send: (agentGroupId: string, text: string, files: Upload[]) =>
    request<ChatMessage>(`/api/agent-groups/${encodeURIComponent(agentGroupId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text, files }),
    }),
  details: (agentGroupId: string) =>
    request<AgentGroupDetails>(`/api/agent-groups/${encodeURIComponent(agentGroupId)}`),
  library: (agentGroupId: string) =>
    request<LibraryFile[]>(`/api/agent-groups/${encodeURIComponent(agentGroupId)}/library`),
  routines: (agentGroupId: string) =>
    request<Routine[]>(`/api/agent-groups/${encodeURIComponent(agentGroupId)}/routines`),
  templates: () => request<Template[]>('/api/templates'),
  createAgent: (template: string, name: string) =>
    request<CreateAgentOutcome>('/api/agent-groups', {
      method: 'POST',
      body: JSON.stringify({ template, name }),
    }),
  markRead: (agentGroupId: string, messageId: string) =>
    request<{ unread: number }>(`/api/agent-groups/${encodeURIComponent(agentGroupId)}/read`, {
      method: 'POST',
      body: JSON.stringify({ messageId }),
    }),
};

export function fileUrl(file: StoredFile): string {
  return `/api/files/${encodeURIComponent(file.id)}`;
}

export function subscribe(onEvent: (event: ConsoleEvent) => void): () => void {
  const source = new EventSource('/api/events');
  source.onmessage = (e) => onEvent(JSON.parse(e.data) as ConsoleEvent);
  return () => source.close();
}

export function readUpload(file: File): Promise<Upload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        data: dataUrl.slice(dataUrl.indexOf(',') + 1),
      });
    };
    reader.readAsDataURL(file);
  });
}
