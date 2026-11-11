import { ReactElement } from "react";

/** The six-dot grip: two columns of three dots, drawn in the current text colour. */
export function Grip(): ReactElement {
    return (
        <svg className="dragdrop-grip" viewBox="0 0 10 16" aria-hidden="true" focusable="false">
            <circle cx="2.5" cy="3" r="1.5" />
            <circle cx="7.5" cy="3" r="1.5" />
            <circle cx="2.5" cy="8" r="1.5" />
            <circle cx="7.5" cy="8" r="1.5" />
            <circle cx="2.5" cy="13" r="1.5" />
            <circle cx="7.5" cy="13" r="1.5" />
        </svg>
    );
}
