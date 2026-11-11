import { ReactElement } from "react";
import { DragDropPreviewProps } from "../typings/DragDropProps";
import { Grip } from "./components/Grip";

/** What Studio Pro shows in design mode. */
export function preview(props: DragDropPreviewProps): ReactElement {
    if (props.role === "zone" && props.zoneTarget === "selector") {
        // Nothing is drawn in the app; in the editor a small tag says which element is the drop zone.
        return (
            <span
                style={{
                    display: "inline-block",
                    padding: "1px 6px",
                    border: "1px dashed #98a2b3",
                    borderRadius: 4,
                    color: "#667085",
                    font: "11px/16px sans-serif",
                    whiteSpace: "nowrap"
                }}
            >
                Drop zone: {props.targetSelector.trim() || "no element chosen"}
            </span>
        );
    }
    if (props.role === "zone") {
        const Content = props.content.renderer;
        return (
            <div className="dragdrop-zone">
                <Content>
                    <div style={{ width: "100%" }} />
                </Content>
            </div>
        );
    }
    // Without dots the widget shows nothing in the app; in the editor a faint grip keeps it selectable.
    const hiddenInApp = props.dragBy === "row" && !props.showHandle;
    return (
        <span className="dragdrop-handle" style={hiddenInApp ? { opacity: 0.4 } : undefined}>
            <Grip />
        </span>
    );
}

export function getPreviewCss(): string {
    return require("./ui/DragDrop.css");
}
