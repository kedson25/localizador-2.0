import { adminDb, isFirebaseAdminConfigured } from '../_lib/firebase-admin';
import { LoginSchema } from '../_lib/validation';
import { sendSuccess, sendError } from '../_lib/response';
import { logApi } from '../_lib/logger';
import { AuthError } from '../_lib/auth';
import { validatePasswordLogin } from './password-login';

function firebaseWebApiKey(): string {
  return String(process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || '').trim();
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  if (!isFirebaseAdminConfigured() || !firebaseWebApiKey()) {
    return sendError(res, 503, 'AUTH_NOT_CONFIGURED', 'Autenticação indisponível no servidor.');
  }

  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'INVALID_PAYLOAD', 'Dados de login inválidos');

  try {
    const { emailOrUsername, password } = parsed.data;
    const { auth, db } = adminDb;
    const users = db.collection('users');
    const identifier = emailOrUsername.trim();
    let profileQuery = await users.where('email', '==', identifier.toLowerCase()).limit(2).get();
    if (profileQuery.empty && identifier !== identifier.toLowerCase()) profileQuery = await users.where('email', '==', identifier).limit(2).get();
    if (profileQuery.empty) profileQuery = await users.where('username', '==', identifier).limit(2).get();
    if (profileQuery.empty) return sendError(res, 401, 'INVALID_CREDENTIALS', 'Usuário ou senha inválidos.');
    if (profileQuery.docs.length !== 1) return sendError(res, 409, 'AMBIGUOUS_PROFILE', 'Há mais de um perfil com este identificador. Contate o administrador.');

    const profileDoc = profileQuery.docs[0];
    const { uid, profile } = await validatePasswordLogin(auth, db, profileDoc, password, firebaseWebApiKey());
    if (profile.isApproved !== true) return sendError(res, 403, 'NOT_APPROVED', 'Acesso pendente de aprovação.');
    const customToken = await auth.createCustomToken(uid, { profileId: profileDoc.id });
    logApi('info', 'Login validado pelo Firebase Authentication', { endpoint: '/api/auth/login', uid });
    return sendSuccess(res, {
      token: customToken,
      user: {
        id: profileDoc.id,
        username: profile.username,
        email: profile.email,
        isAdmin: profile.isAdmin === true,
        isApproved: profile.isApproved === true,
        allowedGroups: Array.isArray(profile.allowedGroups) ? profile.allowedGroups : [],
      },
    });
  } catch (error: any) {
    if (error instanceof AuthError) return sendError(res, error.statusCode, error.code, error.message);
    logApi('error', 'Falha no login', { endpoint: '/api/auth/login', code: error?.code || 'BACKEND_ERROR' });
    return sendError(res, 503, 'LOGIN_FAILED', 'Não foi possível realizar o login.');
  }
}
