import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 合并多个 className 输入，解决 Tailwind 工具类冲突。
 * <p>
 * 先用 clsx 把任意形态的输入归一为字符串，再交给 tailwind-merge 去掉相互冲突的类（后者覆盖前者）。
 *
 * @param inputs 类名，可为字符串、数组、对象或假值
 * @return 去重冲突后的单个 className 字符串
 */
export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
