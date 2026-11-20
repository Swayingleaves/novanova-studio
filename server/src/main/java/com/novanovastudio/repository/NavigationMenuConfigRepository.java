package com.novanovastudio.repository;

import com.novanovastudio.entity.PlatformNavigationMenuConfigRecords;
import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 平台全局左侧导航菜单配置数据库访问层。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-18 10:55:00
 */
@Repository
@RequiredArgsConstructor
public class NavigationMenuConfigRepository {

    /** 整份配置替换使用的事务级咨询锁键，避免并发保存互相穿插。 */
    private static final String REPLACE_LOCK_KEY = "platform-navigation-menu-configs";

    /** R2DBC 数据库客户端。 */
    private final DatabaseClient databaseClient;

    /**
     * 按排序值读取全部已保存的导航菜单配置。
     *
     * @return 已排序的导航菜单配置流
     */
    public Flux<PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord> listOrdered() {
        return databaseClient.sql("""
                SELECT menu_key, enabled, sort_order, created_at, updated_at
                FROM platform_navigation_menu_configs
                ORDER BY sort_order ASC, menu_key ASC
                """).map((row, metadata) -> mapRecord(row)).all();
    }

    /**
     * 在当前事务内获取整份菜单配置的咨询锁，防止并发保存顺序交错。
     *
     * @return 加锁完成信号
     */
    public Mono<Void> lockForReplace() {
        return databaseClient.sql("SELECT pg_advisory_xact_lock(hashtext(:lockKey))")
                .bind("lockKey", REPLACE_LOCK_KEY)
                .fetch()
                .all()
                .then();
    }

    /**
     * 清空并按序写入整份导航菜单配置，调用方必须保证处于同一事务内。
     *
     * @param records 按展示顺序排列的菜单配置列表
     * @return 写入完成信号
     */
    public Mono<Void> replaceAll(List<PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord> records) {
        return databaseClient.sql("DELETE FROM platform_navigation_menu_configs")
                .fetch()
                .rowsUpdated()
                .thenMany(Flux.fromIterable(records).concatMap(this::insert))
                .then();
    }

    /**
     * 插入单条导航菜单配置记录。
     *
     * @param record 待插入的菜单配置记录
     * @return 插入完成信号
     */
    private Mono<Void> insert(PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord record) {
        return databaseClient.sql("""
                INSERT INTO platform_navigation_menu_configs(menu_key, enabled, sort_order)
                VALUES (:menuKey, :enabled, :sortOrder)
                """)
                .bind("menuKey", record.getMenuKey())
                .bind("enabled", record.getEnabled())
                .bind("sortOrder", record.getSortOrder())
                .fetch()
                .rowsUpdated()
                .then();
    }

    /**
     * 将数据库行映射为导航菜单配置实体。
     *
     * @param row R2DBC 查询行
     * @return 映射后的配置实体
     */
    private PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord mapRecord(io.r2dbc.spi.Row row) {
        PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord record =
                new PlatformNavigationMenuConfigRecords.NavigationMenuConfigRecord();
        record.setMenuKey(row.get("menu_key", String.class));
        record.setEnabled(row.get("enabled", Boolean.class));
        record.setSortOrder(row.get("sort_order", Integer.class));
        record.setCreatedAt(row.get("created_at", OffsetDateTime.class));
        record.setUpdatedAt(row.get("updated_at", OffsetDateTime.class));
        return record;
    }
}
