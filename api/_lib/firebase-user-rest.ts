import {
  FIREBASE_API_KEY,
  FIREBASE_PROJECT_ID,
  FIRESTORE_DATABASE_ID,
  fromFirestoreFields,
  getDocRest,
  runQueryRest,
  toFirestoreFields,
  toFirestoreValue,
} from './firestore-rest';

export const DEFAULT_ALLOWED_GROUPS = [
  'consulta',
  'remover',
  'reporte',
  'listas',
  'upload',
];

export interface FirebaseIdentity {
  uid: string;
  email: string;
  displayName?: string;
}

export interface UserProfileRest {
  id: string;
  username: string;
  email: string;
  isAdmin: boolean;
  isApproved: boolean;
  allowedGroups: string[];
  [key: string]: any;
}

const documentsBase = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents`;
const runQueryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents:runQuery?key=${FIREBASE_API_KEY}`;

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeProfile(data: any, id: string): UserProfileRest {
  return {
    id,
    username: String(data?.username || ''),
    email: String(data?.email || data?.emailLower || ''),
    isAdmin: data?.isAdmin === true,
    isApproved: data?.isApproved === true,
    allowedGroups: Array.isArray(data?.allowedGroups)
      ? data.allowedGroups.filter((group: unknown): group is string => typeof group === 'string')
      : [],
    ...(data || {}),
  };
}

function parseDocument(document: any): UserProfileRest | null {
  if (!document?.name) return null;
  const data = fromFirestoreFields(document.fields || {});
  const parts = String(document.name).split('/');
  return normalizeProfile(data, parts[parts.length - 1]);
}

export async function lookupFirebaseIdentity(idToken: string): Promise<FirebaseIdentity> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );

  const payload = await response.json().catch(() => ({}));
  const account = payload?.users?.[0];

  if (!response.ok || !account?.localId || !account?.email) {
    const error = new Error('INVALID_FIREBASE_TOKEN');
    (error as any).statusCode = 401;
    throw error;
  }

  return {
    uid: String(account.localId),
    email: normalizeEmail(account.email),
    displayName: String(account.displayName || '').trim() || undefined,
  };
}

async function getProfileByUid(
  idToken: string,
  uid: string
): Promise<UserProfileRest | null> {
  const response = await fetch(
    `${documentsBase}/users/${encodeURIComponent(uid)}?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    { headers: { Authorization: `Bearer ${idToken}` } }
  );

  if (response.ok) return parseDocument(await response.json());

  // Compatibilidade com regras legadas ainda públicas: a identidade já foi
  // validada antes, então este fallback continua limitado ao UID autenticado.
  const legacyOpen = await getDocRest(`users/${uid}`).catch(() => null);
  return legacyOpen ? normalizeProfile(legacyOpen, uid) : null;
}

async function queryProfilesByFieldAuthenticated(
  idToken: string,
  fieldPath: 'email' | 'emailLower',
  email: string
): Promise<UserProfileRest[]> {
  const response = await fetch(runQueryUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'users' }],
        where: {
          fieldFilter: {
            field: { fieldPath },
            op: 'EQUAL',
            value: toFirestoreValue(email),
          },
        },
        limit: 20,
      },
    }),
  });

  if (!response.ok) return [];
  const rows = await response.json().catch(() => []);
  return (Array.isArray(rows) ? rows : [])
    .map((row: any) => parseDocument(row.document))
    .filter((profile: UserProfileRest | null): profile is UserProfileRest => Boolean(profile));
}

async function queryProfilesByField(
  idToken: string,
  fieldPath: 'email' | 'emailLower',
  email: string
): Promise<UserProfileRest[]> {
  const authenticated = await queryProfilesByFieldAuthenticated(
    idToken,
    fieldPath,
    email
  ).catch(() => []);

  if (authenticated.length > 0) return authenticated;

  // Caso as regras publicadas ainda sejam as antigas, usa o REST legado apenas
  // depois de validar o ID token e filtra novamente pelo e-mail autenticado.
  const legacy = await runQueryRest('users', {
    whereField: fieldPath,
    whereOp: 'EQUAL',
    whereValue: email,
    limit: 20,
  }).catch(() => []);

  return legacy
    .map((profile: any) => normalizeProfile(profile, String(profile.id || '')))
    .filter((profile) => normalizeEmail(profile.email) === email);
}

export async function getOwnProfilesWithToken(
  idToken: string,
  identity: FirebaseIdentity
): Promise<UserProfileRest[]> {
  const byId = new Map<string, UserProfileRest>();

  const canonical = await getProfileByUid(idToken, identity.uid).catch(() => null);
  if (canonical && normalizeEmail(canonical.email) === identity.email) {
    byId.set(canonical.id, canonical);
  }

  const [lowerMatches, exactMatches] = await Promise.all([
    queryProfilesByField(idToken, 'emailLower', identity.email),
    queryProfilesByField(idToken, 'email', identity.email),
  ]);

  [...lowerMatches, ...exactMatches].forEach((profile) => {
    if (normalizeEmail(profile.email) === identity.email) {
      byId.set(profile.id, profile);
    }
  });

  return Array.from(byId.values());
}

export function mergeOwnProfiles(
  identity: FirebaseIdentity,
  profiles: UserProfileRest[]
): UserProfileRest {
  const canonical = profiles.find((profile) => profile.id === identity.uid);
  const isAdmin = profiles.some((profile) => profile.isAdmin === true);
  const isApproved = isAdmin || profiles.some((profile) => profile.isApproved === true);
  const groups = new Set<string>();

  profiles.forEach((profile) => {
    (profile.allowedGroups || []).forEach((group) => {
      if (typeof group === 'string' && group.trim()) groups.add(group.trim());
    });
  });

  if (groups.size === 0) DEFAULT_ALLOWED_GROUPS.forEach((group) => groups.add(group));

  const username = String(
    canonical?.username ||
      profiles.find((profile) => profile.username)?.username ||
      identity.displayName ||
      identity.email.split('@')[0] ||
      'Usuário'
  ).trim();

  return {
    id: identity.uid,
    username,
    email: identity.email,
    isAdmin,
    isApproved,
    allowedGroups: Array.from(groups),
  };
}

export async function createPendingOwnProfile(
  idToken: string,
  identity: FirebaseIdentity,
  username?: string
): Promise<UserProfileRest> {
  const displayName = String(
    username || identity.displayName || identity.email.split('@')[0] || 'Usuário'
  ).trim();

  const profile = {
    id: identity.uid,
    authUid: identity.uid,
    username: displayName,
    usernameLower: displayName.toLowerCase(),
    email: identity.email,
    emailLower: identity.email,
    isAdmin: false,
    isApproved: false,
    allowedGroups: DEFAULT_ALLOWED_GROUPS,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const response = await fetch(
    `${documentsBase}/users/${encodeURIComponent(identity.uid)}?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ fields: toFirestoreFields(profile) }),
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`PROFILE_CREATE_FAILED:${response.status}:${text}`);
  }

  return mergeOwnProfiles(identity, [profile as UserProfileRest]);
}
