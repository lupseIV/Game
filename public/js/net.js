export class Net {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.handlers = {};
    this.ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      const h = this.handlers[m.type];
      if (h) h(m);
    };
  }
  on(type, fn) { this.handlers[type] = fn; }
  send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  ready() {
    return new Promise((res, rej) => {
      if (this.ws.readyState === 1) return res();
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
  }
}
