import assert from "node:assert/strict";
import test from "node:test";
import { Ios } from "./ios.js";
import type { Simulator } from "./types.js";

const simulator = (udid: string, name: string, state: "Booted" | "Shutdown", runtime: string): Simulator => ({ udid, name, state, runtime, isAvailable: true });

test("orders iPhones before iPads and booted before shutdown", () => {
	const sorted = Ios.sort([
		simulator("ipad", "iPad Pro", "Booted", "com.apple.CoreSimulator.SimRuntime.iOS-26-5"),
		simulator("shutdown", "iPhone 17", "Shutdown", "com.apple.CoreSimulator.SimRuntime.iOS-26-5"),
		simulator("booted", "iPhone 16", "Booted", "com.apple.CoreSimulator.SimRuntime.iOS-18-6"),
	]);
	assert.deepEqual(sorted.map(({ udid }) => udid), ["booted", "shutdown", "ipad"]);
});

test("orders newer runtime and usage within the same state", () => {
	const old = simulator("old", "iPhone 15", "Shutdown", "com.apple.CoreSimulator.SimRuntime.iOS-18-6");
	const latest = simulator("latest", "iPhone 17", "Shutdown", "com.apple.CoreSimulator.SimRuntime.iOS-26-10");
	assert.deepEqual(Ios.sort([old, latest], { old: 99 }).map(({ udid }) => udid), ["latest", "old"]);
});

test("parses iOS runtime versions", () => {
	assert.equal(Ios.runtimeVersion("com.apple.CoreSimulator.SimRuntime.iOS-26-2"), "26.2");
	assert.equal(Ios.runtimeVersion("com.apple.CoreSimulator.SimRuntime.iOS-18"), "18");
});
