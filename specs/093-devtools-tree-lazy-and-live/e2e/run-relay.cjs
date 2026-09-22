const { startCdpRelay } = require('./relay.cjs');
startCdpRelay({
  cdpPort: 49902,
  vmPort: 49903,
  vmHost: '127.0.0.1', // loopback: a LAN/emulator leftover must not steal the slot
  log: (l) => console.error('[relay]', l),
}).then(() => console.error('[relay] up cdp=49902 vm=49903'));
