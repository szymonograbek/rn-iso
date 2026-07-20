import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { debugTargets, openDevtools } from "./metro.js";

test("discovers a target and asks Metro to open DevTools", async () => {
	const requests: string[] = [];
	const server = createServer((request, response) => {
		requests.push(`${request.method ?? ""} ${request.url ?? ""}`);
		if (request.url === "/json/list") {
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify([{ id: "device-page", title: "Example", description: "Hermes" }]));
			return;
		}
		response.end();
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, resolve);
	});

	try {
		const address = server.address();
		if (address === null || typeof address === "string") throw new Error("Test server has no TCP port");

		const targets = await debugTargets(address.port);
		assert.deepEqual(targets, [{ id: "device-page", title: "Example", description: "Hermes" }]);
		await openDevtools(address.port, targets[0]?.id ?? "");
		assert.deepEqual(requests, ["POST /json/list", "POST /open-debugger?target=device-page"]);
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
	}
});
