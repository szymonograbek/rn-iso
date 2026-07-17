#!/usr/bin/env node
import { Command } from "commander";
import { androidDevices, avds, bootAvd, launchAndroid, reverseMetro } from "./android.js";
import { requireSuccess, run } from "./exec.js";
import { boot, configureAndLaunch, expoAppId, simulators } from "./ios.js";
import { metroHealthy, metroLogPath, startMetro } from "./metro.js";
import { findProject } from "./project.js";
import { nextPort, readState, updateProject, writeState } from "./state.js";
import type { IosAssignment, Project } from "./types.js";

const program = new Command();
program.name("rn-iso").description("Isolated React Native simulators and Metro servers").version("1.0.0");

function newProject(label: string, metroPort: number, isExpo: boolean): Project {
	return { label, metroPort, isExpo, assignments: {} };
}

async function currentProject(): Promise<{ readonly root: string; readonly project: Project }> {
	const info = await findProject(process.cwd());
	const state = await readState();
	const project = state.projects[info.root] ?? newProject(info.label, nextPort(state), info.isExpo);
	return { root: info.root, project };
}

async function saveProject(root: string, project: Project): Promise<void> {
	const state = await readState();
	await writeState(updateProject(state, root, project));
}

async function assignIos(device: string | undefined): Promise<{ readonly root: string; readonly project: Project; readonly assignment: IosAssignment }> {
	const { root, project } = await currentProject();
	const current = project.assignments.ios;
	if (current?.platform === "ios" && device === undefined) return { root, project, assignment: current };

	const all = await simulators();
	const selected = device === undefined ? all.find((candidate) => candidate.state === "Booted") ?? all[0] : all.find((candidate) => candidate.udid === device);
	if (selected === undefined) throw new Error(`iOS simulator not found${device === undefined ? "" : `: ${device}`}`);
	if (selected.state !== "Booted") await boot(selected.udid);

	const assignment: IosAssignment = { platform: "ios", udid: selected.udid };
	const updated: Project = { ...project, assignments: { ...project.assignments, ios: assignment } };
	await saveProject(root, updated);
	return { root, project: updated, assignment };
}

program.command("ios")
	.option("--auto", "Use the best available simulator")
	.option("--device <udid>", "Use this simulator")
	.option("--managed-metro", "Start Metro detached")
	.option("--no-install", "Skip build and install")
	.action(async (options: { readonly device?: string; readonly managedMetro?: boolean; readonly install: boolean }) => {
		const prepared = await assignIos(options.device);
		if (options.managedMetro === true) await startMetro(prepared.root, prepared.project.metroPort, prepared.project.isExpo);
		if (!options.managedMetro && !(await metroHealthy(prepared.project.metroPort))) {
			await startMetro(prepared.root, prepared.project.metroPort, prepared.project.isExpo);
		}
		if (options.install) {
			const args = prepared.project.isExpo
				? ["expo", "run:ios", "--device", prepared.assignment.udid, "--port", String(prepared.project.metroPort)]
				: ["react-native", "run-ios", "--udid", prepared.assignment.udid, "--port", String(prepared.project.metroPort), "--no-packager"];
			await requireSuccess("npx", args, prepared.root);
		}
		const appBundleId = prepared.project.bundleId ?? await expoAppId(prepared.root, "ios");
		await saveProject(prepared.root, { ...prepared.project, bundleId: appBundleId });
		await configureAndLaunch(prepared.assignment.udid, appBundleId, prepared.project.metroPort);
		console.log(`iOS ready on ${prepared.assignment.udid}; Metro healthy on ${prepared.project.metroPort}`);
	});

program.command("android")
	.option("--auto", "Use the best available Android device")
	.option("--device <serial>", "Use this Android device")
	.option("--avd <name>", "Boot this AVD")
	.option("--managed-metro", "Start Metro detached")
	.option("--no-install", "Skip build and install")
	.action(async (options: { readonly device?: string; readonly avd?: string; readonly managedMetro?: boolean; readonly install: boolean }) => {
		const { root, project } = await currentProject();
		const devices = await androidDevices();
		let selected = options.device === undefined && options.avd === undefined ? devices.find((device) => device.state === "device") : devices.find((device) => device.serial === options.device && device.state === "device");
		if (selected === undefined && options.device === undefined) {
			const availableAvds = await avds();
			const avd = options.avd ?? availableAvds[0];
			if (avd === undefined) throw new Error("No Android AVD or connected device is available");
			selected = await bootAvd(avd);
		}
		if (selected === undefined) throw new Error(`No ready Android device found${options.device === undefined ? "" : `: ${options.device}`}`);
		const assignment: { readonly platform: "android"; readonly serial: string } = { platform: "android", serial: selected.serial };
		const updated: Project = { ...project, assignments: { ...project.assignments, android: assignment } };
		await saveProject(root, updated);
		if (options.managedMetro === true || !(await metroHealthy(updated.metroPort))) await startMetro(root, updated.metroPort, updated.isExpo);
		await reverseMetro(assignment.serial, updated.metroPort);
		if (options.install) {
			const args = updated.isExpo
				? ["expo", "run:android", "--device", assignment.serial, "--port", String(updated.metroPort)]
				: ["react-native", "run-android", "--deviceId", assignment.serial, "--port", String(updated.metroPort), "--no-packager"];
			await requireSuccess("npx", args, root);
		}
		const packageName = await expoAppId(root, "android");
		await launchAndroid(packageName, assignment.serial);
		console.log(`Android ready on ${assignment.serial}; Metro healthy on ${updated.metroPort}`);
	});

program.command("start").action(async () => {
	const { root, project } = await currentProject();
	await saveProject(root, project);
	await startMetro(root, project.metroPort, project.isExpo);
	console.log(`Metro healthy on port ${project.metroPort}`);
});

program.command("device")
	.requiredOption("--platform <platform>", "ios or android")
	.option("--json", "JSON output")
	.action(async (options: { readonly platform: string; readonly json?: boolean }) => {
		const { root, project } = await currentProject();
		if (options.platform === "ios") {
			const assignment = project.assignments.ios;
			if (assignment?.platform !== "ios") throw new Error("No rn-iso assignment for project; run rn-iso ios first");
			const payload = { platform: "ios", udid: assignment.udid, metroPort: project.metroPort, metroHealthy: await metroHealthy(project.metroPort), metroLog: metroLogPath(root) };
			console.log(options.json === true ? JSON.stringify(payload) : payload.udid);
			return;
		}
		if (options.platform === "android") {
			const assignment = project.assignments.android;
			if (assignment?.platform !== "android") throw new Error("No rn-iso assignment for project; run rn-iso android first");
			const payload = { platform: "android", serial: assignment.serial, metroPort: project.metroPort, metroHealthy: await metroHealthy(project.metroPort), metroLog: metroLogPath(root) };
			console.log(options.json === true ? JSON.stringify(payload) : payload.serial);
			return;
		}
		throw new Error(`Unsupported platform: ${options.platform}`);
	});

program.command("status").action(async () => {
	const state = await readState();
	for (const [root, project] of Object.entries(state.projects)) {
		console.log(`${project.label} (${root})\n  metro: ${project.metroPort} (${await metroHealthy(project.metroPort) ? "running" : "stopped"})`);
		if (project.assignments.ios?.platform === "ios") console.log(`  ios: ${project.assignments.ios.udid}`);
		if (project.assignments.android?.platform === "android") console.log(`  android: ${project.assignments.android.serial}`);
	}
});

program.command("logs").option("-n <lines>", "Lines", "50").action(async (options: { readonly lines: string }) => {
	const { root } = await currentProject();
	await requireSuccess("tail", ["-n", options.lines, metroLogPath(root)]);
});

program.command("stop").action(async () => {
	const { project } = await currentProject();
	const result = await run("lsof", ["-ti", `:${project.metroPort}`]);
	for (const pid of result.stdout.split(/\s+/).filter(Boolean)) await run("kill", [pid]);
});

await program.parseAsync();
