import { spawn } from "node:child_process";

export interface CommandResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

async function run(command: string, args: readonly string[], cwd?: string): Promise<CommandResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
		child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
		child.on("error", reject);
		child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
	});
}

async function inherited(command: string, args: readonly string[], cwd?: string, env?: NodeJS.ProcessEnv): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { cwd, env, stdio: "inherit" });
		child.on("error", reject);
		child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code ?? 1}`)));
	});
}

async function requireSuccess(command: string, args: readonly string[], cwd?: string): Promise<string> {
	const result = await run(command, args, cwd);
	if (result.code === 0) return result.stdout;
	const output = `${result.stdout}\n${result.stderr}`.trim();
	throw new Error(`${command} ${args.join(" ")} failed${output.length > 0 ? `:\n${output}` : ""}`);
}

export const Exec = { inherited, requireSuccess, run };
export { inherited, requireSuccess, run };
