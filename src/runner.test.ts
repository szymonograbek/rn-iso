import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Runner } from "./runner.js";

const fixture = (scripts: Readonly<Record<string, string>> = {}): string => {
	const root = mkdtempSync(join(tmpdir(), "rn-iso-runner-"));
	writeFileSync(join(root, "package.json"), JSON.stringify({ scripts }));
	return root;
};

test("builds package-manager script commands", () => {
	assert.deepEqual(Runner.scriptCommand("npm", "ios", ["--port", "8082"]), ["run", "ios", "--", "--port", "8082"]);
	assert.deepEqual(Runner.scriptCommand("yarn", "android", ["--device", "emulator-5554"]), ["android", "--device", "emulator-5554"]);
});

test("uses Expo device flags and keeps extras last", () => {
	const root = fixture({ ios: "expo run:ios" });
	try {
		const invocation = Runner.ios({ root, manager: "yarn", scriptName: "ios", isExpo: true, port: 8083, managedMetro: true, extras: ["--variant=release"], udid: "UDID" });
		assert.equal(invocation.command, "yarn");
		assert.deepEqual(invocation.args, ["ios", "--device", "UDID", "--port", "8083", "--variant=release"]);
		assert.equal(invocation.env?.RCT_METRO_PORT, "8083");
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("uses RN no-packager and Android Metro environment", () => {
	const root = fixture();
	try {
		const ios = Runner.ios({ root, manager: "npm", scriptName: null, isExpo: false, port: 8083, managedMetro: true, extras: [], udid: "UDID" });
		assert.equal(ios.env?.RCT_METRO_PORT, "8083");
		assert.deepEqual(ios.args, ["react-native", "run-ios", "--udid", "UDID", "--port", "8083", "--no-packager"]);
		const android = Runner.android({ root, manager: "npm", scriptName: null, isExpo: false, port: 8083, managedMetro: true, extras: [], serial: "emulator-5554", avdName: "Pixel" });
		assert.equal(android.env?.RCT_METRO_PORT, "8083");
		assert.deepEqual(android.args, ["react-native", "run-android", "--device", "emulator-5554", "--no-packager"]);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
