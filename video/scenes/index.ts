import type { Scene } from "./common";
import { phoneScenes } from "./phone";
import { readerScenes } from "./reader";
import { securityScenes } from "./security";
import { signupScene, writerScenes } from "./writer";

/**
 * Every take, in recording order. Order matters where takes share state: the
 * writer signs up before she writes, and deleting her account comes last.
 */
export const SCENES: Scene[] = [...readerScenes, ...phoneScenes, signupScene, ...writerScenes, ...securityScenes];
