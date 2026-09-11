import type { ReactElement } from "react";

export default function PageFallback(): ReactElement {
    return (
        <div className="page center-block">
            <mdui-circular-progress />
        </div>
    );
}
