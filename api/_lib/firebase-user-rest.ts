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

const FIREBASE_PROJECT_ID = 'ecooy-5b791';
const FIRESTORE_DATABASE_ID = '(default)';
const FIREBASE_API_KEY = 'AIzaSyCfpBmn3cdKP9vaGrDzKCB7oRPMSMx02tA';

const documentsBase = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents`;
const runQueryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents:runQuery?key=${FIREBASE_API_KEY}`;

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function toFirestoreValue(value: any): any {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  const fields: Record<string, any> = {};
  Object.entries(value || {}).forEach(([key, item]) => {
    if (item !== undefined) fields[key] = toFirestoreValue(item);
  });
  return { mapValue: { fields } };
}

function fromFirestoreValue(value: any): any {
  if (!value) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.nullValue !== undefined) return null;
  if (value.arrayValue) {
    return (value.arrayValue.values || []).map(fromFirestoreValue);
  }
  if (value.mapValue) {
    const result: Record<string, any> = {};
    Object.entries(value.mapValue.fields || {}).forEach(([key, item]) => {
      result[key] = fromFirestoreValue(item);
    });
    return result;
  }
  return null;
}

function fromFirestoreFields(fields: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  Object.entries(fields || {}).forEach(([key, value]) => {
    result[key] = fromFirestoreValue(value);
  });
  return result;
}

function toFirestoreFields(data: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  Object.entries(data || {}).forEach(([key, value]) => {
    if (value !== undefined) result[key] = toFirestoreValue(value);
  });
  return result;
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

async function getDocumentWithToken(
  idToken: string,
  path: string
): Promise<UserProfileRest | null> {
  const response = await fetch(
    `${documentsBase}/${path.replace(/^\/+/, '')}?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    { headers: { Authorization: `Bearer ${idToken}` } }
  );

  if (!response.ok) return null;
  return parseDocument(await response.json());
}

async function getDocumentOpen(path: string): Promise<UserProfileRest | null> {
  const response = await fetch(
    `${documentsBase}/${path.replace(/^\/+/, '')}?key=${encodeURIComponent(FIREBASE_API_KEY)}`
  );

  if (!response.ok) return null;
  return parseDocument(await response.json());
}

async function queryByField(
  fieldPath: 'email' | 'emailLower',
  email: string,
  idToken?: string
): Promise<UserProfileRest[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;

  const response = await fetch(runQueryUrl, {
    method: 'POST',
    headers,
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

export async function getOwnProfilesWithToken(
  idToken: string,
  identity: FirebaseIdentity
): Promise<UserProfileRest[]> {
  const byId = new Map<string, UserProfileRest>();

  const canonical =
    (await getDocumentWithToken(idToken, `users/${identity.uid}`).catch(() => null)) ||
    (await getDocumentOpen(`users/${identity.uid}`).catch(() => null));

  if (canonical && normalizeEmail(canonical.email) === identity.email) {
    byId.set(canonical.id, canonical);
  }

  const authenticatedResults = await Promise.all([
    queryByField('emailLower', identity.email, idToken),
    queryByField('email', identity.email, idToken),
  ]);

  authenticatedResults.flat().forEach((profile) => {
    if (normalizeEmail(profile.email) === identity.email) byId.set(profile.id, profile);
  });

  if (byId.size === 0) {
    const legacyOpenResults = await Promise.all([
      queryByField('emailLower', identity.email),
      queryByField('email', identity.email),
    ]);

    legacyOpenResults.flat().forEach((profile) => {
      if (normalizeEmail(profile.email) === identity.email) byId.set(profile.id, profile);
    });
  }

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
