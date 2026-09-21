import {
  BASE_URL,
  FIREBASE_API_KEY,
  FIREBASE_PROJECT_ID,
  FIRESTORE_DATABASE_ID,
  toFirestoreFields,
} from './firestore-rest';

export interface FirestoreBatchWrite {
  type: 'set' | 'update' | 'delete';
  docPath: string;
  data?: Record<string, any>;
  updateMask?: string[];
}

export interface BatchChunkFailure {
  chunkIndex: number;
  startIndex: number;
  writeCount: number;
  attempts: number;
  status?: number;
  quotaLimited: boolean;
  error: string;
}

export interface BatchCommitResult {
  ok: boolean;
  partialSuccess: boolean;
  totalWrites: number;
  successfulWrites: number;
  failedWrites: number;
  successfulChunks: number;
  failedChunks: BatchChunkFailure[];
  quotaLimited: boolean;
  totalAttempts: number;
}

export interface BatchCommitOptions {
  chunkSize?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  delayBetweenChunksMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isQuotaError(status: number | undefined, message: string): boolean {
  return (
    status === 429 ||
    /RESOURCE_EXHAUSTED|quota|too many requests|rate.?limit/i.test(message)
  );
}

function isRetryableError(status: number | undefined, message: string): boolean {
  return (
    isQuotaError(status, message) ||
    status === 408 ||
    status === 425 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === undefined
  );
}

function makeWritePayload(write: FirestoreBatchWrite): Record<string, any> {
  const cleanPath = write.docPath.replace(/^\/+/, '');
  const docName = `projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/${cleanPath}`;

  if (write.type === 'delete') {
    return { delete: docName };
  }

  const payload: Record<string, any> = {
    update: {
      name: docName,
      fields: toFirestoreFields(write.data || {}),
    },
  };

  if (write.updateMask && write.updateMask.length > 0) {
    payload.updateMask = { fieldPaths: write.updateMask };
  }

  return payload;
}

function getBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * Math.min(250, Math.max(50, baseDelayMs)));
  return exponential + jitter;
}

/**
 * Executa commits REST do Firestore com retry exponencial e circuit breaker de quota.
 *
 * Importante: os writes usados pela tela de Brancas apontam para documentos
 * determinísticos, portanto repetir um chunk após 429/5xx é seguro e idempotente.
 * Em caso de quota persistente a função NÃO lança erro: retorna sucesso parcial
 * com contadores precisos para que a sincronização nunca seja anunciada como 100%.
 */
export async function batchCommitWritesWithRetry(
  writes: FirestoreBatchWrite[],
  options: BatchCommitOptions = {}
): Promise<BatchCommitResult> {
  const totalWrites = writes.length;

  if (totalWrites === 0) {
    return {
      ok: true,
      partialSuccess: false,
      totalWrites: 0,
      successfulWrites: 0,
      failedWrites: 0,
      successfulChunks: 0,
      failedChunks: [],
      quotaLimited: false,
      totalAttempts: 0,
    };
  }

  const chunkSize = Math.min(450, Math.max(1, options.chunkSize ?? 250));
  const maxAttempts = Math.min(6, Math.max(1, options.maxAttempts ?? 4));
  const baseDelayMs = Math.max(100, options.baseDelayMs ?? 400);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 4_000);
  const delayBetweenChunksMs = Math.max(0, options.delayBetweenChunksMs ?? 80);

  const url = `${BASE_URL}:commit?key=${FIREBASE_API_KEY}`;
  const payloads = writes.map(makeWritePayload);
  const failedChunks: BatchChunkFailure[] = [];

  let successfulWrites = 0;
  let successfulChunks = 0;
  let quotaLimited = false;
  let totalAttempts = 0;
  let quotaCircuitOpen = false;

  const chunks: Array<{ startIndex: number; writes: Record<string, any>[] }> = [];
  for (let startIndex = 0; startIndex < payloads.length; startIndex += chunkSize) {
    chunks.push({
      startIndex,
      writes: payloads.slice(startIndex, startIndex + chunkSize),
    });
  }

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];

    if (quotaCircuitOpen) {
      failedChunks.push({
        chunkIndex,
        startIndex: chunk.startIndex,
        writeCount: chunk.writes.length,
        attempts: 0,
        status: 429,
        quotaLimited: true,
        error: 'Chunk não enviado porque a cota permaneceu esgotada após os retries do chunk anterior.',
      });
      continue;
    }

    let committed = false;
    let lastStatus: number | undefined;
    let lastMessage = 'Falha desconhecida no commit do Firestore.';
    let attemptsUsed = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attemptsUsed = attempt;
      totalAttempts++;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ writes: chunk.writes }),
        });

        lastStatus = response.status;

        if (response.ok) {
          committed = true;
          successfulWrites += chunk.writes.length;
          successfulChunks++;
          break;
        }

        lastMessage = await response.text();
        const quota = isQuotaError(response.status, lastMessage);
        quotaLimited = quotaLimited || quota;

        if (!isRetryableError(response.status, lastMessage) || attempt === maxAttempts) {
          break;
        }

        const delay = getBackoffDelay(attempt, baseDelayMs, maxDelayMs);
        console.warn(
          `[Firestore Batch] tentativa ${attempt}/${maxAttempts} falhou no chunk ${chunkIndex + 1}/${chunks.length} ` +
            `(${response.status}). Retry em ${delay}ms.`
        );
        await sleep(delay);
      } catch (error: any) {
        lastStatus = undefined;
        lastMessage = error?.message || String(error);

        if (attempt === maxAttempts) {
          break;
        }

        const delay = getBackoffDelay(attempt, baseDelayMs, maxDelayMs);
        console.warn(
          `[Firestore Batch] erro de rede no chunk ${chunkIndex + 1}/${chunks.length}. ` +
            `Tentativa ${attempt}/${maxAttempts}; retry em ${delay}ms: ${lastMessage}`
        );
        await sleep(delay);
      }
    }

    if (!committed) {
      const chunkQuotaLimited = isQuotaError(lastStatus, lastMessage);
      quotaLimited = quotaLimited || chunkQuotaLimited;

      failedChunks.push({
        chunkIndex,
        startIndex: chunk.startIndex,
        writeCount: chunk.writes.length,
        attempts: attemptsUsed,
        status: lastStatus,
        quotaLimited: chunkQuotaLimited,
        error: lastMessage.slice(0, 1200),
      });

      console.warn(
        `[Firestore Batch] chunk ${chunkIndex + 1}/${chunks.length} não foi persistido após ${attemptsUsed} tentativa(s).`,
        {
          status: lastStatus,
          quotaLimited: chunkQuotaLimited,
          writeCount: chunk.writes.length,
        }
      );

      // Se a quota continuou esgotada mesmo após todos os retries, não piora a
      // limitação enviando imediatamente todos os chunks restantes.
      if (chunkQuotaLimited) {
        quotaCircuitOpen = true;
      }
    }

    if (delayBetweenChunksMs > 0 && chunkIndex < chunks.length - 1 && !quotaCircuitOpen) {
      await sleep(delayBetweenChunksMs);
    }
  }

  const failedWrites = totalWrites - successfulWrites;

  return {
    ok: failedWrites === 0,
    partialSuccess: successfulWrites > 0 && failedWrites > 0,
    totalWrites,
    successfulWrites,
    failedWrites,
    successfulChunks,
    failedChunks,
    quotaLimited,
    totalAttempts,
  };
}
