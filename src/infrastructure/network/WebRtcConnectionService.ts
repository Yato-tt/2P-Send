import type { IConnectionService, ConnectionEvent } from "../../core/interfaces/IConnectionService";

// Credenciais de um servidor TURN opcional, configuráveis via variáveis de
// ambiente públicas do Astro (PUBLIC_*). STUN sozinho não é suficiente para
// atravessar NAT simétrico, CGNAT (comum em redes móveis) ou firewalls
// corporativos — cenários comuns quando remetente e destinatário estão em
// redes diferentes. Sem TURN, esses casos vão falhar silenciosamente com
// iceConnectionState = 'failed'.
const TURN_URL = (import.meta.env.PUBLIC_TURN_URL as string) || '';
const TURN_USERNAME = (import.meta.env.PUBLIC_TURN_USERNAME as string) || '';
const TURN_CREDENTIAL = (import.meta.env.PUBLIC_TURN_CREDENTIAL as string) || '';

export class WebRtcConnectionService implements IConnectionService {

    private peerConnection: RTCPeerConnection | null = null;
    private dataChannel: RTCDataChannel | null = null;
    private eventSource: EventSource | null = null;

    private roomId: string = '';
    private role: 'sender' | 'receiver' = 'sender';
    private peerId: string = '';

    private pendingCandidates: RTCIceCandidateInit[] = [];
    private remoteDescriptionSet = false;

    private onChunkReceivedCallback: ((chunk: ArrayBuffer) => void) | null = null;
    private onMessageReceivedCallback: ((data: any) => void) | null = null;
    private onStatusChangeCallback: ((event: ConnectionEvent) => void) | null = null;

    // Pausa o envio quando o buffer pendente do canal passa de 1MB, retoma
    // quando cai abaixo de 256KB. Sem isso, enviar chunks mais rápido do que
    // a rede consegue escoar estoura o buffer do SCTP.
    private static readonly MAX_BUFFERED_AMOUNT = 1 * 1024 * 1024;
    private static readonly BUFFERED_AMOUNT_LOW_THRESHOLD = 256 * 1024;

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
        this.roomId = roomId;
        this.role = role;
        this.peerId = Math.random().toString(36).substring(7);

        const signalingUrl = `/api/signaling?roomId=${roomId}&role=${role}&peerId=${this.peerId}`;
        this.eventSource = new EventSource(signalingUrl);

        this.eventSource.onerror = () => {
            // O EventSource tenta reconectar sozinho; apenas avisamos.
            this.notifyStatusChange({
                type: 'connection-error',
                message: 'Conexão de sinalização instável. Tentando reconectar...'
            });
        };

        this.peerConnection = new RTCPeerConnection(this.rtcConfig);

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignalingMessage({ type: 'candidate', candidate: event.candidate });
            }
        };

        this.peerConnection.oniceconnectionstatechange = () => {
            const state = this.peerConnection?.iceConnectionState;
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
            this.dataChannel = this.peerConnection.createDataChannel('fileTransfer', {
                ordered: true
            });
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

        this.eventSource.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            await this.handleSignalingMessage(message);
        };
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
        this.eventSource?.close();
        this.notifyStatusChange({ type: 'peer-disconnected' });
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
                    const parsed = JSON.parse(event.data);
                    this.onMessageReceivedCallback?.(parsed);
                } catch {
                    // mensagem de controle malformada — ignora
                }
            }
        };
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
                    // O candidato chegou antes da SDP remota ser aplicada —
                    // comum quando os dois peers estão em redes diferentes e
                    // o tempo de handshake não bate. Guarda para aplicar
                    // assim que a SDP remota for definida.
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
            } catch (error) {
                console.error('Erro ao aplicar ICE candidate pendente:', error);
            }
        }
    }

    private async sendSignalingMessage(data: any) {
        await fetch('/api/signaling', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                roomId: this.roomId,
                role: this.role,
                data
            })
        });
    }

    private notifyStatusChange(event: ConnectionEvent): void {
        this.onStatusChangeCallback?.(event);
    }
}
