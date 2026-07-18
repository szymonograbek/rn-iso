import { Project } from "./project.js";
import type { State } from "./types.js";

const resolveProject = (state: State, target: string | undefined, cwd?: string): string => Project.resolveRegistered(state, target, cwd);

export const Target = { resolveProject };
