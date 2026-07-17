import { access, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Schema } from "./types.js";

export interface ProjectInfo {
	readonly root: string;
	readonly label: string;
	readonly isExpo: boolean;
}

const exists = async (path: string): Promise<boolean> => {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
};

const find = async (start: string): Promise<ProjectInfo> => {
	let directory = await realpath(start);

	while (true) {
		const manifestPath = join(directory, "package.json");

		if (await exists(manifestPath)) {
			const manifest = Schema.packageManifest.parse(JSON.parse(await readFile(manifestPath, "utf8")));
			const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
			const isExpo = dependencies.expo !== undefined;
			const isReactNative = dependencies["react-native"] !== undefined;

			if (!isExpo && !isReactNative) throw new Error(`Not a React Native project: ${directory}`);
			return { root: directory, label: basename(directory), isExpo };
		}

		const parent = dirname(directory);
		if (parent === directory) throw new Error("No React Native package.json found");
		directory = parent;
	}
};

export const Project = { find };
export { find as findProject };
