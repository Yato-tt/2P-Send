import React, { useCallback, useRef } from 'react';
import { Upload, File, Copy, Check, Loader2, Plus, X, Send, CheckCircle, AlertCircle, LogIn, QrCode } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { useFileQueue } from '../../hooks/useFileQueue';
import { useP2PSender } from '../../hooks/useP2PSender';
import { useQrCode } from '../../hooks/useQrCode';
import { useFileDragAndDrop } from '../../hooks/useFileDragAndDrop';
import { useMobileQrPanel } from '../../hooks/useMobileQrPanel';
import { useJoinRoomNavigation } from '../../hooks/useJoinRoomNavigation';
import { useClipboard } from '../../hooks/useClipboard';

// Máximo de arquivos por leva de envio. É um limite de UX/organização da
// fila, não uma restrição técnica.
const MAX_FILES = 6;

export const SenderCard: React.FC = () => {
  const fileQueue = useFileQueue(MAX_FILES);
  const sender = useP2PSender({
    onQueueItemStatusChange: fileQueue.setQueueItemStatus,
    getQueueSnapshot: () => fileQueue.queueRef.current
  });
  const qr = useQrCode(sender.roomUrl);
  const mobileQrPanel = useMobileQrPanel();
  const joinRoom = useJoinRoomNavigation();
  const clipboard = useClipboard();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilesSelected = useCallback((files: File[]) => {
    fileQueue.addPendingFiles(files, () => {
      toast.error(`Você pode selecionar no máximo ${MAX_FILES} arquivos por vez.`);
    });
  }, [fileQueue]);

  // Drop em qualquer lugar da página: some direto pra revisão se ainda não
  // há sessão em andamento; some pra revisão também depois de um envio já
  // concluído (mesma liberdade); é bloqueado só durante conexão/transferência.
  const isDragActive = useFileDragAndDrop((files) => {
    if (sender.status === 'idle' || sender.status === 'done') {
      handleFilesSelected(files);
    } else {
      toast.info('Aguarde a transferência atual terminar antes de adicionar mais arquivos.');
    }
  });

  // Único ponto de confirmação de envio — vale igual para o primeiro envio
  // e para qualquer envio adicional feito depois.
  const confirmAndSend = () => {
    if (fileQueue.pendingFiles.length === 0) return;
    const filesToSend = fileQueue.pendingFiles.map((entry) => entry.file);
    fileQueue.clearPendingFiles();

    if (sender.status === 'idle') {
      fileQueue.startQueue(filesToSend);
      sender.startSession(filesToSend);
    } else {
      const startOffset = fileQueue.appendToQueue(filesToSend);
      sender.sendFiles(filesToSend, startOffset);
    }
  };

  const canStageFiles = sender.status === 'idle' || sender.status === 'done';
  const urlPrefix = sender.roomUrl && sender.roomCode
    ? sender.roomUrl.slice(0, sender.roomUrl.length - sender.roomCode.length)
    : '';

  return (
    <div className="relative w-full max-w-md rounded-3xl p-5 shadow-2xl mx-auto text-left border border-zinc-800 bg-zinc-900">
      <Toaster position="top-right" richColors theme="dark" />

      {/* Input real sempre montado — independente da etapa atual —, porque
          o botão "adicionar mais arquivos" também depende dele. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) handleFilesSelected(Array.from(e.target.files));
          e.target.value = '';
        }}
      />

      {isDragActive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/85 backdrop-blur-sm pointer-events-none">
          <div className="border-2 border-dashed border-orange-500 rounded-3xl px-14 py-12 text-center bg-zinc-900/60">
            <Upload size={40} className="mx-auto mb-4 text-orange-500" />
            <p className="text-zinc-100 font-medium text-sm">Solte até {MAX_FILES} arquivos em qualquer lugar da página</p>
          </div>
        </div>
      )}

      {canStageFiles && (
        <div className="space-y-4">
          {fileQueue.queue.length === 0 && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`w-full aspect-square border-2 border-dashed rounded-2xl flex flex-col items-center justify-center p-6 text-center cursor-pointer transition-all ${isDragActive ? 'border-orange-500 bg-orange-500/5' : 'border-zinc-800 bg-transparent'}`}
            >
              <div className="p-4 rounded-full mb-4 bg-zinc-950 text-zinc-400">
                <Upload size={26} />
              </div>
              <p className="font-medium text-zinc-200 text-sm">Arraste e solte seus arquivos aqui</p>
              <p className="text-[11px] text-zinc-600 mt-1">até {MAX_FILES} arquivos por vez</p>
              <span className="mt-4 px-3 py-1 rounded-full text-[10px] font-semibold tracking-wider bg-zinc-950 text-orange-500">P2P SEGURO</span>

              <div onClick={(e) => e.stopPropagation()} className="w-full mt-4 pt-4 border-t border-zinc-800/70 cursor-default">
                <p className="text-[10px] text-zinc-600 mb-1.5">Já tem um código de sala?</p>
                <div className="flex rounded-xl border p-1 border-zinc-800 bg-zinc-950">
                  <input
                    type="text"
                    value={joinRoom.code}
                    onChange={(e) => joinRoom.setCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') joinRoom.join(); }}
                    placeholder="ex: a1b2c3"
                    className="bg-transparent flex-1 min-w-0 text-xs px-2.5 text-zinc-200 font-mono tracking-widest outline-none placeholder:text-zinc-600 placeholder:tracking-normal placeholder:font-sans"
                  />
                  <button
                    onClick={joinRoom.join}
                    className="px-2.5 py-1.5 text-white rounded-lg transition-colors flex items-center justify-center gap-1 shrink-0 cursor-pointer bg-zinc-800 hover:bg-zinc-700 text-[10px] font-medium"
                  >
                    <LogIn size={12} /> Entrar
                  </button>
                </div>
              </div>
            </div>
          )}

          {fileQueue.pendingFiles.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                Selecionados ({fileQueue.pendingFiles.length}/{MAX_FILES})
              </h2>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {fileQueue.pendingFiles.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2 border p-2 rounded-xl border-zinc-800 bg-zinc-950/60">
                    <File size={16} className="text-orange-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-200 truncate">{entry.file.name}</p>
                      <p className="text-[10px] text-zinc-500">{(entry.file.size / (1024 * 1024)).toFixed(2)} MB</p>
                    </div>
                    <button
                      onClick={() => fileQueue.removePendingFile(entry.id)}
                      aria-label="Remover arquivo"
                      className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors shrink-0 cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={confirmAndSend}
                className="w-full py-2.5 rounded-xl text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Send size={14} /> {fileQueue.queue.length === 0 ? 'Enviar' : 'Enviar mais'} {fileQueue.pendingFiles.length} {fileQueue.pendingFiles.length === 1 ? 'arquivo' : 'arquivos'}
              </button>
            </div>
          )}

          {sender.status === 'done' && fileQueue.queue.length > 0 && fileQueue.pendingFiles.length === 0 && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2.5 rounded-xl text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer border border-zinc-800"
            >
              <Plus size={14} /> Adicionar mais arquivos (mesmo link)
            </button>
          )}
        </div>
      )}

      {fileQueue.queue.length > 0 && (
        <div className={`flex flex-col space-y-4 ${canStageFiles ? 'mt-4' : ''}`}>
          <div>
            <h2 className="text-xs font-semibold text-zinc-500 mb-2.5 uppercase tracking-wide">
              Arquivos ({fileQueue.doneCount}/{fileQueue.queue.length} concluídos)
            </h2>
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {fileQueue.queue.map((item, i) => (
                <div key={`${item.file.name}-${i}`} className="flex items-center gap-2 border p-2 rounded-xl border-zinc-800 bg-zinc-950/60">
                  {item.status === 'done' && <CheckCircle size={16} className="text-emerald-500 shrink-0" />}
                  {item.status === 'sending' && <Loader2 size={16} className="text-orange-500 animate-spin shrink-0" />}
                  {item.status === 'queued' && <File size={16} className="text-zinc-600 shrink-0" />}
                  {item.status === 'error' && <AlertCircle size={16} className="text-red-500 shrink-0" />}
                  <p className="flex-1 min-w-0 text-xs text-zinc-300 truncate">{item.file.name}</p>
                  {item.status === 'sending' && <span className="text-[10px] text-orange-500 font-semibold shrink-0">{sender.progress}%</span>}
                </div>
              ))}
            </div>

            {sender.roomUrl && sender.roomCode && (
              <div className="mt-4 space-y-1.5">
                <label className="text-[11px] text-zinc-500 font-medium">Link de envio direto</label>

                <div className="flex items-center rounded-xl border p-1 border-zinc-800 bg-zinc-950 min-w-0">
                  {/* Destaque visual do código dentro do próprio link — dá a
                      entender que o texto pode ser selecionado e copiado
                      manualmente, além do botão. */}
                  <div
                    title={sender.roomUrl}
                    className="flex-1 min-w-0 text-xs px-2.5 py-1.5 truncate select-all cursor-text"
                  >
                    <span className="text-zinc-500">{urlPrefix}</span>
                    <span className="text-orange-400 font-semibold">{sender.roomCode}</span>
                  </div>

                  {qr.dataUrl && (
                    <button
                      onClick={mobileQrPanel.toggle}
                      aria-label="Mostrar QR code"
                      className={`lg:hidden p-2 rounded-lg transition-colors flex items-center justify-center shrink-0 cursor-pointer mr-1 ${mobileQrPanel.expanded ? 'bg-orange-500 text-white hover:bg-orange-600' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
                    >
                      <QrCode size={14} />
                    </button>
                  )}

                  <button onClick={() => clipboard.copy(sender.roomUrl!)} className="p-2 text-white rounded-lg transition-colors flex items-center justify-center shrink-0 cursor-pointer bg-orange-500 hover:bg-orange-600">
                    {clipboard.copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>

                {mobileQrPanel.expanded && qr.dataUrl && (
                  <div
                    className={`lg:hidden flex flex-col items-center gap-2 pt-2 transition-all duration-150 ${mobileQrPanel.revealed ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}
                  >
                    <div className="bg-white p-1.5 rounded-xl">
                      <div className="w-40 h-40 aspect-square">
                        <img src={qr.dataUrl} alt="QR code da sala" className="w-full h-full object-contain block" />
                      </div>
                    </div>
                    <p className="text-[10px] text-zinc-500 text-center">Aproxime o celular do destinatário para escanear</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border p-3.5 rounded-2xl text-center border-zinc-800 bg-zinc-950/40">
            {sender.status === 'connecting' && (
              <div className="flex flex-col items-center justify-center py-2 text-zinc-400 text-xs gap-2">
                <Loader2 size={16} className="animate-spin text-orange-500" />
                <span>Aguardando conexão P2P estável...</span>
              </div>
            )}

            {sender.status === 'transferring' && (
              <div className="space-y-2 text-left">
                <div className="flex justify-between text-xs font-medium text-zinc-400">
                  <span>Transferindo via canal de dados...</span>
                  <span className="text-orange-500 font-bold">{sender.progress}%</span>
                </div>
                <div className="w-full rounded-full h-1.5 overflow-hidden bg-zinc-800">
                  <div style={{ width: `${sender.progress}%` }} className="h-full bg-orange-500 transition-all duration-75" />
                </div>
              </div>
            )}

            {sender.status === 'done' && (
              <div className="space-y-3">
                <p className="text-xs text-emerald-500 font-medium py-1 text-center">✓ Concluído!</p>
                <button onClick={() => window.location.reload()} className="w-full py-2 rounded-xl text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer">
                  <Plus size={14} /> Nova sala
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* QR code fora do card, só em telas grandes o suficiente pra sobrar
          espaço ao lado sem espremer nada. Wrapper com aspect-square +
          object-contain garante que ele nunca deixe de ser quadrado. */}
      {sender.roomUrl && qr.dataUrl && (
        <div className="hidden lg:block absolute top-1/2 -translate-y-1/2 left-full ml-6 pointer-events-none">
          <div
            className={`pointer-events-auto transition-all duration-500 ease-out ${
              qr.visible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-10 -z-10'
            }`}
          >
            <div className="bg-white p-1.5 rounded-2xl shadow-2xl">
              <div className="w-40 h-40 aspect-square">
                <img src={qr.dataUrl} alt="QR code da sala" className="w-full h-full object-contain block" />
              </div>
            </div>
            <p className="text-[10px] text-zinc-500 text-center mt-2">Escaneie para abrir</p>
          </div>
        </div>
      )}
    </div>
  );
};
