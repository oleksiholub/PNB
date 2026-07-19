import { randomUUID } from "crypto";

export function newTraceId(): string {
  return randomUUID();
}

export function newArtifactId(): string {
  return randomUUID();
}