import assert from "node:assert/strict";
import test from "node:test";
import { Android } from "./android.js";

test("parses emulator, physical, and unhealthy adb devices", () => {
	const parsed = Android.parseDevices("List of devices attached\nemulator-5554\tdevice product:sdk model:sdk_gphone64_arm64\nR5CR70\tdevice product:lynx model:Pixel_7a device:lynx\nemulator-5556\toffline\nUSB\tunauthorized\n");
	assert.deepEqual(parsed.emulators, [{ serial: "emulator-5554", consolePort: 5554 }]);
	assert.deepEqual(parsed.physical, [{ serial: "R5CR70", modelName: "Pixel_7a" }]);
	assert.deepEqual(parsed.unhealthy, [
		{ serial: "emulator-5556", status: "offline", consolePort: 5556 },
		{ serial: "USB", status: "unauthorized" },
	]);
});

test("sorts running and physical Android devices first", () => {
	const sorted = Android.sort([
		{ kind: "avd", avdName: "Z", running: false, consolePort: null },
		{ kind: "avd", avdName: "A", running: true, consolePort: 5554 },
		{ kind: "physical", serial: "USB", modelName: "Pixel_7a", running: true },
	]);
	assert.deepEqual(sorted.map((candidate) => candidate.kind === "physical" ? candidate.serial : candidate.avdName), ["USB", "A", "Z"]);
});

test("allocates even Android console ports", () => {
	assert.equal(Android.nextConsolePort([]), 5554);
	assert.equal(Android.nextConsolePort([5554, 5558]), 5560);
});
