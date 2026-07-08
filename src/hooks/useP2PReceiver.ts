import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { WebRtcConnectionService } from '../infrastructure/network/WebRtcConnectionService';
import { FileTransferService } from '../core/use-cases/FileTransferService';
import type { FileMetadata } from '../core/interfaces/IFileTransferService';

const fileTransferService = new FileTransferService();

export type ReceiverStatus = 'connecting' | 'transferring' | 'done';

export function useP2PReceiver(roomId: string) {
  const [status, setStatus] = useState<ReceiverStatus>('connecting');
  const [progress, setProgress] = useState(0);
  const [fileMeta, setFileMeta] = useState<FileMetadata | null>(null);

  // Handler do arquivo em andamento. Um novo file-meta troca esse handler
  // por um novo, com buffer de chunks zerado — sem risco de misturar bytes
  // de arquivos diferentes na mesma sala.
  const activeHandlerRef = useRef<{ handleChunk: (chunk: ArrayBuffer) => void } | null>(null);

  useEffect(() => {
    if (!roomId) return;

    const connection = new WebRtcConnectionService();

    connection.onConnectionStatusChange((event) => {
      if (event.type === 'connection-error') {
        toast.error(event.message || 'Erro na conexão P2P.');
      } else if (event.type === 'peer-disconnected') {
        toast.info('O remetente saiu da sala.');
      }
    });

    connection.onMessageReceived((data: any) => {
      if (data?.kind === 'file-meta') {
        const meta: FileMetadata = {
          name: data.name,
          size: data.size,
          type: data.mime || 'application/octet-stream'
        };

        setFileMeta(meta);
        setProgress(0);
        setStatus('transferring');
        toast.info('Arquivo recebido! Iniciando download...');

        activeHandlerRef.current = fileTransferService.receiveAndAssembleFile(meta, (p) => {
          setProgress(p.percentage);
          if (p.byteTransferred >= p.totalByte) {
            setStatus('done');
            toast.success('Download guardado com sucesso!');
          }
        });
      }
    });

    connection.onChunkReceived((chunk: ArrayBuffer) => {
      activeHandlerRef.current?.handleChunk(chunk);
    });

    connection.joinRoom(roomId, 'receiver').catch((err) => {
      console.error(err);
      toast.error('Não foi possível conectar à sala.');
    });

    return () => {
      connection.disconnect();
    };
  }, [roomId]);

  const resetForNextFile = () => {
    setStatus('connecting');
    setProgress(0);
    setFileMeta(null);
  };

  return { status, progress, fileMeta, resetForNextFile };
}
