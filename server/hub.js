// Keeps track of open sockets per space and fans out messages.
export class Hub {
  constructor() {
    this.rooms = new Map();
  }
  add(conn) {
    let room = this.rooms.get(conn.uid);
    if (!room) this.rooms.set(conn.uid, (room = new Set()));
    room.add(conn);
  }
  remove(conn) {
    const room = this.rooms.get(conn.uid);
    if (!room) return;
    room.delete(conn);
    if (!room.size) this.rooms.delete(conn.uid);
  }
  conns(uid) {
    return [...(this.rooms.get(uid) ?? [])];
  }
  online(uid) {
    return [...new Set(this.conns(uid).map((c) => c.devId))];
  }
  broadcast(uid, msg, except) {
    const data = JSON.stringify(msg);
    for (const c of this.conns(uid)) if (c !== except) c.send(data);
  }
  presence(uid) {
    this.broadcast(uid, { t: 'presence', online: this.online(uid) });
  }
  /** Drop a device (kick): notify and close every socket it has open. */
  kick(uid, tokenHash) {
    for (const c of this.conns(uid)) {
      if (c.tokenHash === tokenHash) {
        c.send(JSON.stringify({ t: 'kicked' }));
        c.close();
      }
    }
  }
}
