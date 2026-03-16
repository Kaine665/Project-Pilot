/**
 * chat-9090.ts
 * 封装 http://81.68.249.18:9090 的 REST API 调用
 *
 * 该后端使用：
 * - HTTP API（邮箱登录、好友管理、聊天列表、历史消息）
 * - Socket.IO（实时发送/接收消息）
 */

export const CHAT_API = 'http://81.68.249.18:9090/api';
export const CHAT_SOCKET_URL = 'http://81.68.249.18:9090';

export const CHAT_TOKEN_KEY = 'pp_chat_9090_token';
export const CHAT_USER_KEY = 'pp_chat_9090_user';

// ── 类型定义 ──────────────────────────────────────────────────────────────

export interface ChatUser9090 {
  id: string;
  username: string;
  email: string;
  avatar: string | null;
  lastSeenAt?: string;
}

export interface ChatFriend {
  id: string;
  username: string;
  avatar: string | null;
  lastSeenAt?: string;
}

export interface ChatFriendRequest {
  id: string;
  senderId: string;
  receiverId: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  createdAt: string;
  sender?: ChatFriend;
}

export interface ChatMessage9090 {
  id: string;
  content: string;
  type: 'TEXT' | 'AI_SUMMARY';
  senderId: string;
  chatId: string;
  createdAt: string;
  sender: {
    id: string;
    username: string;
    avatar: string | null;
  };
}

export interface Chat9090 {
  id: string;
  type: 'DIRECT';
  updatedAt: string;
  members: Array<{
    userId: string;
    user: ChatFriend;
  }>;
  messages: ChatMessage9090[]; // 最新一条（预览用）
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────

function getToken(): string {
  return localStorage.getItem(CHAT_TOKEN_KEY) ?? '';
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  const t = token ?? getToken();
  if (t) headers['Authorization'] = `Bearer ${t}`;

  const res = await fetch(`${CHAT_API}${path}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

// ── Auth ──────────────────────────────────────────────────────────────────

export async function chatLogin(email: string, password: string) {
  return apiFetch<{ user: ChatUser9090; token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function chatRegister(email: string, password: string, username: string) {
  return apiFetch<{ user: ChatUser9090; token: string }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, username }),
  });
}

export async function chatGetMe(token: string) {
  return apiFetch<{ user: ChatUser9090 }>('/users/me', {}, token);
}

// ── Users ─────────────────────────────────────────────────────────────────

export async function chatSearchUsers(q: string) {
  return apiFetch<{ users: ChatFriend[] }>(`/users/search?q=${encodeURIComponent(q)}`);
}

// ── Friends ───────────────────────────────────────────────────────────────

export async function chatGetFriends() {
  return apiFetch<{ friends: ChatFriend[] }>('/friends');
}

export async function chatGetFriendRequests() {
  return apiFetch<{ requests: ChatFriendRequest[] }>('/friends/requests');
}

export async function chatSendFriendRequest(receiverId: string) {
  return apiFetch<{ request: ChatFriendRequest }>('/friends/request', {
    method: 'POST',
    body: JSON.stringify({ receiverId }),
  });
}

export async function chatAcceptFriendRequest(requestId: string) {
  return apiFetch<unknown>(`/friends/request/${requestId}/accept`, { method: 'PUT' });
}

export async function chatRejectFriendRequest(requestId: string) {
  return apiFetch<unknown>(`/friends/request/${requestId}/reject`, { method: 'PUT' });
}

// ── Chats ─────────────────────────────────────────────────────────────────

export async function chatGetChats() {
  return apiFetch<{ chats: Chat9090[] }>('/chats');
}

export async function chatGetMessages(chatId: string, before?: string, limit = 30) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (before) q.set('before', before);
  return apiFetch<{ messages: ChatMessage9090[] }>(`/chats/${chatId}/messages?${q}`);
}
