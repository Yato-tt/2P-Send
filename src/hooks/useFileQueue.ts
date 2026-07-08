import { useCallback, useRef, useState } from 'react';

export type QueueStatus = 'queued' | 'sending' | 'done' | 'error';

export interface QueueItem {
  file: File;
  status: QueueStatus;
}

interface PendingEntry {
  id: string;
  file: File;
}

const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

interface AddFilesCallbacks {
  onCountExceeded?: () => void;
  onSizeExceeded?: () => void;
}

/**
 * Gerencia dois estágios de arquivos:
 * - `pendingFiles`: selecionados mas ainda não confirmados — podem ser
 *   removidos livremente (id estável, não por índice, então remover
 *   qualquer item sempre atinge exatamente o arquivo certo).
 * - `queue`: já confirmados para envio, com status individual
 *   (queued/sending/done/error).
 *
 * O limite de 2GB é sobre o total da sala (queue já enviada + pendentes),
 * não por leva — reenviar mais arquivos depois de um envio já concluído
 * também respeita o total acumulado.
 *
 * Não sabe nada sobre WebRTC ou sinalização — só organiza os arquivos.
 */
export function useFileQueue(maxFiles: number, maxTotalBytes: number = MAX_TOTAL_BYTES) {
  const [pendingFiles, setPendingFiles] = useState<PendingEntry[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  const idCounterRef = useRef(0);

  const addPendingFiles = useCallback((newFiles: File[], callbacks?: AddFilesCallbacks) => {
    setPendingFiles((prev) => {
      let combined = [
        ...prev,
        ...newFiles.map((file) => ({ id: `f${idCounterRef.current++}`, file }))
      ];

      if (combined.length > maxFiles) {
        callbacks?.onCountExceeded?.();
        combined = combined.slice(0, maxFiles);
      }

      const queueBytes = queueRef.current.reduce((sum, item) => sum + item.file.size, 0);
      let pendingBytes = combined.reduce((sum, entry) => sum + entry.file.size, 0);

      if (queueBytes + pendingBytes > maxTotalBytes) {
        callbacks?.onSizeExceeded?.();
        // Descarta os últimos adicionados até caber no limite total.
        while (combined.length && queueBytes + pendingBytes > maxTotalBytes) {
          const removed = combined.pop()!;
          pendingBytes -= removed.file.size;
        }
      }

      return combined;
    });
  }, [maxFiles, maxTotalBytes]);

  const removePendingFile = useCallback((id: string) => {
    setPendingFiles((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const clearPendingFiles = useCallback(() => setPendingFiles([]), []);

  const syncQueueState = useCallback(() => setQueue([...queueRef.current]), []);

  const startQueue = useCallback((files: File[]) => {
    queueRef.current = files.map((file) => ({ file, status: 'queued' as const }));
    syncQueueState();
  }, [syncQueueState]);

  /** Acrescenta arquivos ao fim da fila já existente e retorna o índice
   *  inicial dessa nova leva — necessário pra reportar status corretamente
   *  quando o envio dessa leva começar. */
  const appendToQueue = useCallback((files: File[]): number => {
    const startOffset = queueRef.current.length;
    queueRef.current = [...queueRef.current, ...files.map((file) => ({ file, status: 'queued' as const }))];
    syncQueueState();
    return startOffset;
  }, [syncQueueState]);

  const setQueueItemStatus = useCallback((index: number, status: QueueStatus) => {
    if (queueRef.current[index]) {
      queueRef.current[index] = { ...queueRef.current[index], status };
      syncQueueState();
    }
  }, [syncQueueState]);

  const doneCount = queue.filter((item) => item.status === 'done').length;

  return {
    pendingFiles,
    addPendingFiles,
    removePendingFile,
    clearPendingFiles,
    queue,
    queueRef,
    startQueue,
    appendToQueue,
    setQueueItemStatus,
    doneCount
  };
}
