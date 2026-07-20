import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Schema } from "./types.js";
import type { PackageManager } from "./types.js";

export interface Invocation {
	readonly command: string;
	readonly args: readonly string[];
	readonly env?: NodeJS.ProcessEnv;
}

const lockfiles: readonly [string, PackageManager][] = [
	["bun.lock", "bun"],
	["bun.lockb", "bun"],
	["pnpm-lock.yaml", "pnpm"],
	["yarn.lock", "yarn"],
	["package-lock.json", "npm"],
];

const packageManager = (root: string): PackageManager => {
	let directory = resolve(root);
	while (true) {
		const match = lockfiles.find(([lockfile]) => existsSync(join(directory, lockfile)));
		if (match !== undefined) return match[1];
		const parent = dirname(directory);
		if (parent === directory) return "npm";
		directory = parent;
	}
};

const script = (root: string, name: string): string | undefined => Schema.packageManifest.parse(JSON.parse(readFileSync(join(root, "package.json"), "utf8"))).scripts?.[name];

const scriptCommand = (manager: PackageManager, name: string, args: readonly string[]): readonly string[] => {
	if (manager === "npm") return ["run", name, "--", ...args];
	if (manager === "bun") return ["run", name, ...args];
	return [name, ...args];
};

const scriptCli = (body: string | undefined): "expo" | "react-native" | "unknown" => {
	if (body === undefined) return "unknown";
	if (/\bexpo\s+(run:ios|run:android|start)\b/.test(body)) return "expo";
	if (/\breact-native\s+(run-ios|run-android|start)\b/.test(body)) return "react-native";
	return "unknown";
};

const metroEnvironment = (port: number): NodeJS.ProcessEnv => ({ ...process.env, RCT_METRO_PORT: String(port) });

interface BuildOptions {
	readonly root: string;
	readonly manager: PackageManager;
	readonly scriptName: string | null;
	readonly isExpo: boolean;
	readonly port: number;
	readonly managedMetro: boolean;
	readonly extras: readonly string[];
}

const ios = (options: BuildOptions & { readonly udid: string }): Invocation => {
	const body = options.scriptName === null ? undefined : script(options.root, options.scriptName);
	const cli = body === undefined ? (options.isExpo ? "expo" : "react-native") : scriptCli(body);
	const args = [cli === "expo" ? "--device" : "--udid", options.udid, "--port", String(options.port)];
	if (options.managedMetro && cli !== "expo") args.push("--no-packager");
	args.push(...options.extras);
	const env = metroEnvironment(options.port);
	if (body !== undefined && options.scriptName !== null) return { command: options.manager, args: scriptCommand(options.manager, options.scriptName, args), env };
	return { command: "npx", args: [options.isExpo ? "expo" : "react-native", options.isExpo ? "run:ios" : "run-ios", ...args], env };
};

const android = (options: BuildOptions & { readonly serial: string; readonly avdName: string | null }): Invocation => {
	const body = options.scriptName === null ? undefined : script(options.root, options.scriptName);
	const cli = body === undefined ? (options.isExpo ? "expo" : "react-native") : scriptCli(body);
	const device = cli === "expo" ? options.avdName ?? options.serial : options.serial;
	const args = ["--device", device];
	if (cli === "expo" || body !== undefined) args.push("--port", String(options.port));
	if (options.managedMetro && cli !== "expo") args.push("--no-packager");
	args.push(...options.extras);
	const env = metroEnvironment(options.port);
	if (body !== undefined && options.scriptName !== null) return { command: options.manager, args: scriptCommand(options.manager, options.scriptName, args), env };
	return {
		command: "npx",
		args: [options.isExpo ? "expo" : "react-native", options.isExpo ? "run:android" : "run-android", ...args],
		env,
	};
};

export const Runner = { android, ios, packageManager, script, scriptCli, scriptCommand };
export type { PackageManager };
