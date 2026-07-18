import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { requireSuccess, run } from "./exec.js";
import { StateStore } from "./state.js";

function metroLogPath(projectRoot: string): string {
	const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 12);
	return join(StateStore.configDirectory(), "logs", `${hash}.log`);
}

async function metroHealthy(port: number): Promise<boolean> {
	try {
		const response = await fetch(`http://localhost:${port}/status`, { signal: AbortSignal.timeout(2_000) });
		return (await response.text()).includes("packager-status:running");
	} catch {
		return false;
	}
}

interface StartResult {
	readonly alreadyRunning: boolean;
	readonly pid: number | null;
	readonly ready: boolean;
}

async function startMetro(projectRoot: string, port: number, expo: boolean, extras: readonly string[] = []): Promise<StartResult> {
	if (await metroHealthy(port)) return { alreadyRunning: true, pid: null, ready: true };

	const logPath = metroLogPath(projectRoot);
	await import("node:fs/promises").then(({ mkdir }) => mkdir(join(StateStore.configDirectory(), "logs"), { recursive: true }));
	const log = await open(logPath, "a");
	const command = expo ? ["expo", "start"] : ["react-native", "start"];
	const child = spawn("npx", [...command, "--port", String(port), ...extras], {
		cwd: projectRoot,
		detached: true,
		stdio: ["ignore", log.fd, log.fd],
		env: { ...process.env, RCT_METRO_PORT: String(port) },
	});
	child.unref();
	await log.close();

	for (let attempt = 0; attempt < 60; attempt += 1) {
		if (await metroHealthy(port)) return { alreadyRunning: false, pid: child.pid ?? null, ready: true };
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return { alreadyRunning: false, pid: child.pid ?? null, ready: false };
}

async function listeningPid(port: number): Promise<number | null> {
	const result = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
	if (result.code !== 0) return null;
	const pid = Number(result.stdout.trim().split("\n")[0]);
	return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function pidAlive(pid: number | null): boolean {
	if (pid === null) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function stop(port: number, recordedPid: number | null): Promise<number | null> {
	const pid = recordedPid !== null && pidAlive(recordedPid) ? recordedPid : await listeningPid(port);
	if (pid === null) return null;
	process.kill(pid, "SIGTERM");
	return pid;
}

async function tail(projectRoot: string, lines: number, follow: boolean): Promise<void> {
	const args = follow ? ["-n", String(lines), "-f", metroLogPath(projectRoot)] : ["-n", String(lines), metroLogPath(projectRoot)];
	const output = await requireSuccess("tail", args);
	if (!follow) process.stdout.write(output);
}

export const Metro = { healthy: metroHealthy, listeningPid, logPath: metroLogPath, pidAlive, start: startMetro, stop, tail };
export { metroHealthy, metroLogPath, startMetro };
