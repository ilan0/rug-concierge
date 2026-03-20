import { createHash } from "node:crypto";

export function hashBytesSha256(value: ArrayBuffer | Buffer | Uint8Array): string {
  if (value instanceof ArrayBuffer) {
    return createHash("sha256").update(Buffer.from(value)).digest("hex");
  }
  if (ArrayBuffer.isView(value)) {
    return createHash("sha256").update(Buffer.from(value.buffer, value.byteOffset, value.byteLength)).digest("hex");
  }
  return createHash("sha256").update(value).digest("hex");
}
