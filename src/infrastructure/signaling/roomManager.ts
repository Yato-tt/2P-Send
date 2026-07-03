interface PeerConnection {
    id: string;
    controller: ReadableStreamDefaultController;
}

interface Room {
    id: string;
    sender: PeerConnection | null;
    receiver: PeerConnection | null;
    // Mensagens que não puderam ser entregues porque o peer alvo ainda não
    // tinha entrado na sala. É o caso normal do fluxo: o remetente cria a
    // oferta (offer) e o link ANTES do destinatário abrir a página. Sem essa
    // fila, a oferta se perdia e o destinatário ficava travado em
    // "conectando" para sempre.
    pendingMessages: { sender: any[]; receiver: any[] };
}

const activeRooms = new Map<string, Room>();

// Limite de segurança para não deixar a fila crescer sem limite caso o peer
// alvo nunca apareça.
const MAX_QUEUED_MESSAGES = 200;

export const roomManager = {
    getOrCreateRoom(roomId: string): Room {
        if (!activeRooms.has(roomId)) {
            activeRooms.set(roomId, {
                id: roomId,
                sender: null,
                receiver: null,
                pendingMessages: { sender: [], receiver: [] }
            });
        }
        return activeRooms.get(roomId)!;
    },

    addPeer(roomId: string, role: 'sender' | 'receiver', peerId: string, controller: ReadableStreamDefaultController) {
        const room = this.getOrCreateRoom(roomId);
        room[role] = { id: peerId, controller };

        // Entrega imediatamente qualquer mensagem que ficou esperando esse
        // peer entrar na sala.
        const queued = room.pendingMessages[role];
        if (queued.length) {
            const encoder = new TextEncoder();
            for (const data of queued) {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                } catch {
                    break;
                }
            }
            room.pendingMessages[role] = [];
        }
    },

    notifyPeer(roomId: string, targetRole: 'sender' | 'receiver', data: any) {
        const room = this.getOrCreateRoom(roomId);
        const target = room[targetRole];

        if (target?.controller) {
            try {
                const encoder = new TextEncoder();
                target.controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                return;
            } catch {
                // controller já fechado (peer caiu bem nesse instante) —
                // cai para a fila abaixo em vez de perder a mensagem.
            }
        }

        const queue = room.pendingMessages[targetRole];
        queue.push(data);
        if (queue.length > MAX_QUEUED_MESSAGES) {
            queue.shift();
        }
    },

    // Remove só o peer que desconectou. Antes, qualquer desconexão apagava a
    // sala inteira (removeRoom), derrubando o outro peer que ainda estava
    // conectado e impedindo reconexões ou reenvio de arquivos na mesma sala.
    removePeer(roomId: string, role: 'sender' | 'receiver', peerId?: string) {
        const room = activeRooms.get(roomId);
        if (!room) return;

        // Só remove se for o peer atual — evita que uma conexão antiga,
        // ainda fechando, apague um peer novo que já reconectou no lugar.
        if (peerId && room[role]?.id !== peerId) return;

        room[role] = null;

        if (!room.sender && !room.receiver) {
            activeRooms.delete(roomId);
        }
    },

    removeRoom(roomId: string) {
        activeRooms.delete(roomId);
    }
};
