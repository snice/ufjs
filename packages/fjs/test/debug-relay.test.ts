// The two halves of "who tells the app where to dial" (spec 088):
// the dev server remembering the live relay, and `fjs debug` staying
// connected to a dev server that restarts under it. Both were one-shot
// before, which made `fjs run ios` + `fjs debug` attach only when the two
// happened to be started in the right order.
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { DebugRelayRegistry } from '../src/dev/debug-relay.js';
import { keepDevServerLinked, type DevServerLink } from '../src/dev/tool-conn.js';

describe('DebugRelayRegistry', () => {
  it('greets apps with the live relay port', () => {
    const registry = new DebugRelayRegistry<string>();
    expect(registry.greeting()).toBeNull();
    registry.open('debug-1', 38903);
    expect(registry.greeting()).toBe('debug on 38903');
  });

  it('forgets the relay when its owner disconnects', () => {
    const registry = new DebugRelayRegistry<string>();
    registry.open('debug-1', 38903);
    // another tool leaving is not a detach — `fjs log` comes and goes
    expect(registry.dropOwner('log-1')).toBe(false);
    expect(registry.greeting()).toBe('debug on 38903');
    expect(registry.dropOwner('debug-1')).toBe(true);
    expect(registry.greeting()).toBeNull();
  });

  it('lets a second fjs debug take over', () => {
    const registry = new DebugRelayRegistry<string>();
    registry.open('debug-1', 38903);
    registry.open('debug-2', 38913);
    expect(registry.greeting()).toBe('debug on 38913');
    // the replaced owner leaving must not close the new session
    expect(registry.dropOwner('debug-1')).toBe(false);
    expect(registry.greeting()).toBe('debug on 38913');
  });
});

describe('keepDevServerLinked', () => {
  let link: DevServerLink | null = null;
  const servers: WebSocketServer[] = [];

  afterEach(async () => {
    link?.stop();
    link = null;
    await Promise.all(
      servers.splice(0).map(
        (server) => new Promise<void>((done) => server.close(() => done())),
      ),
    );
  });

  /** A dev server that only knows the tool handshake, pushing every
   * `debug-relay` announce it receives into `announces`. */
  function fakeDevServer(port: number, announces: unknown[]): Promise<WebSocketServer> {
    return new Promise((resolve) => {
      const server: WebSocketServer = new WebSocketServer(
        { port, host: '127.0.0.1' },
        () => resolve(server),
      );
      servers.push(server);
      server.on('connection', (socket: WebSocket) => {
        socket.on('message', (raw: RawData) => {
          const msg = JSON.parse(String(raw)) as Record<string, unknown>;
          if (msg.fjs === 'tool') {
            socket.send(JSON.stringify({ fjs: 'hello', apps: 0 }));
          } else if (msg.fjs === 'debug-relay') {
            announces.push(msg);
          }
        });
      });
    });
  }

  const waitFor = async (check: () => boolean, ms = 4000): Promise<void> => {
    const deadline = Date.now() + ms;
    while (!check()) {
      if (Date.now() > deadline) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  it('re-announces the relay after the dev server restarts', async () => {
    const announces: unknown[] = [];
    const first = await fakeDevServer(0, announces);
    const port = (first.address() as { port: number }).port;

    link = keepDevServerLinked(
      { port, host: '127.0.0.1' },
      {
        onLink: (socket) =>
          socket.send(JSON.stringify({ fjs: 'debug-relay', on: true, port: 38903 })),
      },
      50,
    );
    await waitFor(() => announces.length === 1);

    // what `fjs run ios` does to a running `fjs debug`
    await new Promise<void>((done) => {
      for (const client of first.clients) client.terminate();
      first.close(() => done());
    });
    servers.splice(servers.indexOf(first), 1);
    await fakeDevServer(port, announces);

    await waitFor(() => announces.length === 2);
    expect(announces[1]).toEqual({ fjs: 'debug-relay', on: true, port: 38903 });
  });

  it('keeps retrying until a dev server shows up, and reports the gap once', async () => {
    const announces: unknown[] = [];
    // a port nobody is listening on yet — `fjs debug` before `fjs dev`
    const probe = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    const port = await new Promise<number>((resolve) =>
      probe.on('listening', () => resolve((probe.address() as { port: number }).port)),
    );
    await new Promise<void>((done) => probe.close(() => done()));

    let drops = 0;
    link = keepDevServerLinked(
      { port, host: '127.0.0.1' },
      {
        onLink: (socket) =>
          socket.send(JSON.stringify({ fjs: 'debug-relay', on: true, port: 38903 })),
        onDrop: () => drops++,
      },
      50,
    );
    await waitFor(() => drops === 1);

    await fakeDevServer(port, announces);
    await waitFor(() => announces.length === 1);
    // one report per disconnected streak, not one per retry
    expect(drops).toBe(1);
  });

  it('stops reconnecting after stop()', async () => {
    const announces: unknown[] = [];
    const server = await fakeDevServer(0, announces);
    const port = (server.address() as { port: number }).port;

    link = keepDevServerLinked(
      { port, host: '127.0.0.1' },
      {
        onLink: (socket) =>
          socket.send(JSON.stringify({ fjs: 'debug-relay', on: true, port: 38903 })),
      },
      50,
    );
    await waitFor(() => announces.length === 1);

    link.stop();
    expect(link.socket).toBeNull();
    await new Promise((r) => setTimeout(r, 200));
    expect(announces).toHaveLength(1);
  });
});
