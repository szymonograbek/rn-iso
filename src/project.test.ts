import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Project } from "./project.js";
import type { Project as ProjectState, State } from "./types.js";

const entry = (label?: string): ProjectState => ({ ...(label === undefined ? {} : { label }), metroPort: 8082, metroPid: null, isExpo: true, platforms: {} });

test("detects Expo projects and app identifiers", async () => {
	const root = await mkdtemp(join(tmpdir(), "rn-iso-project-"));
	await mkdir(join(root, "src"));
	await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { expo: "55" }, scripts: { ios: "expo run:ios" } }));
	await writeFile(join(root, "app.json"), JSON.stringify({ expo: { ios: { bundleIdentifier: "com.test" }, android: { package: "com.test" } } }));
	try {
		const found = await Project.find(join(root, "src"));
		assert.equal(found.root, await realpath(root));
		assert.equal(found.isExpo, true);
		assert.equal(found.bundleId, "com.test");
		assert.equal(found.androidPackage, "com.test");
	} finally { await rm(root, { recursive: true, force: true }); }
});

test("resolves labels, basenames, ports, and detects ambiguity", () => {
	const state: State = { version: 1, projects: { "/a/work": entry(), "/b/other": { ...entry("agent"), metroPort: 8083 } } };
	assert.equal(Project.resolveRegistered(state, "work"), "/a/work");
	assert.equal(Project.resolveRegistered(state, "agent"), "/b/other");
	assert.equal(Project.resolveRegistered(state, "8083"), "/b/other");
	const ambiguous: State = { version: 1, projects: { "/a/work": entry(), "/b/work": entry() } };
	assert.throws(() => Project.resolveRegistered(ambiguous, "work"), /Multiple projects/);
});
