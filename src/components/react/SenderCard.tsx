import React, { useState, useRef, useEffect } from 'react';
import { Upload, File, Copy, Check, Loader2, Plus } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { WebRtcConnectionService } from '../../infrastructure/network/WebRtcConnectionService';
import { FileTransferService } from '../../core/use-cases/FileTransferService';
import type { IConnectionService, ConnectionEvent } from '../../core/interfaces/IConnectionService';

const fileTransferService = new FileTransferService();

export const SenderCard: React.FC = () => {
  const [isDragActive, setIsDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'transferring' | 'done'>('idle');
  const [progress, setProgress] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const resendInputRef = useRef<HTMLInputElement>(null);
  const connectionRef = useRef<IConnectionService | null>(null);
  const pendingFileRef = useRef<File | null>(null);
  const hasSentInitialFileRef = useRef(false);

  useEffect(() => {
    // Fecha a conexão P2P e a sinalização se o usuário sair da página.
    return () => {
      connectionRef.current?.disconnect();
    };
  }, []);

  const sendCurrentFile = async () => {
    const connection = connectionRef.current;
    const selectedFile = pendingFileRef.current;
    if (!connection || !selectedFile) return;

    if (!connection.isChannelOpen()) {
      toast.error("A conexão com o destinatário ainda não está pronta.");
      return;
    }

    setProgress(0);
    setStatus('transferring');

    // Metadata vai como mensagem de controle (JSON) pelo mesmo canal,
    // antes dos chunks binários — o DataChannel é ordenado, então chega
    // garantidamente primeiro.
    connection.sendMessage({
      kind: 'file-meta',
      name: selectedFile.name,
      size: selectedFile.size,
      mime: selectedFile.type
    });

    try {
      await fileTransferService.sendLargeFile(selectedFile, connection, (p) => {
        setProgress(p.percentage);
      });
      setStatus('done');
      toast.success("Arquivo enviado com sucesso!");
    } catch (err) {
      console.error(err);
      toast.error("Falha ao enviar o arquivo. Verifique a conexão.");
    }
  };

  const startTransfer = async (selectedFile: File) => {
    setFile(selectedFile);
    pendingFileRef.current = selectedFile;
    hasSentInitialFileRef.current = false;
    setProgress(0);
    setStatus('connecting');

    const generatedId = Math.random().toString(36).substring(2, 8);
    const originUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4321';
    setRoomUrl(`${originUrl}/sala/${generatedId}`);

    const connection = new WebRtcConnectionService();
    connectionRef.current = connection;

    connection.onConnectionStatusChange((event: ConnectionEvent) => {
      if (event.type === 'peer-connected') {
        if (!hasSentInitialFileRef.current) {
          hasSentInitialFileRef.current = true;
          toast.success("Destinatário conectado! Iniciando transmissão...");
          sendCurrentFile();
        } else {
          toast.info("Destinatário reconectado.");
        }
      } else if (event.type === 'connection-error') {
        toast.error(event.message || "Erro na conexão P2P.");
      } else if (event.type === 'peer-disconnected') {
        toast.info("O destinatário saiu da sala.");
      }
    });

    try {
      await connection.joinRoom(generatedId, 'sender');
      toast.info("Sala criada! Envie o link para o destinatário.");
    } catch (err) {
      console.error(err);
      toast.error("Não foi possível iniciar a conexão P2P.");
    }
  };

  // Reaproveita a MESMA conexão/DataChannel já aberto para mandar outro
  // arquivo pelo mesmo link, sem precisar renegociar WebRTC nem gerar uma
  // sala nova.
  const sendAnotherFile = (selectedFile: File) => {
    setFile(selectedFile);
    pendingFileRef.current = selectedFile;
    sendCurrentFile();
  };

  const copyToClipboard = () => {
    if (!roomUrl) return;
    navigator.clipboard.writeText(roomUrl);
    setCopied(true);
    toast.success("Link copiado!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full max-w-md rounded-3xl p-5 shadow-2xl mx-auto text-left border border-zinc-800 bg-zinc-900">
      <Toaster position="top-right" richColors theme="dark" />

      {status === 'idle' && (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragActive(true); }}
          onDragLeave={() => setIsDragActive(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragActive(false); if (e.dataTransfer.files?.[0]) startTransfer(e.dataTransfer.files[0]); }}
          onClick={() => fileInputRef.current?.click()}
          className={`w-full aspect-square border-2 border-dashed rounded-2xl flex flex-col items-center justify-center p-6 text-center cursor-pointer transition-all ${isDragActive ? 'border-orange-500 bg-orange-500/5' : 'border-zinc-800 bg-transparent'}`}
        >
          <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => { if (e.target.files?.[0]) startTransfer(e.target.files[0]); }} />
          <div className="p-4 rounded-full mb-4 bg-zinc-950 text-zinc-400">
            <Upload size={26} />
          </div>
          <p className="font-medium text-zinc-200 text-sm">Arraste e solte seu arquivo aqui</p>
          <span className="mt-4 px-3 py-1 rounded-full text-[10px] font-semibold tracking-wider bg-zinc-950 text-orange-500">P2P SEGURO</span>
        </div>
      )}

      {status !== 'idle' && file && (
        <div className="flex flex-col space-y-4">
          <div>
            <h2 className="text-xs font-semibold text-zinc-500 mb-2.5 uppercase tracking-wide">Arquivo Selecionado</h2>
            <div className="flex items-center gap-3 border p-3.5 rounded-2xl border-zinc-800 bg-zinc-950/60">
              <div className="p-2.5 rounded-xl bg-orange-500/10 text-orange-500">
                <File size={20} />
              </div>
              <div className="flex-1 min-w-0 pr-8">
                <p className="text-xs font-medium text-zinc-200 truncate">{file.name}</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
              </div>
            </div>

            {roomUrl && (
              <div className="space-y-1.5 mt-4">
                <label className="text-[11px] text-zinc-500 font-medium">Link de envio direto</label>
                <div className="flex rounded-xl border p-1 border-zinc-800 bg-zinc-950">
                  <input type="text" readOnly value={roomUrl} className="bg-transparent flex-1 text-xs px-2.5 text-zinc-400 outline-none truncate"/>
                  <button onClick={copyToClipboard} className="p-2 text-white rounded-lg transition-colors flex items-center justify-center shrink-0 cursor-pointer bg-orange-500 hover:bg-orange-600">
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="border p-3.5 rounded-2xl text-center border-zinc-800 bg-zinc-950/40">
            {status === 'connecting' && (
              <div className="flex flex-col items-center justify-center py-2 text-zinc-400 text-xs gap-2">
                <Loader2 size={16} className="animate-spin text-orange-500" />
                <span>Aguardando conexão P2P estável...</span>
              </div>
            )}

            {status === 'transferring' && (
              <div className="space-y-2 text-left">
                <div className="flex justify-between text-xs font-medium text-zinc-400">
                  <span>Transferindo via canal de dados...</span>
                  <span className="text-orange-500 font-bold">{progress}%</span>
                </div>
                <div className="w-full rounded-full h-1.5 overflow-hidden bg-zinc-800">
                  <div style={{ width: `${progress}%` }} className="h-full bg-orange-500 transition-all duration-75" />
                </div>
              </div>
            )}

            {status === 'done' && (
              <div className="space-y-3">
                <p className="text-xs text-emerald-500 font-medium py-1 text-center">✓ Concluído!</p>
                <input
                  ref={resendInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => { if (e.target.files?.[0]) sendAnotherFile(e.target.files[0]); e.target.value = ''; }}
                />
                <button
                  onClick={() => resendInputRef.current?.click()}
                  className="w-full py-2 rounded-xl text-xs font-medium text-zinc-200 bg-orange-500 hover:bg-orange-600 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus size={14} /> Enviar outro arquivo (mesmo link)
                </button>
                <button onClick={() => window.location.reload()} className="w-full py-2 rounded-xl text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer">
                  <Plus size={14} /> Nova sala
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
