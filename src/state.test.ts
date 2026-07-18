import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { StateStore } from "./state.js";
import type { Project, State } from "./types.js";

const project = (port: number, platforms: Project["platforms"] = {}): Project => ({ metroPort: port, metroPid: null, isExpo: false, platforms });

test("allocates Metro ports from 8082", () => {
	assert.equal(StateStore.nextPort(StateStore.empty()), 8082);
	assert.equal(StateStore.nextPort({ version: 1, projects: { a: project(8084) } }), 8085);
});

test("tracks device claims only for live projects", async () => {
	const root = await mkdtemp(join(tmpdir(), "rn-iso-state-"));
	const live = join(root, "live");
	await mkdir(live);
	try {
		const state: State = { version: 1, projects: {
			[live]: project(8082, { ios: { deviceUdid: "IOS" }, android: { avdName: "Pixel", consolePort: 5554 } }),
			"/definitely/dead": project(8083, { ios: { deviceUdid: "DEAD" } }),
		} };
		const claims = StateStore.claimedDevices(state);
		assert.equal(claims.ios.IOS?.path, live);
		assert.equal(claims.ios.DEAD, undefined);
		assert.equal(claims.androidAvds.Pixel?.path, live);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("roundtrips typed config through RN_ISO_HOME", async () => {
	const home = await mkdtemp(join(tmpdir(), "rn-iso-home-"));
	process.env.RN_ISO_HOME = home;
	try {
		const state: State = { version: 1, projects: { "/app": project(8082) } };
		await StateStore.write(state);
		assert.deepEqual(await StateStore.read(), state);
	} finally {
		delete process.env.RN_ISO_HOME;
		await rm(home, { recursive: true, force: true });
	}
});
