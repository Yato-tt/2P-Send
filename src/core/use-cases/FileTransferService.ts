import type { IConnectionService } from "../interfaces/IConnectionService";
import type { FileMetadata, IFileTransferService, TransferProgress } from "../interfaces/IFileTransferService";

export class FileTransferService implements IFileTransferService {
    // 256KB por chunk — dentro do limite seguro de mensagem do DataChannel
    // em navegadores modernos. Chunks maiores reduzem a sobrecarga de
    // overhead por mensagem e melhoram bastante o throughput.
    private CHUNK_SIZE = 256 * 1024;

    async sendLargeFile(
        file: File,
        connection: IConnectionService,
        onProgress: (progress: TransferProgress) => void
    ):Promise<void> {
        const totalBytes = file.size;
        let byteTransferred = 0;
        const startTime = Date.now();

        const stream = file.stream();
        const reader = stream.getReader();

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                let offset = 0;
                while (offset < value.byteLength) {
                    const currentChunkSize = Math.min(this.CHUNK_SIZE, value.byteLength - offset);

                    const safeChunk = value.subarray(offset, offset + currentChunkSize);

                    const chunk = safeChunk.buffer.slice(
                        safeChunk.byteOffset,
                        safeChunk.byteOffset + safeChunk.byteLength
                    ) as ArrayBuffer;

                    await connection.sendChunk(chunk);

                    offset += chunk.byteLength;
                    byteTransferred += chunk.byteLength;

                    const elapsedTime = (Date.now() - startTime) / 1000;
                    const speedBytesPerSecond = elapsedTime > 0 ? byteTransferred / elapsedTime : 0;
                    const percentage = Math.round((byteTransferred / totalBytes) * 100);

                    onProgress({
                        byteTransferred: byteTransferred,
                        totalByte: totalBytes,
                        percentage,
                        speedBytesPerSecond
                    });
                }
            }
        } catch (error) {
            console.error('Erro ao ler ou enviar o arquivo:', error);
            throw error;
        } finally {
            reader.releaseLock();
        }
    }

    receiveAndAssembleFile(
        metadata: FileMetadata,
        onProgress: (progress: TransferProgress) => void,
        onComplete: (blob: Blob) => void
    )  {
        const chunks: BlobPart[] = [];
        let bytesTransferred = 0;
        const startTime = Date.now();

        return {
            handleChunk: (chunk: ArrayBuffer) => {
                chunks.push(chunk);
                bytesTransferred += chunk.byteLength;

                const elapsedTime = (Date.now() - startTime) / 1000;
                const speedBytesPerSecond = elapsedTime > 0 ? bytesTransferred / elapsedTime : 0;
                const percentage = Math.round((bytesTransferred / metadata.size) * 100);

                onProgress({
                    byteTransferred: bytesTransferred,
                    totalByte: metadata.size,
                    percentage,
                    speedBytesPerSecond,
                });

                if (bytesTransferred >= metadata.size) {
                    // Só monta o Blob e entrega — decidir se/quando baixar é
                    // responsabilidade da UI (que vai perguntar ao usuário).
                    const fileBlob = new Blob(chunks, { type: metadata.type });
                    onComplete(fileBlob);
                }
            }
        };
    }
}