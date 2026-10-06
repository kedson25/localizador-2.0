import type { IncomingMessage } from 'http';
import { adminDb, isFirebaseAdminConfigured } from './firebase-admin';

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  displayName?: string;
  isAdmin: boolean;
  isApproved: boolean;
  allowedGroups: string[];
}

export class AuthError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 401) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export async function requireAuth(
  req: IncomingMessage & { headers: Record<string, any> }
): Promise<AuthenticatedUser> {
  if (!isFirebaseAdminConfigured()) {
    throw new AuthError('ADMIN_NOT_CONFIGURED', 'Autenticação indisponível no servidor.', 503);
  }

  const authHeader = req.headers.authorization || req.headers.Authorization;
  const match = typeof authHeader === 'string' ? authHeader.match(/^Bearer\s+([^\s]+)$/i) : null;
  if (!match) throw new AuthError('UNAUTHORIZED', 'Autenticação obrigatória.');

  try {
    const { auth, db } = adminDb;
    const decoded = await auth.verifyIdToken(match[1], true);
    const profileId = typeof decoded.profileId === 'string' ? decoded.profileId : decoded.uid;
    if (!profileId || profileId.includes('/')) throw new AuthError('INVALID_TOKEN', 'Perfil de autenticação inválido.');
    const profileSnapshot = await db.collection('users').doc(profileId).get();
    if (!profileSnapshot.exists) {
      throw new AuthError('PROFILE_NOT_FOUND', 'Perfil de usuário não encontrado.', 403);
    }

    const profile = profileSnapshot.data() || {};
    if ((profileId !== decoded.uid && profile.authUid !== decoded.uid) || (profile.authUid && profile.authUid !== decoded.uid)) {
      throw new AuthError('PROFILE_ID_MISMATCH', 'Perfil não corresponde à sessão.', 403);
    }
    return {
      uid: decoded.uid,
      email: decoded.email || profile.email,
      displayName: decoded.name || profile.username || profile.displayName || 'Usuário',
      isAdmin: profile.isAdmin === true,
      isApproved: profile.isApproved === true,
      allowedGroups: Array.isArray(profile.allowedGroups) ? profile.allowedGroups : [],
    };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    const code = (error as { code?: string })?.code || '';
    if (['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found'].includes(code)) {
      throw new AuthError('INVALID_TOKEN', 'Token de autenticação inválido ou expirado.');
    }
    throw new AuthError('AUTH_UNAVAILABLE', 'Autenticação indisponível no servidor.', 503);
  }
}

export async function requireApprovedUser(req: any): Promise<AuthenticatedUser> {
  const user = await requireAuth(req);
  if (!user.isApproved) throw new AuthError('NOT_APPROVED', 'Usuário ainda não aprovado.', 403);
  return user;
}

export async function requireAdmin(req: any): Promise<AuthenticatedUser> {
  const user = await requireApprovedUser(req);
  if (!user.isAdmin) throw new AuthError('FORBIDDEN', 'Acesso exclusivo para administradores.', 403);
  return user;
}

export async function requireGroup(req: any, group: string): Promise<AuthenticatedUser> {
  const user = await requireApprovedUser(req);
  if (!user.isAdmin && !user.allowedGroups.includes(group)) {
    throw new AuthError('FORBIDDEN', 'Usuário sem permissão para este recurso.', 403);
  }
  return user;
}
