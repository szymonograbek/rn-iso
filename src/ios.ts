import { randomBytes } from "node:crypto";
import { requireSuccess, run } from "./exec.js";
import { Schema } from "./types.js";
import type { IosRuntime, Simulator } from "./types.js";

const runtimeVersion = (runtime: string): string => {
	const match = runtime.match(/iOS-(\d+)(?:-(\d+))?$/);
	if (match?.[1] === undefined) return runtime;
	return match[2] === undefined ? match[1] : `${match[1]}.${match[2]}`;
};

const familyRank = (name: string): number => /^iPhone/i.test(name) ? 0 : /^iPad/i.test(name) ? 1 : 2;

const sort = (items: readonly Simulator[], usage: Readonly<Record<string, number>> = {}): readonly Simulator[] => [...items].sort((left, right) =>
	familyRank(left.name) - familyRank(right.name) ||
	Number(right.state === "Booted") - Number(left.state === "Booted") ||
	runtimeVersion(right.runtime).localeCompare(runtimeVersion(left.runtime), undefined, { numeric: true }) ||
	(usage[right.udid] ?? 0) - (usage[left.udid] ?? 0) ||
	left.name.localeCompare(right.name),
);

const list = async (): Promise<readonly Simulator[]> => {
	const output = await requireSuccess("xcrun", ["simctl", "list", "devices", "available", "-j"]);
	const devices = Schema.simctlDevices.parse(JSON.parse(output)).devices;
	const result: Simulator[] = [];
	for (const [runtime, entries] of Object.entries(devices)) {
		if (!/\.iOS-/.test(runtime)) continue;
		for (const entry of entries) if (entry.isAvailable) result.push({ ...entry, runtime });
	}
	return result;
};

const boot = async (udid: string): Promise<void> => {
	const result = await run("xcrun", ["simctl", "boot", udid]);
	if (result.code !== 0 && !result.stderr.includes("Booted")) throw new Error(result.stderr.trim());
	await requireSuccess("xcrun", ["simctl", "bootstatus", udid, "-b"]);
	await run("open", ["-a", "Simulator"]);
};

const shutdown = async (udid: string): Promise<void> => {
	await run("xcrun", ["simctl", "shutdown", udid]);
};

const runtimes = async (): Promise<readonly IosRuntime[]> => {
	const output = await requireSuccess("xcrun", ["simctl", "list", "runtimes", "--json"]);
	return Schema.simctlRuntimes.parse(JSON.parse(output)).runtimes.filter((runtime) => runtime.isAvailable && runtime.platform === "iOS");
};

const create = async (deviceType: string, requestedRuntime?: string): Promise<string> => {
	const available = await runtimes();
	const runtime = requestedRuntime === undefined
		? [...available].sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }))[0]
		: available.find((candidate) => candidate.version === requestedRuntime || candidate.name === `iOS ${requestedRuntime}`);
	if (runtime === undefined) throw new Error(requestedRuntime === undefined ? "No iOS runtimes installed" : `Runtime ${requestedRuntime} is not installed`);
	const type = runtime.supportedDeviceTypes?.find((candidate) => candidate.name === deviceType || candidate.identifier === deviceType);
	if (type === undefined) throw new Error(`Device type ${deviceType} is not compatible with iOS ${runtime.version}`);
	const name = `rn-iso-${randomBytes(3).toString("hex")}`;
	const udid = (await requireSuccess("xcrun", ["simctl", "create", name, type.identifier, runtime.identifier])).trim();
	await boot(udid);
	return udid;
};

const configureAndLaunch = async (udid: string, appBundleId: string, metroPort: number): Promise<void> => {
	await requireSuccess("xcrun", ["simctl", "spawn", udid, "defaults", "write", appBundleId, "RCT_jsLocation", `localhost:${metroPort}`]);
	await run("xcrun", ["simctl", "terminate", udid, appBundleId]);
	await requireSuccess("xcrun", ["simctl", "launch", udid, appBundleId]);
};

const format = async (udid: string): Promise<string> => {
	try {
		const simulator = (await list()).find((candidate) => candidate.udid === udid);
		return simulator === undefined ? udid : `${simulator.name} (${udid})`;
	} catch {
		return udid;
	}
};

export const Ios = { boot, configureAndLaunch, create, familyRank, format, list, runtimeVersion, shutdown, sort };
export { boot, configureAndLaunch, list as simulators };
