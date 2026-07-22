"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import type { EChartsCoreOption } from "echarts/core";
import { BarChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

import { useThemeStore } from "@/features/theme/stores/use-theme-store";

echarts.use([BarChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type CreditChartDataItem = {
    name: string;
    value: number;
};

type CreditChartProps = {
    type: "pie" | "bar";
    data: CreditChartDataItem[];
    ariaLabel: string;
};

type ChartTheme = {
    action: string;
    accent: string;
    info: string;
    success: string;
    warning: string;
    text: string;
    muted: string;
    line: string;
    surface: string;
};

/**
 * 渲染积分统计图表。
 *
 * @param props 图表类型、数据和无障碍说明
 * @return 图表容器
 */
export function CreditChart({ type, data, ariaLabel }: CreditChartProps) {
    const chartElementReference = useRef<HTMLDivElement>(null);
    const resolvedTheme = useThemeStore((state) => state.resolvedTheme);

    useEffect(() => {
        const chartElement = chartElementReference.current;
        if (!chartElement) return;

        const chart = echarts.init(chartElement);
        const theme = readChartTheme(chartElement);
        chart.setOption(type === "pie" ? createPieOption(data, theme) : createBarOption(data, theme));
        const resizeObserver = new ResizeObserver(() => chart.resize());
        resizeObserver.observe(chartElement);
        return () => {
            resizeObserver.disconnect();
            chart.dispose();
        };
    }, [ariaLabel, data, resolvedTheme, type]);

    return <div ref={chartElementReference} className="h-72 w-full" role="img" aria-label={ariaLabel} />;
}

/**
 * 读取当前主题图表颜色。
 *
 * @param element 图表容器
 * @return 当前主题图表颜色
 */
function readChartTheme(element: HTMLElement): ChartTheme {
    const styles = getComputedStyle(element);
    return {
        action: styles.getPropertyValue("--studio-action").trim(),
        accent: styles.getPropertyValue("--studio-accent").trim(),
        info: styles.getPropertyValue("--studio-info").trim(),
        success: styles.getPropertyValue("--studio-success").trim(),
        warning: styles.getPropertyValue("--studio-warning").trim(),
        text: styles.getPropertyValue("--studio-text").trim(),
        muted: styles.getPropertyValue("--studio-muted").trim(),
        line: styles.getPropertyValue("--studio-line").trim(),
        surface: styles.getPropertyValue("--studio-surface").trim(),
    };
}

/**
 * 创建积分分布扇形图配置。
 *
 * @param data 图表数据
 * @param theme 当前主题颜色
 * @return ECharts 配置
 */
function createPieOption(data: CreditChartDataItem[], theme: ChartTheme): EChartsCoreOption {
    return {
        backgroundColor: "transparent",
        color: [theme.action, theme.accent, theme.info, theme.success, theme.warning],
        tooltip: {
            trigger: "item",
            backgroundColor: theme.surface,
            borderColor: theme.line,
            textStyle: { color: theme.text },
            valueFormatter: (value: string | number) => `${Number(value).toLocaleString("zh-CN")} 积分`,
        },
        legend: {
            type: "scroll",
            bottom: 0,
            textStyle: { color: theme.muted },
        },
        series: [{
            type: "pie",
            radius: ["42%", "72%"],
            center: ["50%", "44%"],
            avoidLabelOverlap: true,
            label: { color: theme.text, formatter: "{b}\n{d}%" },
            labelLine: { lineStyle: { color: theme.line } },
            emphasis: { scale: true, scaleSize: 5 },
            data,
        }],
    };
}

/**
 * 创建积分消耗柱状图配置。
 *
 * @param data 图表数据
 * @param theme 当前主题颜色
 * @return ECharts 配置
 */
function createBarOption(data: CreditChartDataItem[], theme: ChartTheme): EChartsCoreOption {
    return {
        backgroundColor: "transparent",
        tooltip: {
            trigger: "axis",
            backgroundColor: theme.surface,
            borderColor: theme.line,
            textStyle: { color: theme.text },
            valueFormatter: (value: string | number) => `${Number(value).toLocaleString("zh-CN")} 积分`,
        },
        grid: { left: 12, right: 12, top: 18, bottom: 32, containLabel: true },
        xAxis: {
            type: "category",
            data: data.map((item) => item.name),
            axisTick: { show: false },
            axisLine: { lineStyle: { color: theme.line } },
            axisLabel: { color: theme.muted, hideOverlap: true },
        },
        yAxis: {
            type: "value",
            minInterval: 1,
            splitLine: { lineStyle: { color: theme.line } },
            axisLabel: { color: theme.muted },
        },
        series: [{
            type: "bar",
            data: data.map((item) => item.value),
            barMaxWidth: 36,
            itemStyle: { color: theme.action, borderRadius: [4, 4, 0, 0] },
        }],
    };
}
