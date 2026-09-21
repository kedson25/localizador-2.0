import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, isFirebaseAdminConfigured } from '../_lib/firebase-admin';
import { listDocsRest, patchDocRest } from '../_lib/firestore-rest';
import { SaveListaMetaSchema } from '../_lib/validation';
import { sendSuccess, sendError } from '../_lib/response';
import { logApi } from '../_lib/logger';

export default async function handler(req: any, res: any) {
  const startTime = Date.now();

  if (req.method === 'GET') {
    try {
      if (!isFirebaseAdminConfigured()) {
        const { documents } = await listDocsRest('coleta_listas', 100);
        const listas = documents.map((data) => ({
          id: data.id,
          nome: data.nome || 'Lista sem nome',
          tipo: data.tipo || 'comum',
          rota: data.rota || 'Brancas',
          data: data.data || '',
          responsavel: data.responsavel || 'Operador',
          status: data.status || 'em_andamento',
          saidaPadrao: data.saidaPadrao || 'Ciclo 2 - Saída PM',
          motivoPadrao: data.motivoPadrao || 'Pendente',
          totalItens: typeof data.totalItens === 'number' ? data.totalItens : 0,
          totalValidados: typeof data.totalValidados === 'number' ? data.totalValidados : 0,
          saidasCount: data.saidasCount || {},
          motivosCount: data.motivosCount || {},
          bipsPorOperador: data.bipsPorOperador || {},
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          grupos: data.grupos || [],
          grupoAtivoId: data.grupoAtivoId,
          porcentagemAcerto: data.porcentagemAcerto,
          fechamentoGaiola: data.fechamentoGaiola,
          itensFaltaram: data.itensFaltaram,
        }));

        listas.sort((a, b) => (b.id || '').localeCompare(a.id || ''));
        return sendSuccess(res, { listas });
      }

      const { db } = adminDb;
      const snap = await db.collection('coleta_listas').get();
      const listas = snap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          nome: data.nome || 'Lista sem nome',
          tipo: data.tipo || 'comum',
          rota: data.rota || 'Brancas',
          data: data.data || '',
          responsavel: data.responsavel || 'Operador',
          status: data.status || 'em_andamento',
          saidaPadrao: data.saidaPadrao || 'Ciclo 2 - Saída PM',
          motivoPadrao: data.motivoPadrao || 'Pendente',
          totalItens: typeof data.totalItens === 'number' ? data.totalItens : 0,
          totalValidados: typeof data.totalValidados === 'number' ? data.totalValidados : 0,
          saidasCount: data.saidasCount || {},
          motivosCount: data.motivosCount || {},
          bipsPorOperador: data.bipsPorOperador || {},
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          grupos: data.grupos || [],
          grupoAtivoId: data.grupoAtivoId,
          porcentagemAcerto: data.porcentagemAcerto,
          fechamentoGaiola: data.fechamentoGaiola,
          itensFaltaram: data.itensFaltaram,
        };
      });

      // Ordenar mais recentes primeiro
      listas.sort((a, b) => {
        const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        if (tA !== tB) return tB - tA;
        return (b.id || '').localeCompare(a.id || '');
      });

      return sendSuccess(res, { listas });
    } catch (err: any) {
      return sendError(res, 500, 'FETCH_FAILED', 'Erro ao listar listas', err.message);
    }
  }

  if (req.method === 'POST') {
    try {
      const parseResult = SaveListaMetaSchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendError(res, 400, 'INVALID_PAYLOAD', 'Dados da lista inválidos', parseResult.error.format());
      }

      const listaData = parseResult.data;
      const listaId = listaData.id || `lista-${Date.now()}`;

      if (!isFirebaseAdminConfigured()) {
        const toSave = {
          ...listaData,
          id: listaId,
          totalItens: 0,
          totalValidados: 0,
          saidasCount: {},
          motivosCount: {},
          bipsPorOperador: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await patchDocRest(`coleta_listas/${listaId}`, toSave);
        return sendSuccess(res, toSave, 201);
      }

      const { db } = adminDb;
      const docRef = db.collection('coleta_listas').doc(listaId);

      const toSave = {
        ...listaData,
        id: listaId,
        totalItens: 0,
        totalValidados: 0,
        saidasCount: {},
        motivosCount: {},
        bipsPorOperador: {},
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      await docRef.set(toSave, { merge: true });

      logApi('info', 'Nova lista criada', {
        endpoint: '/api/listas',
        listaId,
        nome: listaData.nome,
        durationMs: Date.now() - startTime,
      });

      return sendSuccess(res, toSave, 201);
    } catch (err: any) {
      return sendError(res, 500, 'CREATE_FAILED', 'Erro ao criar lista', err.message);
    }
  }

  return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
}
