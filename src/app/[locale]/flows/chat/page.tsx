'use client';

import { useState, useEffect } from 'react';
import { useRouter } from '@/i18n/routing';
import { Plus, MessageSquare, LogIn } from 'lucide-react';
import type { ChatRoom, ChatUser } from '@/lib/chat-store';

const USER_KEY = 'pp_chat_user';

function getSavedUser(): ChatUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ChatUser;
  } catch {
    return null;
  }
}

function saveUser(user: ChatUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export default function ChatPage() {
  const router = useRouter();

  const [user, setUser] = useState<ChatUser | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Load saved user on mount
  useEffect(() => {
    const saved = getSavedUser();
    if (saved) setUser(saved);
  }, []);

  // Fetch rooms when user is set
  useEffect(() => {
    if (!user) return;
    fetchRooms();
  }, [user]);

  async function fetchRooms() {
    setRoomsLoading(true);
    try {
      const res = await fetch('/api/chat/rooms');
      const data = await res.json();
      setRooms(data.rooms ?? []);
    } catch {
      setRooms([]);
    } finally {
      setRoomsLoading(false);
    }
  }

  async function handleLogin() {
    const name = usernameInput.trim();
    if (!name) return;
    setLoginLoading(true);
    setLoginError('');
    try {
      const res = await fetch('/api/chat/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error ?? '登录失败');
        return;
      }
      saveUser(data.user);
      setUser(data.user);
    } catch {
      setLoginError('网络错误，请重试');
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleCreateRoom() {
    const name = newRoomName.trim();
    if (!name) return;
    setCreateLoading(true);
    setCreateError('');
    try {
      const res = await fetch('/api/chat/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error ?? '创建失败');
        return;
      }
      setNewRoomName('');
      setCreating(false);
      await fetchRooms();
      router.push(`/flows/chat/${data.room.id}`);
    } catch {
      setCreateError('网络错误，请重试');
    } finally {
      setCreateLoading(false);
    }
  }

  function handleEnterRoom(roomId: string) {
    router.push(`/flows/chat/${roomId}`);
  }

  // ── Login screen ──
  if (!user) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-6 flex items-center gap-2.5">
            <MessageSquare className="h-6 w-6 text-zinc-700 dark:text-zinc-300" />
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">P2P 聊天</h1>
          </div>
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">输入用户名开始聊天</p>
          <input
            autoFocus
            value={usernameInput}
            onChange={e => setUsernameInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleLogin(); }}
            placeholder="你的用户名"
            maxLength={30}
            className="mb-3 w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
          />
          {loginError && (
            <p className="mb-2 text-xs text-red-500">{loginError}</p>
          )}
          <button
            onClick={handleLogin}
            disabled={loginLoading || !usernameInput.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <LogIn className="h-4 w-4" />
            {loginLoading ? '进入中...' : '进入'}
          </button>
        </div>
      </div>
    );
  }

  // ── Room list screen ──
  return (
    <div className="flex h-full flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2.5">
          <MessageSquare className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
          <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">P2P 聊天</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-400">
            当前用户：<span className="font-medium text-zinc-600 dark:text-zinc-300">{user.username}</span>
          </span>
          <button
            onClick={() => { localStorage.removeItem(USER_KEY); setUser(null); }}
            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            切换用户
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl">
          {/* Create room */}
          <div className="mb-6">
            {creating ? (
              <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <input
                  autoFocus
                  value={newRoomName}
                  onChange={e => setNewRoomName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCreateRoom();
                    if (e.key === 'Escape') { setCreating(false); setNewRoomName(''); setCreateError(''); }
                  }}
                  placeholder="房间名称"
                  maxLength={50}
                  className="mb-3 w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400"
                />
                {createError && <p className="mb-2 text-xs text-red-500">{createError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateRoom}
                    disabled={createLoading || !newRoomName.trim()}
                    className="rounded-lg bg-zinc-900 px-4 py-1.5 text-xs text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    {createLoading ? '创建中...' : '创建'}
                  </button>
                  <button
                    onClick={() => { setCreating(false); setNewRoomName(''); setCreateError(''); }}
                    className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-600"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
              >
                <Plus className="h-4 w-4" />
                新建聊天房间
              </button>
            )}
          </div>

          {/* Room list */}
          {roomsLoading ? (
            <div className="text-center text-sm text-zinc-400 py-8">加载中...</div>
          ) : rooms.length === 0 ? (
            <div className="text-center text-sm text-zinc-400 py-8">
              还没有任何房间，创建一个开始聊天吧
            </div>
          ) : (
            <div className="space-y-2">
              {rooms.map(room => (
                <button
                  key={room.id}
                  onClick={() => handleEnterRoom(room.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3.5 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <MessageSquare className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{room.name}</p>
                    <p className="text-xs text-zinc-400">
                      创建于 {new Date(room.createdAt).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
