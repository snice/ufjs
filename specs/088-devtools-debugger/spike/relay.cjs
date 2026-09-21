// fjs spec 088 spike — CDP relay: newline-delimited JSON over TCP (mini-host)
// <-> WebSocket (Chrome DevTools / cdp-client). Also serves the /json
// endpoints chrome://inspect uses for discovery.
// Run from /tmp/fjs-spike (node_modules symlink points at the repo's ws).
const http = require('http');
const net = require('net');
const { WebSocketServer, WebSocket } = require('ws');

const TCP_PORT = 39800; // mini-host
const HTTP_PORT = 39801; // relay + discovery

const server = http.createServer((req, res) => {
  const json = (obj) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  if (req.url === '/json/version') {
    json({
      Browser: 'fjs-spike/0.1 primjs',
      'Protocol-Version': '1.3',
      webSocketDebuggerUrl: `ws://127.0.0.1:${HTTP_PORT}/cdp`,
    });
  } else if (req.url === '/json/list' || req.url === '/json') {
    json([
      {
        id: 'spike',
        title: 'fjs spike (primjs)',
        type: 'page',
        url: 'file:///tmp/fjs-spike/host/test.js',
        webSocketDebuggerUrl: `ws://127.0.0.1:${HTTP_PORT}/cdp`,
      },
    ]);
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server, path: '/cdp' });
wss.on('connection', (ws) => {
  console.log('[relay] devtools connected');
  const sock = net.connect(TCP_PORT, '127.0.0.1', () =>
    console.log('[relay] mini-host connected'),
  );
  let buf = '';
  sock.on('data', (chunk) => {
    buf += chunk;
    let pos;
    while ((pos = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, pos);
      buf = buf.slice(pos + 1);
      if (line && ws.readyState === WebSocket.OPEN) ws.send(line);
    }
  });
  sock.on('close', () => ws.close());
  ws.on('message', (data) => sock.write(data + '\n'));
  ws.on('close', () => sock.destroy());
});

server.listen(HTTP_PORT, '127.0.0.1', () =>
  console.log(`[relay] http+ws on 127.0.0.1:${HTTP_PORT} (ws path /cdp)`),
);
