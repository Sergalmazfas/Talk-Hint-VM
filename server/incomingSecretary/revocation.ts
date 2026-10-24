import { EventEmitter } from "node:events";
/** Permission revocation only, never telephone routing or activation. */
export const incomingRevocations=new EventEmitter();
