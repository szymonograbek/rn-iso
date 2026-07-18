import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Schema } from "./types.js";
import type { AndroidAssignment, Platform, Project, State } from "./types.js";

export interface Claim {
	readonly label: string;
	readonly path: string;
}

export interface ClaimedDevices {
	readonly ios: Readonly<Record<string, Claim>>;
	readonly androidAvds: Readonly<Record<string, Claim>>;
	readonly androidPorts: Readonly<Record<number, Claim>>;
	readonly androidSerials: Readonly<Record<string, Claim>>;
}

const configDirectory = (): string => process.env.RN_ISO_HOME ?? join(homedir(), ".rn-iso");
const configPath = (): string => join(configDirectory(), "config.json");
const empty = (): State => ({ version: 1, projects: {} });

const read = async (): Promise<State> => {
	try {
		return Schema.state.parse(JSON.parse(await readFile(configPath(), "utf8")));
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return empty();
		throw new Error(`Cannot read rn-iso state at ${configPath()}: ${error instanceof Error ? error.message : "unknown error"}`);
	}
};

const write = async (state: State): Promise<void> => {
	await mkdir(dirname(configPath()), { recursive: true });
	const validated = Schema.state.parse(state);
	const temporaryPath = `${configPath()}.${process.pid}.tmp`;
	await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`);
	await rename(temporaryPath, configPath());
};

const withProject = (state: State, root: string, project: Project): State => ({
	...state,
	projects: { ...state.projects, [root]: project },
});

const withoutProject = (state: State, root: string): State => {
	const { [root]: _, ...projects } = state.projects;
	return { ...state, projects };
};

const nextPort = (state: State): number => Math.max(8081, ...Object.values(state.projects).flatMap((project) => project.metroPort === null ? [] : [project.metroPort])) + 1;

const shortcut = (root: string, project: Project): string => project.label ?? root.split("/").pop() ?? root;

const emulatorAssignment = (assignment: AndroidAssignment): assignment is Extract<AndroidAssignment, { avdName: string }> => "avdName" in assignment;

const claimedDevices = (state: State, exceptRoot?: string): ClaimedDevices => {
	const ios: Record<string, Claim> = {};
	const androidAvds: Record<string, Claim> = {};
	const androidPorts: Record<number, Claim> = {};
	const androidSerials: Record<string, Claim> = {};

	for (const [root, project] of Object.entries(state.projects)) {
		if (root === exceptRoot || !existsSync(root)) continue;
		const claim = { label: shortcut(root, project), path: root };
		const iosAssignment = project.platforms.ios;
		if (iosAssignment !== undefined) ios[iosAssignment.deviceUdid] = claim;
		const android = project.platforms.android;
		if (android === undefined) continue;
		if (emulatorAssignment(android)) {
			androidAvds[android.avdName] = claim;
			androidPorts[android.consolePort] = claim;
		} else {
			androidSerials[android.serial] = claim;
		}
	}

	return { ios, androidAvds, androidPorts, androidSerials };
};

const clearAssignment = (project: Project, platform: Platform): Project => {
	const { [platform]: _, ...platforms } = project.platforms;
	return { ...project, platforms };
};

const recordUsage = (state: State, platform: Platform, identifier: string): State => {
	const simUsage = state.simUsage ?? { ios: {}, android: {} };
	return {
		...state,
		simUsage: {
			...simUsage,
			[platform]: { ...simUsage[platform], [identifier]: (simUsage[platform][identifier] ?? 0) + 1 },
		},
	};
};

export const StateStore = {
	claimedDevices,
	clearAssignment,
	configDirectory,
	empty,
	nextPort,
	read,
	recordUsage,
	shortcut,
	withProject,
	withoutProject,
	write,
};
export { read as readState, write as writeState, nextPort, withProject as updateProject, withoutProject };
