import { readFile, writeFile, chmod } from "node:fs/promises";
import { parseEnv } from "node:util";
import { hashPassword } from "../apps/server/dist/auth.js";

// Read credentials from a private file, never shell arguments or source code.
const access = parseEnv(await readFile(new URL("../deploy/access.env", import.meta.url), "utf8"));
const username = access.MEDDESK_LOGIN_USER, password = access.MEDDESK_LOGIN_PASSWORD;
if (!username || username.length > 128 || !/^[a-zA-Z0-9_.@-]+$/.test(username) || !password || password.length > 256)
  throw new Error("The private access.env needs a valid username and password.");
const settings = new URL("../deploy/server.env", import.meta.url);
const previous = await readFile(settings, "utf8");
const kept = previous.split(/\r?\n/).filter(line => !/^MEDDESK_(LOGIN_USER|PASSWORD_HASH)=/.test(line)).join("\n").trimEnd();
await writeFile(settings, `${kept}\nMEDDESK_LOGIN_USER=${username}\nMEDDESK_PASSWORD_HASH=${await hashPassword(password)}\n`, { mode: 0o600 });
if (process.platform !== "win32") await chmod(settings, 0o600);
console.log("Updated private server.env with the login username and a salted password hash. No credentials printed.");
