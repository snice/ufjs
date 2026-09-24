// Who may drive the dev channels (spec 107).
//
// The dev server and the `fjs debug` VM listener bind the LAN because a
// phone has to reach them. Everything that can steer an app — `eval`, the
// debugger, `debug-relay` — is a tool running on the developer's machine,
// so the line drawn here is the loopback interface: a local process can
// already talk to the loopback-only DevTools endpoint with no credential at
// all, so trusting it adds nothing, while a LAN peer gets nothing more than
// an app gets.

/** The token `fjs debug` hands apps through the dev server (`debug on
 * <port> <token>`): 128 random bits as lower-case hex. Hex only, so it can
 * be spliced into a JS string literal on the app side. */
export const DEBUG_TOKEN_RE = /^[0-9a-f]{32}$/;

/** Whether [address] (as node reports `socket.remoteAddress`) is this
 * machine's loopback: 127.0.0.0/8, ::1, or either written IPv4-mapped. A
 * missing address (already-closed socket) is not trusted. */
export function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  const v4 = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4)) return true;
  return address === '::1' || address === '0:0:0:0:0:0:0:1';
}
