export class SseHub {
  constructor() {
    this.clients = new Set();
    this.sequence = 0;
    this.heartbeat = setInterval(() => this.#broadcastRaw(': heartbeat\n\n'), 20000);
    this.heartbeat.unref?.();
  }

  connect(request, response) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.write(`event: ready\ndata: ${JSON.stringify({ connected: true })}\n\n`);
    this.clients.add(response);
    request.on('close', () => this.clients.delete(response));
  }

  publish(type, data) {
    this.sequence += 1;
    const payload = `id: ${this.sequence}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    this.#broadcastRaw(payload);
  }

  close() {
    clearInterval(this.heartbeat);
    for (const client of this.clients) client.end();
    this.clients.clear();
  }

  #broadcastRaw(payload) {
    for (const client of [...this.clients]) {
      try {
        client.write(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }
}
