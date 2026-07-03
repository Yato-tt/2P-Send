import React, { useState, useEffect, useRef } from 'react';
import { File, Download, Loader2, CheckCircle, RefreshCw } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { WebRtcConnectionService } from '../../infrastructure/network/WebRtcConnectionService';
import { FileTransferService } from '../../core/use-cases/FileTransferService';
import type { FileMetadata } from '../../core/interfaces/IFileTransferService';

interface ReceiverCardProps {
  roomId: string;
}

const fileTransferService = new FileTransferService();

export const ReceiverCard: React.FC<ReceiverCardProps> = ({ roomId }) => {
  const [status, setStatus] = useState<'connecting' | 'transferring' | 'done'>('connecting');
  const [progress, setProgress] = useState<number>(0);
  const [fileMeta, setFileMeta] = useState<FileMetadata | null>(null);

  // Guarda o handler retornado por receiveAndAssembleFile para o arquivo
  // em andamento. Um novo file-meta troca esse handler por um novo, com
  // buffer de chunks zerado — sem risco de misturar bytes de arquivos
  // diferentes na mesma sala.
  const activeHandlerRef = useRef<{ handleChunk: (chunk: ArrayBuffer) => void } | null>(null);

  useEffect(() => {
    if (!roomId) return;

    const connection = new WebRtcConnectionService();

    connection.onConnectionStatusChange((event) => {
      if (event.type === 'connection-error') {
        toast.error(event.message || "Erro na conexão P2P.");
      } else if (event.type === 'peer-disconnected') {
        toast.info("O remetente saiu da sala.");
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
        toast.info("Arquivo recebido! Iniciando download...");

        activeHandlerRef.current = fileTransferService.receiveAndAssembleFile(meta, (p) => {
          setProgress(p.percentage);
          if (p.byteTransferred >= p.totalByte) {
            setStatus('done');
            toast.success("Download guardado com sucesso!");
          }
        });
      }
    });

    connection.onChunkReceived((chunk: ArrayBuffer) => {
      activeHandlerRef.current?.handleChunk(chunk);
    });

    connection.joinRoom(roomId, 'receiver').catch((err) => {
      console.error(err);
      toast.error("Não foi possível conectar à sala.");
    });

    return () => {
      connection.disconnect();
    };
  }, [roomId]);

  return (
    <div className="w-full max-w-md rounded-3xl p-5 shadow-2xl mx-auto text-left border border-zinc-800 bg-zinc-900-custom/50">
      <Toaster position="top-right" richColors theme="dark" />

      <h2 className="text-xs font-semibold text-zinc-500 mb-4 uppercase tracking-wide text-center">Canal P2P</h2>

      {status === 'connecting' && (
        <div className="w-full aspect-square border rounded-2xl flex flex-col items-center justify-center p-6 text-center border-zinc-800 bg-zinc-950-custom/40">
          <div className="p-4 rounded-full mb-4 bg-transparent text-orange-500">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
          <p className="font-medium text-zinc-200 text-sm">Aguardando transferência de arquivo...</p>
          <p className="text-xs text-zinc-500 mt-1.5">Sala ativa: <span className="text-orange-500 font-mono">{roomId}</span></p>
        </div>
      )}

      {status === 'transferring' && fileMeta && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 border p-3.5 rounded-2xl border-zinc-800 bg-zinc-950-custom/60">
            <div className="p-2.5 rounded-xl bg-orange-500/10 text-orange-500">
              <File className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-zinc-200 truncate">{fileMeta.name}</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">{(fileMeta.size / (1024 * 1024)).toFixed(2)} MB</p>
            </div>
          </div>

          <div className="border p-4 rounded-2xl space-y-3 border-zinc-800 bg-zinc-950-custom/40">
            <div className="flex justify-between text-xs font-medium text-zinc-400">
              <span className="flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5 text-orange-500" />
                Baixando via P2P...
              </span>
              <span className="text-orange-500 font-bold">{progress}%</span>
            </div>
            <div className="w-full rounded-full h-1 bg-zinc-800">
              <div style={{ width: `${progress}%` }} className="h-full bg-orange-500 transition-all duration-300" />
            </div>
          </div>
        </div>
      )}

      {status === 'done' && fileMeta && (
        <div className="w-full aspect-square border rounded-2xl flex flex-col items-center justify-center p-6 text-center justify-between border-zinc-800 bg-zinc-950-custom/20">
          <div className="flex flex-col items-center justify-center pt-8">
            <div className="p-4 rounded-full mb-4 bg-emerald-500/10 text-emerald-500">
              <CheckCircle className="w-8 h-8" />
            </div>
            <p className="font-semibold text-zinc-100 text-sm">Salvo no seu computador!</p>
            <p className="text-xs text-zinc-500 mt-1 truncate max-w-[200px] font-mono">{fileMeta.name}</p>
          </div>

          <button
            onClick={() => {
              // Mantém a MESMA conexão aberta e só reseta a tela para o
              // estado de espera — o remetente pode mandar outro arquivo
              // pelo mesmo link sem que ninguém precise recarregar a página.
              setStatus('connecting');
              setProgress(0);
              setFileMeta(null);
            }}
            className="w-full py-2.5 rounded-xl text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors flex items-center justify-center gap-1.5 mt-4 cursor-pointer border border-zinc-800"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Aguardar nova mídia
          </button>
        </div>
      )}
    </div>
  );
};
