import type { APIRoute } from "astro";
import { roomManager } from "../../infrastructure/signaling/roomManager";

export const GET: APIRoute = ({ request }) => {
    const url = new URL(request.url);
    const roomId = url.searchParams.get('roomId');
    const role = url.searchParams.get('role') as 'sender' | 'receiver';
    const peerId = url.searchParams.get('peerId');

    if (!roomId || !role || !peerId) {
        return new Response('Parâmetros ausentes', { status: 404 });
    }

    let heartbeat: ReturnType<typeof setInterval>;

    const stream = new ReadableStream({
        start(controller) {
            roomManager.addPeer(roomId, role, peerId, controller);

            const targetRole = role === 'sender' ? 'receiver' : 'sender';
            roomManager.notifyPeer(roomId, targetRole, { type: 'peer-connected', peerId });

            // Mantém a conexão SSE viva. Proxies, CDNs e alguns provedores
            // derrubam conexões ociosas depois de ~30s, o que quebra o
            // handshake quando remetente e destinatário estão em redes
            // diferentes e o destinatário demora a abrir o link.
            heartbeat = setInterval(() => {
                try {
                    controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
                } catch {
                    clearInterval(heartbeat);
                }
            }, 15000);
        },
        cancel() {
            clearInterval(heartbeat);
            roomManager.removePeer(roomId, role, peerId);
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
};

export const POST: APIRoute = async ({ request }) => {
    const { roomId, role, data } = await request.json();

    if (!roomId || !role || !data) {
        return new Response('Dados inválidos!', { status: 404 });
    }

    const targetRole = role === 'sender' ? 'receiver' : 'sender';

    roomManager.notifyPeer(roomId, targetRole, data);

    return new Response(JSON.stringify({ success: true }), { status: 200 });
};
