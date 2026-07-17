import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export function metroLogPath(projectRoot: string): string {
	const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 12);
	return join(process.env.RN_ISO_HOME ?? join(homedir(), ".rn-iso"), "logs", `${hash}.log`);
}

export async function metroHealthy(port: number): Promise<boolean> {
	try {
		const response = await fetch(`http://localhost:${port}/status`, { signal: AbortSignal.timeout(2_000) });
		return (await response.text()).trim() === "packager-status:running";
	} catch {
		return false;
	}
}

export async function startMetro(projectRoot: string, port: number, expo: boolean): Promise<void> {
	if (await metroHealthy(port)) return;

	const logPath = metroLogPath(projectRoot);
	await mkdir(dirname(logPath), { recursive: true });
	const log = await import("node:fs/promises").then(({ open }) => open(logPath, "a"));
	const command = expo ? ["expo", "start"] : ["react-native", "start"];
	const child = spawn("npx", [...command, "--port", String(port)], {
		cwd: projectRoot,
		detached: true,
		stdio: ["ignore", log.fd, log.fd],
	});
	child.unref();
	await log.close();

	for (let attempt = 0; attempt < 30; attempt += 1) {
		if (await metroHealthy(port)) return;
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
	throw new Error(`Metro did not become healthy on port ${port}; see ${logPath}`);
}

const dirname = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/"))) || ".";
