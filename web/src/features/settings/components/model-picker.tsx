"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Cpu } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";
import { modelOptionLabel, modelOptionName, resolveModelRequestConfig, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/features/settings/stores/use-config-store";

import { isMonochromeModelIcon, resolveModelIcon } from "./model-icon";

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
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder = "选择模型", onMissingConfig, modelOptions }: ModelPickerProps) {
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const current = value || "";
    const options = useMemo(() => createModelOptions(config, capability, value, modelOptions), [capability, config, modelOptions, value]);

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
            onMissingConfig?.();
        }
        if (nextOpen) {
            window.dispatchEvent(new CustomEvent(MODEL_PICKER_OPEN_EVENT, { detail: pickerId }));
        }
        setOpen(nextOpen);
    };

    return (
        <Select open={open} value={current} onOpenChange={handleOpenChange} onValueChange={onChange}>
            <SelectTrigger
                className={cn(
                    "canvas-composer-model-picker h-8 w-fit max-w-full gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={current ? modelOptionLabel(config, current) : placeholder}
            >
                <ModelIcon config={config} model={current} />
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? modelOptionLabel(config, current) : placeholder}</span>
            </SelectTrigger>
            {open ? (
                <SelectContent
                    data-canvas-no-zoom
                    className="z-[1200] w-80 max-w-[calc(100vw-24px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl"
                    position="popper"
                    align="start"
                    side="bottom"
                    sideOffset={6}
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    {options.length ? (
                        options.map((model) => <SelectItem key={model} value={model} textValue={modelOptionLabel(config, model)} label={<ModelLabel config={config} model={model} />} />)
                    ) : (
                        <SelectItem value="__empty__" disabled textValue={emptyModelLabel(config, capability)}>
                            {emptyModelLabel(config, capability)}
                        </SelectItem>
                    )}
                </SelectContent>
            ) : null}
        </Select>
    );
}

function createModelOptions(config: AiConfig, capability: ModelCapability | undefined, value: string | undefined, modelOptions?: string[]) {
    const retainedLocalValue = config.channelMode === "local" && !capability ? [value] : [];
    const configured = selectableModelsByCapability(config, capability);
    const filtered = modelOptions ? configured.filter((model) => modelOptions.includes(model)) : configured;
    return Array.from(new Set([...retainedLocalValue, ...filtered].filter(isFilledText)));
}

function isFilledText(value: string | undefined): value is string {
    return Boolean(value?.trim());
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability): string {
    if (capability && config.models.length) return "请先在上方配置可选模型";
    if (!config.models.length) return "请先到配置里添加渠道和模型";
    const label = capabilityLabel(capability);
    return label ? `暂无匹配的${label}模型` : "暂无可用模型";
}

function capabilityLabel(capability?: ModelCapability): string {
    switch (capability) {
        case "image":
            return "生图";
        case "video":
            return "视频";
        case "text":
            return "文本";
        default:
            return "";
    }
}

function ModelLabel({ config, model }: { config: AiConfig; model: string }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ModelIcon config={config} model={model} />
            <span className="truncate">{modelOptionLabel(config, model)}</span>
        </span>
    );
}

function ModelIcon({ config, model }: { config: AiConfig; model: string }) {
    const modelName = model ? modelOptionName(model) : "";
    const apiFormat = model ? resolveModelRequestConfig(config, model).apiFormat : undefined;
    const icon = model ? resolveModelIcon(modelName, apiFormat) : "";
    const monochrome = model ? isMonochromeModelIcon(modelName, apiFormat) : false;

    return (
        <span className={cn("model-picker-icon flex size-5 shrink-0 items-center justify-center rounded-md", monochrome && "model-picker-icon-monochrome")}>
            {icon ? <img src={icon} alt="" className="size-4" /> : <Cpu className="size-4 opacity-70" />}
        </span>
    );
}
