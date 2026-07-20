#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import { existsSync } from "node:fs";
import prompts from "prompts";
import { Android } from "./android.js";
import { inherited } from "./exec.js";
import { Ios } from "./ios.js";
import { Metro } from "./metro.js";
import { findProject } from "./project.js";
import { Runner } from "./runner.js";
import { StateStore } from "./state.js";
import { Target } from "./target.js";
import type { AndroidAssignment, PackageManager, Platform, Project, Simulator, State } from "./types.js";
import type { AndroidCandidate } from "./android.js";

const program = new Command();
program.name("rn-iso").description("Isolated React Native dev environments per project/worktree").version("1.0.0");

const isEmulator = (assignment: AndroidAssignment): assignment is Extract<AndroidAssignment, { avdName: string }> => "avdName" in assignment;
const autoMode = (requested: boolean | undefined): boolean => requested === true || !process.stdin.isTTY;

async function save(state: State): Promise<void> {
	await StateStore.write(state);
}

async function projectContext(): Promise<{ readonly root: string; readonly info: Awaited<ReturnType<typeof findProject>>; readonly state: State; readonly project?: Project }> {
	const info = await findProject(process.cwd());
	const state = await StateStore.read();
	const project = state.projects[info.root];
	return project === undefined ? { root: info.root, info, state } : { root: info.root, info, state, project };
}

async function labelFor(root: string, project: Project | undefined, explicit: string | undefined, auto: boolean): Promise<string | undefined> {
	if (explicit !== undefined) return explicit;
	if (project?.label !== undefined) return project.label;
	if (auto) return undefined;
	const answer: { readonly label?: string } = await prompts({ type: "text", name: "label", message: "Project label (shortcut for stop / release):", initial: root.split("/").pop() });
	return answer.label;
}

async function ensureRegistered(options: { readonly label?: string | undefined; readonly auto: boolean; readonly allocatePort: boolean }): Promise<{ readonly root: string; readonly state: State; readonly project: Project }> {
	const context = await projectContext();
	const label = await labelFor(context.root, context.project, options.label, options.auto);
	let state = context.state;
	let metroPort = context.project?.metroPort ?? null;
	if (options.allocatePort && metroPort === null) {
		const deadProjects = Object.entries(state.projects).filter(([root, project]) => root !== context.root && !existsSync(root) && project.metroPort !== null);
		for (const [root, project] of deadProjects) {
			if (project.metroPort !== null && !(await Metro.healthy(project.metroPort))) {
				metroPort = project.metroPort;
				state = StateStore.withoutProject(state, root);
				break;
			}
		}
		metroPort ??= StateStore.nextPort(state);
		console.log(chalk.dim(`Allocated Metro port: ${metroPort}`));
	}
	const project: Project = {
		...(context.project ?? { metroPid: null, platforms: {} }),
		metroPort,
		isExpo: context.info.isExpo,
		bundleId: context.info.bundleId,
		androidPackage: context.info.androidPackage,
		...(label === undefined ? {} : { label }),
	};
	state = StateStore.withProject(state, context.root, project);
	await save(state);
	return { root: context.root, state, project };
}

async function updateProject(root: string, transform: (project: Project) => Project): Promise<Project> {
	const state = await StateStore.read();
	const project = state.projects[root];
	if (project === undefined) throw new Error(`Project not registered: ${root}`);
	const updated = transform(project);
	await save(StateStore.withProject(state, root, updated));
	return updated;
}

async function ensureManagedMetro(root: string, project: Project, managed: boolean): Promise<Project> {
	if (project.metroPort === null) throw new Error("Metro port is not allocated");
	if (!managed) {
		console.log(chalk.dim(`Metro port: ${project.metroPort}${await Metro.healthy(project.metroPort) ? " (already running)" : " (will be started by build CLI)"}`));
		return project;
	}
	const result = await Metro.start(root, project.metroPort, project.isExpo);
	if (result.alreadyRunning) {
		console.log(chalk.dim(`Metro port: ${project.metroPort} (already running)`));
		return project;
	}
	const updated = await updateProject(root, (current) => ({ ...current, metroPid: result.pid }));
	console.log(chalk.dim(`Metro started detached (pid ${result.pid ?? "?"}, port ${project.metroPort})`));
	console.log(chalk.dim(`Metro log: ${Metro.logPath(root)}`));
	if (!result.ready) console.log(chalk.yellow("Warning: Metro did not report ready within 30 seconds"));
	return updated;
}

async function pickIos(candidates: readonly Simulator[], claims: Readonly<Record<string, { readonly label: string; readonly path: string }>>, auto: boolean): Promise<Simulator> {
	const first = candidates[0];
	if (first === undefined) throw new Error("No iOS simulators found");
	if (auto) return first;
	const answer: { readonly simulator?: Simulator } = await prompts({
		type: "select",
		name: "simulator",
		message: "Pick a simulator (claimed sims require confirmation):",
		choices: candidates.map((simulator) => ({
			title: `${simulator.name}  ${Ios.runtimeVersion(simulator.runtime)}${simulator.state === "Booted" ? " [booted]" : ""}${claims[simulator.udid] === undefined ? "" : ` [claimed by ${claims[simulator.udid]?.label}]`}`,
			value: simulator,
		})),
	});
	if (answer.simulator === undefined) throw new Error("Cancelled");
	const claim = claims[answer.simulator.udid];
	if (claim !== undefined) {
		const confirmation: { readonly ok?: boolean } = await prompts({ type: "confirm", name: "ok", message: `Take this simulator over from ${claim.label}?`, initial: false });
		if (confirmation.ok !== true) throw new Error("Cancelled");
		const state = await StateStore.read();
		const owner = state.projects[claim.path];
		if (owner !== undefined) await save(StateStore.withProject(state, claim.path, StateStore.clearAssignment(owner, "ios")));
	}
	return answer.simulator;
}

interface IosOptions {
	readonly auto?: boolean;
	readonly deviceType?: string;
	readonly runtime?: string;
	readonly managedMetro?: boolean;
	readonly label?: string;
	readonly script?: string | boolean;
	readonly pm?: string;
	readonly install: boolean;
}

program.command("ios")
	.description("Ensure a dedicated iOS simulator and Metro server; build/install if needed")
	.argument("[extras...]", "Flags forwarded to the build CLI")
	.option("--device-type <name>", "Create a new simulator of this type")
	.option("--runtime <version>", "Runtime for a newly created simulator")
	.option("--auto", "Pick the first unclaimed simulator")
	.option("--managed-metro", "Start Metro detached")
	.option("--label <name>", "Project shortcut")
	.option("--script <name>", "Build script")
	.option("--no-script", "Use the CLI directly")
	.option("--pm <name>", "npm, yarn, pnpm, or bun")
	.option("--no-install", "Skip build/install")
	.action(async (extras: readonly string[], options: IosOptions) => {
		const auto = autoMode(options.auto);
		const prepared = await ensureRegistered({ auto, allocatePort: true, label: options.label });
		const project = await ensureManagedMetro(prepared.root, prepared.project, options.managedMetro === true);
		if (project.metroPort === null) throw new Error("Metro port is not allocated");
		const all = await Ios.list();
		const currentUdid = project.platforms.ios?.deviceUdid;
		let simulator = currentUdid === undefined ? undefined : all.find((candidate) => candidate.udid === currentUdid);
		if (simulator === undefined) {
			const claims = StateStore.claimedDevices(prepared.state, prepared.root).ios;
			const unclaimed = Ios.sort(all.filter((candidate) => claims[candidate.udid] === undefined), prepared.state.simUsage?.ios);
			if (unclaimed.length === 0) {
				if (options.deviceType !== undefined) {
					const udid = await Ios.create(options.deviceType, options.runtime);
					simulator = (await Ios.list()).find((candidate) => candidate.udid === udid);
					if (simulator === undefined) throw new Error(`Created simulator ${udid} was not found`);
				} else if (auto) {
					throw new Error("All iOS simulators are claimed by other rn-iso projects");
				} else {
					simulator = await pickIos(Ios.sort(all, prepared.state.simUsage?.ios), claims, false);
				}
			} else {
				simulator = auto ? await pickIos(unclaimed, claims, true) : await pickIos(Ios.sort(all, prepared.state.simUsage?.ios), claims, false);
			}
		}
		if (simulator.state !== "Booted") await Ios.boot(simulator.udid);
		let state = await StateStore.read();
		const latest = state.projects[prepared.root];
		if (latest === undefined) throw new Error("Project disappeared from state");
		state = StateStore.withProject(state, prepared.root, { ...latest, platforms: { ...latest.platforms, ios: { deviceUdid: simulator.udid } } });
		state = StateStore.recordUsage(state, "ios", simulator.udid);
		await save(state);
		if (options.install) {
			const manager = resolvePackageManager(options.pm, project.settings?.packageManager, prepared.root);
			const scriptName = options.script === false ? null : typeof options.script === "string" ? options.script : project.settings?.ios?.script ?? "ios";
			const invocation = Runner.ios({ root: prepared.root, manager, scriptName, isExpo: project.isExpo, port: project.metroPort, managedMetro: options.managedMetro === true, extras, udid: simulator.udid });
			console.log(chalk.dim(`> ${invocation.command} ${invocation.args.join(" ")}`));
			await inherited(invocation.command, invocation.args, prepared.root, invocation.env);
		}
		if (project.bundleId === null || project.bundleId === undefined) throw new Error("iOS bundle identifier was not found");
		await Ios.configureAndLaunch(simulator.udid, project.bundleId, project.metroPort);
		console.log(chalk.green(`\nOK: iOS ready on sim ${await Ios.format(simulator.udid)}, Metro port ${project.metroPort}`));
	});

const resolvePackageManager = (cli: string | undefined, stored: PackageManager | undefined, root: string): PackageManager => {
	const value = cli ?? stored ?? Runner.packageManager(root);
	if (value !== "npm" && value !== "yarn" && value !== "pnpm" && value !== "bun") throw new Error(`Unsupported package manager: ${value}`);
	return value;
};

async function pickAndroid(items: readonly AndroidCandidate[], claims: ReturnType<typeof StateStore.claimedDevices>, auto: boolean): Promise<AndroidCandidate> {
	const first = items[0];
	if (first === undefined) throw new Error("No Android devices available");
	if (auto) return first;
	const answer: { readonly candidate?: AndroidCandidate } = await prompts({
		type: "select", name: "candidate", message: "Pick an Android device:", choices: items.map((candidate) => ({
			title: candidate.kind === "physical" ? `${candidate.serial} [physical]` : `${candidate.avdName}${candidate.running ? ` [emulator-${candidate.consolePort}, running]` : ""}`,
			value: candidate,
		})),
	});
	if (answer.candidate === undefined) throw new Error("Cancelled");
	const claim = answer.candidate.kind === "physical" ? claims.androidSerials[answer.candidate.serial] : claims.androidAvds[answer.candidate.avdName];
	if (claim !== undefined) {
		const confirmation: { readonly ok?: boolean } = await prompts({ type: "confirm", name: "ok", message: `Take this device over from ${claim.label}?`, initial: false });
		if (confirmation.ok !== true) throw new Error("Cancelled");
		const state = await StateStore.read();
		const owner = state.projects[claim.path];
		if (owner !== undefined) await save(StateStore.withProject(state, claim.path, StateStore.clearAssignment(owner, "android")));
	}
	return answer.candidate;
}

interface AndroidOptions {
	readonly auto?: boolean;
	readonly managedMetro?: boolean;
	readonly label?: string;
	readonly script?: string | boolean;
	readonly pm?: string;
	readonly install: boolean;
}

program.command("android")
	.description("Ensure a dedicated Android device and Metro server; build/install if needed")
	.argument("[extras...]", "Flags forwarded to the build CLI")
	.option("--auto", "Pick the first unclaimed device")
	.option("--managed-metro", "Start Metro detached")
	.option("--label <name>", "Project shortcut")
	.option("--script <name>", "Build script")
	.option("--no-script", "Use the CLI directly")
	.option("--pm <name>", "npm, yarn, pnpm, or bun")
	.option("--no-install", "Skip build/install")
	.action(async (extras: readonly string[], options: AndroidOptions) => {
		const auto = autoMode(options.auto);
		const prepared = await ensureRegistered({ auto, allocatePort: true, label: options.label });
		const project = await ensureManagedMetro(prepared.root, prepared.project, options.managedMetro === true);
		if (project.metroPort === null) throw new Error("Metro port is not allocated");
		const all = await Android.candidates();
		const current = project.platforms.android;
		let candidate = current === undefined ? undefined : all.find((item) => isEmulator(current) ? item.kind === "avd" && item.avdName === current.avdName : item.kind === "physical" && item.serial === current.serial);
		if (candidate?.kind === "avd" && current !== undefined && isEmulator(current) && candidate.consolePort === null) candidate = { ...candidate, consolePort: current.consolePort };
		const claims = StateStore.claimedDevices(prepared.state, prepared.root);
		if (candidate === undefined) {
			const unclaimed = Android.sort(all.filter((item) => item.kind === "avd" ? claims.androidAvds[item.avdName] === undefined : claims.androidSerials[item.serial] === undefined));
			if (unclaimed.length === 0 && auto) throw new Error("All Android devices are claimed by other rn-iso projects");
			candidate = auto ? await pickAndroid(unclaimed, claims, true) : await pickAndroid(Android.sort(all), claims, false);
		}
		let assignment: AndroidAssignment;
		let serial: string;
		let selectedAvd: string | null = null;
		if (candidate.kind === "physical") {
			serial = candidate.serial;
			assignment = { serial };
		} else {
			selectedAvd = candidate.avdName;
			const claimedPorts = Object.keys(claims.androidPorts).map(Number);
			const consolePort = candidate.consolePort ?? Android.nextConsolePort(claimedPorts);
			const unhealthy = (await Android.devices()).unhealthy.find((device) => device.consolePort === consolePort);
			if (unhealthy !== undefined) throw new Error(`${unhealthy.serial} is ${unhealthy.status}; restart adb or cold-boot the AVD`);
			serial = candidate.running ? `emulator-${consolePort}` : await Android.boot(candidate.avdName, consolePort);
			assignment = { avdName: candidate.avdName, consolePort };
		}
		await updateProject(prepared.root, (currentProject) => ({ ...currentProject, platforms: { ...currentProject.platforms, android: assignment } }));
		await Android.reverseMetro(serial, project.metroPort);
		if (options.install) {
			const manager = resolvePackageManager(options.pm, project.settings?.packageManager, prepared.root);
			const scriptName = options.script === false ? null : typeof options.script === "string" ? options.script : project.settings?.android?.script ?? "android";
			const expoDeviceName = candidate.kind === "physical" ? candidate.modelName ?? candidate.serial : candidate.avdName;
			const invocation = Runner.android({ root: prepared.root, manager, scriptName, isExpo: project.isExpo, port: project.metroPort, managedMetro: options.managedMetro === true, extras, serial, expoDeviceName });
			console.log(chalk.dim(`> ${invocation.command} ${invocation.args.join(" ")}`));
			await inherited(invocation.command, invocation.args, prepared.root, invocation.env);
		}
		console.log(chalk.green(`\nAndroid ready on ${selectedAvd ?? "physical device"} (${serial}), Metro port ${project.metroPort}`));
	});

program.command("start")
	.description("Start managed Metro without building or installing")
	.argument("[extras...]", "Flags forwarded to Metro")
	.option("--reset-cache", "Clear Metro transform cache")
	.action(async (extras: readonly string[], options: { readonly resetCache?: boolean }) => {
		const prepared = await ensureRegistered({ auto: true, allocatePort: true });
		if (prepared.project.metroPort === null) throw new Error("Metro port is not allocated");
		const allExtras = [...extras, ...(options.resetCache === true ? ["--reset-cache"] : [])];
		const result = await Metro.start(prepared.root, prepared.project.metroPort, prepared.project.isExpo, allExtras);
		if (result.alreadyRunning) {
			console.log(allExtras.length === 0 ? chalk.dim(`Metro already running on port ${prepared.project.metroPort}`) : chalk.yellow("Metro is already running; extras were not applied"));
		} else {
			await updateProject(prepared.root, (project) => ({ ...project, metroPid: result.pid }));
			console.log(chalk.green(`Metro started (pid ${result.pid ?? "?"}, port ${prepared.project.metroPort})`));
		}
	});

program.command("devtools")
	.description("Open React Native DevTools for the current project's Metro server")
	.action(async () => {
		const context = await projectContext();
		if (context.project === undefined || context.project.metroPort === null) throw new Error(`No Metro assignment for project ${context.root}`);
		if (!(await Metro.healthy(context.project.metroPort))) throw new Error(`Metro is not running on port ${context.project.metroPort}; run rn-iso start`);

		const targets = await Metro.debugTargets(context.project.metroPort);
		if (targets.length === 0) throw new Error("No connected DevTools targets; launch the app first");
		let target = targets[0];
		if (targets.length > 1) {
			const answer: { readonly target?: (typeof targets)[number] } = await prompts({
				type: "select",
				name: "target",
				message: "Pick a DevTools target:",
				choices: targets.map((candidate) => ({
					title: `${candidate.title}${candidate.description === "" ? "" : ` — ${candidate.description}`}`,
					value: candidate,
				})),
			});
			if (answer.target === undefined) throw new Error("Cancelled");
			target = answer.target;
		}
		if (target === undefined) throw new Error("No connected DevTools targets; launch the app first");

		await Metro.openDevtools(context.project.metroPort, target.id);
		console.log(chalk.green(`Opened DevTools for ${target.title}`));
	});

program.command("device")
	.description("Print the assigned device for the current project")
	.option("--platform <platform>", "ios or android", "ios")
	.option("--json", "JSON output")
	.action(async (options: { readonly platform: string; readonly json?: boolean }) => {
		if (options.platform !== "ios" && options.platform !== "android") throw new Error(`Unsupported platform: ${options.platform}`);
		const context = await projectContext();
		if (context.project === undefined) throw new Error(`No rn-iso assignment for project ${context.root}`);
		const assignment = context.project.platforms[options.platform];
		if (assignment === undefined) throw new Error(`No ${options.platform} device assigned`);
		const metro = { metroPort: context.project.metroPort, metroPid: context.project.metroPid, metroHealthy: context.project.metroPort !== null && await Metro.healthy(context.project.metroPort), metroLog: Metro.logPath(context.root) };
		if (options.platform === "ios" && "deviceUdid" in assignment) {
			console.log(options.json === true ? JSON.stringify({ platform: "ios", udid: assignment.deviceUdid, ...metro }) : assignment.deviceUdid);
		} else if (options.platform === "android" && !containsDeviceUdid(assignment)) {
			const payload = isEmulator(assignment)
				? { platform: "android", kind: "emulator", serial: `emulator-${assignment.consolePort}`, avdName: assignment.avdName, consolePort: assignment.consolePort, ...metro }
				: { platform: "android", kind: "physical", serial: assignment.serial, avdName: null, consolePort: null, ...metro };
			console.log(options.json === true ? JSON.stringify(payload) : payload.serial);
		}
	});

const containsDeviceUdid = (value: AndroidAssignment | { readonly deviceUdid: string }): value is { readonly deviceUdid: string } => "deviceUdid" in value;

async function resolveTarget(target: string | undefined, numericMustBeRegistered = true): Promise<{ readonly root: string; readonly state: State; readonly project: Project }> {
	const state = await StateStore.read();
	let cwdRoot: string | undefined;
	try { cwdRoot = (await findProject(process.cwd())).root; } catch { cwdRoot = undefined; }
	if (!numericMustBeRegistered && target !== undefined && /^\d+$/.test(target)) throw new Error("numeric-target");
	const root = Target.resolveProject(state, target, cwdRoot);
	const project = state.projects[root];
	if (project === undefined) throw new Error(`Project not registered: ${root}`);
	return { root, state, project };
}

program.command("status").description("Show all project assignments and Metro state").action(async () => {
	const state = await StateStore.read();
	if (Object.keys(state.projects).length === 0) { console.log(chalk.dim("No projects registered.")); return; }
	let current: string | undefined;
	try { current = (await findProject(process.cwd())).root; } catch { current = undefined; }
	let simulators: readonly Simulator[] = [];
	try { simulators = await Ios.list(); } catch { simulators = []; }
	for (const [root, project] of Object.entries(state.projects)) {
		console.log(`\n${root === current ? "* " : ""}${StateStore.shortcut(root, project)} (${root})`);
		console.log(`  app: ${project.bundleId ?? "?"} (${project.isExpo ? "expo" : "bare"})`);
		console.log(project.metroPort === null ? "  metro: unassigned" : `  metro: port ${project.metroPort} pid ${project.metroPid ?? "?"} (${await Metro.healthy(project.metroPort) ? "running" : Metro.pidAlive(project.metroPid) ? "pid alive but not responding" : "stopped"})`);
		if (existsSync(Metro.logPath(root))) console.log(chalk.dim(`  log: ${Metro.logPath(root)}`));
		const ios = project.platforms.ios;
		if (ios !== undefined) console.log(`  ios: ${simulators.find((simulator) => simulator.udid === ios.deviceUdid)?.name ?? "unknown"} (${ios.deviceUdid})`);
		const android = project.platforms.android;
		if (android !== undefined) console.log(`  android: ${isEmulator(android) ? `${android.avdName} (emulator-${android.consolePort})` : `${android.serial} (physical)`}`);
	}
	console.log("");
});

program.command("stop [target]").description("Stop Metro by project, shortcut, path, or port").action(async (target: string | undefined) => {
	if (target !== undefined && /^\d+$/.test(target)) {
		const port = Number(target);
		const pid = await Metro.stop(port, null);
		console.log(pid === null ? chalk.dim(`No process listening on port ${port}`) : chalk.green(`Killed pid ${pid} on port ${port}`));
		const state = await StateStore.read();
		const owner = Object.entries(state.projects).find(([, project]) => project.metroPort === port);
		if (owner !== undefined) await save(StateStore.withProject(state, owner[0], { ...owner[1], metroPid: null }));
		return;
	}
	const resolved = await resolveTarget(target);
	if (resolved.project.metroPort === null) return;
	const pid = await Metro.stop(resolved.project.metroPort, resolved.project.metroPid);
	await save(StateStore.withProject(resolved.state, resolved.root, { ...resolved.project, metroPid: null }));
	console.log(pid === null ? chalk.dim(`No Metro process found on port ${resolved.project.metroPort}`) : chalk.green(`Killed Metro pid ${pid} on port ${resolved.project.metroPort}`));
});

program.command("logs [target]")
	.description("Print or follow a managed Metro log")
	.option("-n, --lines <count>", "Trailing lines", "50")
	.option("-f, --follow", "Follow the log")
	.action(async (target: string | undefined, options: { readonly lines: string; readonly follow?: boolean }) => {
		const resolved = await resolveTarget(target);
		const path = Metro.logPath(resolved.root);
		if (!existsSync(path)) throw new Error(`No Metro log for ${resolved.root}`);
		console.log(chalk.dim(`log: ${path}`));
		await inherited("tail", options.follow === true ? ["-n", options.lines, "-f", path] : ["-n", options.lines, path]);
	});

async function release(root: string, platforms: readonly Platform[], shutdown: boolean): Promise<void> {
	let state = await StateStore.read();
	let project = state.projects[root];
	if (project === undefined) throw new Error(`Project not registered: ${root}`);
	for (const platform of platforms) {
		const assignment = project.platforms[platform];
		if (assignment === undefined) continue;
		if (shutdown) {
			if (platform === "ios" && containsDeviceUdid(assignment)) await Ios.shutdown(assignment.deviceUdid);
			if (platform === "android" && !containsDeviceUdid(assignment) && isEmulator(assignment)) await Android.shutdown(`emulator-${assignment.consolePort}`);
		}
		project = StateStore.clearAssignment(project, platform);
	}
	state = StateStore.withProject(state, root, project);
	await save(state);
}

program.command("release [target]")
	.description("Release device assignments, optionally shutting virtual devices down")
	.option("--platform <platform>", "ios or android")
	.option("--shutdown", "Shut down virtual devices")
	.action(async (target: string | undefined, options: { readonly platform?: string; readonly shutdown?: boolean }) => {
		if (options.platform !== undefined && options.platform !== "ios" && options.platform !== "android") throw new Error(`Unsupported platform: ${options.platform}`);
		if (target !== undefined && /^\d+$/.test(target)) {
			const state = await StateStore.read();
			const owner = Object.entries(state.projects).find(([, project]) => project.metroPort === Number(target));
			if (owner === undefined) {
				const pid = await Metro.listeningPid(Number(target));
				if (pid === null) throw new Error(`No registered project has Metro port ${target}, and nothing is listening there`);
				if (!process.stdin.isTTY) throw new Error("Refusing to kill an unrecognized process without confirmation");
				const confirmation: { readonly ok?: boolean } = await prompts({ type: "confirm", name: "ok", message: `Kill pid ${pid} on port ${target}?`, initial: false });
				if (confirmation.ok !== true) throw new Error("Cancelled");
				process.kill(pid, "SIGTERM");
				return;
			}
		}
		const resolved = await resolveTarget(target);
		await release(resolved.root, options.platform === undefined ? ["ios", "android"] : [options.platform], options.shutdown === true);
	});

program.command("unreserve [platform]").description("Clear current project device claims without shutdown").action(async (platform: string | undefined) => {
	if (platform !== undefined && platform !== "ios" && platform !== "android") throw new Error(`Unsupported platform: ${platform}`);
	const resolved = await resolveTarget(undefined);
	await release(resolved.root, platform === undefined ? ["ios", "android"] : [platform], false);
});

program.command("reserve [platform]")
	.description("Claim an already-running simulator or emulator without building")
	.option("--label <name>", "Project shortcut")
	.action(async (platform: string | undefined, options: { readonly label?: string }) => {
		const selectedPlatform = platform ?? "ios";
		if (selectedPlatform !== "ios" && selectedPlatform !== "android") throw new Error(`Unsupported platform: ${selectedPlatform}`);
		const prepared = await ensureRegistered({ auto: !process.stdin.isTTY, allocatePort: true, label: options.label });
		if (selectedPlatform === "ios") {
			const claims = StateStore.claimedDevices(prepared.state, prepared.root);
			const booted = Ios.sort((await Ios.list()).filter((simulator) => simulator.state === "Booted"));
			const available = process.stdin.isTTY ? booted : booted.filter((simulator) => claims.ios[simulator.udid] === undefined);
			if (available.length === 0) throw new Error("No unclaimed booted iOS simulators found");
			const simulator = await pickIos(available, claims.ios, !process.stdin.isTTY);
			await updateProject(prepared.root, (project) => ({ ...project, platforms: { ...project.platforms, ios: { deviceUdid: simulator.udid } } }));
		} else {
			const claims = StateStore.claimedDevices(prepared.state, prepared.root);
			const running = (await Android.candidates()).filter((candidate) => candidate.kind === "avd" && candidate.running);
			const available = process.stdin.isTTY ? running : running.filter((candidate) => candidate.kind === "avd" && claims.androidAvds[candidate.avdName] === undefined);
			if (available.length === 0) throw new Error("No unclaimed running Android emulators found");
			const candidate = await pickAndroid(Android.sort(available), claims, !process.stdin.isTTY);
			const assignment: AndroidAssignment = candidate.kind === "physical" ? { serial: candidate.serial } : { avdName: candidate.avdName, consolePort: candidate.consolePort ?? Android.nextConsolePort([]) };
			await updateProject(prepared.root, (project) => ({ ...project, platforms: { ...project.platforms, android: assignment } }));
		}
	});

program.command("prune").description("Remove deleted-project entries and orphaned Metro processes").action(async () => {
	let state = await StateStore.read();
	const removed = Object.entries(state.projects).filter(([root]) => !existsSync(root));
	for (const [root, project] of removed) {
		if (project.metroPort !== null) await Metro.stop(project.metroPort, project.metroPid);
		state = StateStore.withoutProject(state, root);
		console.log(chalk.green(`Pruned ${root}`));
	}
	await save(state);
	if (removed.length === 0) console.log(chalk.dim("Nothing to prune"));
});

program.command("shutdown [target]")
	.description("Stop Metro and clear assignments for one or all projects")
	.option("-y, --yes", "Skip confirmation")
	.option("--keep-sims", "Keep simulators running")
	.action(async (target: string | undefined, options: { readonly yes?: boolean; readonly keepSims?: boolean }) => {
		const state = await StateStore.read();
		const roots = target === undefined ? Object.keys(state.projects) : [(await resolveTarget(target)).root];
		if (roots.length === 0) { console.log(chalk.dim("No projects registered.")); return; }
		if (options.yes !== true && process.stdin.isTTY) {
			const answer: { readonly ok?: boolean } = await prompts({ type: "confirm", name: "ok", message: `Shut down ${roots.length} rn-iso project(s)?`, initial: false });
			if (answer.ok !== true) throw new Error("Cancelled");
		}
		for (const root of roots) {
			const latest = await StateStore.read();
			const project = latest.projects[root];
			if (project === undefined) continue;
			if (project.metroPort !== null) await Metro.stop(project.metroPort, project.metroPid);
			if (options.keepSims !== true) {
				if (project.platforms.ios !== undefined) await Ios.shutdown(project.platforms.ios.deviceUdid);
				const android = project.platforms.android;
				if (android !== undefined && isEmulator(android)) await Android.shutdown(`emulator-${android.consolePort}`);
			}
			await save(StateStore.withProject(latest, root, { ...project, metroPid: null, platforms: {} }));
		}
	});

program.command("config [key] [value]")
	.description("Get or set per-project package manager and build scripts")
	.option("--unset", "Remove setting")
	.option("--project <target>", "Target project")
	.action(async (key: string | undefined, value: string | undefined, options: { readonly unset?: boolean; readonly project?: string }) => {
		const prepared = options.project === undefined ? await ensureRegistered({ auto: true, allocatePort: false }) : await resolveTarget(options.project);
		const root = prepared.root;
		const project = prepared.project;
		if (key === undefined) {
			const settings = project.settings;
			if (settings === undefined || Object.keys(settings).length === 0) console.log(chalk.dim(`No settings for ${root}.`));
			else console.log(JSON.stringify(settings, null, 2));
			return;
		}
		if (key !== "packageManager" && key !== "ios.script" && key !== "android.script") throw new Error(`Unknown key ${key}`);
		const current = key === "packageManager" ? project.settings?.packageManager : key === "ios.script" ? project.settings?.ios?.script : project.settings?.android?.script;
		if (value === undefined && options.unset !== true) { console.log(current ?? "(unset)"); return; }
		const settings = { ...project.settings };
		if (key === "packageManager") {
			if (options.unset === true) delete settings.packageManager;
			else settings.packageManager = resolvePackageManager(value, undefined, root);
		} else if (key === "ios.script") {
			if (options.unset === true) delete settings.ios;
			else if (value !== undefined) settings.ios = { script: value };
		} else {
			if (options.unset === true) delete settings.android;
			else if (value !== undefined) settings.android = { script: value };
		}
		await updateProject(root, (entry) => ({ ...entry, settings }));
	});

try {
	await program.parseAsync();
} catch (error: unknown) {
	console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
	process.exitCode = 1;
}
