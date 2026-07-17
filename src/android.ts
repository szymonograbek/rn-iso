import { spawn } from "node:child_process";
import { requireSuccess, run } from "./exec.js";

export interface AndroidDevice {
	readonly serial: string;
	readonly state: "device" | "offline";
	readonly physical: boolean;
}

export async function androidDevices(): Promise<readonly AndroidDevice[]> {
	const output = await requireSuccess("adb", ["devices"]);
	const devices: AndroidDevice[] = [];
	for (const line of output.split("\n").slice(1)) {
		const [serial, state] = line.trim().split(/\s+/);
		if (serial === undefined || state === undefined) continue;
		const physical = !serial.startsWith("emulator-");
		if (state === "device") devices.push({ serial, state: "device", physical });
		if (state === "offline") devices.push({ serial, state: "offline", physical });
	}
	return devices.sort((left, right) => Number(right.state === "device") - Number(left.state === "device") || Number(right.physical) - Number(left.physical) || left.serial.localeCompare(right.serial));
}

export async function avds(): Promise<readonly string[]> {
	const output = await requireSuccess("emulator", ["-list-avds"]);
	return output.split("\n").map((name) => name.trim()).filter((name) => name.length > 0).sort();
}

export async function bootAvd(name: string): Promise<AndroidDevice> {
	const child = spawn("emulator", [`@${name}`], { detached: true, stdio: "ignore" });
	child.unref();

	for (let attempt = 0; attempt < 120; attempt += 1) {
		const ready = (await androidDevices()).find((device) => device.serial.startsWith("emulator-") && device.state === "device");
		if (ready !== undefined) {
			const bootCompleted = await run("adb", ["-s", ready.serial, "shell", "getprop", "sys.boot_completed"]);
			if (bootCompleted.stdout.trim() === "1") return ready;
		}
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
	throw new Error(`Android emulator ${name} did not finish booting`);
}

export async function reverseMetro(serial: string, metroPort: number): Promise<void> {
	await requireSuccess("adb", ["-s", serial, "reverse", "tcp:8081", `tcp:${metroPort}`]);
}

export async function launchAndroid(packageName: string, serial: string): Promise<void> {
	const result = await run("adb", ["-s", serial, "shell", "monkey", "-p", packageName, "1"]);
	if (result.code !== 0) throw new Error(result.stderr.trim());
}
