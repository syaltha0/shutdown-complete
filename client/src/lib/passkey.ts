import { api } from './api';

// The browser's passkey dialogs (WebAuthn), with the server's options turned into the buffers they need.
const toBuf = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const toB64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const passkeysSupported = () => typeof window !== 'undefined' && 'PublicKeyCredential' in window && !!navigator.credentials;

/** Creates a passkey for the signed-in account and stores it on the server. */
export async function addPasskey(name: string) {
  const o = await api.passkeyCreateOptions();
  const cred = (await navigator.credentials.create({
    publicKey: {
      ...o,
      challenge: toBuf(o.challenge),
      user: { ...o.user, id: toBuf(o.user.id) },
      excludeCredentials: o.excludeCredentials.map((c) => ({ ...c, id: toBuf(c.id) })),
    } as PublicKeyCredentialCreationOptions,
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('cancelled');
  const r = cred.response as AuthenticatorAttestationResponse;
  await api.passkeyAdd(name, {
    id: cred.id, rawId: toB64(cred.rawId), type: cred.type,
    response: { clientDataJSON: toB64(r.clientDataJSON), attestationObject: toB64(r.attestationObject) },
    transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
  });
}

/** Signs in with any passkey of this site that the device offers. */
export async function signInWithPasskey() {
  const o = await api.passkeyLoginOptions();
  const cred = (await navigator.credentials.get({
    publicKey: { challenge: toBuf(o.challenge), rpId: o.rpId, timeout: o.timeout, userVerification: o.userVerification as UserVerificationRequirement, allowCredentials: [] },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('cancelled');
  const r = cred.response as AuthenticatorAssertionResponse;
  await api.passkeyLogin({
    id: cred.id, rawId: toB64(cred.rawId), type: cred.type,
    response: {
      clientDataJSON: toB64(r.clientDataJSON), authenticatorData: toB64(r.authenticatorData), signature: toB64(r.signature),
      userHandle: r.userHandle ? toB64(r.userHandle) : null,
    },
  });
}

/** A name for a new passkey: the browser and system it is made on. */
export function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return os ? `${br} on ${os}` : br;
}
