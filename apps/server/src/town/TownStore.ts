import type { BusinessKind, TownStory } from "@herdr-office/core";
import Database from "better-sqlite3";
import { type Business, businessAccount, planDelivery } from "./business.ts";

const reserve = "town:temporary-fund";

export interface TownFunding {
  initial: number;
  weekly: number;
  reserve: number;
}
export const defaultFunding: TownFunding = {
  initial: 55_000,
  weekly: 35_000,
  reserve: 10_000_000_000,
};
const residentFunding = { initial: 42_000, weekly: 45_000 };

function safeNonnegative(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function fundingFromEnv(env: NodeJS.ProcessEnv): TownFunding {
  const value = (name: string, fallback: number) => {
    const raw = env[name];
    const number = raw === undefined ? fallback : Number(raw);
    if (!safeNonnegative(number))
      throw new RangeError(`${name} must be a nonnegative integer`);
    return number;
  };
  return {
    initial: value("OFFICE_TOWN_INITIAL_BALANCE", defaultFunding.initial),
    weekly: value("OFFICE_TOWN_WEEKLY_DEPOSIT", defaultFunding.weekly),
    reserve: value("OFFICE_TOWN_FUNDING_RESERVE", defaultFunding.reserve),
  };
}

export interface Purchase {
  id: string;
  buyerId: string;
  name: string;
  actor: "employee" | "resident";
  slotId: string;
  date: string;
  at: number;
  productId: string;
}

interface Account {
  balance: number;
}
interface Patron {
  name: string;
  visits: number;
}

export class TownStore {
  private readonly db;
  private readonly sql;

  constructor(
    path: string,
    private readonly funding = defaultFunding,
  ) {
    if (
      ![funding.initial, funding.weekly, funding.reserve].every(safeNonnegative)
    )
      throw new RangeError("Invalid synthetic town funding amounts");
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS town_shop (slot_id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS town_account (id TEXT PRIMARY KEY, balance INTEGER NOT NULL CHECK(balance >= 0));
      CREATE TABLE IF NOT EXISTS town_transfer (
        id TEXT PRIMARY KEY, debit TEXT NOT NULL REFERENCES town_account(id), credit TEXT NOT NULL REFERENCES town_account(id),
        amount INTEGER NOT NULL CHECK(amount > 0), day TEXT NOT NULL, at INTEGER NOT NULL, category TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS town_transfer_credit_day ON town_transfer(credit, day, category);
      CREATE TABLE IF NOT EXISTS town_funding_week (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS town_attempt (id TEXT PRIMARY KEY, kind TEXT NOT NULL, day TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS town_attempt_date ON town_attempt(day);
      CREATE TABLE IF NOT EXISTS town_patron (
        shop_account TEXT NOT NULL, buyer_id TEXT NOT NULL, name TEXT NOT NULL, actor TEXT NOT NULL, visits INTEGER NOT NULL,
        PRIMARY KEY(shop_account,buyer_id)
      );
      CREATE TABLE IF NOT EXISTS town_story (id TEXT PRIMARY KEY, day TEXT NOT NULL, at INTEGER NOT NULL, value TEXT NOT NULL);
    `);
    this.sql = {
      shops: this.db.prepare<[], { value: string }>(
        "SELECT value FROM town_shop ORDER BY slot_id",
      ),
      shop: this.db.prepare<[string], { value: string }>(
        "SELECT value FROM town_shop WHERE slot_id=?",
      ),
      save: this.db.prepare<[string, string]>(
        "INSERT INTO town_shop VALUES (?,?) ON CONFLICT(slot_id) DO UPDATE SET value=excluded.value WHERE value<>excluded.value",
      ),
      account: this.db.prepare<[string], Account>(
        "SELECT balance FROM town_account WHERE id=?",
      ),
      ensure: this.db.prepare<[string, number]>(
        "INSERT OR IGNORE INTO town_account VALUES (?,?)",
      ),
      debit: this.db.prepare<[number, string, number]>(
        "UPDATE town_account SET balance=balance-? WHERE id=? AND balance>=?",
      ),
      credit: this.db.prepare<[number, string]>(
        "UPDATE town_account SET balance=balance+? WHERE id=?",
      ),
      total: this.db.prepare<[], Account>(
        "SELECT SUM(balance) AS balance FROM town_account",
      ),
      transfer: this.db.prepare<
        [string, string, string, number, string, number, string]
      >("INSERT INTO town_transfer VALUES (?,?,?,?,?,?,?)"),
      receipt: this.db.prepare<[string], { id: string }>(
        "SELECT id FROM town_transfer WHERE id=?",
      ),
      sales: this.db.prepare<[string, string], Account>(
        "SELECT COALESCE(SUM(amount),0) AS balance FROM town_transfer WHERE credit=? AND day=? AND category='sale'",
      ),
      paidWeek: this.db.prepare<[string]>(
        "INSERT OR IGNORE INTO town_funding_week VALUES (?)",
      ),
      attempt: this.db.prepare<[string, BusinessKind, string]>(
        "INSERT OR IGNORE INTO town_attempt VALUES (?,?,?)",
      ),
      demand: this.db.prepare<[string], { kind: BusinessKind; count: number }>(
        "SELECT kind,COUNT(*) AS count FROM town_attempt WHERE day>=? GROUP BY kind",
      ),
      patron: this.db.prepare<[string, string], Patron>(
        "SELECT name,visits FROM town_patron WHERE shop_account=? AND buyer_id=?",
      ),
      visit: this.db.prepare<[string, string, string, string]>(
        "INSERT INTO town_patron VALUES (?,?,?,?,1) ON CONFLICT DO UPDATE SET visits=visits+1,name=excluded.name",
      ),
      regulars: this.db.prepare<[string], Patron>(
        "SELECT name, visits FROM town_patron WHERE shop_account=? AND actor='employee' AND visits>=2 ORDER BY visits DESC, name LIMIT 6",
      ),
      story: this.db.prepare<[string, string, number, string]>(
        "INSERT OR IGNORE INTO town_story VALUES (?,?,?,?)",
      ),
      news: this.db.prepare<[string], { value: string }>(
        "SELECT value FROM town_story WHERE day=? ORDER BY at DESC,id LIMIT 16",
      ),
    };
    this.sql.ensure.run(reserve, funding.reserve);
  }

  close(): void {
    this.db.close();
  }
  run<T>(work: () => T): T {
    return this.db.transaction(work).immediate();
  }
  shops(): Business[] {
    return this.sql.shops
      .all()
      .map(({ value }) => JSON.parse(value) as Business);
  }

  private shop(slotId: string): Business | undefined {
    const row = this.sql.shop.get(slotId);
    return row ? (JSON.parse(row.value) as Business) : undefined;
  }

  save(shop: Business): void {
    this.sql.save.run(shop.slotId, JSON.stringify(shop));
  }

  balance(actor: "employee" | "resident", id: string): number {
    return this.sql.account.get(`${actor}:${id}`)?.balance ?? 0;
  }

  total(): number {
    return this.sql.total.get()?.balance ?? 0;
  }

  daySales(shop: Business, day: string): number {
    return this.sql.sales.get(businessAccount(shop), day)?.balance ?? 0;
  }
  regulars(shop: Business): string[] {
    return this.sql.regulars.all(businessAccount(shop)).map(({ name }) => name);
  }
  demand(since: string) {
    return Object.fromEntries(
      this.sql.demand.all(since).map(({ kind, count }) => [kind, count]),
    );
  }

  addStory(date: string, story: TownStory): void {
    this.sql.story.run(story.id, date, story.at, JSON.stringify(story));
  }
  news(date: string): TownStory[] {
    return this.sql.news
      .all(date)
      .map(({ value }) => JSON.parse(value) as TownStory);
  }

  fund(
    actor: "employee" | "resident",
    id: string,
    date: string,
    at: number,
  ): void {
    const account = `${actor}:${id}`;
    this.run(() => {
      const isNew = this.sql.ensure.run(account, 0).changes > 0;
      const policy = actor === "employee" ? this.funding : residentFunding;
      // Stage 6.7 will replace employee stipends with payroll transfers.
      const week = weekOf(date);
      if (!this.sql.paidWeek.run(`${account}:${week}`).changes) return;
      this.transfer(
        `stipend:${account}:${week}`,
        reserve,
        account,
        isNew ? policy.initial : policy.weekly,
        date,
        at,
        "stipend",
      );
    });
  }

  purchase(order: Purchase): "sold" | "unavailable" | "alreadyHandled" {
    return this.run(() => {
      const shop = this.shop(order.slotId);
      if (!shop?.kind) return "unavailable";
      const key = `sale:${order.id}`;
      if (!this.sql.attempt.run(key, shop.kind, order.date).changes)
        return "alreadyHandled";
      const item = shop.menu.find(({ id }) => id === order.productId);
      if (!item?.stock) return "unavailable";
      const account = businessAccount(shop);
      const buyer = `${order.actor}:${order.buyerId}`;
      if (
        !this.transfer(
          key,
          buyer,
          account,
          item.price,
          order.date,
          order.at,
          "sale",
        )
      )
        return "unavailable";
      const patron = this.sql.patron.get(account, buyer);
      this.sql.visit.run(account, buyer, order.name, order.actor);
      const reducedMenu = shop.menu.map((entry) =>
        entry === item ? { ...entry, stock: entry.stock - 1 } : entry,
      );
      const lastGreeting =
        (patron?.visits ?? 0) >= 1
          ? {
              text: `${order.name}님, 오늘도 들러줘서 반가워요.`,
              until: order.at + 24_000,
            }
          : shop.lastGreeting;
      this.save(
        planDelivery({ ...shop, menu: reducedMenu, lastGreeting }, order.at),
      );
      return "sold";
    });
  }

  private transfer(
    id: string,
    payer: string,
    payee: string,
    amount: number,
    date: string,
    at: number,
    category: string,
  ): boolean {
    if (
      !safeNonnegative(amount) ||
      amount === 0 ||
      payer === payee ||
      this.sql.receipt.get(id)
    )
      return false;
    if (!this.sql.debit.run(amount, payer, amount).changes) return false;
    this.sql.ensure.run(payee, 0);
    this.sql.credit.run(amount, payee);
    this.sql.transfer.run(id, payer, payee, amount, date, at, category);
    return true;
  }
}

function weekOf(date: string): string {
  const epoch = new Date(`${date}T00:00:00Z`);
  const back = (epoch.getUTCDay() + 6) % 7;
  return new Date(epoch.getTime() - back * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
