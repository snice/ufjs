// Which CDP relay (`fjs debug`) the dev server should point apps at.
//
// The push cannot be fire-and-forget at the moment `fjs debug` starts: the
// app that needs it may not be connected yet, may reconnect after a hot
// restart, or may be started by `fjs run ios` minutes later. So the server
// remembers the live relay and greets every app that announces itself.
//
// Ownership matters as much as the port: the relay is only reachable while
// the `fjs debug` that opened it is alive, so the registration dies with
// that tool connection. Otherwise a new app would dial a port nobody is
// listening on and report an attach failure for a session long gone.
export class DebugRelayRegistry<Owner> {
  private live: { port: number; owner: Owner } | null = null;

  /** `fjs debug` announced its VM listener. One relay at a time: a second
   * `fjs debug` takes over, which is what the user just asked for. */
  open(owner: Owner, port: number): void {
    this.live = { port, owner };
  }

  /** Explicit detach (`fjs debug` exiting), whoever asked. */
  close(): void {
    this.live = null;
  }

  /** A tool connection dropped. Only the owner's death closes the session —
   * `fjs log` coming and going must not detach a debugger. */
  dropOwner(owner: Owner): boolean {
    if (!this.live || this.live.owner !== owner) return false;
    this.live = null;
    return true;
  }

  get port(): number | null {
    return this.live?.port ?? null;
  }

  /** What to send an app that just connected, or null when no relay is up.
   * Wire form parsed by flutter_fjs's dev_client.dart. */
  greeting(): string | null {
    return this.live === null ? null : `debug on ${this.live.port}`;
  }
}
