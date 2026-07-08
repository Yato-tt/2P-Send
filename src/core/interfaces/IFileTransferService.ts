import type { IConnectionService } from "./IConnectionService";

export interface FileMetadata {
    name: string;
    size: number;
    type: string;
}

export interface TransferProgress {
    byteTransferred: number;
    totalByte: number;
    percentage: number;
    speedBytesPerSecond: number;
}

export interface IFileTransferService {
    sendLargeFile(file: File, connection: IConnectionService, onProgress: (progress: TransferProgress) => void): Promise<void>;

    receiveAndAssembleFile(
        metadata: FileMetadata,
        onProgress: (progress: TransferProgress) => void,
        onComplete: (blob: Blob) => void
    ): {
        handleChunk(chunk: ArrayBuffer):void;
    }
}