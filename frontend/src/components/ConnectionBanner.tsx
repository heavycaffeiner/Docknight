import type { ReactElement } from "react";
import { useT } from "../lib/i18n.ts";
import { useStore } from "../lib/store.ts";
import { connection } from "../lib/transport.ts";

export default function ConnectionBanner(): ReactElement | null {
    const { t } = useT();
    const { degraded, phase } = useStore(connection);
    if (!degraded || phase === "connected" || phase === "authed") return null;

    return (
        <div className="banner type-label-medium" role="status">
            <mdui-icon name="cloud_off--outlined" />
            {t("connection.degraded")}
        </div>
    );
}
