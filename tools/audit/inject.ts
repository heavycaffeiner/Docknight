import { auditRun } from "./index.ts";
import { RULES } from "./rules/index.ts";

/** The bundle Playwright injects. page.evaluate reaches the runner through these globals. */
const target = globalThis as unknown as {
    __docknightAudit?: typeof auditRun;
    __docknightRules?: string[];
};

target.__docknightAudit = auditRun;
target.__docknightRules = RULES.map((rule) => rule.name);
