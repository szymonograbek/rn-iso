# rn-iso

A local CLI for isolated React Native development environments. Each project gets its own Metro port and device assignment.

## Install

```sh
cd ~/dev/rn-iso
npm install
npm run build
npm link
```

## Usage

Run from a React Native project:

```sh
rn-iso ios --auto --managed-metro
rn-iso android --auto --managed-metro
rn-iso device --platform ios --json
rn-iso status
```

`rn-iso` starts Metro on the project’s assigned port, configures the native app to reach it, and launches the app on its assigned device.

State and Metro logs live under `~/.rn-iso/` by default. Set `RN_ISO_HOME` to use another location.
