import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const groups = sqliteTable("groups", {
  id: text().primaryKey(),
  name: text().notNull(),
});

export const members = sqliteTable("group_members", {
  spaceId: text("space_id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
});

export const overrides = sqliteTable(
  "hierarchy_overrides",
  {
    parentSpaceId: text("parent_space_id").notNull(),
    childSpaceId: text("child_space_id").notNull(),
    manages: integer({ mode: "boolean" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.parentSpaceId, table.childSpaceId] }),
  ],
);

export const settings = sqliteTable("settings", {
  key: text().primaryKey(),
  value: integer({ mode: "boolean" }).notNull(),
});

export const buildingNames = sqliteTable("building_names", {
  id: text().primaryKey(),
  name: text().notNull(),
});
