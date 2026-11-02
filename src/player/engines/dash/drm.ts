import type { DrmConfig, DrmSystem } from '../../types';
import type { ProtectionInfo } from './mpd';

/*
 * Encrypted Media Extensions. Picks the first key system the device supports
 * (Widevine, PlayReady, ClearKey; FairPlay for native HLS on Apple), opens a
 * session per `encrypted` event (or per manifest PSSH) and exchanges license
 * messages with the configured server.
 */

export const KEY_SYSTEMS: Record<DrmSystem, string> = {
  widevine: 'com.widevine.alpha',
  playready: 'com.microsoft.playready',
  clearkey: 'org.w3.clearkey',
  fairplay: 'com.apple.fps',
};

const SCHEME_IDS: Record<string, DrmSystem> = {
  'urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed': 'widevine',
  'urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95': 'playready',
  'urn:uuid:e2719d58-a985-b3c9-781a-b030af78d30e': 'clearkey',
  'urn:uuid:1077efec-c0b2-4d02-ace3-3c1e52e2fb4b': 'clearkey',
};

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexToB64Url(hex: string): string {
  let bin = '';
  for (let i = 0; i < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class DrmController {
  private keys: MediaKeys | null = null;
  private system: DrmSystem | null = null;
  private config: DrmConfig | null = null;
  private sessions: MediaKeySession[] = [];
  private seenInitData = new Set<string>();
  private video: HTMLVideoElement | null = null;
  private onError: (e: Error) => void;

  constructor(onError: (e: Error) => void) {
    this.onError = onError;
  }

  /** Negotiates a key system and attaches MediaKeys. Returns false if none fits. */
  async init(video: HTMLVideoElement, configs: DrmConfig[], protection: ProtectionInfo[], videoMime: string, audioMime: string): Promise<boolean> {
    if (!navigator.requestMediaKeySystemAccess) throw new Error('EME is not available');
    const offered = new Set(protection.map((p) => SCHEME_IDS[p.schemeIdUri]).filter(Boolean));
    const ordered = configs.filter((c) => !c.system || offered.size === 0 || offered.has(c.system));
    for (const cfg of ordered) {
      const systems: DrmSystem[] = cfg.system ? [cfg.system] : cfg.clearKeys ? ['clearkey'] : ['widevine', 'playready'];
      for (const sys of systems) {
        try {
          const access = await navigator.requestMediaKeySystemAccess(KEY_SYSTEMS[sys], [
            {
              initDataTypes: ['cenc', 'keyids', 'webm'],
              videoCapabilities: videoMime ? [{ contentType: videoMime, robustness: cfg.videoRobustness || '' }] : undefined,
              audioCapabilities: audioMime ? [{ contentType: audioMime, robustness: cfg.audioRobustness || '' }] : undefined,
            },
          ]);
          this.keys = await access.createMediaKeys();
          this.system = sys;
          this.config = cfg;
          if (cfg.certificateUrl) {
            const cert = await (await fetch(cfg.certificateUrl)).arrayBuffer();
            await this.keys.setServerCertificate(cert);
          }
          await video.setMediaKeys(this.keys);
          this.video = video;
          video.addEventListener('encrypted', this.onEncrypted);
          // Manifest PSSH lets playback start before the first `encrypted` event.
          const pssh = protection.find((p) => SCHEME_IDS[p.schemeIdUri] === sys && p.pssh);
          if (pssh && pssh.pssh) this.createSession('cenc', b64ToBytes(pssh.pssh));
          return true;
        } catch {
          // try next system
        }
      }
    }
    return false;
  }

  get keySystem(): string | null {
    return this.system ? KEY_SYSTEMS[this.system] : null;
  }

  private onEncrypted = (e: MediaEncryptedEvent) => {
    if (e.initData) this.createSession(e.initDataType, new Uint8Array(e.initData));
  };

  private createSession(type: string, initData: Uint8Array) {
    if (!this.keys) return;
    const sig = type + ':' + Array.prototype.join.call(initData.subarray(0, 64), ',') + initData.length;
    if (this.seenInitData.has(sig)) return;
    this.seenInitData.add(sig);
    const session = this.keys.createSession();
    this.sessions.push(session);
    session.addEventListener('message', (ev) => {
      this.license(session, (ev as MediaKeyMessageEvent).message).catch((err) => this.onError(err));
    });
    session.generateRequest(type, initData as unknown as BufferSource).catch((err) => this.onError(err));
  }

  private async license(session: MediaKeySession, message: ArrayBuffer) {
    const cfg = this.config!;
    if (this.system === 'clearkey' && cfg.clearKeys) {
      const req = JSON.parse(new TextDecoder().decode(message)) as { kids: string[] };
      const keys = req.kids.map((kid) => {
        const hex = Object.keys(cfg.clearKeys!).find((k) => hexToB64Url(k.replace(/-/g, '')) === kid);
        return { kty: 'oct', kid, k: hex ? hexToB64Url(cfg.clearKeys![hex]) : '' };
      });
      await session.update(new TextEncoder().encode(JSON.stringify({ keys, type: 'temporary' })));
      return;
    }
    const body = cfg.transformRequest ? cfg.transformRequest(message) : message;
    const res = await fetch(cfg.licenseUrl, { method: 'POST', body, headers: cfg.headers });
    if (!res.ok) throw new Error('License request failed: HTTP ' + res.status);
    let data = await res.arrayBuffer();
    if (cfg.transformResponse) data = cfg.transformResponse(data);
    await session.update(data);
  }

  async destroy() {
    if (this.video) this.video.removeEventListener('encrypted', this.onEncrypted);
    for (const s of this.sessions) s.close().catch(() => {});
    this.sessions = [];
    if (this.video && this.keys) await this.video.setMediaKeys(null).catch(() => {});
    this.keys = null;
    this.video = null;
  }
}
