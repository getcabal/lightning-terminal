declare module "macaroon" {
  export type CaveatVerifier = (condition: string) => string | null | undefined;

  export interface Macaroon {
    identifier: Uint8Array;
    addFirstPartyCaveat(caveat: string | Uint8Array): void;
    exportBinary(): Uint8Array;
    exportJSON(): Record<string, unknown>;
    verify(
      rootKey: Uint8Array,
      check: CaveatVerifier,
      discharges: readonly unknown[],
    ): void;
  }

  export function bytesToBase64(input: Uint8Array): string;
  export function base64ToBytes(input: string): Uint8Array;

  export function importMacaroon(serialized: string | Uint8Array): Macaroon;

  export function newMacaroon(options: {
    version: number;
    rootKey: Uint8Array;
    identifier: string | Uint8Array;
    location?: string;
  }): Macaroon;
}
