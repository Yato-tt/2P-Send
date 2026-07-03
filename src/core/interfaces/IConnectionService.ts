export interface ConnectionEvent {
    type: 'peer-connected' | 'peer-disconnected' | 'connection-error';
    message?: string;
}

export interface IConnectionService {
    joinRoom(roomId: string, role: 'sender' | 'receiver'): Promise<void>;

    // Agora retorna Promise: internamente espera o buffer do DataChannel
    // esvaziar antes de mandar o próximo chunk (backpressure), evitando
    // estourar o buffer do SCTP em conexões mais lentas/instáveis.
    sendChunk(chunk: ArrayBuffer): Promise<void>;

    onChunkReceived(callback: (chunk: ArrayBuffer) => void): void;

    // Canal paralelo para mensagens de controle (metadata do arquivo, etc.),
    // trafegando como texto (JSON) no mesmo DataChannel, sem se misturar
    // com os chunks binários.
    sendMessage(data: unknown): void;
    onMessageReceived(callback: (data: any) => void): void;

    isChannelOpen(): boolean;

    onConnectionStatusChange(callback: (event: ConnectionEvent) => void): void;

    disconnect(): void;
}
