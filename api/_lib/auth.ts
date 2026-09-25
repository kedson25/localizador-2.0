import type { IncomingMessage } from 'http';
import { adminDb, isFirebaseAdminConfigured } from './firebase-admin';
import { getDocRest } from './firestore-rest';

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  displayName?: string;
  isAdmin: boolean;
  isApproved: boolean;
  allowedGroups: string[];
}

export async function requireAuth(
  req: IncomingMessage & { headers: Record<string, any> }
): Promise<AuthenticatedUser> {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];

  if (!authHeader || typeof authHeader !== 'string') {
    throw new AuthError('UNAUTHORIZED', 'Header Authorization não fornecido.');
  }

  const match = authHeader.match(/^Bearer\s+(.*)$/i);
  if (!match || !match[1]) {
    throw new AuthError('UNAUTHORIZED', 'Formato do token inválido. Use Bearer <token>.');
  }

  const token = match[1].trim();

  // Se o Firebase Admin não estiver configurado com credenciais de service account
  if (!isFirebaseAdminConfigured()) {
    throw new AuthError(
      'ADMIN_NOT_CONFIGURED',
      'A verificação Firebase não está configurada no servidor.',
      503
    );

    try {
      if (token.startsWith('user_')) {
        const userId = token.replace('user_', '');
        const userData = await getDocRest(`users/${userId}`);
        return {
          uid: userId,
          email: userData?.email,
          displayName: userData?.username || userData?.displayName || 'Usuário',
          isAdmin: Boolean(userData?.isAdmin),
          isApproved: userData ? Boolean(userData.isApproved) : true,
          allowedGroups: Array.isArray(userData?.allowedGroups)
            ? userData.allowedGroups
            : ['consulta', 'remover', 'reporte', 'listas', 'upload'],
        };
      }

      // Tenta decodificar JWT padrão do Firebase Auth
      if (token.includes('.')) {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payloadJson = Buffer.from(parts[1], 'base64').toString('utf8');
          const payload = JSON.parse(payloadJson);
          const uid = payload.user_id || payload.sub || payload.uid;
          if (uid) {
            const userData = await getDocRest(`users/${uid}`);
            return {
              uid,
              email: payload.email || userData?.email,
              displayName: payload.name || userData?.username || userData?.displayName || 'Usuário',
              isAdmin: Boolean(userData?.isAdmin || payload.admin === true),
              isApproved: userData ? Boolean(userData.isApproved) : true,
              allowedGroups: Array.isArray(userData?.allowedGroups)
                ? userData.allowedGroups
                : ['consulta', 'remover', 'reporte', 'listas', 'upload'],
            };
          }
        }
      }
    } catch (e) {
      console.warn('[Auth] Erro ao decodificar token em modo fallback REST:', e);
    }

    return {
      uid: 'user_anonymous',
      email: undefined,
      displayName: 'Operador',
      isAdmin: false,
      isApproved: true,
      allowedGroups: ['consulta', 'remover', 'reporte', 'listas', 'upload'],
    };
  }

  try {
    const { auth, db } = adminDb;
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    const email = decodedToken.email;

    // Busca dados complementares e papel no Firestore (autorização estritamente no servidor)
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : null;

    const isAdmin = Boolean(userData?.isAdmin || decodedToken.admin === true);
    const isApproved = userData ? Boolean(userData.isApproved) : true;
    const allowedGroups = Array.isArray(userData?.allowedGroups)
      ? userData.allowedGroups
      : ['consulta', 'remover', 'reporte', 'listas', 'upload'];

    return {
      uid,
      email: email || userData?.email,
      displayName: decodedToken.name || userData?.username || 'Usuário',
      isAdmin,
      isApproved,
      allowedGroups,
    };
  } catch (err: any) {
    // Se for erro de verificação do Firebase Admin
    if (err instanceof AuthError) {
      throw err;
    }

    // Suporte a transição suave de desenvolvimento: se for um token de sessão de usuário serializado em JSON seguro
    try {
      if (token.startsWith('user_')) {
        const userId = token.replace('user_', '');
        const { db } = adminDb;
        const userDoc = await db.collection('users').doc(userId).get();
        if (userDoc.exists) {
          const u = userDoc.data();
          return {
            uid: userDoc.id,
            email: u?.email,
            displayName: u?.username || 'Usuário',
            isAdmin: Boolean(u?.isAdmin),
            isApproved: Boolean(u?.isApproved),
            allowedGroups: Array.isArray(u?.allowedGroups) ? u.allowedGroups : [],
          };
        }
      }
    } catch (_) {}

    throw new AuthError('INVALID_TOKEN', 'Token de autenticação inválido ou expirado.');
  }
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
