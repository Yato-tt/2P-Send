import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { WebRtcConnectionService } from '../infrastructure/network/WebRtcConnectionService';
import { FileTransferService } from '../core/use-cases/FileTransferService';
import type { IConnectionService, ConnectionEvent } from '../core/interfaces/IConnectionService';
import type { QueueItem, QueueStatus } from './useFileQueue';

const fileTransferService = new FileTransferService();

export type SessionStatus = 'idle' | 'connecting' | 'transferring' | 'done';

interface UseP2PSenderParams {
  onQueueItemStatusChange: (index: number, status: QueueStatus) => void;
  getQueueSnapshot: () => QueueItem[];
}

export function useP2PSender({ onQueueItemStatusChange, getQueueSnapshot }: UseP2PSenderParams) {
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);

  const connectionRef = useRef<IConnectionService | null>(null);
  const hasSentInitialFileRef = useRef(false);

  useEffect(() => {
    return () => {
      connectionRef.current?.disconnect();
    };
  }, []);

  const sendFileOverChannel = useCallback(async (fileToSend: File) => {
    const connection = connectionRef.current;
    if (!connection) throw new Error('Sem conexão ativa.');
    if (!connection.isChannelOpen()) throw new Error('Canal ainda não está aberto.');

    setProgress(0);
    connection.sendMessage({
      kind: 'file-meta',
      name: fileToSend.name,
      size: fileToSend.size,
      mime: fileToSend.type
    });

    await fileTransferService.sendLargeFile(fileToSend, connection, (p) => {
      setProgress(p.percentage);
    });
  }, []);

  const sendFiles = useCallback(async (filesToSend: File[], startOffset: number) => {
    setStatus('transferring');

    for (let i = 0; i < filesToSend.length; i++) {
      const queueIndex = startOffset + i;
      onQueueItemStatusChange(queueIndex, 'sending');
      try {
        await sendFileOverChannel(filesToSend[i]);
        onQueueItemStatusChange(queueIndex, 'done');
      } catch (err) {
        console.error(err);
        onQueueItemStatusChange(queueIndex, 'error');
        toast.error(`Falha ao enviar "${filesToSend[i].name}".`);
      }
    }

    setStatus('done');
    const finalQueue = getQueueSnapshot();
    const successCount = finalQueue.filter((item) => item.status === 'done').length;
    toast.success(`Envio concluído! ${successCount}/${finalQueue.length} arquivo(s) entregues.`);
  }, [onQueueItemStatusChange, sendFileOverChannel, getQueueSnapshot]);

  const startSession = useCallback(async (filesToSend: File[]) => {
    hasSentInitialFileRef.current = false;
    setStatus('connecting');

    const generatedId = Math.random().toString(36).substring(2, 8);
    const originUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4321';
    setRoomUrl(`${originUrl}/sala/${generatedId}`);
    setRoomCode(generatedId);

    const connection = new WebRtcConnectionService();
    connectionRef.current = connection;

    connection.onConnectionStatusChange((event: ConnectionEvent) => {
      if (event.type === 'peer-connected') {
        if (!hasSentInitialFileRef.current) {
          hasSentInitialFileRef.current = true;
          toast.success('Destinatário conectado! Iniciando transmissão...');
          sendFiles(filesToSend, 0);
        } else {
          toast.info('Destinatário reconectado.');
        }
      } else if (event.type === 'connection-error') {
        toast.error(event.message || 'Erro na conexão P2P.');
      } else if (event.type === 'peer-disconnected') {
        toast.info('O destinatário saiu da sala.');
      }
    });

    try {
      await connection.joinRoom(generatedId, 'sender');
      toast.info('Sala criada! Compartilhe o link, o QR code ou o código.');
    } catch (err) {
      console.error(err);
      toast.error('Não foi possível iniciar a conexão P2P.');
    }
  }, [sendFiles]);

  return { status, progress, roomUrl, roomCode, startSession, sendFiles };
}
