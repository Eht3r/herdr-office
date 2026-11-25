import type { Persona } from "@herdr-office/core";
import Database from "better-sqlite3";
import type { EmployeeState } from "./employeeState.ts";

interface ActivityRow {
  activity: string;
  line: string;
  day: string;
}

export class SimulationStore {
  private readonly db;
  private readonly statements;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sim_persona (employee_id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sim_employee (employee_id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sim_break (
        employee_id TEXT NOT NULL, at INTEGER NOT NULL, activity TEXT NOT NULL, line TEXT NOT NULL, day TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sim_break_employee_at ON sim_break (employee_id, at DESC);
      CREATE TABLE IF NOT EXISTS sim_affinity (
        first_id TEXT NOT NULL, second_id TEXT NOT NULL, score INTEGER NOT NULL, PRIMARY KEY (first_id, second_id)
      );
      CREATE TABLE IF NOT EXISTS sim_work_sample (
        team_id TEXT NOT NULL, bucket INTEGER NOT NULL, minute INTEGER NOT NULL, PRIMARY KEY (team_id, bucket)
      );
    `);
    this.statements = {
      persona: this.db.prepare<[string], { value: string }>(
        "SELECT value FROM sim_persona WHERE employee_id=?",
      ),
      insertPersona: this.db.prepare<[string, string]>(
        "INSERT OR IGNORE INTO sim_persona VALUES (?,?)",
      ),
      employees: this.db.prepare<[], { value: string }>(
        "SELECT value FROM sim_employee",
      ),
      save: this.db.prepare<[string, string]>(
        "INSERT INTO sim_employee VALUES (?,?) ON CONFLICT(employee_id) DO UPDATE SET value=excluded.value WHERE value<>excluded.value",
      ),
      addBreak: this.db.prepare<[string, number, string, string, string]>(
        "INSERT INTO sim_break VALUES (?,?,?,?,?)",
      ),
      recent: this.db.prepare<[string], ActivityRow>(
        "SELECT activity,line,day FROM sim_break WHERE employee_id=? ORDER BY at DESC, rowid DESC LIMIT 8",
      ),
      count: this.db.prepare<
        [string, string],
        { activity: string; count: number }
      >(
        "SELECT activity,COUNT(*) AS count FROM sim_break WHERE employee_id=? AND day=? GROUP BY activity",
      ),
      affinity: this.db.prepare<[string, string], { score: number }>(
        "SELECT score FROM sim_affinity WHERE first_id=? AND second_id=?",
      ),
      bump: this.db.prepare<[string, string]>(
        "INSERT INTO sim_affinity VALUES (?,?,1) ON CONFLICT DO UPDATE SET score=min(score+1,100)",
      ),
      sample: this.db.prepare<[string, number, number]>(
        "INSERT OR IGNORE INTO sim_work_sample VALUES (?,?,?)",
      ),
      samples: this.db.prepare<
        [number, number],
        { bucket: number; minute: number }
      >(
        "SELECT bucket,minute FROM sim_work_sample WHERE bucket BETWEEN ? AND ? ORDER BY bucket",
      ),
      cleanSamples: this.db.prepare<[number]>(
        "DELETE FROM sim_work_sample WHERE bucket < ?",
      ),
    };
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(callback: () => T): T {
    return this.db.transaction(callback)();
  }

  persona(id: string, make: () => Persona): Persona {
    const row = this.statements.persona.get(id);
    if (row) return JSON.parse(row.value) as Persona;
    const persona = make();
    this.statements.insertPersona.run(id, JSON.stringify(persona));
    return persona;
  }

  states(): EmployeeState[] {
    return this.statements.employees
      .all()
      .map(({ value }) => JSON.parse(value) as EmployeeState);
  }

  save(state: EmployeeState): void {
    this.statements.save.run(state.id, JSON.stringify(state));
  }

  addBreak(
    id: string,
    at: number,
    day: string,
    activity: string,
    line: string,
  ): void {
    this.statements.addBreak.run(id, at, activity, line, day);
  }

  breakHistory(id: string, day: string) {
    return {
      recent: this.statements.recent.all(id),
      counts: new Map(
        this.statements.count
          .all(id, day)
          .map(({ activity, count }) => [activity, count]),
      ),
    };
  }

  affinity(first: string, second: string): number {
    const [a, b] = [first, second].sort();
    return this.statements.affinity.get(a, b)?.score ?? 0;
  }

  interact(first: string, second: string): void {
    if (first === second) return;
    const [a, b] = [first, second].sort();
    this.statements.bump.run(a, b);
  }

  sample(team: string, bucket: number, minute: number): void {
    this.statements.sample.run(team, bucket, minute);
  }

  samples(since: number, until: number) {
    return this.statements.samples.all(since, until);
  }

  pruneSamples(since: number): void {
    this.statements.cleanSamples.run(since);
  }
}
