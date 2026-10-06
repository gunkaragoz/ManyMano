import { randomBytes } from "node:crypto";

// Workers declarations must not erase Node globals in the shared TS program.
type IsAny<T> = 0 extends 1 & T ? true : false;
type Assert<T extends true> = T;
export type ProcessIsTyped = Assert<IsAny<typeof process> extends false ? true : false>;
export type BufferIsTyped = Assert<IsAny<typeof Buffer> extends false ? true : false>;
export type ProcessEnvIsTyped = Assert<IsAny<typeof process.env> extends false ? true : false>;

export const hexControl = (): string => randomBytes(8).toString("hex");
