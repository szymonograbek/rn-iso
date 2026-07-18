import assert from "node:assert/strict";
import test from "node:test";
import { Schema } from "./types.js";

test("rejects malformed persistent state", () => {
	assert.throws(() => Schema.state.parse({ version: 1, projects: { app: { label: "app" } } }));
});

test("accepts a project device assignment", () => {
	const state = Schema.state.parse({
		version: 1,
		projects: {
			"/tmp/app": {
				label: "app",
				metroPort: 8082,
				metroPid: null,
				isExpo: true,
				platforms: { ios: { deviceUdid: "device-id" } },
			},
		},
	});
	assert.equal(state.projects["/tmp/app"]?.metroPort, 8082);
});
