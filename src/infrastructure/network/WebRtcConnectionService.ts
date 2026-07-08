import type { IConnectionService, ConnectionEvent } from "../../core/interfaces/IConnectionService";

// Servidor TURN — obrigatório para atravessar NAT simétrico, CGNAT (redes
// móveis) e firewalls corporativos. Trocar o transporte de sinalização não
// substitui isso: são dois problemas diferentes.
const TURN_URL = (import.meta.env.PUBLIC_TURN_URL as string) || '';
const TURN_USERNAME = (import.meta.env.PUBLIC_TURN_USERNAME as string) || '';
const TURN_CREDENTIAL = (import.meta.env.PUBLIC_TURN_CREDENTIAL as string) || '';

// URL do servidor de sinalização standalone (pasta /server deste projeto).
// Em dev, o padrão aponta pro servidor rodando localmente.
const SIGNALING_WS_URL = (import.meta.env.PUBLIC_SIGNALING_WS_URL as string) || 'ws://localhost:8787';

const SOCKET_CONNECT_TIMEOUT_MS = 8000;

export class WebRtcConnectionService implements IConnectionService {

    private peerConnection: RTCPeerConnection | null = null;
    private dataChannel: RTCDataChannel | null = null;
    private socket: WebSocket | null = null;

    private role: 'sender' | 'receiver' = 'sender';

    private remoteDescriptionSet = false;
    private pendingCandidates: RTCIceCandidateInit[] = [];
    // Mensagens que tentaram sair antes do socket de sinalização abrir.
    private outgoingQueue: unknown[] = [];

    private onChunkReceivedCallback: ((chunk: ArrayBuffer) => void) | null = null;
    private onMessageReceivedCallback: ((data: any) => void) | null = null;
    private onStatusChangeCallback: ((event: ConnectionEvent) => void) | null = null;

    // Buffer bem maior antes de pausar (16MB) e uma margem mais alta pra
    // retomar (4MB). Com 1MB/256KB o canal ficava ocioso entre pausa e
    // retomada com muita frequência, sobretudo em conexões com latência
    // maior (relay TURN, redes móveis) — isso sozinho derrubava bastante o
    // throughput. Valores maiores mantêm mais dados "em voo" e usam melhor
    // a banda disponível.
    private static readonly MAX_BUFFERED_AMOUNT = 16 * 1024 * 1024;
    private static readonly BUFFERED_AMOUNT_LOW_THRESHOLD = 4 * 1024 * 1024;

    private rtcConfig: RTCConfiguration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            ...(TURN_URL ? [{
                urls: TURN_URL,
                username: TURN_USERNAME,
                credential: TURN_CREDENTIAL,
            }] : [])
        ]
    };

    async joinRoom(roomId: string, role: "sender" | "receiver"): Promise<void> {
        this.role = role;

        await this.connectSignalingSocket(roomId, role);

        this.peerConnection = new RTCPeerConnection(this.rtcConfig);

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignalingMessage({ type: 'candidate', candidate: event.candidate });
            }
        };

        this.peerConnection.oniceconnectionstatechange = () => {
            const state = this.peerConnection?.iceConnectionState;
            console.log('[ice] estado mudou para:', state);
            if (state === 'failed') {
                this.notifyStatusChange({
                    type: 'connection-error',
                    message: 'Não foi possível conectar diretamente nessa rede. Configure um servidor TURN.'
                });
            } else if (state === 'disconnected') {
                this.notifyStatusChange({ type: 'peer-disconnected' });
            }
        };

        if (this.role === 'sender') {
            this.dataChannel = this.peerConnection.createDataChannel('fileTransfer', { ordered: true });
            this.setupDataChannelHandlers();

            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            this.sendSignalingMessage({ type: 'offer', sdp: offer });
        } else {
            this.peerConnection.ondatachannel = (event) => {
                this.dataChannel = event.channel;
                this.setupDataChannelHandlers();
            };
        }
    }

    async sendChunk(chunk: ArrayBuffer): Promise<void> {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            throw new Error('Canal de dados não está aberto para envio.');
        }
        if (this.dataChannel.bufferedAmount > WebRtcConnectionService.MAX_BUFFERED_AMOUNT) {
            await this.waitForBufferDrain();
        }
        this.dataChannel.send(chunk);
    }

    sendMessage(data: unknown): void {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            throw new Error('Canal de dados não está aberto para envio.');
        }
        this.dataChannel.send(JSON.stringify(data));
    }

    onChunkReceived(callback: (chunk: ArrayBuffer) => void): void {
        this.onChunkReceivedCallback = callback;
    }

    onMessageReceived(callback: (data: any) => void): void {
        this.onMessageReceivedCallback = callback;
    }

    onConnectionStatusChange(callback: (event: ConnectionEvent) => void): void {
        this.onStatusChangeCallback = callback;
    }

    isChannelOpen(): boolean {
        return this.dataChannel?.readyState === 'open';
    }

    disconnect(): void {
        this.dataChannel?.close();
        this.peerConnection?.close();
        this.socket?.close();
        this.notifyStatusChange({ type: 'peer-disconnected' });
    }

    private connectSignalingSocket(roomId: string, role: 'sender' | 'receiver'): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = `${SIGNALING_WS_URL}?roomId=${encodeURIComponent(roomId)}&role=${role}`;
            console.log('[signaling] conectando em', url);
            const socket = new WebSocket(url);
            this.socket = socket;

            const timeoutId = setTimeout(() => {
                if (socket.readyState !== WebSocket.OPEN) {
                    console.error('[signaling] timeout esperando o socket abrir. readyState =', socket.readyState);
                    reject(new Error('Não foi possível conectar ao servidor de sinalização.'));
                }
            }, SOCKET_CONNECT_TIMEOUT_MS);

            socket.onopen = () => {
                console.log('[signaling] socket aberto');
                clearTimeout(timeoutId);
                // Esvazia qualquer mensagem que tentou sair antes de abrir.
                for (const msg of this.outgoingQueue) socket.send(JSON.stringify(msg));
                this.outgoingQueue = [];
                resolve();
            };

            socket.onmessage = (event) => {
                console.log('[signaling] mensagem recebida:', event.data);
                try {
                    const message = JSON.parse(event.data);
                    this.handleSignalingMessage(message);
                } catch (err) {
                    console.error('Mensagem de sinalização inválida:', err);
                }
            };

            socket.onerror = (err) => {
                console.error('[signaling] erro no socket:', err);
                this.notifyStatusChange({
                    type: 'connection-error',
                    message: 'Erro na conexão com o servidor de sinalização.'
                });
            };

            socket.onclose = (event) => {
                console.log('[signaling] socket fechado. code =', event.code, 'reason =', event.reason);
            };
        });
    }

    private sendSignalingMessage(data: unknown): void {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
        } else {
            // Socket ainda conectando — guarda e manda assim que abrir.
            this.outgoingQueue.push(data);
        }
    }

    private async handleSignalingMessage(message: any): Promise<void> {
        if (!this.peerConnection) return;

        try {
            if (message.type === 'offer' && this.role === 'receiver') {
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp));
                this.remoteDescriptionSet = true;
                await this.flushPendingCandidates();

                const answer = await this.peerConnection.createAnswer();
                await this.peerConnection.setLocalDescription(answer);
                this.sendSignalingMessage({ type: 'answer', sdp: answer });

            } else if (message.type === 'answer' && this.role === 'sender') {
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp));
                this.remoteDescriptionSet = true;
                await this.flushPendingCandidates();

            } else if (message.type === 'candidate') {
                if (this.remoteDescriptionSet) {
                    await this.peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
                } else {
                    this.pendingCandidates.push(message.candidate);
                }
            }
        } catch (error) {
            this.notifyStatusChange({ type: 'connection-error', message: 'Falha no aperto de mão da sinalização.' });
        }
    }

    private async flushPendingCandidates(): Promise<void> {
        const candidates = this.pendingCandidates;
        this.pendingCandidates = [];
        for (const candidate of candidates) {
            try {
                await this.peerConnection?.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
                console.error('Erro ao aplicar ICE candidate pendente:', err);
            }
        }
    }

    private waitForBufferDrain(): Promise<void> {
        return new Promise((resolve) => {
            const dc = this.dataChannel;
            if (!dc) return resolve();
            dc.bufferedAmountLowThreshold = WebRtcConnectionService.BUFFERED_AMOUNT_LOW_THRESHOLD;
            const onLow = () => {
                dc.removeEventListener('bufferedamountlow', onLow);
                resolve();
            };
            dc.addEventListener('bufferedamountlow', onLow);
        });
    }

    private setupDataChannelHandlers(): void {
        if (!this.dataChannel) return;

        this.dataChannel.binaryType = 'arraybuffer';

        this.dataChannel.onopen = () => {
            this.notifyStatusChange({ type: 'peer-connected' });
        };

        this.dataChannel.onclose = () => {
            this.notifyStatusChange({ type: 'peer-disconnected' });
        };

        this.dataChannel.onerror = () => {
            this.notifyStatusChange({ type: 'connection-error', message: 'Erro no canal de dados WebRTC.' });
        };

        this.dataChannel.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                this.onChunkReceivedCallback?.(event.data);
                return;
            }
            if (typeof event.data === 'string') {
                try {
                    this.onMessageReceivedCallback?.(JSON.parse(event.data));
                } catch {
                    // mensagem de controle malformada — ignora
                }
            }
        };
    }

    private notifyStatusChange(event: ConnectionEvent): void {
        this.onStatusChangeCallback?.(event);
    }
}
