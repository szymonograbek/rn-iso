import { requireSuccess, run } from "./exec.js";
import { Schema } from "./types.js";
import type { ExpoConfig, Simulator } from "./types.js";

const simulatorRank = (simulator: Simulator): number => simulator.name.startsWith("iPhone") ? 0 : simulator.name.startsWith("iPad") ? 1 : 2;

const list = async (): Promise<readonly Simulator[]> => {
	const output = await requireSuccess("xcrun", ["simctl", "list", "devices", "available", "-j"]);
	const devices = Schema.simctlDevices.parse(JSON.parse(output)).devices;
	const simulators = Object.values(devices).flat();

	return simulators.sort((left, right) =>
		simulatorRank(left) - simulatorRank(right) ||
		Number(right.state === "Booted") - Number(left.state === "Booted") ||
		left.name.localeCompare(right.name),
	);
};

const boot = async (udid: string): Promise<void> => {
	const result = await run("xcrun", ["simctl", "boot", udid]);
	if (result.code !== 0 && !result.stderr.includes("Booted")) throw new Error(result.stderr.trim());
	await requireSuccess("xcrun", ["simctl", "bootstatus", udid, "-b"]);
};

const expoAppId = async (projectRoot: string, platform: "ios" | "android"): Promise<string> => {
	const output = await requireSuccess("npx", ["expo", "config", "--json"], projectRoot);
	const config: ExpoConfig = Schema.expoConfig.parse(JSON.parse(output));
	return platform === "ios" ? config.ios.bundleIdentifier : config.android.package;
};

const configureAndLaunch = async (udid: string, appBundleId: string, metroPort: number): Promise<void> => {
	await requireSuccess("xcrun", ["simctl", "spawn", udid, "defaults", "write", appBundleId, "RCT_jsLocation", `localhost:${metroPort}`]);
	await run("xcrun", ["simctl", "terminate", udid, appBundleId]);
	await requireSuccess("xcrun", ["simctl", "launch", udid, appBundleId]);
};

export const Ios = { boot, configureAndLaunch, expoAppId, list };
export { boot, configureAndLaunch, expoAppId, list as simulators };
