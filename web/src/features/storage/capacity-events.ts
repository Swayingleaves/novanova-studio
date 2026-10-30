/** 文件变化通知与容量查询分离，API模块不依赖组件或查询客户端。 */
export const storageCapacityChangedEvent = "novanova:storage-capacity-changed";

/** 通知当前浏览器空间重新获取容量，服务端调用时不产生副作用。 */
export function notifyStorageCapacityChanged() {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(storageCapacityChangedEvent));
}
