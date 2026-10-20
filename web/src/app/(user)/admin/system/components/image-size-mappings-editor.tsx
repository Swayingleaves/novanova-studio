"use client";

import { Button, Input, Table } from "antd";
import { useTranslation } from "@/features/locale/use-translation";
import { cloneImageSizeMappings, IMAGE_ASPECT_RATIOS, IMAGE_RESOLUTIONS, isValidImagePixelSize, type ImageSizeMappings } from "@/features/generation/lib/image-size-mappings";

/** 编辑当前模型各比例与分辨率对应的像素尺寸。 */
export function ImageSizeMappingsEditor({ value, onChange }: { value: ImageSizeMappings; onChange: (mappings: ImageSizeMappings) => void }) {
    const translate = useTranslation();
    const ratios = [...new Set([...IMAGE_ASPECT_RATIOS, ...Object.keys(value)])];
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
                <span className="text-sm">{translate("appShell.imageSizeMappings")}</span>
                <Button size="small" onClick={() => onChange(cloneImageSizeMappings())}>{translate("appShell.restoreDefaultImageSizes")}</Button>
            </div>
            <p className="text-xs text-[var(--studio-muted)]">{translate("appShell.imageSizeMappingsDescription")}</p>
            <Table
                size="small"
                rowKey="ratio"
                pagination={false}
                scroll={{ x: 500, y: 360 }}
                dataSource={ratios.map((ratio) => ({ ratio }))}
                columns={[
                    { title: translate("generation.aspectRatio"), dataIndex: "ratio", width: 70 },
                    ...IMAGE_RESOLUTIONS.map((resolution) => ({
                        title: resolution,
                        render: (_: unknown, { ratio }: { ratio: string }) => {
                            const pixels = value[ratio]?.[resolution] ?? "";
                            return <Input
                                size="small"
                                className="w-full! font-mono"
                                aria-label={translate("appShell.imageSizeMappingInputLabel", { value0: ratio, value1: resolution })}
                                placeholder={translate("appShell.imageSizeNotConfigured")}
                                value={pixels}
                                status={isValidImagePixelSize(pixels) ? undefined : "error"}
                                onChange={(event) => onChange({ ...value, [ratio]: { ...value[ratio], [resolution]: event.target.value } })}
                            />;
                        },
                    })),
                ]}
            />
        </div>
    );
}
