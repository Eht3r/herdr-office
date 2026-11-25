import {
  type Group,
  type HierarchyOverride,
  type Placement,
  type RoomKind,
  roomKinds,
} from "@herdr-office/core";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  buildingNames,
  groups,
  members,
  overrides,
  settings,
} from "./schema.ts";

const defaultKey = "hierarchy.defaultWhenUnknown";

export class GroupConflict extends Error {
  readonly statusCode = 409;
}

export class OrganizationStore {
  private readonly sqlite;
  private readonly db;

  constructor(path: string) {
    this.sqlite = new Database(path);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS group_members (
        space_id TEXT PRIMARY KEY NOT NULL,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS group_members_group_id ON group_members(group_id);
      CREATE TABLE IF NOT EXISTS hierarchy_overrides (
        parent_space_id TEXT NOT NULL,
        child_space_id TEXT NOT NULL,
        manages INTEGER NOT NULL CHECK (manages IN (0, 1)),
        PRIMARY KEY (parent_space_id, child_space_id)
      );
      CREATE TABLE IF NOT EXISTS building_names (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS building_placements (
        id TEXT PRIMARY KEY NOT NULL,
        site TEXT,
        room_kind TEXT,
        room_name TEXT
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value INTEGER NOT NULL);
    `);
    this.db = drizzle({ client: this.sqlite });
  }

  /** Saved placements by public building id; unset fields keep their defaults. */
  listPlacements(): Record<string, Partial<Placement>> {
    const placements: Record<string, Partial<Placement>> = {};
    // Names saved before placements existed become the site name.
    for (const { id, name } of this.db.select().from(buildingNames).all())
      placements[id] = { site: name };
    const rows = this.sqlite
      .prepare("SELECT id, site, room_kind, room_name FROM building_placements")
      .all() as {
      id: string;
      site: string | null;
      room_kind: string | null;
      room_name: string | null;
    }[];
    for (const row of rows) {
      placements[row.id] = {
        ...(row.site ? { site: row.site } : {}),
        ...(isRoomKind(row.room_kind) ? { roomKind: row.room_kind } : {}),
        ...(row.room_name ? { roomName: row.room_name } : {}),
      };
    }
    return placements;
  }

  setPlacement(id: string, placement: Partial<Placement>): void {
    this.sqlite
      .prepare(
        `INSERT INTO building_placements (id, site, room_kind, room_name)
         VALUES (@id, @site, @roomKind, @roomName)
         ON CONFLICT(id) DO UPDATE SET
           site = excluded.site,
           room_kind = excluded.room_kind,
           room_name = excluded.room_name`,
      )
      .run({
        id,
        site: placement.site ?? null,
        roomKind: placement.roomKind ?? null,
        roomName: placement.roomName ?? null,
      });
    this.db.delete(buildingNames).where(eq(buildingNames.id, id)).run();
  }

  close(): void {
    this.sqlite.close();
  }

  listGroups(): Group[] {
    const membership = this.db
      .select()
      .from(members)
      .orderBy(members.spaceId)
      .all();
    const byGroup = new Map<string, string[]>();
    for (const member of membership) {
      const ids = byGroup.get(member.groupId) ?? [];
      ids.push(member.spaceId);
      byGroup.set(member.groupId, ids);
    }
    return this.db
      .select()
      .from(groups)
      .orderBy(groups.id)
      .all()
      .map((group) => ({ ...group, spaceIds: byGroup.get(group.id) ?? [] }));
  }

  saveGroup(group: Group): Group {
    const { id, name, spaceIds } = group;
    try {
      this.db.transaction((tx) => {
        tx.insert(groups)
          .values({ id, name })
          .onConflictDoUpdate({ target: groups.id, set: { name } })
          .run();
        tx.delete(members).where(eq(members.groupId, id)).run();
        if (spaceIds.length) {
          tx.insert(members)
            .values(spaceIds.map((spaceId) => ({ groupId: id, spaceId })))
            .run();
        }
      });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
          error.code === "SQLITE_CONSTRAINT_UNIQUE")
      ) {
        throw new GroupConflict("A space can belong to only one group", {
          cause: error,
        });
      }
      throw error;
    }
    return group;
  }

  deleteGroup(id: string): boolean {
    return this.db.delete(groups).where(eq(groups.id, id)).run().changes > 0;
  }

  listOverrides(): HierarchyOverride[] {
    return this.db
      .select()
      .from(overrides)
      .orderBy(overrides.parentSpaceId, overrides.childSpaceId)
      .all();
  }

  saveOverride(rule: HierarchyOverride): HierarchyOverride {
    this.db
      .insert(overrides)
      .values(rule)
      .onConflictDoUpdate({
        target: [overrides.parentSpaceId, overrides.childSpaceId],
        set: { manages: rule.manages },
      })
      .run();
    return rule;
  }

  deleteOverride(parentSpaceId: string, childSpaceId: string): boolean {
    return (
      this.db
        .delete(overrides)
        .where(
          and(
            eq(overrides.parentSpaceId, parentSpaceId),
            eq(overrides.childSpaceId, childSpaceId),
          ),
        )
        .run().changes > 0
    );
  }

  defaultWhenUnknown(): boolean {
    return (
      this.db.select().from(settings).where(eq(settings.key, defaultKey)).get()
        ?.value ?? true
    );
  }

  setDefaultWhenUnknown(value: boolean): void {
    this.db
      .insert(settings)
      .values({ key: defaultKey, value })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value },
      })
      .run();
  }
}

function isRoomKind(value: string | null): value is RoomKind {
  return (roomKinds as readonly (string | null)[]).includes(value);
}
