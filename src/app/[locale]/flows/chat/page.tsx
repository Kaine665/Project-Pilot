'use client';

/**
 * /flows/chat — P2P 聊天页面
 *
 * 后端：http://81.68.249.18:9090（chat-group 项目）
 * 实时：Socket.IO（直连后端，CORS origin: '*'）
 * 认证：邮箱 + 密码 → JWT（存 localStorage）
 *
 * 功能：
 * - 邮箱注册/登录
 * - 搜索用户 / 发送好友请求 / 接受好友请求
 * - 聊天列表（接受好友后自动创建）
 * - 实时消息收发（Socket.IO send_message / new_message）
 * - AI 唤醒：发送 @ai 开头的消息触发后端 AI 回复
 * - 在线状态显示
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare, LogIn, UserPlus, Check, X, Search,
  Send, Users, Bell, ChevronRight, Loader2, Sparkles,
} from 'lucide-react';
import {
  CHAT_TOKEN_KEY, CHAT_USER_KEY, CHAT_SOCKET_URL,
  chatLogin, chatRegister, chatGetMe, chatGetChats, chatGetMessages,
  chatGetFriends, chatGetFriendRequests, chatSendFriendRequest,
  chatAcceptFriendRequest, chatRejectFriendRequest, chatSearchUsers,
  type ChatUser9090, type Chat9090, type ChatMessage9090,
  type ChatFriend, type ChatFriendRequest,
} from '@/lib/chat-9090';

// ── 辅助 ──────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatPreviewDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return formatTime(iso);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function getOtherMember(chat: Chat9090, myId: string): ChatFriend | undefined {
  return chat.members.find(m => m.userId !== myId)?.user;
}

const AVATAR_COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500'];

function Avatar({ name, online, size = 36 }: { name: string; online?: boolean; size?: number }) {
  const bg = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className={`${bg} flex h-full w-full items-center justify-center rounded-full font-semibold text-white`}
        style={{ fontSize: size * 0.4 }}
      >
        {name[0]?.toUpperCase()}
      </div>
      {online !== undefined && (
        <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-zinc-900 ${online ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
      )}
    </div>
  );
}

// ── 登录/注册表单 ──────────────────────────────────────────────────────────

function AuthForm({ onSuccess }: { onSuccess: (user: ChatUser9090, token: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    setError('');
    setLoading(true);
    try {
      const result = mode === 'login'
        ? await chatLogin(email.trim(), password)
        : await chatRegister(email.trim(), password, username.trim());
      localStorage.setItem(CHAT_TOKEN_KEY, result.token);
      localStorage.setItem(CHAT_USER_KEY, JSON.stringify(result.user));
      onSuccess(result.user, result.token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-6 flex items-center gap-2.5">
          <MessageSquare className="h-6 w-6 text-zinc-700 dark:text-zinc-300" />
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">P2P 聊天</h1>
        </div>

        {/* Mode toggle */}
        <div className="mb-5 flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
          {(['login', 'register'] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setError(''); }}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors
                ${mode === m
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400'
                }`}>
              {m === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        <div className="space-y-2.5">
          {mode === 'register' && (
            <input value={username} onChange={e => setUsername(e.target.value)}
              placeholder="用户名（2-20字）" maxLength={20} autoFocus
              className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400" />
          )}
          <input value={email} onChange={e => setEmail(e.target.value)}
            placeholder="邮箱" type="email" autoFocus={mode === 'login'}
            className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400" />
          <input value={password} onChange={e => setPassword(e.target.value)}
            placeholder="密码" type="password"
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400" />
        </div>

        {error && <p className="mt-2.5 text-xs text-red-500">{error}</p>}

        <button onClick={handleSubmit} disabled={loading || !email || !password}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
          <LogIn className="h-4 w-4" />
          {loading ? '处理中...' : mode === 'login' ? '登录' : '注册'}
        </button>
      </div>
    </div>
  );
}

// ── 主聊天界面 ────────────────────────────────────────────────────────────

type SocketType = import('socket.io-client').Socket;

function ChatMain({ user, token, onLogout }: {
  user: ChatUser9090;
  token: string;
  onLogout: () => void;
}) {
  // ── 数据状态 ──
  const [chats, setChats] = useState<Chat9090[]>([]);
  const [friends, setFriends] = useState<ChatFriend[]>([]);
  const [friendRequests, setFriendRequests] = useState<ChatFriendRequest[]>([]);
  const [activeChat, setActiveChat] = useState<Chat9090 | null>(null);
  const [messages, setMessages] = useState<ChatMessage9090[]>([]);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  // ── Socket ──
  const socketRef = useRef<SocketType | null>(null);

  // ── UI 面板 ──
  const [tab, setTab] = useState<'chats' | 'friends'>('chats');
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showRequests, setShowRequests] = useState(false);

  // ── 搜索好友 ──
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<ChatFriend[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [sentTo, setSentTo] = useState<Record<string, boolean>>({});

  // ── 消息输入 ──
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [acceptLoading, setAcceptLoading] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [aiThinking, setAiThinking] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeChatRef = useRef<Chat9090 | null>(null);
  activeChatRef.current = activeChat;

  // ── Socket.IO 初始化 ──
  useEffect(() => {
    let socket: SocketType;

    (async () => {
      const { io } = await import('socket.io-client');
      socket = io(CHAT_SOCKET_URL, { transports: ['websocket', 'polling'] });
      socketRef.current = socket;

      socket.on('connect', () => socket.emit('authenticate', { token }));

      socket.on('new_message', ({ message }: { message: ChatMessage9090 }) => {
        // 追加到当前聊天
        if (message.chatId === activeChatRef.current?.id) {
          setMessages(prev => prev.some(m => m.id === message.id) ? prev : [...prev, message]);
        }
        // 更新聊天列表预览
        setChats(prev =>
          prev
            .map(c => c.id === message.chatId ? { ...c, messages: [message], updatedAt: message.createdAt } : c)
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        );
      });

      socket.on('new_chat_created', () => { fetchChats(); fetchFriends(); });

      socket.on('user_online', ({ userId }: { userId: string }) =>
        setOnlineIds(prev => new Set([...prev, userId])));
      socket.on('user_offline', ({ userId }: { userId: string }) =>
        setOnlineIds(prev => { const s = new Set(prev); s.delete(userId); return s; }));

      socket.on('typing', ({ chatId, userId }: { chatId: string; userId: string }) => {
        if (chatId === activeChatRef.current?.id)
          setTypingUsers(prev => new Set([...prev, userId]));
      });
      socket.on('typing_stop', ({ chatId, userId }: { chatId: string; userId: string }) => {
        if (chatId === activeChatRef.current?.id)
          setTypingUsers(prev => { const s = new Set(prev); s.delete(userId); return s; });
      });

      socket.on('ai_thinking', () => setAiThinking(true));
      socket.on('ai_thinking_done', () => setAiThinking(false));
    })();

    return () => { socket?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── 加载数据 ──
  const fetchChats = useCallback(async () => {
    try { const { chats: c } = await chatGetChats(); setChats(c); } catch { /* ignore */ }
  }, []);

  const fetchFriends = useCallback(async () => {
    try { const { friends: f } = await chatGetFriends(); setFriends(f); } catch { /* ignore */ }
  }, []);

  const fetchRequests = useCallback(async () => {
    try { const { requests: r } = await chatGetFriendRequests(); setFriendRequests(r); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchChats(); fetchFriends(); fetchRequests();
    const timer = setInterval(() => { fetchChats(); fetchRequests(); }, 8000);
    return () => clearInterval(timer);
  }, [fetchChats, fetchFriends, fetchRequests]);

  // ── 打开聊天 ──
  async function openChat(chat: Chat9090) {
    setActiveChat(chat);
    setMessages([]);
    setTypingUsers(new Set());
    setAiThinking(false);
    setChatLoading(true);
    try {
      const { messages: msgs } = await chatGetMessages(chat.id);
      setMessages(msgs);
    } catch { /* ignore */ }
    finally { setChatLoading(false); }
    // 加入 socket room
    socketRef.current?.emit('mark_read', { chatId: chat.id });
  }

  // ── 自动滚动 ──
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ── 发送消息 ──
  function sendMessage() {
    const content = input.trim();
    if (!content || !activeChat || !socketRef.current) return;
    socketRef.current.emit('send_message', { chatId: activeChat.id, content });
    setInput('');
    if (typingTimer.current) clearTimeout(typingTimer.current);
    socketRef.current.emit('typing_stop', { chatId: activeChat.id });
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleInputChange(val: string) {
    setInput(val);
    if (!activeChat || !socketRef.current) return;
    socketRef.current.emit('typing_start', { chatId: activeChat.id });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socketRef.current?.emit('typing_stop', { chatId: activeChat.id });
    }, 2000);
  }

  // ── 搜索用户 ──
  useEffect(() => {
    if (!searchQ.trim()) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const { users } = await chatSearchUsers(searchQ);
        setSearchResults(users.filter(u => u.id !== user.id));
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [searchQ, user.id]);

  // ── 好友操作 ──
  async function sendRequest(userId: string) {
    try {
      await chatSendFriendRequest(userId);
      setSentTo(prev => ({ ...prev, [userId]: true }));
    } catch (e) { alert((e as Error).message); }
  }

  async function handleAccept(requestId: string) {
    setAcceptLoading(requestId);
    try {
      await chatAcceptFriendRequest(requestId);
      await Promise.all([fetchRequests(), fetchFriends(), fetchChats()]);
    } catch (e) { alert((e as Error).message); }
    finally { setAcceptLoading(null); }
  }

  async function handleReject(requestId: string) {
    try { await chatRejectFriendRequest(requestId); await fetchRequests(); }
    catch (e) { alert((e as Error).message); }
  }

  const pendingCount = friendRequests.length;
  const otherMember = activeChat ? getOtherMember(activeChat, user.id) : null;
  const otherOnline = otherMember ? onlineIds.has(otherMember.id) : false;

  return (
    <div className="flex h-full overflow-hidden bg-zinc-50 dark:bg-zinc-950">

      {/* ══ 左侧面板 ══ */}
      <div className="flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">

        {/* 用户头像 + 退出 */}
        <div className="flex items-center gap-2.5 border-b border-zinc-100 px-3 py-3 dark:border-zinc-800">
          <Avatar name={user.username} size={32} />
          <span className="flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{user.username}</span>
          <button onClick={onLogout} className="text-xs text-zinc-400 hover:text-red-500">退出</button>
        </div>

        {/* Chats / Friends tab */}
        <div className="flex border-b border-zinc-100 dark:border-zinc-800">
          {(['chats', 'friends'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex flex-1 items-center justify-center gap-1 py-2 text-xs font-medium transition-colors
                ${tab === t
                  ? 'border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
                }`}>
              {t === 'chats'
                ? <><MessageSquare className="h-3.5 w-3.5" />聊天</>
                : <><Users className="h-3.5 w-3.5" />好友</>
              }
            </button>
          ))}
        </div>

        {/* 操作栏 */}
        <div className="flex items-center gap-1 border-b border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
          <button onClick={() => { setShowAddFriend(v => !v); setShowRequests(false); }}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors
              ${showAddFriend ? 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200' : 'text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'}`}>
            <UserPlus className="h-3.5 w-3.5" />加好友
          </button>
          <button onClick={() => { setShowRequests(v => !v); setShowAddFriend(false); fetchRequests(); }}
            className={`relative flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors
              ${showRequests ? 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200' : 'text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'}`}>
            <Bell className="h-3.5 w-3.5" />申请
            {pendingCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">{pendingCount}</span>
            )}
          </button>
        </div>

        {/* 加好友面板 */}
        {showAddFriend && (
          <div className="border-b border-zinc-100 p-3 dark:border-zinc-800">
            <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-800">
              <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              <input autoFocus value={searchQ} onChange={e => setSearchQ(e.target.value)}
                placeholder="搜索用户名"
                className="w-full bg-transparent text-xs text-zinc-900 outline-none dark:text-zinc-100 placeholder:text-zinc-400" />
            </div>
            <div className="mt-2 space-y-2">
              {searchLoading && <p className="text-center text-xs text-zinc-400">搜索中...</p>}
              {!searchLoading && searchQ && searchResults.length === 0 && (
                <p className="text-center text-xs text-zinc-400">没找到用户</p>
              )}
              {searchResults.map(u => (
                <div key={u.id} className="flex items-center gap-2">
                  <Avatar name={u.username} size={28} />
                  <span className="flex-1 truncate text-xs text-zinc-700 dark:text-zinc-300">{u.username}</span>
                  <button onClick={() => sendRequest(u.id)} disabled={!!sentTo[u.id]}
                    className="rounded bg-zinc-900 px-2 py-0.5 text-xs text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
                    {sentTo[u.id] ? '已发送' : '添加'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 好友申请面板 */}
        {showRequests && (
          <div className="border-b border-zinc-100 p-3 dark:border-zinc-800">
            <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">待处理申请</p>
            {friendRequests.length === 0 && <p className="text-xs text-zinc-400">暂无待处理申请</p>}
            {friendRequests.map(req => (
              <div key={req.id} className="mb-2 flex items-center gap-2">
                <Avatar name={req.sender?.username ?? '?'} size={28} />
                <span className="flex-1 truncate text-xs text-zinc-700 dark:text-zinc-300">{req.sender?.username}</span>
                <div className="flex gap-1">
                  <button onClick={() => handleAccept(req.id)} disabled={acceptLoading === req.id}
                    className="rounded bg-emerald-600 p-1 text-white hover:bg-emerald-700 disabled:opacity-50">
                    {acceptLoading === req.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  </button>
                  <button onClick={() => handleReject(req.id)}
                    className="rounded bg-zinc-200 p-1 text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 聊天/好友列表 */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'chats' && (
            chats.length === 0
              ? <p className="p-5 text-center text-xs text-zinc-400">添加好友后自动创建聊天</p>
              : chats.map(chat => {
                  const other = getOtherMember(chat, user.id);
                  const lastMsg = chat.messages[0];
                  const isOnline = other ? onlineIds.has(other.id) : false;
                  return (
                    <button key={chat.id} onClick={() => openChat(chat)}
                      className={`flex w-full items-center gap-2.5 px-3 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60
                        ${activeChat?.id === chat.id ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}>
                      <Avatar name={other?.username ?? '?'} online={isOnline} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">{other?.username ?? '未知用户'}</p>
                        {lastMsg && (
                          <p className="truncate text-[11px] text-zinc-400">
                            {lastMsg.type === 'AI_SUMMARY' ? '🤖 ' : ''}{lastMsg.content}
                          </p>
                        )}
                      </div>
                      {lastMsg && <span className="shrink-0 text-[10px] text-zinc-400">{formatPreviewDate(lastMsg.createdAt)}</span>}
                    </button>
                  );
                })
          )}
          {tab === 'friends' && (
            friends.length === 0
              ? <p className="p-5 text-center text-xs text-zinc-400">还没有好友，先加一个吧</p>
              : friends.map(f => {
                  const isOnline = onlineIds.has(f.id);
                  const relatedChat = chats.find(c => c.members.some(m => m.userId === f.id));
                  return (
                    <button key={f.id} onClick={() => relatedChat && openChat(relatedChat)}
                      disabled={!relatedChat}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-zinc-50 disabled:cursor-default dark:hover:bg-zinc-800/60">
                      <Avatar name={f.username} online={isOnline} size={32} />
                      <div className="flex-1">
                        <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{f.username}</p>
                        <p className="text-[11px] text-zinc-400">{isOnline ? '在线' : '离线'}</p>
                      </div>
                      {relatedChat && <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />}
                    </button>
                  );
                })
          )}
        </div>
      </div>

      {/* ══ 右侧聊天区 ══ */}
      {!activeChat ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-zinc-400">
            <MessageSquare className="mx-auto mb-3 h-10 w-10 opacity-20" />
            <p className="text-sm">选择一个聊天开始对话</p>
            <p className="mt-1 text-xs opacity-70">或搜索用户添加好友</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">

          {/* 聊天头部 */}
          <div className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <Avatar name={otherMember?.username ?? '?'} online={otherOnline} size={36} />
            <div className="flex-1">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{otherMember?.username}</p>
              <p className="text-xs text-zinc-400">
                {typingUsers.size > 0 ? '正在输入...' : otherOnline ? '在线' : '离线'}
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              <span>发送 <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono dark:bg-zinc-800">@ai 问题</code> 唤醒 AI</span>
            </div>
          </div>

          {/* 消息列表 */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {chatLoading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-zinc-400">还没有消息，打个招呼吧</p>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map(msg => {
                  const mine = msg.senderId === user.id;
                  const isAI = msg.type === 'AI_SUMMARY';
                  return (
                    <div key={msg.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`flex max-w-[70%] flex-col gap-0.5 ${mine ? 'items-end' : 'items-start'}`}>
                        {!mine && (
                          <span className="px-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            {msg.sender.username}
                          </span>
                        )}
                        <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words
                          ${isAI
                            ? 'rounded-tl-sm bg-amber-50 text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-800'
                            : mine
                              ? 'rounded-tr-sm bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                              : 'rounded-tl-sm bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-700'
                          }`}>
                          {isAI && <span className="mr-1.5">🤖</span>}
                          {msg.content}
                        </div>
                        <span className="px-1 text-[11px] text-zinc-400">{formatTime(msg.createdAt)}</span>
                      </div>
                    </div>
                  );
                })}
                {aiThinking && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-amber-50 px-3.5 py-2.5 text-xs text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />AI 正在思考...
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* 输入区 */}
          <div className="border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-end gap-2">
              <textarea ref={inputRef} value={input} rows={1}
                onChange={e => handleInputChange(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="输入消息，Enter 发送 · Shift+Enter 换行 · @ai 唤醒 AI"
                style={{ resize: 'none' }}
                onInput={e => {
                  const t = e.currentTarget;
                  t.style.height = 'auto';
                  t.style.height = Math.min(t.scrollHeight, 120) + 'px';
                }}
                className="flex-1 rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-sm outline-none transition-colors focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400" />
              <button onClick={sendMessage} disabled={!input.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 页面入口 ──────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [user, setUser] = useState<ChatUser9090 | null>(null);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem(CHAT_TOKEN_KEY);
    const savedUser = localStorage.getItem(CHAT_USER_KEY);
    if (savedToken && savedUser) {
      try {
        setUser(JSON.parse(savedUser) as ChatUser9090);
        setToken(savedToken);
        // 静默刷新用户信息
        chatGetMe(savedToken).then(({ user: u }) => {
          setUser(u);
          localStorage.setItem(CHAT_USER_KEY, JSON.stringify(u));
        }).catch(() => {
          localStorage.removeItem(CHAT_TOKEN_KEY);
          localStorage.removeItem(CHAT_USER_KEY);
          setUser(null);
          setToken('');
        });
      } catch { /* ignore */ }
    }
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!user || !token) {
    return <AuthForm onSuccess={(u, t) => { setUser(u); setToken(t); }} />;
  }

  return <ChatMain user={user} token={token} onLogout={() => { setUser(null); setToken(''); }} />;
}
