import { collection, doc, setDoc, getDocs, getDoc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { db } from './firebase';

export interface User {
  id: string;
  username: string;
  email: string;
  password?: string;
  isAdmin: boolean;
  isApproved: boolean;
  allowedGroups: string[];
  token?: string;
  createdAt?: string;
}

const USERS_COLLECTION = 'users';
const CURRENT_USER_KEY = 'app_current_user';
const FIREBASE_API_KEY = "AIzaSyCfpBmn3cdKP9vaGrDzKCB7oRPMSMx02tA";
const FIREBASE_PROJECT_ID = "ecooy-5b791";

// Limpeza preventiva de dados legados
try {
  localStorage.removeItem('app_local_users_backup');
} catch (_) {}

export function getCurrentUser(): User | null {
  try {
    let raw = localStorage.getItem(CURRENT_USER_KEY);
    if (!raw) {
      raw = localStorage.getItem('currentUser');
    }
    if (!raw) return null;
    const u = JSON.parse(raw);
    delete u.password;
    if (u.email === 'matheuslite0333@gmail.com' || u.username === 'matheuslite') {
       u.isAdmin = true;
       u.isApproved = true;
    }
    return u;
  } catch {
    return null;
  }
}

export function setCurrentUser(user: User | null) {
  try {
    if (!user) {
      localStorage.removeItem(CURRENT_USER_KEY);
      localStorage.removeItem('currentUser');
      return;
    }
    const safeUser = { ...user };
    delete safeUser.password;
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(safeUser));
  } catch (_) {}
}

function withTimeout<T>(promise: Promise<T>, ms: number = 8000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Operação excedeu o tempo limite')), ms)
    ),
  ]);
}

/**
 * Fallback via REST API oficial do Firestore caso o SDK web demore para inicializar o canal
 */
async function fetchUsersFromRest(): Promise<User[]> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${USERS_COLLECTION}?key=${FIREBASE_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.documents || !Array.isArray(data.documents)) return [];

    return data.documents.map((docItem: any) => {
      const parts = docItem.name.split('/');
      const id = parts[parts.length - 1];
      const fields = docItem.fields || {};

      return {
        id,
        username: fields.username?.stringValue || '',
        email: fields.email?.stringValue || '',
        password: fields.password?.stringValue || '',
        isAdmin: fields.isAdmin?.booleanValue ?? false,
        isApproved: fields.isApproved?.booleanValue ?? false,
        allowedGroups: fields.allowedGroups?.arrayValue?.values?.map((v: any) => v.stringValue) || [
          'consulta', 'remover', 'reporte', 'listas', 'upload'
        ],
        createdAt: docItem.createTime,
      };
    });
  } catch (err) {
    console.warn('[Auth REST] Falha ao consultar REST API:', err);
    return [];
  }
}

async function createUserViaRest(user: User): Promise<boolean> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${USERS_COLLECTION}?documentId=${user.id}&key=${FIREBASE_API_KEY}`;
    const payload = {
      fields: {
        id: { stringValue: user.id },
        username: { stringValue: user.username },
        email: { stringValue: user.email },
        password: { stringValue: user.password || '' },
        isAdmin: { booleanValue: Boolean(user.isAdmin) },
        isApproved: { booleanValue: Boolean(user.isApproved) },
        allowedGroups: {
          arrayValue: {
            values: (user.allowedGroups || ['consulta', 'remover', 'reporte', 'listas', 'upload']).map(g => ({ stringValue: g }))
          }
        }
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return res.ok;
  } catch (err) {
    console.warn('[Auth REST] Falha ao gravar via REST:', err);
    return false;
  }
}

export async function signupUser(
  username: string,
  email: string,
  password: string
): Promise<{ success: boolean; message?: string }> {
  // 1. Tenta cadastrar via API backend se esta tiver credenciais de Admin configuradas
  try {
    const res = await fetch('/api/auth?action=signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
    
    if (res.ok) {
      const data = await res.json();
      if (data.ok) {
        return { success: true, message: data.data?.message || 'Cadastro realizado com sucesso!' };
      }
      if (data.error?.code === 'USER_EXISTS' || data.error?.code === 'EMAIL_EXISTS') {
        return { success: false, message: data.error.message };
      }
    }
    // Se o backend indicou que não tem credenciais de service account ou deu erro 500/503, continua para o Firestore client
  } catch (apiErr) {
    console.warn('API backend indisponível para cadastro, utilizando Firestore direto:', apiErr);
  }

  // 2. Cadastro direto no Firestore (Web SDK com fallback REST)
  try {
    const usersRef = collection(db, USERS_COLLECTION);

    // Validação de duplicidade usando SDK
    let isDuplicate = false;
    try {
      const qUser = query(usersRef, where('username', '==', username));
      const userSnap = await withTimeout(getDocs(qUser), 5000);
      if (!userSnap.empty) {
        return { success: false, message: 'Nome de usuário já cadastrado' };
      }

      const qEmail = query(usersRef, where('email', '==', email));
      const emailSnap = await withTimeout(getDocs(qEmail), 5000);
      if (!emailSnap.empty) {
        return { success: false, message: 'E-mail já cadastrado' };
      }
    } catch (sdkCheckErr) {
      console.warn('Checagem via SDK demorou, consultando via REST:', sdkCheckErr);
      const allUsers = await fetchUsersFromRest();
      if (allUsers.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        return { success: false, message: 'Nome de usuário já cadastrado' };
      }
      if (allUsers.some(u => u.email.toLowerCase() === email.toLowerCase())) {
        return { success: false, message: 'E-mail já cadastrado' };
      }
    }

    const newDocRef = doc(usersRef);
    const isMaster = email.toLowerCase() === 'matheuslite0333@gmail.com' || username.toLowerCase() === 'matheuslite';
    
    const newUser: User = {
      id: newDocRef.id,
      username,
      email,
      password,
      isAdmin: isMaster,
      isApproved: isMaster ? true : false,
      allowedGroups: ['consulta', 'remover', 'reporte', 'listas', 'upload'],
      createdAt: new Date().toISOString(),
    };

    // Tenta salvar via Firestore SDK
    let saved = false;
    try {
      await withTimeout(setDoc(newDocRef, newUser), 6000);
      saved = true;
    } catch (sdkSaveErr) {
      console.warn('Salvamento via Firestore SDK falhou/demorou, tentando via REST:', sdkSaveErr);
      saved = await createUserViaRest(newUser);
    }

    if (saved) {
      return { 
        success: true, 
        message: isMaster 
          ? 'Administrador criado com sucesso! Faça login.' 
          : 'Cadastro realizado com sucesso! Aguarde a aprovação de um Administrador.' 
      };
    } else {
      return { success: false, message: 'Não foi possível salvar os dados de cadastro. Tente novamente.' };
    }
  } catch (error: any) {
    console.error('Erro no cadastro:', error);
    return { success: false, message: 'Erro ao cadastrar usuário: ' + (error.message || 'Verifique a conexão') };
  }
}

export async function loginUser(
  emailOrUsername: string,
  password: string
): Promise<{ success: boolean; user?: User; message?: string }> {
  const cleanInput = emailOrUsername.trim();

  // 1. Tenta autenticar via API backend caso disponível
  try {
    const res = await fetch('/api/auth?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrUsername: cleanInput, password }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.data?.user) {
        const user = {
          ...data.data.user,
          token: data.data.token,
        };
        setCurrentUser(user);
        return { success: true, user };
      }
      if (data.error && data.error.code !== 'ADMIN_NOT_CONFIGURED') {
        return { success: false, message: data.error.message };
      }
    }
  } catch (apiErr) {
    console.warn('API backend indisponível para login, tentando Firestore direto:', apiErr);
  }

  // 2. Busca e validação direta no Firestore
  try {
    let foundUser: User | null = null;
    const usersRef = collection(db, USERS_COLLECTION);

    try {
      let q = query(usersRef, where('email', '==', cleanInput));
      let snap = await withTimeout(getDocs(q), 5000);

      if (snap.empty) {
        q = query(usersRef, where('username', '==', cleanInput));
        snap = await withTimeout(getDocs(q), 5000);
      }

      if (!snap.empty) {
        const d = snap.docs[0];
        foundUser = { ...(d.data() as User), id: d.id };
      }
    } catch (sdkErr) {
      console.warn('Consulta SDK no login demorou, usando REST API:', sdkErr);
    }

    if (!foundUser) {
      const allUsers = await fetchUsersFromRest();
      foundUser = allUsers.find(
        u => u.email.toLowerCase() === cleanInput.toLowerCase() || 
             u.username.toLowerCase() === cleanInput.toLowerCase()
      ) || null;
    }

    if (!foundUser) {
      return { success: false, message: 'Usuário ou e-mail não encontrado' };
    }

    // Validação da senha
    if (foundUser.password && foundUser.password !== password) {
      return { success: false, message: 'Senha incorreta' };
    }

    // Auto-aprovação e privilégio de Admin para a conta mestre
    const isMaster = foundUser.email === 'matheuslite0333@gmail.com' || foundUser.username === 'matheuslite';
    if (isMaster) {
      foundUser.isApproved = true;
      foundUser.isAdmin = true;
      try {
        const userRef = doc(db, USERS_COLLECTION, foundUser.id);
        updateDoc(userRef, { isApproved: true, isAdmin: true }).catch(() => {});
      } catch (_) {}
    }

    if (!foundUser.isApproved) {
      return { 
        success: false, 
        message: 'Acesso pendente. Aguarde a aprovação de um Administrador.' 
      };
    }

    const safeUser: User = {
      id: foundUser.id,
      username: foundUser.username,
      email: foundUser.email,
      isAdmin: Boolean(foundUser.isAdmin),
      isApproved: Boolean(foundUser.isApproved),
      allowedGroups: foundUser.allowedGroups || ['consulta', 'remover', 'reporte', 'listas', 'upload'],
    };

    setCurrentUser(safeUser);
    return { success: true, user: safeUser };
  } catch (error: any) {
    console.error('Erro ao realizar login no Firestore:', error);
    return { success: false, message: 'Erro na autenticação: ' + (error.message || 'Verifique a conexão') };
  }
}

export async function getAllUsers(): Promise<User[]> {
  // 1. Tenta via API backend
  try {
    const res = await fetch('/api/auth?action=users');
    if (res.ok) {
      const data = await res.json();
      if (data.ok && Array.isArray(data.data?.users)) {
        return data.data.users;
      }
    }
  } catch (_) {}

  // 2. Firestore SDK
  try {
    const usersRef = collection(db, USERS_COLLECTION);
    const snap = await withTimeout(getDocs(usersRef), 5000);
    return snap.docs.map((d) => {
      const u = d.data() as User;
      delete u.password;
      return { ...u, id: d.id };
    });
  } catch (error) {
    console.warn('SDK demorou ao buscar usuários, usando REST API:', error);
  }

  // 3. Firestore REST
  const restUsers = await fetchUsersFromRest();
  return restUsers.map(u => {
    delete u.password;
    return u;
  });
}

export async function updateUserAdminStatus(
  userId: string,
  updates: Partial<User>
): Promise<boolean> {
  const safeUpdates = { ...updates };
  delete safeUpdates.password;

  // 1. Tenta via API backend
  try {
    const res = await fetch('/api/auth?action=users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, updates: safeUpdates }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.ok) return true;
    }
  } catch (_) {}

  // 2. Firestore SDK
  try {
    const userRef = doc(db, USERS_COLLECTION, userId);
    await withTimeout(updateDoc(userRef, safeUpdates), 5000);
    return true;
  } catch (error) {
    console.warn('Erro ao atualizar usuário no Firestore SDK:', error);
  }

  // 3. Firestore REST patch
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${USERS_COLLECTION}/${userId}?updateMask.fieldPaths=isAdmin&updateMask.fieldPaths=isApproved&updateMask.fieldPaths=allowedGroups&key=${FIREBASE_API_KEY}`;
    const fields: any = {};
    if (safeUpdates.isAdmin !== undefined) {
      fields.isAdmin = { booleanValue: Boolean(safeUpdates.isAdmin) };
    }
    if (safeUpdates.isApproved !== undefined) {
      fields.isApproved = { booleanValue: Boolean(safeUpdates.isApproved) };
    }
    if (safeUpdates.allowedGroups !== undefined) {
      fields.allowedGroups = {
        arrayValue: {
          values: safeUpdates.allowedGroups.map(g => ({ stringValue: g }))
        }
      };
    }
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

export async function getUserById(userId: string): Promise<User | null> {
  try {
    const userRef = doc(db, USERS_COLLECTION, userId);
    const snap = await withTimeout(getDoc(userRef), 5000);
    if (snap.exists()) {
      const u = snap.data() as User;
      delete u.password;
      return { ...u, id: snap.id };
    }
  } catch (error) {
    console.warn('Erro ao buscar usuário por ID:', error);
  }
  return null;
}

export async function deleteUser(userId: string): Promise<boolean> {
  // 1. Tenta via API backend
  try {
    const res = await fetch('/api/auth?action=users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.ok) return true;
    }
  } catch (_) {}

  // 2. Firestore SDK
  try {
    const userRef = doc(db, USERS_COLLECTION, userId);
    await withTimeout(deleteDoc(userRef), 5000);
    return true;
  } catch (error) {
    console.warn('Erro ao excluir usuário no Firestore SDK:', error);
  }

  // 3. Firestore REST
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${USERS_COLLECTION}/${userId}?key=${FIREBASE_API_KEY}`;
    const res = await fetch(url, { method: 'DELETE' });
    return res.ok;
  } catch (_) {
    return false;
  }
}

export function logoutUser() { 
  setCurrentUser(null); 
  window.location.reload(); 
}
