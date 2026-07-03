import { actx } from './audio.js';

const RTC_CFG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// Mesh WebRTC voice. Each connection is negotiated exactly once with a
// sendrecv audio transceiver; enabling the mic later just replaceTrack()s,
// so no renegotiation is ever needed. The lower player id initiates.
export class Voice {
  constructor(net) {
    this.net = net;
    this.myId = 0;
    this.peers = new Map();
    this.micTrack = null;
    this.micStream = null;
    this.analyser = null;
    this.muted = false;
    this._lastTalk = 0;
    this._buf = null;
    net.on('vo', (m) => this._onOffer(m));
    net.on('va', (m) => this._onAnswer(m));
    net.on('vi', (m) => this._onIce(m));
  }

  setId(id) { this.myId = id; }

  async enableMic() {
    if (this.micTrack) return true;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      console.warn('microphone unavailable:', e);
      return false;
    }
    this.micTrack = this.micStream.getAudioTracks()[0];
    const c = actx();
    const src = c.createMediaStreamSource(this.micStream);
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 512;
    src.connect(this.analyser);
    this._buf = new Uint8Array(this.analyser.fftSize);
    for (const p of this.peers.values()) this._attachMic(p);
    return true;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.micTrack) this.micTrack.enabled = !this.muted;
    return this.muted;
  }

  _attachMic(p) {
    if (!this.micTrack) return;
    const tr = p.pc.getTransceivers()[0];
    if (tr) tr.sender.replaceTrack(this.micTrack).catch(() => {});
  }

  connectTo(peerId) {
    if (peerId === this.myId || this.peers.has(peerId)) return;
    if (this.myId < peerId) this._makePeer(peerId, true);
  }

  _makePeer(peerId, initiator) {
    const pc = new RTCPeerConnection(RTC_CFG);
    const p = { pc, panner: null, el: null, pendingIce: [] };
    this.peers.set(peerId, p);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.net.send({ type: 'vi', to: peerId, data: e.candidate });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      this._onTrack(p, stream);
    };
    if (initiator) {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      this._attachMic(p);
      pc.createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => this.net.send({ type: 'vo', to: peerId, data: pc.localDescription }))
        .catch((e) => console.warn('offer failed', e));
    }
    return p;
  }

  async _onOffer(m) {
    const p = this.peers.get(m.from) || this._makePeer(m.from, false);
    try {
      await p.pc.setRemoteDescription(m.data);
      for (const c of p.pendingIce) await p.pc.addIceCandidate(c).catch(() => {});
      p.pendingIce = [];
      this._attachMic(p);
      const a = await p.pc.createAnswer();
      await p.pc.setLocalDescription(a);
      this.net.send({ type: 'va', to: m.from, data: p.pc.localDescription });
    } catch (e) { console.warn('answer failed', e); }
  }

  async _onAnswer(m) {
    const p = this.peers.get(m.from);
    if (!p) return;
    await p.pc.setRemoteDescription(m.data).catch(() => {});
    for (const c of p.pendingIce) await p.pc.addIceCandidate(c).catch(() => {});
    p.pendingIce = [];
  }

  async _onIce(m) {
    const p = this.peers.get(m.from);
    if (!p) return;
    if (p.pc.remoteDescription) await p.pc.addIceCandidate(m.data).catch(() => {});
    else p.pendingIce.push(m.data);
  }

  _onTrack(p, stream) {
    // Chrome requires the stream to also feed a media element before
    // WebAudio receives any data.
    const el = new Audio();
    el.srcObject = stream;
    el.muted = true;
    el.play().catch(() => {});
    p.el = el;

    const c = actx();
    const src = c.createMediaStreamSource(stream);
    const panner = c.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'linear';
    panner.refDistance = 2;
    panner.maxDistance = 32;
    panner.rolloffFactor = 1;
    const gain = c.createGain();
    gain.gain.value = 1.4;
    src.connect(panner).connect(gain).connect(c.destination);
    p.panner = panner;
  }

  setPeerPos(id, x, y, z) {
    const p = this.peers.get(id);
    if (!p || !p.panner) return;
    const c = actx(), t = c.currentTime;
    if (p.panner.positionX) {
      p.panner.positionX.setTargetAtTime(x, t, 0.05);
      p.panner.positionY.setTargetAtTime(y, t, 0.05);
      p.panner.positionZ.setTargetAtTime(z, t, 0.05);
    } else {
      p.panner.setPosition(x, y, z);
    }
  }

  updateListener(pos, fwd, up) {
    const c = actx(), l = c.listener, t = c.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.05);
      l.positionY.setTargetAtTime(pos.y, t, 0.05);
      l.positionZ.setTargetAtTime(pos.z, t, 0.05);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.05);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.05);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.05);
      l.upX.setTargetAtTime(up.x, t, 0.05);
      l.upY.setTargetAtTime(up.y, t, 0.05);
      l.upZ.setTargetAtTime(up.z, t, 0.05);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  isTalking() {
    if (!this.analyser || this.muted || !this.micTrack || !this.micTrack.enabled) return false;
    this.analyser.getByteTimeDomainData(this._buf);
    let s = 0;
    for (let i = 0; i < this._buf.length; i++) {
      const v = (this._buf[i] - 128) / 128;
      s += v * v;
    }
    const rms = Math.sqrt(s / this._buf.length);
    const t = performance.now();
    if (rms > 0.04) this._lastTalk = t;
    return t - this._lastTalk < 300;
  }

  removePeer(id) {
    const p = this.peers.get(id);
    if (p) {
      try { p.pc.close(); } catch { /* already closed */ }
      this.peers.delete(id);
    }
  }
}
