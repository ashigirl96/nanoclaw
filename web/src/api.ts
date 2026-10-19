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

export interface FormField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'multi_select' | 'date';
  options?: string[];
}

/** A Question that asks for form inputs; its resolution lists the answered values. */
export interface FormCard {
  type: 'form';
  questionId: string;
  title: string;
  question: string;
  fields: FormField[];
  resolution: string | null;
}

export type FormValues = Record<string, string | string[]>;

export type Card = ChoiceCard | LinkCard | FormCard;

export function awaitsAnswer(card: Card): card is ChoiceCard | FormCard {
  return card.type !== 'links' && card.resolution === null;
}

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

export interface TaskSummary {
  taskId: string;
  prompt: string;
  status: 'pending' | 'paused';
  schedule: string;
  nextOccurrence: string | null;
  lastOccurrence: string | null;
  occurrences: number;
  failedOccurrences: number;
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
  tasks: (agentGroupId: string) =>
    request<TaskSummary[]>(`/api/agent-groups/${encodeURIComponent(agentGroupId)}/tasks`),
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
  inbox: () => request<ChatMessage[]>('/api/inbox'),
  answer: (messageId: string, value: string) =>
    request<ChatMessage>(`/api/messages/${encodeURIComponent(messageId)}/answer`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    }),
  answerForm: (messageId: string, values: FormValues) =>
    request<ChatMessage>(`/api/messages/${encodeURIComponent(messageId)}/answer`, {
      method: 'POST',
      body: JSON.stringify({ values }),
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
