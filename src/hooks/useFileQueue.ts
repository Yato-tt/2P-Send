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

export function useFileQueue(maxFiles: number) {
  const [pendingFiles, setPendingFiles] = useState<PendingEntry[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  const idCounterRef = useRef(0);

  const addPendingFiles = useCallback((newFiles: File[], onLimitExceeded?: () => void) => {
    setPendingFiles((prev) => {
      const combined = [
        ...prev,
        ...newFiles.map((file) => ({ id: `f${idCounterRef.current++}`, file }))
      ];
      if (combined.length > maxFiles) {
        onLimitExceeded?.();
      }
      return combined.slice(0, maxFiles);
    });
  }, [maxFiles]);

  const removePendingFile = useCallback((id: string) => {
    setPendingFiles((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const clearPendingFiles = useCallback(() => setPendingFiles([]), []);

  const syncQueueState = useCallback(() => setQueue([...queueRef.current]), []);

  const startQueue = useCallback((files: File[]) => {
    queueRef.current = files.map((file) => ({ file, status: 'queued' as const }));
    syncQueueState();
  }, [syncQueueState]);

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
