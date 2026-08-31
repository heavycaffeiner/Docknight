import { noParams } from "../common/validate.ts";
import type { Config } from "./config.ts";
import { method } from "./ws/router.ts";
import type { Conn } from "./ws/conn.ts";
import type { TerminalRegistry } from "./terminal/registry.ts";
import { startUpgrade, upgradeStatus, type UpgradeStatusPayload } from "./upgrade.ts";

declare module "../common/protocol.ts" {
    interface MethodMap {
        "upgrade.status": { params: undefined; result: UpgradeStatusPayload };
        "upgrade.start": { params: undefined; result: { terminal: string } };
    }
}

export function registerUpgradeMethods(config: Readonly<Config>, terminals: TerminalRegistry): void {
    method("upgrade.status", {
        requiresAuth: true,
        routable: false,
        parse: noParams(),
        handle: () => upgradeStatus(config),
    });

    method("upgrade.start", {
        requiresAuth: true,
        routable: false,
        parse: noParams(),
        handle: (conn: Conn) => startUpgrade(config, conn, terminals),
    });
}
