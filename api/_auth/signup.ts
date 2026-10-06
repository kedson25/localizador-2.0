import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, isFirebaseAdminConfigured } from '../_lib/firebase-admin';
import { SignupSchema } from '../_lib/validation';
import { sendSuccess, sendError } from '../_lib/response';
import { logApi } from '../_lib/logger';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  }

  if (!isFirebaseAdminConfigured()) {
    return sendError(
      res,
      503,
      'ADMIN_NOT_CONFIGURED',
      'Cadastro indisponível: Firebase Admin não configurado no servidor.'
    );
  }

  try {
    const parseResult = SignupSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendError(res, 400, 'INVALID_PAYLOAD', 'Dados inválidos para cadastro', parseResult.error.format());
    }

    const { username, email, password } = parseResult.data;
    const { auth, db } = adminDb;

    // 1. Verificar se usuário ou email já existem no Firestore
    const userCol = db.collection('users');
    const [snapUsername, snapEmail] = await Promise.all([
      userCol.where('username', '==', username).limit(1).get(),
      userCol.where('email', '==', email).limit(1).get(),
    ]);

    if (!snapUsername.empty) {
      return sendError(res, 400, 'USER_EXISTS', 'Nome de usuário já cadastrado');
    }
    if (!snapEmail.empty) {
      return sendError(res, 400, 'EMAIL_EXISTS', 'E-mail já cadastrado');
    }

    // 2. Criar conta no Firebase Admin Auth (o hash da senha é gerenciado com segurança pelo Firebase Auth)
    let uid: string;
    try {
      const userRecord = await auth.createUser({
        email,
        password,
        displayName: username,
      });
      uid = userRecord.uid;
    } catch (authErr: any) {
      const invalidInput = ['auth/email-already-exists', 'auth/invalid-email', 'auth/invalid-password'].includes(authErr?.code);
      return sendError(res, invalidInput ? 400 : 503, 'AUTH_CREATE_FAILED', 'Não foi possível criar a conta no Firebase Authentication.');
    }

    // 3. Salvar perfil do usuário no Firestore SEM salvar a senha em texto puro!
    const newUser = {
      id: uid,
      username,
      email,
      isAdmin: false,
      isApproved: false,
      allowedGroups: ['consulta', 'remover', 'reporte', 'listas', 'upload'],
      createdAt: FieldValue.serverTimestamp(),
    };

    try {
      await userCol.doc(uid).create(newUser);
    } catch (error) {
      // Compensar apenas a conta criada nesta requisição; nunca apagar um perfil.
      await auth.deleteUser(uid).catch(() => logApi('error', 'Conta sem perfil requer reconciliação', { uid }));
      throw error;
    }

    logApi('info', 'Novo usuário registrado', {
      endpoint: '/api/auth/signup',
      uid,
      username,
    });

    return sendSuccess(res, {
      success: true,
      message: 'Cadastro realizado com sucesso! Aguarde aprovação de um Administrador.',
      user: {
        id: uid,
        username,
        email,
        isAdmin: false,
        isApproved: false,
      },
    }, 201);
  } catch (err: any) {
    return sendError(res, 503, 'SIGNUP_FAILED', 'Não foi possível concluir o cadastro. Tente novamente.');
  }
}
