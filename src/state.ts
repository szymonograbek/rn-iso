import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Schema } from "./types.js";
import type { Project, State } from "./types.js";

const path = join(process.env.RN_ISO_HOME ?? join(homedir(), ".rn-iso"), "state.json");

const empty = (): State => ({ version: 1, projects: {} });

const read = async (): Promise<State> => {
	try {
		return Schema.state.parse(JSON.parse(await readFile(path, "utf8")));
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return empty();
		throw new Error(`Cannot read rn-iso state at ${path}: ${error instanceof Error ? error.message : "unknown error"}`);
	}
};

const write = async (state: State): Promise<void> => {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.tmp`;
	await writeFile(temporaryPath, `${JSON.stringify(Schema.state.parse(state), null, "\t")}\n`);
	await rename(temporaryPath, path);
};

const nextPort = (state: State): number => Math.max(8081, ...Object.values(state.projects).map((project) => project.metroPort)) + 1;

const withProject = (state: State, root: string, project: Project): State => ({
	...state,
	projects: { ...state.projects, [root]: project },
});

export const StateStore = { read, write, nextPort, withProject };
export { read as readState, write as writeState, nextPort, withProject as updateProject };
