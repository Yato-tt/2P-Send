export interface ConnectionEvent {
    type: 'peer-connected' | 'peer-disconnected' | 'connection-error';
    message?: string;
}

export interface IConnectionService {
    joinRoom(roomId: string, role: 'sender' | 'receiver'): Promise<void>;

    sendChunk(chunk: ArrayBuffer): Promise<void>;

    onChunkReceived(callback: (chunk: ArrayBuffer) => void): void;

    sendMessage(data: unknown): void;
    onMessageReceived(callback: (data: any) => void): void;

    isChannelOpen(): boolean;

    onConnectionStatusChange(callback: (event: ConnectionEvent) => void): void;

    disconnect(): void;
}
