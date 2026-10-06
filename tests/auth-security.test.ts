import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ auth: {} as any, db: {} as any, configured: true }));
vi.mock('../api/_lib/firebase-admin', () => ({ adminDb: state, isFirebaseAdminConfigured: () => state.configured }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { delete: () => 'DELETE_FIELD', serverTimestamp: () => 'SERVER_TIME' } }));
vi.mock('../api/_lib/validation', () => ({ LoginSchema: { safeParse: (data: any) => ({ success: true, data }) }, SignupSchema: { safeParse: (data: any) => ({ success: true, data }) } }));

import { validatePasswordLogin } from '../api/_auth/password-login';
import { requireAuth, requireAdmin } from '../api/_lib/auth';
import loginHandler from '../api/_auth/login';
import signupHandler from '../api/_auth/signup';
import usersHandler from '../api/_auth/users';

function fixture(overrides: Record<string, unknown> = {}) {
  const profile = { email: 'old@example.com', username: 'antigo', password: 'antiga123', isAdmin: true, isApproved: true, allowedGroups: ['refugo'], ...overrides };
  const update = vi.fn().mockResolvedValue(undefined);
  const profileDoc = { id: 'legacy-uid', data: () => profile, ref: { update } };
  const auth = { getUserByEmail: vi.fn().mockRejectedValue({ code: 'auth/user-not-found' }), getUser: vi.fn().mockRejectedValue({ code: 'auth/user-not-found' }), createUser: vi.fn().mockResolvedValue({ uid: 'legacy-uid' }) };
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ localId: 'legacy-uid' }) });
  vi.stubGlobal('fetch', fetchMock);
  return { profile, profileDoc, auth, update, fetchMock };
}
beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); state.configured = true; });

describe('migração e validação de senha', () => {
  it('migra senha correta com mesmo UID sem mudar permissões', async () => {
    const f = fixture();
    const result = await validatePasswordLogin(f.auth, {}, f.profileDoc, 'antiga123', 'api-key');
    expect(f.auth.createUser).toHaveBeenCalledWith({ uid: 'legacy-uid', email: 'old@example.com', password: 'antiga123', displayName: 'antigo' });
    expect(f.update).toHaveBeenCalledWith(expect.objectContaining({ password: 'DELETE_FIELD', authUid: 'legacy-uid', authMigrated: true }));
    expect(f.update.mock.calls[0][0]).not.toHaveProperty('isAdmin');
    expect(result.profile.allowedGroups).toEqual(['refugo']);
  });
  it('senha legada errada não cria conta nem remove senha', async () => {
    const f = fixture();
    await expect(validatePasswordLogin(f.auth, {}, f.profileDoc, 'errada', 'key')).rejects.toMatchObject({ statusCode: 401 });
    expect(f.auth.createUser).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled(); expect(f.fetchMock).not.toHaveBeenCalled();
  });
  it('conta Auth existente não aceita a senha velha do Firestore', async () => {
    const f = fixture(); f.auth.getUserByEmail.mockResolvedValue({ uid: 'legacy-uid' });
    f.fetchMock.mockResolvedValue({ ok: false, status: 400 });
    await expect(validatePasswordLogin(f.auth, {}, f.profileDoc, 'antiga123', 'key')).rejects.toMatchObject({ statusCode: 401 });
    expect(f.auth.createUser).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled();
  });
  it('preserva senhas curtas sem armazenar senha nova no perfil', async () => {
    const f = fixture({ password: '1234' });
    await validatePasswordLogin(f.auth, {}, f.profileDoc, '1234', 'key');
    const createdPassword = f.auth.createUser.mock.calls[0][0].password;
    expect(createdPassword.length).toBeGreaterThanOrEqual(6);
    expect(createdPassword).not.toBe('1234');
    expect(JSON.parse(f.fetchMock.mock.calls[0][1].body).password).toBe(createdPassword);
    expect(f.update).toHaveBeenCalledWith(expect.objectContaining({ authPasswordEncoding: 'sha256-v1', password: 'DELETE_FIELD' }));
  });
  it('recupera migração curta interrompida validando somente pelo Auth', async () => {
    const f = fixture({ password: '1234' }); f.auth.getUserByEmail.mockResolvedValue({ uid: 'legacy-uid' });
    f.fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });
    await validatePasswordLogin(f.auth, {}, f.profileDoc, '1234', 'key');
    expect(f.fetchMock).toHaveBeenCalledTimes(2); expect(f.auth.createUser).not.toHaveBeenCalled();
  });
  it('falha de Firebase não cria perfil ou autenticação alternativa', async () => {
    const f = fixture(); f.auth.createUser.mockRejectedValue({ code: 'auth/internal-error' });
    await expect(validatePasswordLogin(f.auth, {}, f.profileDoc, 'antiga123', 'key')).rejects.toMatchObject({ code: 'auth/internal-error' });
    expect(f.fetchMock).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled();
  });
  it('recusa conta desativada e resposta Auth com UID diferente', async () => {
    const f = fixture(); f.auth.getUserByEmail.mockResolvedValue({ uid: 'legacy-uid', disabled: true });
    await expect(validatePasswordLogin(f.auth, {}, f.profileDoc, 'antiga123', 'key')).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
    f.auth.getUserByEmail.mockResolvedValue({ uid: 'legacy-uid' });
    f.fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ localId: 'outro' }) });
    await expect(validatePasswordLogin(f.auth, {}, f.profileDoc, 'antiga123', 'key')).rejects.toMatchObject({ statusCode: 401 });
  });
  it('indisponibilidade Auth bloqueia entrada', async () => {
    const f = fixture(); f.auth.getUserByEmail.mockResolvedValue({ uid: 'legacy-uid' }); f.fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(validatePasswordLogin(f.auth, {}, f.profileDoc, 'antiga123', 'key')).rejects.toMatchObject({ statusCode: 503 });
    expect(f.update).not.toHaveBeenCalled();
  });
  it('perfil e Auth com IDs distintos são ligados sem mover o documento', async () => {
    const f = fixture(); f.auth.getUserByEmail.mockResolvedValue({ uid: 'firebase-uid' });
    f.fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ localId: 'firebase-uid' }) });
    const db = { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }), doc: () => ({ get: async () => ({ exists: false }) }) }) };
    const result = await validatePasswordLogin(f.auth, db, f.profileDoc, 'antiga123', 'key');
    expect(result.uid).toBe('firebase-uid'); expect(f.profileDoc.id).toBe('legacy-uid');
    expect(f.update).toHaveBeenCalledWith(expect.objectContaining({ authUid: 'firebase-uid' }));
  });
  it('não associa conta Auth que já pertence a outro perfil', async () => {
    const f = fixture(); f.auth.getUserByEmail.mockResolvedValue({ uid: 'firebase-uid' });
    const db = { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ docs: [{ id: 'outro-perfil' }] }) }) }), doc: () => ({ get: async () => ({ exists: false }) }) }) };
    await expect(validatePasswordLogin(f.auth, db, f.profileDoc, 'antiga123', 'key')).rejects.toMatchObject({ code: 'AUTH_ID_CONFLICT' });
    expect(f.fetchMock).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled();
  });
  it('senha curta já migrada é validada pelo Firebase sem campo legado', async () => {
    const f = fixture({ password: undefined, authMigrated: true, authUid: 'legacy-uid', authPasswordEncoding: 'sha256-v1' });
    f.auth.getUserByEmail.mockResolvedValue({ uid: 'legacy-uid' });
    await validatePasswordLogin(f.auth, {}, f.profileDoc, '1234', 'key');
    expect(f.auth.createUser).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled();
    expect(JSON.parse(f.fetchMock.mock.calls[0][1].body).password).not.toBe('1234');
  });
});

describe('autorização server-side', () => {
  const req = (token: string) => ({ headers: { authorization: `Bearer ${token}` } } as any);
  it('token user_ID não é aceito', async () => {
    state.auth = { verifyIdToken: vi.fn().mockRejectedValue({ code: 'auth/argument-error' }) };
    await expect(requireAuth(req('user_legacy-uid'))).rejects.toMatchObject({ statusCode: 401 });
    expect(state.auth.verifyIdToken).toHaveBeenCalledWith('user_legacy-uid', true);
  });
  it('sem Firebase Admin retorna 503', async () => {
    state.configured = false;
    await expect(requireAuth(req('token'))).rejects.toMatchObject({ statusCode: 503 });
  });
  it('claim admin não promove perfil e bloqueia usuário comum', async () => {
    state.auth = { verifyIdToken: vi.fn().mockResolvedValue({ uid: 'uid', admin: true }) };
    state.db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ isAdmin: false, isApproved: true, allowedGroups: [] }) }) }) }) };
    await expect(requireAdmin(req('token'))).rejects.toMatchObject({ statusCode: 403 });
  });
  it('perfil legado ligado ao UID Auth mantém ID do documento', async () => {
    const doc = vi.fn(() => ({ get: async () => ({ exists: true, data: () => ({ authUid: 'auth-uid', isAdmin: true, isApproved: true }) }) }));
    state.auth = { verifyIdToken: vi.fn().mockResolvedValue({ uid: 'auth-uid', profileId: 'legacy-id' }) };
    state.db = { collection: () => ({ doc }) };
    await expect(requireAdmin(req('token'))).resolves.toMatchObject({ uid: 'auth-uid', isAdmin: true });
    expect(doc).toHaveBeenCalledWith('legacy-id');
  });
});

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
}
describe('endpoints de login, cadastro e administração', () => {
  beforeEach(() => { process.env.FIREBASE_WEB_API_KEY = 'test-key'; });
  function loginFixture(approved = true) {
    const f = fixture({ isApproved: approved });
    state.auth = { ...f.auth, createCustomToken: vi.fn().mockResolvedValue('custom-token') };
    state.db = { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ empty: false, docs: [f.profileDoc] }) }) }) }) };
    return f;
  }
  it('emite token somente depois de validar a senha e remove senha do retorno', async () => {
    loginFixture(); const res = response();
    await loginHandler({ method: 'POST', body: { emailOrUsername: 'antigo', password: 'antiga123' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(state.auth.createCustomToken).toHaveBeenCalledWith('legacy-uid', { profileId: 'legacy-uid' });
    const user = res.json.mock.calls[0][0].data.user;
    expect(user).not.toHaveProperty('password'); expect(user.isAdmin).toBe(true);
  });
  it('senha incorreta nunca recebe token', async () => {
    loginFixture(); const res = response();
    await loginHandler({ method: 'POST', body: { emailOrUsername: 'antigo', password: 'errada' } }, res);
    expect(res.status).toHaveBeenCalledWith(401); expect(state.auth.createCustomToken).not.toHaveBeenCalled();
  });
  it('migra conta pendente mas não concede sessão antes de aprovação', async () => {
    const f = loginFixture(false); const res = response();
    await loginHandler({ method: 'POST', body: { emailOrUsername: 'antigo', password: 'antiga123' } }, res);
    expect(res.status).toHaveBeenCalledWith(403); expect(f.update).toHaveBeenCalled(); expect(state.auth.createCustomToken).not.toHaveBeenCalled();
  });
  it('cadastro cria perfil pendente sem senha e sem privilégio', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    state.auth = { createUser: vi.fn().mockResolvedValue({ uid: 'new' }) };
    state.db = { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ empty: true }) }) }), doc: () => ({ create }) }) };
    const res = response();
    await signupHandler({ method: 'POST', body: { username: 'novo', email: 'new@example.com', password: 'nova12345' } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(create.mock.calls[0][0]).toMatchObject({ id: 'new', isAdmin: false, isApproved: false });
    expect(create.mock.calls[0][0]).not.toHaveProperty('password');
  });
  it('falha de criação Auth não grava nenhum perfil', async () => {
    const create = vi.fn();
    state.auth = { createUser: vi.fn().mockRejectedValue(new Error('offline')) };
    state.db = { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ empty: true }) }) }), doc: () => ({ create }) }) };
    const res = response();
    await signupHandler({ method: 'POST', body: { username: 'novo', email: 'new@example.com', password: 'nova12345' } }, res);
    expect(res.status).toHaveBeenCalledWith(503); expect(create).not.toHaveBeenCalled();
  });
  it('falha de gravação do perfil desfaz somente a nova conta Auth', async () => {
    state.auth = { createUser: vi.fn().mockResolvedValue({ uid: 'new' }), deleteUser: vi.fn().mockResolvedValue(undefined) };
    state.db = { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ empty: true }) }) }), doc: () => ({ create: vi.fn().mockRejectedValue(new Error('offline')) }) }) };
    const res = response();
    await signupHandler({ method: 'POST', body: { username: 'novo', email: 'new@example.com', password: 'nova12345' } }, res);
    expect(res.status).toHaveBeenCalledWith(503); expect(state.auth.deleteUser).toHaveBeenCalledWith('new');
  });
  it.each(['GET', 'PATCH', 'DELETE'])('usuário comum não pode executar %s em users', async method => {
    state.auth = { verifyIdToken: vi.fn().mockResolvedValue({ uid: 'common' }) };
    state.db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ isAdmin: false, isApproved: true }) }) }) }) };
    const res = response();
    await usersHandler({ method, headers: { authorization: 'Bearer valid' }, body: { userId: 'target', updates: { isAdmin: true } } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
  it('PATCH rejeita alteração de senha mesmo para admin', async () => {
    state.auth = { verifyIdToken: vi.fn().mockResolvedValue({ uid: 'admin' }) };
    state.db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ isAdmin: true, isApproved: true }) }) }) }) };
    const res = response();
    await usersHandler({ method: 'PATCH', headers: { authorization: 'Bearer valid' }, body: { userId: 'target', updates: { password: 'unsafe' } } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
