import { spawn } from "node:child_process";
import { requireSuccess, run } from "./exec.js";

export interface RunningEmulator {
	readonly serial: string;
	readonly consolePort: number;
}

export interface UnhealthyDevice {
	readonly serial: string;
	readonly status: string;
	readonly consolePort?: number;
}

export interface PhysicalDevice {
	readonly serial: string;
	readonly modelName: string | null;
}

export interface AdbDevices {
	readonly emulators: readonly RunningEmulator[];
	readonly physical: readonly PhysicalDevice[];
	readonly unhealthy: readonly UnhealthyDevice[];
}

export type AndroidCandidate =
	| { readonly kind: "avd"; readonly avdName: string; readonly running: boolean; readonly consolePort: number | null }
	| { readonly kind: "physical"; readonly serial: string; readonly modelName: string | null; readonly running: true };

const parseDevices = (output: string): AdbDevices => {
	const emulators: RunningEmulator[] = [];
	const physical: PhysicalDevice[] = [];
	const unhealthy: UnhealthyDevice[] = [];
	for (const line of output.split("\n").slice(1)) {
		const [serial, status, ...properties] = line.trim().split(/\s+/);
		if (serial === undefined || status === undefined) continue;
		const emulator = serial.match(/^emulator-(\d+)$/);
		if (status !== "device") {
			const consolePort = emulator?.[1] === undefined ? undefined : Number(emulator[1]);
			unhealthy.push(consolePort === undefined ? { serial, status } : { serial, status, consolePort });
		} else if (emulator?.[1] !== undefined) {
			emulators.push({ serial, consolePort: Number(emulator[1]) });
		} else {
			const model = properties.find((property) => property.startsWith("model:"));
			physical.push({ serial, modelName: model?.slice("model:".length) || null });
		}
	}
	return { emulators, physical, unhealthy };
};

const devices = async (): Promise<AdbDevices> => parseDevices(await requireSuccess("adb", ["devices", "-l"]));

const avds = async (): Promise<readonly string[]> => (await requireSuccess("emulator", ["-list-avds"]))
	.split("\n")
	.map((name) => name.trim())
	.filter((name) => name.length > 0 && !name.startsWith("INFO") && !name.startsWith("WARNING"));

const avdName = async (serial: string): Promise<string | null> => {
	const result = await run("adb", ["-s", serial, "emu", "avd", "name"]);
	return result.code === 0 ? result.stdout.split("\n")[0]?.trim() || null : null;
};

const candidates = async (): Promise<readonly AndroidCandidate[]> => {
	const [available, connected] = await Promise.all([avds(), devices()]);
	const running = new Map<string, number>();
	for (const emulator of connected.emulators) {
		const name = await avdName(emulator.serial);
		if (name !== null) running.set(name, emulator.consolePort);
	}
	return [
		...available.map((name): AndroidCandidate => ({ kind: "avd", avdName: name, running: running.has(name), consolePort: running.get(name) ?? null })),
		...connected.physical.map((device): AndroidCandidate => ({ kind: "physical", ...device, running: true })),
	];
};

const sort = (items: readonly AndroidCandidate[]): readonly AndroidCandidate[] => [...items].sort((left, right) =>
	Number(right.running) - Number(left.running) ||
	(left.kind === right.kind ? 0 : left.kind === "physical" ? -1 : 1) ||
	(left.kind === "physical" ? left.serial : left.avdName).localeCompare(right.kind === "physical" ? right.serial : right.avdName),
);

const nextConsolePort = (claimed: readonly number[]): number => claimed.length === 0 ? 5554 : Math.max(...claimed) + 2;

const boot = async (name: string, consolePort: number): Promise<string> => {
	const child = spawn("emulator", ["-avd", name, "-port", String(consolePort)], { detached: true, stdio: "ignore" });
	child.unref();
	const serial = `emulator-${consolePort}`;
	for (let attempt = 0; attempt < 120; attempt += 1) {
		const sys = await run("adb", ["-s", serial, "shell", "getprop", "sys.boot_completed"]);
		const dev = await run("adb", ["-s", serial, "shell", "getprop", "dev.bootcomplete"]);
		if (sys.stdout.trim() === "1" || dev.stdout.trim() === "1") return serial;
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
	const snapshot = await run("adb", ["devices"]);
	throw new Error(`Android emulator ${name} did not finish booting; adb devices:\n${snapshot.stdout}`);
};

const reverseMetro = async (serial: string, metroPort: number): Promise<void> => {
	await requireSuccess("adb", ["-s", serial, "reverse", `tcp:${metroPort}`, `tcp:${metroPort}`]);
};

const shutdown = async (serial: string): Promise<void> => {
	if (serial.startsWith("emulator-")) await run("adb", ["-s", serial, "emu", "kill"]);
};

export const Android = { avdName, avds, boot, candidates, devices, nextConsolePort, parseDevices, reverseMetro, shutdown, sort };
