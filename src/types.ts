import { z } from "zod";

const platform = z.enum(["ios", "android"]);

const iosAssignment = z.object({
	platform: z.literal("ios"),
	udid: z.string().min(1),
});

const androidAssignment = z.object({
	platform: z.literal("android"),
	serial: z.string().min(1),
});

const assignment = z.discriminatedUnion("platform", [iosAssignment, androidAssignment]);

const project = z.object({
	label: z.string().min(1),
	metroPort: z.number().int().positive(),
	isExpo: z.boolean(),
	bundleId: z.string().min(1).optional(),
	assignments: z.partialRecord(platform, assignment),
});

const state = z.object({
	version: z.literal(1),
	projects: z.record(z.string(), project),
});

const packageManifest = z.object({
	dependencies: z.record(z.string(), z.string()).optional(),
	devDependencies: z.record(z.string(), z.string()).optional(),
});

const expoConfig = z.object({
	ios: z.object({ bundleIdentifier: z.string().min(1) }),
	android: z.object({ package: z.string().min(1) }),
});

const simulator = z.object({
	udid: z.string().min(1),
	name: z.string().min(1),
	state: z.enum(["Booted", "Shutdown"]),
	isAvailable: z.literal(true),
});

const simctlDevices = z.object({
	devices: z.record(z.string(), z.array(simulator)),
});

export const Schema = {
	assignment,
	expoConfig,
	packageManifest,
	project,
	simctlDevices,
	state,
};

export type Platform = z.infer<typeof platform>;
export type IosAssignment = z.infer<typeof iosAssignment>;
export type AndroidAssignment = z.infer<typeof androidAssignment>;
export type DeviceAssignment = z.infer<typeof assignment>;
export type Project = z.infer<typeof project>;
export type State = z.infer<typeof state>;
export type ExpoConfig = z.infer<typeof expoConfig>;
export type Simulator = z.infer<typeof simulator>;
