import { createHash, timingSafeEqual } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { AuthError } from '../_lib/auth';

const shortPasswordEncoding = 'sha256-v1';
function encodedPassword(password: string) {
  return createHash('sha256').update(`localizador-legacy-v1\0${password}`).digest('base64');
}
function matchesLegacyPassword(password: string, legacy: unknown) {
  if (typeof legacy !== 'string' || legacy.length === 0) return false;
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(password), hash(legacy));
}
async function findAuthUser(auth: any, method: 'getUser' | 'getUserByEmail', value: string) {
  try { return await auth[method](value); }
  catch (error: any) { if (error?.code === 'auth/user-not-found') return null; throw error; }
}

export async function validatePasswordLogin(auth: any, db: any, profileDoc: any, password: string, apiKey: string) {
  const profile = profileDoc.data();
  const email = String(profile.email || '').trim().toLowerCase();
  if (!email) throw new AuthError('PROFILE_EMAIL_REQUIRED', 'O perfil precisa de um e-mail válido para autenticar.', 409);
  let account = await findAuthUser(auth, 'getUserByEmail', email);
  let encoding = profile.authPasswordEncoding;
  if (!account) {
    if (!matchesLegacyPassword(password, profile.password)) throw new AuthError('INVALID_CREDENTIALS', 'Senha incorreta.');
    // Nunca substituir uma conta Auth que já ocupa o UID do perfil.
    const uidAccount = await findAuthUser(auth, 'getUser', profileDoc.id);
    if (uidAccount) throw new AuthError('AUTH_ID_CONFLICT', 'O perfil possui uma associação de autenticação incompatível.', 409);
    // Firebase exige seis caracteres na criação. A transformação permite manter
    // senhas legadas curtas; nas próximas entradas a validação continua no Auth.
    encoding = password.length < 6 ? shortPasswordEncoding : null;
    try {
      account = await auth.createUser({ uid: profileDoc.id, email, password: encoding ? encodedPassword(password) : password, displayName: profile.username });
    } catch (error: any) {
      if (!['auth/email-already-exists', 'auth/uid-already-exists'].includes(error?.code)) throw error;
      // Outra requisição pode ter concluído a migração. Validar no Auth abaixo.
      account = await findAuthUser(auth, 'getUserByEmail', email);
      if (!account) throw error;
    }
  }
  if (account.disabled) throw new AuthError('ACCOUNT_DISABLED', 'Conta desativada.', 403);
  if (profile.authUid && profile.authUid !== account.uid) throw new AuthError('AUTH_ID_CONFLICT', 'Associação de autenticação incompatível.', 409);
  if (account.uid !== profileDoc.id) {
    const linked = await db.collection('users').where('authUid', '==', account.uid).limit(2).get();
    const canonical = await db.collection('users').doc(account.uid).get();
    if ((canonical.exists && canonical.id !== profileDoc.id) || linked.docs.some((item: any) => item.id !== profileDoc.id)) {
      throw new AuthError('AUTH_ID_CONFLICT', 'A conta já está associada a outro perfil.', 409);
    }
  }

  const verify = async (candidate: string) => {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: candidate, returnSecureToken: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status >= 500 || response.status === 429) throw new AuthError('AUTH_UNAVAILABLE', 'Autenticação temporariamente indisponível.', 503);
    return response.ok ? await response.json() as { localId?: string } : null;
  };
  let authenticated = await verify(encoding === shortPasswordEncoding ? encodedPassword(password) : password);
  // Recupera uma migração curta cuja gravação no Firestore foi interrompida.
  // A senha antiga nunca é comparada quando a conta Auth já existe.
  if (!authenticated && !encoding && typeof profile.password === 'string' && password.length < 6) {
    authenticated = await verify(encodedPassword(password));
    if (authenticated) encoding = shortPasswordEncoding;
  }
  if (!authenticated?.localId || authenticated.localId !== account.uid) throw new AuthError('INVALID_CREDENTIALS', 'Usuário ou senha inválidos.');

  if (typeof profile.password === 'string' || !profile.authMigrated || profile.authUid !== account.uid) {
    await profileDoc.ref.update({
      password: FieldValue.delete(), authUid: account.uid, authMigrated: true,
      authMigratedAt: FieldValue.serverTimestamp(),
      ...(encoding === shortPasswordEncoding ? { authPasswordEncoding: shortPasswordEncoding } : {}),
    });
  }
  return { uid: account.uid, profile };
}
