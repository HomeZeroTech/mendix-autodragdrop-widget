/**
 * This file was generated from DragDrop.xml
 * WARNING: All changes made to this file will be overwritten
 * @author Mendix Widgets Framework Team
 */
import { ActionValue, DynamicValue, EditableValue, Option } from "mendix";
import { ComponentType, CSSProperties, ReactNode } from "react";
import { Big } from "big.js";

export type AdvancedEnum = "no" | "yes";

export type RoleEnum = "handle" | "zone";

export type DragByEnum = "row" | "handle";

export type SequencingEnum = "automatic" | "manual";

export type ZoneTargetEnum = "selector" | "content";

export type AnimationFlowEnum = "easeInOut" | "easeIn" | "easeOut" | "linear";

export interface DragDropContainerProps {
    name: string;
    class: string;
    style?: CSSProperties;
    tabIndex?: number;
    advanced: AdvancedEnum;
    role: RoleEnum;
    group: string;
    disabled?: DynamicValue<boolean>;
    sortAttribute?: EditableValue<Big>;
    dragBy: DragByEnum;
    showHandle: boolean;
    sequencing: SequencingEnum;
    itemKey?: DynamicValue<string>;
    rowSelector: string;
    handleLabel?: DynamicValue<string>;
    zoneKey?: DynamicValue<string>;
    zoneTarget: ZoneTargetEnum;
    targetSelector: string;
    content?: ReactNode;
    animateChanges: boolean;
    duration: number;
    animationFlow: AnimationFlowEnum;
    onDrop?: ActionValue<{
        newIndex: Option<Big>;
        newSortValue: Option<Big>;
        toZoneKey: Option<string>;
        fromZoneKey: Option<string>;
        afterKey: Option<string>;
        beforeKey: Option<string>;
    }>;
    onZoneDrop?: ActionValue<{
        draggedKey: Option<string>;
        fromZoneKey: Option<string>;
        afterKey: Option<string>;
        beforeKey: Option<string>;
        newIndex: Option<Big>;
        newSortValue: Option<Big>;
    }>;
}

export interface DragDropPreviewProps {
    /**
     * @deprecated Deprecated since version 9.18.0. Please use class property instead.
     */
    className: string;
    class: string;
    style: string;
    styleObject?: CSSProperties;
    readOnly: boolean;
    renderMode: "design" | "xray" | "structure";
    translate: (text: string) => string;
    advanced: AdvancedEnum;
    role: RoleEnum;
    group: string;
    disabled: string;
    sortAttribute: string;
    dragBy: DragByEnum;
    showHandle: boolean;
    sequencing: SequencingEnum;
    itemKey: string;
    rowSelector: string;
    handleLabel: string;
    zoneKey: string;
    zoneTarget: ZoneTargetEnum;
    targetSelector: string;
    content: { widgetCount: number; renderer: ComponentType<{ children: ReactNode; caption?: string }> };
    animateChanges: boolean;
    duration: number | null;
    animationFlow: AnimationFlowEnum;
    onDrop: {} | null;
    onZoneDrop: {} | null;
}
