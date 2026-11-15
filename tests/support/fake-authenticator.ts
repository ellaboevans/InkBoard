import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

/**
 * A software passkey for integration tests: an ES256 key pair that answers
 * registration and authentication options with real, signed WebAuthn
 * responses ("none" attestation). So SimpleWebAuthn's verification really runs
 * (challenge, origin, RP ID, flags, signature, counter) instead of being mocked.
 * Knobs let a test break one thing at a time.
 */

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

const b64 = (bytes: Uint8Array | Buffer) => isoBase64URL.fromBuffer(new Uint8Array(bytes));
const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest();

export class FakeAuthenticator {
  readonly credentialId = randomBytes(32);
  readonly id = b64(this.credentialId);
  private readonly privateKey: KeyObject;
  private readonly cosePublicKey: Uint8Array;
  /** Signature counter; stays 0 when `counting` is false (like synced passkeys). */
  counter = 0;
  /** The user handle from the registration options (sent back in assertions). */
  userHandle: string | undefined;

  constructor(private readonly opts: { counting?: boolean; synced?: boolean } = {}) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: "jwk" });
    this.cosePublicKey = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, isoBase64URL.toBuffer(jwk.x!)],
        [-3, isoBase64URL.toBuffer(jwk.y!)],
      ]),
    );
  }

  private flags(uv: boolean, extra = 0) {
    const synced = this.opts.synced ? FLAG_BE | FLAG_BS : 0;
    return FLAG_UP | (uv ? FLAG_UV : 0) | synced | extra;
  }

  /** Answer navigator.credentials.create() options. */
  register(
    options: PublicKeyCredentialCreationOptionsJSON,
    { origin, rpId = options.rp.id, uv = true, challenge = options.challenge }: { origin: string; rpId?: string; uv?: boolean; challenge?: string },
  ): RegistrationResponseJSON {
    this.userHandle = options.user.id;
    const clientDataJSON = JSON.stringify({ type: "webauthn.create", challenge, origin, crossOrigin: false });
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha(rpId!),
      Buffer.from([this.flags(uv, FLAG_AT)]),
      Buffer.alloc(4), // counter 0
      Buffer.alloc(16), // aaguid
      idLength,
      this.credentialId,
      Buffer.from(this.cosePublicKey),
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", new Uint8Array(authData)],
      ]) as never,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64(Buffer.from(clientDataJSON)),
        attestationObject: b64(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** Answer navigator.credentials.get() options. */
  assert(
    options: PublicKeyCredentialRequestOptionsJSON,
    {
      origin,
      rpId = options.rpId,
      uv = true,
      counter,
      userHandle = this.userHandle,
      challenge = options.challenge,
    }: { origin: string; rpId?: string; uv?: boolean; counter?: number; userHandle?: string; challenge?: string },
  ): AuthenticationResponseJSON {
    if (counter !== undefined) this.counter = counter;
    else if (this.opts.counting !== false) this.counter += 1;
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }));
    const counterBytes = Buffer.alloc(4);
    counterBytes.writeUInt32BE(this.counter);
    const authData = Buffer.concat([sha(rpId!), Buffer.from([this.flags(uv)]), counterBytes]);
    const signature = sign("sha256", Buffer.concat([authData, sha(clientDataJSON)]), this.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64(clientDataJSON),
        authenticatorData: b64(authData),
        signature: b64(signature),
        userHandle,
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
