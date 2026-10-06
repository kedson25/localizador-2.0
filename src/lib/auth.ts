import { signInWithCustomToken, signOut } from 'firebase/auth';
import { auth as firebaseAuth } from './firebase-core';

export interface User {
  id: string;
  username: string;
  email: string;
  isAdmin: boolean;
  isApproved: boolean;
  allowedGroups: string[];
  createdAt?: string;
}

const CURRENT_USER_KEY = 'app_current_user';

export function getCurrentUser(): User | null {
  try {
    const raw = localStorage.getItem(CURRENT_USER_KEY);
    return raw ? JSON.parse(raw) as User : null;
  } catch {
    return null;
  }
}

export function setCurrentUser(user: User | null): void {
  if (!user) localStorage.removeItem(CURRENT_USER_KEY);
  else localStorage.setItem(CURRENT_USER_KEY, JSON.stringify({ id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin, isApproved: user.isApproved, allowedGroups: user.allowedGroups }));
  localStorage.removeItem('currentUser');
}

async function authHeaders(json = false): Promise<Record<string, string>> {
  await firebaseAuth.authStateReady();
  const token = await firebaseAuth.currentUser?.getIdToken();
  if (!token) throw new Error('Sessão expirada. Entre novamente.');
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${token}`,
  };
}

async function readApiResponse(response: Response): Promise<any> {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || 'Não foi possível concluir a operação.');
  }
  return payload.data;
}

export async function signupUser(username: string, email: string, password: string) {
  try {
    const response = await fetch('/api/auth?action=signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), email: email.trim().toLowerCase(), password }),
    });
    const data = await readApiResponse(response);
    return { success: true, message: data.message as string };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Erro ao cadastrar usuário.' };
  }
}

export async function loginUser(emailOrUsername: string, password: string) {
  try {
    const response = await fetch('/api/auth?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrUsername: emailOrUsername.trim(), password }),
    });
    const data = await readApiResponse(response);
    const credential = await signInWithCustomToken(firebaseAuth, data.token);
    await credential.user.getIdToken(true);
    const user = data.user as User;
    setCurrentUser(user);
    return { success: true, user };
  } catch (error: any) {
    await signOut(firebaseAuth).catch(() => undefined);
    setCurrentUser(null);
    return { success: false, message: error?.message || 'Usuário ou senha inválidos.' };
  }
}

export async function getAllUsers(): Promise<User[]> {
  const response = await fetch('/api/auth?action=users', { headers: await authHeaders() });
  const data = await readApiResponse(response);
  return Array.isArray(data.users) ? data.users : [];
}

export async function updateUserAdminStatus(userId: string, updates: Partial<User>): Promise<boolean> {
  const allowed = {
    ...(updates.isAdmin !== undefined ? { isAdmin: updates.isAdmin } : {}),
    ...(updates.isApproved !== undefined ? { isApproved: updates.isApproved } : {}),
    ...(updates.allowedGroups !== undefined ? { allowedGroups: updates.allowedGroups } : {}),
  };
  const response = await fetch('/api/auth?action=users', {
    method: 'PATCH',
    headers: await authHeaders(true),
    body: JSON.stringify({ userId, updates: allowed }),
  });
  await readApiResponse(response);
  return true;
}

export async function getUserById(userId: string): Promise<User | null> {
  const users = await getAllUsers();
  return users.find(user => user.id === userId) || null;
}

export async function deleteUser(userId: string): Promise<boolean> {
  const response = await fetch('/api/auth?action=users', {
    method: 'DELETE',
    headers: await authHeaders(true),
    body: JSON.stringify({ userId }),
  });
  await readApiResponse(response);
  return true;
}

export async function logoutUser(): Promise<void> {
  await signOut(firebaseAuth).catch(() => undefined);
  setCurrentUser(null);
  window.location.assign('/login');
}
