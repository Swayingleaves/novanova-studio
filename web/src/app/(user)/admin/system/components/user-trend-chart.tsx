"use client";

import { currentLanguageTag } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";
import { useThemeStore } from "@/features/theme/stores/use-theme-store";
import type { UserTrendPoint } from "@/services/api/server";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import type { EChartsCoreOption } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type ChartTheme = {
    action: string;
    warning: string;
    text: string;
    muted: string;
    line: string;
    surface: string;
};

type UserTrendChartProps = {
    points: UserTrendPoint[];
    ariaLabel: string;
};

/**
 * 渲染用户数量与每日增量折线图。
 *
 * @param props 每日趋势数据与无障碍说明
 * @return 图表容器
 */
export function UserTrendChart({ points, ariaLabel }: UserTrendChartProps) {
    const chartElementReference = useRef<HTMLDivElement>(null);
    const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
    const translate = useTranslation();
    const locale = translate.locale;

    useEffect(() => {
        const chartElement = chartElementReference.current;
        if (!chartElement) return;

        const chart = echarts.init(chartElement);
        chart.setOption(
            createTrendOption(points, readChartTheme(chartElement), {
                totalUsers: translate("administration.userCount"),
                dailyNewUsers: translate("administration.dailyUserIncrement"),
            }),
        );
        const resizeObserver = new ResizeObserver(() => chart.resize());
        resizeObserver.observe(chartElement);
        return () => {
            resizeObserver.disconnect();
            chart.dispose();
        };
    }, [ariaLabel, locale, points, resolvedTheme, translate]);

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
        warning: styles.getPropertyValue("--studio-warning").trim(),
        text: styles.getPropertyValue("--studio-text").trim(),
        muted: styles.getPropertyValue("--studio-muted").trim(),
        line: styles.getPropertyValue("--studio-line").trim(),
        surface: styles.getPropertyValue("--studio-surface").trim(),
    };
}

/**
 * 创建用户趋势折线图配置：累计用户走左轴，每日增量走右轴。
 *
 * @param points 每日趋势数据
 * @param theme 当前主题颜色
 * @param labels 两条曲线的名称
 * @return ECharts 配置
 */
function createTrendOption(points: UserTrendPoint[], theme: ChartTheme, labels: { totalUsers: string; dailyNewUsers: string }): EChartsCoreOption {
    // 只有一个或两个数据点时折线不可见，直接显示圆点
    const showSymbol = points.length <= 2;
    return {
        backgroundColor: "transparent",
        tooltip: {
            trigger: "axis",
            backgroundColor: theme.surface,
            borderColor: theme.line,
            textStyle: { color: theme.text },
            valueFormatter: (value: string | number) => Number(value).toLocaleString(currentLanguageTag()),
        },
        legend: {
            bottom: 0,
            itemWidth: 12,
            itemHeight: 8,
            textStyle: { color: theme.muted },
        },
        grid: { left: 8, right: 8, top: 24, bottom: 44, containLabel: true },
        xAxis: {
            type: "category",
            boundaryGap: false,
            data: points.map((item) => item.date.slice(5)),
            axisTick: { show: false },
            axisLine: { lineStyle: { color: theme.line } },
            axisLabel: { color: theme.muted, hideOverlap: true },
        },
        yAxis: [
            {
                type: "value",
                minInterval: 1,
                splitLine: { lineStyle: { color: theme.line } },
                axisLabel: { color: theme.muted },
            },
            {
                type: "value",
                minInterval: 1,
                splitLine: { show: false },
                axisLabel: { color: theme.muted },
            },
        ],
        series: [
            {
                name: labels.totalUsers,
                type: "line",
                yAxisIndex: 0,
                smooth: true,
                showSymbol,
                lineStyle: { width: 2, color: theme.action },
                itemStyle: { color: theme.action },
                areaStyle: { color: theme.action, opacity: 0.08 },
                data: points.map((item) => item.totalUsers),
            },
            {
                name: labels.dailyNewUsers,
                type: "line",
                yAxisIndex: 1,
                smooth: true,
                showSymbol,
                lineStyle: { width: 2, color: theme.warning },
                itemStyle: { color: theme.warning },
                data: points.map((item) => item.newUsers),
            },
        ],
    };
}
