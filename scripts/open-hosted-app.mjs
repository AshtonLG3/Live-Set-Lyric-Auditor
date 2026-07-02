import { spawn } from "node:child_process";

const appUrl = process.env.LSLA_APP_URL || process.env.PUBLIC_APP_URL || "https://lsla.mangezi.xyz";

const commandByPlatform = {
  win32: { command: "cmd", args: ["/c", "start", "", appUrl] },
  darwin: { command: "open", args: [appUrl] },
  linux: { command: "xdg-open", args: [appUrl] }
};

const launcher = commandByPlatform[process.platform] ?? commandByPlatform.linux;
const child = spawn(launcher.command, launcher.args, {
  detached: true,
  stdio: "ignore"
});

child.unref();
console.log(`Opening ${appUrl}`);
