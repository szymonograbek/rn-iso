# rn-iso

Per-project Metro servers and dedicated simulators/emulators for React Native and Expo. Multiple projects or worktrees can run concurrently without sharing ports or devices.

State lives in `~/.rn-iso/config.json`. Set `RN_ISO_HOME` to override it.

## Usage

```sh
npx rn-iso ios --auto --managed-metro
npx rn-iso android --auto --managed-metro
npx rn-iso device --platform ios --json
```

Use `--auto` in agents and CI. It is also implied when stdin is not a TTY. Use `--managed-metro` when Metro must survive the invoking shell.

Forward build flags after `--`:

```sh
npx rn-iso ios -- --variant=release
npx rn-iso android -- --mode=release
```

## Commands

| Command | Purpose |
|---|---|
| `ios [options] [-- extras...]` | Allocate/reuse an unclaimed iOS simulator, configure Metro, and build/install. Supports `--auto`, `--managed-metro`, `--device-type`, `--runtime`, `--script`, `--no-script`, `--pm`, `--label`, and `--no-install`. |
| `android [options] [-- extras...]` | Allocate/reuse an AVD or physical device, configure `adb reverse`, and build/install. Supports `--auto`, `--managed-metro`, script/package-manager overrides, labels, and `--no-install`. |
| `start [--reset-cache] [-- extras...]` | Start managed Metro without building. |
| `stop [target]` | Stop Metro by current project, port, shortcut, or path. |
| `logs [target] [-n count] [--follow]` | Read the managed Metro log. |
| `device [--platform ios\|android] [--json]` | Print the assigned device and Metro health. |
| `status` | Show every registered project, device, and Metro state. |
| `reserve [ios\|android]` | Claim an already-running simulator/emulator without building. |
| `unreserve [ios\|android]` | Clear claims without shutting devices down. |
| `release [target] [--platform p] [--shutdown]` | Release claims, optionally shutting virtual devices down. |
| `shutdown [target] [-y] [--keep-sims]` | Stop Metro and clear assignments for one or all projects. |
| `prune` | Remove deleted-project entries and orphaned Metro processes. |
| `config [key] [value] [--unset] [--project target]` | Manage `packageManager`, `ios.script`, and `android.script`. |

Targets may be an absolute path, unique project label/basename, or Metro port where supported.

## Selection behavior

- Existing valid assignments are reused.
- Claims belonging to deleted worktrees are ignored and can be pruned.
- Non-interactive selection never takes over another live project's device.
- Interactive pickers display claims and require confirmation before takeover.
- iOS order: iPhone before iPad; booted before shutdown; newest runtime; usage count; name.
- Android order: running before stopped; physical before AVD within the same group; name.
- No simulator is created implicitly. Use `--device-type "iPhone 17 Pro"` to explicitly create one.

## Build detection

The project's `ios` or `android` script is preferred. If absent or disabled with `--no-script`, rn-iso runs `expo run:*` or `react-native run-*` directly. It detects Expo from scripts/config and walks parent directories for npm, Yarn, pnpm, or Bun lockfiles.

## Development

```sh
npm install
npm test
npm run check
```

Requires Node 22+, Xcode for iOS, and Android SDK tools for Android.
