import { hidePropertiesIn, Properties } from "@mendix/pluggable-widgets-tools";
import { DragDropPreviewProps } from "../typings/DragDropProps";

/**
 * Shows only the properties that belong to the chosen role.
 *
 * Keep every rule a plain `if (values.x === "literal")` with a literal list of keys. Studio Pro reports CE0463
 * ("the definition of this widget has changed") for a widget that stores a value in a hidden property, and mxcli
 * reads these rules from this file to know which properties to leave empty when it writes a widget. It only
 * recognises this simple shape (`mxcli widget describe dragdrop -p <app.mpr>` lists the rules it found).
 */
export function getProperties(values: DragDropPreviewProps, defaultProperties: Properties): Properties {
    if (values.role === "zone") {
        hidePropertiesIn(defaultProperties, values, [
            "dragBy",
            "showHandle",
            "sortValue",
            "itemKey",
            "rowSelector",
            "handleLabel",
            "duration",
            "animationFlow",
            "onDrop"
        ]);
    }
    if (values.role === "handle") {
        hidePropertiesIn(defaultProperties, values, ["zoneKey", "zoneTarget", "targetSelector", "content", "onZoneDrop"]);
    }
    // A drop zone is one or the other: an element around the widget, or the widget's own content.
    if (values.zoneTarget === "selector") {
        hidePropertiesIn(defaultProperties, values, ["content"]);
    }
    if (values.zoneTarget === "content") {
        hidePropertiesIn(defaultProperties, values, ["targetSelector"]);
    }
    if (values.dragBy === "handle") {
        // The dots are the only way to drag then, so they are always shown.
        hidePropertiesIn(defaultProperties, values, ["showHandle"]);
    } else if (!values.showHandle) {
        hidePropertiesIn(defaultProperties, values, ["handleLabel"]);
    }
    return defaultProperties;
}

interface Problem {
    property?: string;
    severity?: "error" | "warning" | "deprecation";
    message: string;
}

/** Shown in Studio Pro's error list. */
export function check(values: DragDropPreviewProps): Problem[] {
    if (values.role === "zone" && values.zoneTarget === "selector" && !values.targetSelector.trim()) {
        return [
            {
                property: "targetSelector",
                message:
                    "Fill in 'Element (CSS selector)', or set 'Drop zone is' to 'The content of this widget' and place the list in the widget."
            }
        ];
    }
    return [];
}
