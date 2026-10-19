export interface StoredFile {
  id: string;
  name: string;
  mimeType: string;
}

export interface CardOption {
  label: string;
  selectedLabel: string;
  value: string;
  style?: 'primary' | 'danger' | 'default';
}

/** An Approval Request or a Question; answered by picking one option. */
export interface ChoiceCard {
  type: 'approval' | 'question';
  questionId: string;
  title: string;
  question: string;
  options: CardOption[];
  resolution: string | null;
}

export interface LinkCard {
  type: 'links';
  title: string;
  description: string;
  children: string[];
  links: Array<{ label: string; url: string; style?: 'primary' | 'danger' | 'default' }>;
}

export type Card = ChoiceCard | LinkCard;

export interface ChatMessage {
  id: string;
  /** null for the Inbox. */
  agentGroupId: string | null;
  role: 'owner' | 'agent';
  text: string;
  card: Card | null;
  reactions: string[];
  files: StoredFile[];
  createdAt: string;
  editedAt: string | null;
}

export interface AgentGroupSummary {
  id: string;
  name: string;
  lastMessage: ChatMessage | null;
}

export interface Upload {
  name: string;
  mimeType: string;
  data: string;
}

export type ConsoleEvent = { type: 'message'; message: ChatMessage };

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
  inbox: () => request<ChatMessage[]>('/api/inbox'),
  answer: (messageId: string, value: string) =>
    request<ChatMessage>(`/api/messages/${encodeURIComponent(messageId)}/answer`, {
      method: 'POST',
      body: JSON.stringify({ value }),
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
