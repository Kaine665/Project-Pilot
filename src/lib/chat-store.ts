/**
 * P2P Chat 数据存储层
 *
 * 数据文件结构：
 * ~/.project-pilot/data/chat/
 *   users.json                    — 用户列表 { users: ChatUser[] }
 *   rooms.json                    — 房间列表 { rooms: ChatRoom[] }
 *   {roomId}-messages.jsonl       — 消息流（每行一条 JSON）
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getDataDir, readJsonFile, writeJsonFile, modifyJsonFile } from './file-store';

// ==================== 类型定义 ====================

export interface ChatUser {
  id: string;
  username: string;
  createdAt: string;
}

export interface ChatRoom {
  id: string;
  name: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: string;
}

interface UsersFile {
  users: ChatUser[];
}

interface RoomsFile {
  rooms: ChatRoom[];
}

// ==================== 路径函数 ====================

export function getChatDir(): string {
  return path.join(getDataDir(), 'chat');
}

export function getUsersPath(): string {
  return path.join(getChatDir(), 'users.json');
}

export function getRoomsPath(): string {
  return path.join(getChatDir(), 'rooms.json');
}

export function getMessagesPath(roomId: string): string {
  const safe = roomId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid room id: ${roomId}`);
  }
  return path.join(getChatDir(), `${safe}-messages.jsonl`);
}

async function ensureChatDir(): Promise<void> {
  await fs.mkdir(getChatDir(), { recursive: true });
}

// ==================== 用户操作 ====================

export async function getUsers(): Promise<ChatUser[]> {
  await ensureChatDir();
  const data = await readJsonFile<UsersFile>(getUsersPath(), { users: [] });
  return data.users;
}

/** 通过用户名查找用户，不存在则创建 */
export async function upsertUser(username: string): Promise<ChatUser> {
  await ensureChatDir();
  let found: ChatUser | null = null;

  await modifyJsonFile<UsersFile>(getUsersPath(), { users: [] }, (data) => {
    const existing = data.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (existing) {
      found = existing;
      return data;
    }
    const user: ChatUser = {
      id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      username: username.trim(),
      createdAt: new Date().toISOString(),
    };
    found = user;
    return { users: [...data.users, user] };
  });

  return found!;
}

export async function getUserById(userId: string): Promise<ChatUser | null> {
  const users = await getUsers();
  return users.find(u => u.id === userId) ?? null;
}

// ==================== 房间操作 ====================

export async function getRooms(): Promise<ChatRoom[]> {
  await ensureChatDir();
  const data = await readJsonFile<RoomsFile>(getRoomsPath(), { rooms: [] });
  return data.rooms;
}

export async function getRoomById(roomId: string): Promise<ChatRoom | null> {
  const rooms = await getRooms();
  return rooms.find(r => r.id === roomId) ?? null;
}

export async function createRoom(name: string): Promise<ChatRoom> {
  await ensureChatDir();
  const room: ChatRoom = {
    id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    createdAt: new Date().toISOString(),
  };

  await modifyJsonFile<RoomsFile>(getRoomsPath(), { rooms: [] }, (data) => ({
    rooms: [...data.rooms, room],
  }));

  return room;
}

export async function deleteRoom(roomId: string): Promise<void> {
  await modifyJsonFile<RoomsFile>(getRoomsPath(), { rooms: [] }, (data) => ({
    rooms: data.rooms.filter(r => r.id !== roomId),
  }));
  // Delete messages file
  try {
    await fs.unlink(getMessagesPath(roomId));
  } catch {
    // ignore if not exists
  }
}

// ==================== 消息操作 ====================

export async function getMessages(roomId: string, limit = 200): Promise<ChatMessage[]> {
  await ensureChatDir();
  const filePath = getMessagesPath(roomId);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const messages = lines.map(line => {
      try { return JSON.parse(line) as ChatMessage; } catch { return null; }
    }).filter((m): m is ChatMessage => m !== null);
    // Return last `limit` messages
    return messages.slice(-limit);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function appendMessage(msg: Omit<ChatMessage, 'id' | 'createdAt'>): Promise<ChatMessage> {
  await ensureChatDir();
  const message: ChatMessage = {
    ...msg,
    id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  const filePath = getMessagesPath(msg.roomId);
  await fs.appendFile(filePath, JSON.stringify(message) + '\n', 'utf-8');
  return message;
}
