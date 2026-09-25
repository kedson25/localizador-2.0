import { initializeApp, getApps, cert, applicationDefault, App } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';
import { SERVICE_ACCOUNT_CREDENTIALS } from './googleCredentials';

let app: App | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

function getAppletConfig(): Record<string, any> | null {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (_) {}
  return null;
}

export function isFirebaseAdminConfigured(): boolean {
  const email = process.env.FIREBASE_CLIENT_EMAIL;
  const key = process.env.FIREBASE_PRIVATE_KEY;
  return Boolean(email && key);
}

export function getFirebaseAdmin(): {
  db: Firestore;
  auth: Auth;
  FieldValue: typeof FieldValue;
} {
  if (!app) {
    const appletConfig = getAppletConfig();
    const existingApps = getApps();

    const projectId =
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_PROJECT_ID ||
      appletConfig?.projectId ||
      process.env.VITE_FIREBASE_PROJECT_ID ||
      'gen-lang-client-0559227827';

    const databaseId = process.env.FIRESTORE_DATABASE_ID ||
      (process.env.FIREBASE_PROJECT_ID ? '(default)' : appletConfig?.firestoreDatabaseId || '(default)');

    if (existingApps.length > 0) {
      app = existingApps[0];
    } else {
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

      if (clientEmail && privateKeyRaw) {
        const credential = cert({
          projectId,
          clientEmail,
          privateKey: privateKeyRaw.replace(/\\n/g, '\n'),
        });
        app = initializeApp({
          credential,
          projectId,
        });
      } else {
        app = initializeApp({ credential: applicationDefault(), projectId });
      }
    }

    try {
      // Passa o databaseId nomeado para garantir conexão com a instância correta
      if (databaseId && databaseId !== '(default)') {
        db = getFirestore(app, databaseId);
      } else {
        db = getFirestore(app);
      }
    } catch (dbErr) {
      console.warn('[Firebase Admin] Erro ao obter Firestore com databaseId especificado, tentando padrão:', dbErr);
      db = getFirestore(app);
    }

    try {
      db.settings({ ignoreUndefinedProperties: true });
    } catch (_) {}

    auth = getAuth(app);
  }

  return {
    db: db!,
    auth: auth!,
    FieldValue,
  };
}

export { FieldValue };

export const adminDb = {
  get db() {
    return getFirebaseAdmin().db;
  },
  get auth() {
    return getFirebaseAdmin().auth;
  },
  get FieldValue() {
    return FieldValue;
  },
};

