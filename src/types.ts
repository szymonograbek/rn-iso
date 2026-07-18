import { z } from "zod";

const packageManager = z.enum(["npm", "yarn", "pnpm", "bun"]);
const platform = z.enum(["ios", "android"]);

const iosAssignment = z.object({
	deviceUdid: z.string().min(1),
});

const androidEmulatorAssignment = z.object({
	avdName: z.string().min(1),
	consolePort: z.number().int().positive(),
});

const androidPhysicalAssignment = z.object({
	serial: z.string().min(1),
});

const androidAssignment = z.union([androidEmulatorAssignment, androidPhysicalAssignment]);

const projectSettings = z.object({
	packageManager: packageManager.optional(),
	ios: z.object({ script: z.string().min(1).optional() }).optional(),
	android: z.object({ script: z.string().min(1).optional() }).optional(),
});

const project = z.object({
	label: z.string().min(1).optional(),
	metroPort: z.number().int().positive().nullable().default(null),
	metroPid: z.number().int().positive().nullable().default(null),
	isExpo: z.boolean(),
	bundleId: z.string().min(1).nullable().optional(),
	androidPackage: z.string().min(1).nullable().optional(),
	settings: projectSettings.optional(),
	platforms: z.object({
		ios: iosAssignment.optional(),
		android: androidAssignment.optional(),
	}).default({}),
});

const state = z.object({
	version: z.literal(1),
	projects: z.record(z.string(), project),
	simUsage: z.object({
		ios: z.record(z.string(), z.number().int().nonnegative()),
		android: z.record(z.string(), z.number().int().nonnegative()),
	}).optional(),
});

const packageManifest = z.object({
	dependencies: z.record(z.string(), z.string()).optional(),
	devDependencies: z.record(z.string(), z.string()).optional(),
	scripts: z.record(z.string(), z.string()).optional(),
});

const expoConfig = z.object({
	ios: z.object({ bundleIdentifier: z.string().min(1).optional() }).optional(),
	android: z.object({ package: z.string().min(1).optional() }).optional(),
});

const simulator = z.object({
	udid: z.string().min(1),
	name: z.string().min(1),
	state: z.enum(["Booted", "Shutdown"]),
	isAvailable: z.boolean(),
});

const simctlDevices = z.object({
	devices: z.record(z.string(), z.array(simulator)),
});

const deviceType = z.object({
	identifier: z.string().min(1),
	name: z.string().min(1),
});

const runtime = z.object({
	identifier: z.string().min(1),
	name: z.string().min(1),
	version: z.string().min(1),
	isAvailable: z.boolean(),
	platform: z.string(),
	supportedDeviceTypes: z.array(deviceType).optional(),
});

const simctlRuntimes = z.object({ runtimes: z.array(runtime) });

export const Schema = {
	expoConfig,
	packageManager,
	packageManifest,
	project,
	simctlDevices,
	simctlRuntimes,
	state,
};

export type Platform = z.infer<typeof platform>;
export type PackageManager = z.infer<typeof packageManager>;
export type IosAssignment = z.infer<typeof iosAssignment>;
export type AndroidAssignment = z.infer<typeof androidAssignment>;
export type ProjectSettings = z.infer<typeof projectSettings>;
export type Project = z.infer<typeof project>;
export type State = z.infer<typeof state>;
export type ExpoConfig = z.infer<typeof expoConfig>;
export type Simulator = z.infer<typeof simulator> & { readonly runtime: string };
export type IosRuntime = z.infer<typeof runtime>;
