import { access, readFile, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { Schema } from "./types.js";
import type { ExpoConfig, Project as ProjectState, State } from "./types.js";

export interface ProjectInfo {
	readonly root: string;
	readonly label: string;
	readonly isExpo: boolean;
	readonly bundleId: string | null;
	readonly androidPackage: string | null;
}

const exists = async (path: string): Promise<boolean> => {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
};

const manifest = async (root: string) => Schema.packageManifest.parse(JSON.parse(await readFile(join(root, "package.json"), "utf8")));

const configText = async (root: string): Promise<string | null> => {
	for (const name of ["app.config.js", "app.config.ts", "app.config.cjs", "app.config.mjs"]) {
		const path = join(root, name);
		if (await exists(path)) return readFile(path, "utf8");
	}
	return null;
};

const appJson = async (root: string): Promise<unknown> => {
	try {
		return JSON.parse(await readFile(join(root, "app.json"), "utf8"));
	} catch {
		return undefined;
	}
};

const expoConfigFromJson = (value: unknown): ExpoConfig | undefined => {
	if (typeof value !== "object" || value === null || !("expo" in value)) return undefined;
	const parsed = Schema.expoConfig.safeParse(value.expo);
	return parsed.success ? parsed.data : undefined;
};

const detectIsExpo = async (root: string): Promise<boolean> => {
	const packageJson = await manifest(root);
	const iosScript = packageJson.scripts?.ios;
	if (iosScript !== undefined) {
		if (/\bexpo\s+run:ios\b/.test(iosScript)) return true;
		if (/\breact-native\s+run-ios\b/.test(iosScript)) return false;
	}
	const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
	if (dependencies.expo === undefined) return false;
	if (expoConfigFromJson(await appJson(root)) !== undefined) return true;
	const text = await configText(root);
	return text !== null && /\b(?:from\s+['"]expo['"]|expo\/config|ExpoConfig)\b/.test(text);
};

const bundleIdFromPbxproj = async (root: string): Promise<string | null> => {
	const ios = join(root, "ios");
	if (!(await exists(ios))) return null;
	for (const entry of await readdir(ios, { withFileTypes: true })) {
		if (!entry.isDirectory() || !entry.name.endsWith(".xcodeproj")) continue;
		const text = await readFile(join(ios, entry.name, "project.pbxproj"), "utf8");
		const identifiers = [...text.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;\s"]+)\s*;/g)]
			.map((match) => match[1])
			.filter((identifier): identifier is string => identifier !== undefined && !identifier.startsWith("$") && !identifier.includes("("));
		const counts = new Map<string, number>();
		for (const identifier of identifiers) counts.set(identifier, (counts.get(identifier) ?? 0) + 1);
		return [...counts.entries()].sort(([left, leftCount], [right, rightCount]) => rightCount - leftCount || left.length - right.length)[0]?.[0] ?? null;
	}
	return null;
};

const detectBundleId = async (root: string): Promise<string | null> => {
	const fromJson = expoConfigFromJson(await appJson(root))?.ios?.bundleIdentifier;
	if (fromJson !== undefined) return fromJson;
	const text = await configText(root);
	const fromConfig = text?.match(/bundleIdentifier\s*:\s*["']([^"']+)["']/)?.[1];
	return fromConfig ?? bundleIdFromPbxproj(root);
};

const detectAndroidPackage = async (root: string): Promise<string | null> => {
	const fromJson = expoConfigFromJson(await appJson(root))?.android?.package;
	if (fromJson !== undefined) return fromJson;
	const text = await configText(root);
	const fromConfig = text?.match(/package\s*:\s*["']([^"']+)["']/)?.[1];
	if (fromConfig !== undefined) return fromConfig;
	try {
		const gradle = await readFile(join(root, "android", "app", "build.gradle"), "utf8");
		return gradle.match(/namespace\s+["']([^"']+)["']/)?.[1] ?? gradle.match(/applicationId\s+["']([^"']+)["']/)?.[1] ?? null;
	} catch {
		return null;
	}
};

const find = async (start: string): Promise<ProjectInfo> => {
	let directory = await realpath(start);
	while (true) {
		if (await exists(join(directory, "package.json"))) {
			const packageJson = await manifest(directory);
			const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
			if (dependencies.expo !== undefined || dependencies["react-native"] !== undefined) {
				return {
					root: directory,
					label: basename(directory),
					isExpo: await detectIsExpo(directory),
					bundleId: await detectBundleId(directory),
					androidPackage: await detectAndroidPackage(directory),
				};
			}
		}
		const parent = dirname(directory);
		if (parent === directory) throw new Error("Not in a React Native project (no package.json found)");
		directory = parent;
	}
};

const shortcut = (root: string, project: ProjectState): string => project.label ?? basename(root);

const resolveRegistered = (state: State, target: string | undefined, cwdRoot?: string): string => {
	if (target === undefined) {
		if (cwdRoot === undefined || state.projects[cwdRoot] === undefined) throw new Error("No rn-iso entry for the current project; run rn-iso ios or android first");
		return cwdRoot;
	}
	if (/^\d+$/.test(target)) {
		const port = Number(target);
		const owner = Object.entries(state.projects).find(([, project]) => project.metroPort === port);
		if (owner === undefined) throw new Error(`No project owns Metro port ${port}`);
		return owner[0];
	}
	const path = resolve(target);
	if ((isAbsolute(target) || target.includes("/")) && state.projects[path] !== undefined) return path;
	const matches = Object.entries(state.projects).filter(([root, project]) => shortcut(root, project) === target);
	if (matches.length === 1 && matches[0] !== undefined) return matches[0][0];
	if (matches.length > 1) throw new Error(`Multiple projects share the shortcut "${target}": ${matches.map(([root]) => root).join(", ")}`);
	throw new Error(`No registered project matches "${target}"`);
};

export const Project = { detectAndroidPackage, detectBundleId, detectIsExpo, find, resolveRegistered, shortcut };
export { find as findProject };
