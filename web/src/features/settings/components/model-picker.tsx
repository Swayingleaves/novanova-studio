"use client";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useId, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Clapperboard } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { App } from "antd";

import { cn } from "@/shared/lib/utils";
import {
    modelOptionLabel,
    modelOptionLabelWithRealName,
    modelOptionName,
    resolveModelRequestConfig,
    selectableModelsByCapability,
    sortModelOptions,
    type AiConfig,
    type ModelCapability,
} from "@/features/settings/stores/use-config-store";
import { groupModelOptionsByChannel, resolveActiveChannelId } from "@/features/settings/lib/model-picker-groups";

import { MODEL_ICON_MONOCHROME_KEYS, isMonochromeModelIcon, resolveModelIcon, resolveModelIconByKey } from "./model-icon";

const MODEL_PICKER_OPEN_EVENT = "model-picker-open";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
    modelOptions?: string[];
    showRealName?: boolean;
    /** 是否在名称后附带渠道名，工具栏等空间紧张的位置传 false。 */
    showChannel?: boolean;
};

export function ModelPicker({
    config,
    value,
    onChange,
    capability,
    className,
    fullWidth = false,
    placeholder = translate("settings.selectModel"),
    onMissingConfig,
    modelOptions,
    showRealName = false,
    showChannel = true,
}: ModelPickerProps) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const [hoveredChannelId, setHoveredChannelId] = useState<string | null>(null);
    const current = value || "";
    const options = useMemo(() => createModelOptions(config, capability, value, modelOptions), [capability, config, modelOptions, value, translate.locale]);
    const channelGroups = useMemo(
        () => groupModelOptionsByChannel(options, config, translate("settings.defaultChannel")),
        [config, options, translate],
    );
    const activeChannelId = resolveActiveChannelId(channelGroups, current, hoveredChannelId);
    const activeGroup = channelGroups.find((group) => group.channelId === activeChannelId) || channelGroups[0];

    const triggerLabel = (model: string) => {
        if (!showChannel) return config.modelDisplayNames?.[model.trim()] || modelOptionName(model);
        return showRealName ? modelOptionLabelWithRealName(config, model) : modelOptionLabel(config, model);
    };

    const itemLabel = (model: string) => {
        const trimmed = model.trim();
        if (showRealName) return modelOptionLabelWithRealName(config, trimmed, false);
        return config.modelDisplayNames?.[trimmed] || modelOptionName(trimmed);
    };

    useEffect(() => {
        const closeWhenOtherPickerOpens = (event: Event) => {
            const activePickerId = event instanceof CustomEvent ? event.detail : "";
            if (activePickerId !== pickerId) setOpen(false);
        };
        window.addEventListener(MODEL_PICKER_OPEN_EVENT, closeWhenOtherPickerOpens);
        return () => window.removeEventListener(MODEL_PICKER_OPEN_EVENT, closeWhenOtherPickerOpens);
    }, [pickerId]);

    const handleOpenChange = (nextOpen: boolean) => {
        if (nextOpen && !options.length) {
            if (onMissingConfig) onMissingConfig();
            else message.warning(translate("settings.contactAdministratorForModel"));
            return;
        }
        if (nextOpen) {
            setHoveredChannelId(null);
            window.dispatchEvent(new CustomEvent(MODEL_PICKER_OPEN_EVENT, { detail: pickerId }));
        }
        setOpen(nextOpen);
    };

    const selectModel = (model: string) => {
        onChange(model);
        setOpen(false);
    };

    return (
        <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
            <PopoverPrimitive.Trigger asChild>
                <button
                    type="button"
                    data-state={open ? "open" : "closed"}
                    className={cn(
                        "canvas-composer-model-picker flex h-8 w-fit max-w-full cursor-pointer items-center justify-between gap-2 rounded-full border border-input bg-transparent px-3 text-sm! font-normal text-foreground! shadow-sm transition-colors outline-none select-none",
                        fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20",
                        "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                        className,
                    )}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    title={current ? triggerLabel(current) : placeholder}
                >
                    <ModelIcon config={config} model={current} />
                    <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? triggerLabel(current) : placeholder}</span>
                    <ChevronDown className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
                </button>
            </PopoverPrimitive.Trigger>
            {open ? (
                <PopoverPrimitive.Portal>
                    <PopoverPrimitive.Content
                        data-canvas-no-zoom
                        data-model-picker-content
                        align="start"
                        side="bottom"
                        sideOffset={6}
                        collisionPadding={12}
                        className="z-[1200] w-[520px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-border/70 bg-popover text-popover-foreground shadow-xl outline-none"
                        onPointerDown={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                    >
                        {channelGroups.length ? (
                            <div className="flex max-h-80 min-h-[180px]">
                                <div className="w-40 shrink-0 overflow-y-auto border-r border-border/60 p-1.5 sm:w-44" role="listbox" aria-label="channels">
                                    {channelGroups.map((group) => {
                                        const active = group.channelId === activeGroup?.channelId;
                                        const containsSelected = Boolean(current && group.models.includes(current));
                                        return (
                                            <button
                                                key={group.channelId}
                                                type="button"
                                                role="option"
                                                aria-selected={active}
                                                className={cn(
                                                    "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm! transition-colors",
                                                    active
                                                        ? "bg-accent font-medium text-accent-foreground!"
                                                        : "text-popover-foreground! hover:bg-accent/60",
                                                )}
                                                onMouseEnter={() => setHoveredChannelId(group.channelId)}
                                                onClick={() => setHoveredChannelId(group.channelId)}
                                            >
                                                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                                                    {containsSelected ? <span className="size-1.5 shrink-0 rounded-full bg-[var(--studio-primary)]" /> : null}
                                                    <span className="truncate">{group.channelName}</span>
                                                </span>
                                                <span className="flex shrink-0 items-center gap-1 text-xs! text-muted-foreground!">
                                                    <span>{group.models.length}</span>
                                                    <ChevronRight className="size-3.5 opacity-70" />
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="min-w-0 flex-1 overflow-y-auto p-1.5" role="listbox" aria-label="models">
                                    {activeGroup?.models.map((model) => {
                                        const selected = model === current;
                                        const description = config.modelDescriptions?.[model.trim()];
                                        return (
                                            <button
                                                key={model}
                                                type="button"
                                                role="option"
                                                aria-selected={selected}
                                                className={cn(
                                                    "flex w-full cursor-pointer flex-col rounded-lg px-2.5 py-2 text-left transition-colors",
                                                    selected
                                                        ? "bg-accent text-accent-foreground!"
                                                        : "text-popover-foreground! hover:bg-accent/60",
                                                )}
                                                onClick={() => selectModel(model)}
                                            >
                                                <span className="flex w-full min-w-0 items-center gap-2">
                                                    <ModelIcon config={config} model={model} />
                                                    <span className="min-w-0 flex-1 truncate text-sm! font-medium">{itemLabel(model)}</span>
                                                    {selected ? <Check className="size-4 shrink-0 text-[var(--studio-primary)]" /> : null}
                                                </span>
                                                {description ? (
                                                    <span
                                                        className="mt-1 line-clamp-2 pl-7 text-xs! leading-4 break-words text-muted-foreground!"
                                                        title={description}
                                                    >
                                                        {description}
                                                    </span>
                                                ) : null}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                                {translate("settings.contactAdministratorForModel")}
                            </div>
                        )}
                    </PopoverPrimitive.Content>
                </PopoverPrimitive.Portal>
            ) : null}
        </PopoverPrimitive.Root>
    );
}

function createModelOptions(config: AiConfig, capability: ModelCapability | undefined, value: string | undefined, modelOptions?: string[]) {
    const retainedLocalValue = config.channelMode === "local" && !capability ? [value] : [];
    const configured = selectableModelsByCapability(config, capability);
    const filtered = modelOptions ? configured.filter((model) => modelOptions.includes(model)) : configured;
    return sortModelOptions([...retainedLocalValue, ...filtered].filter(isFilledText), config);
}

function isFilledText(value: string | undefined): value is string {
    return Boolean(value?.trim());
}

/** 模型图标：优先使用管理端配置的图标，其次按模型名和接口格式自动匹配。 */
export function ModelIcon({ config, model }: { config: AiConfig; model: string }) {
    const modelName = model ? modelOptionName(model) : "";
    const apiFormat = model ? resolveModelRequestConfig(config, model).apiFormat : undefined;
    const configuredKey = model ? config.modelIcons?.[model] : undefined;
    const icon = configuredKey ? resolveModelIconByKey(configuredKey) : model ? resolveModelIcon(modelName, apiFormat) : "";
    const monochrome = configuredKey ? MODEL_ICON_MONOCHROME_KEYS.has(configuredKey) : model ? isMonochromeModelIcon(modelName, apiFormat) : false;
    const qwenIcon = icon === "/icons/qwen.svg";

    return (
        <span className={cn("model-picker-icon flex size-5 shrink-0 items-center justify-center rounded-md", monochrome && "model-picker-icon-monochrome", qwenIcon && "model-icon-qwen")}>
            {icon ? <img src={icon} alt="" className={cn("size-4", qwenIcon && "model-icon-qwen")} /> : <Clapperboard className="size-4 opacity-70" />}
        </span>
    );
}
