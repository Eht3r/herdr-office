import { expect, it } from "vitest";
import type { HcTerminal } from "../hc/HcClient.ts";
import { type LayoutSpace, liveTeams } from "./normalize.ts";

function terminal(
  address: string,
  cwd: string,
  agent: string | null,
  spaceId = "example",
): HcTerminal {
  return {
    address,
    cwd,
    agent,
    state: "live",
    labels: { "herdr.space": spaceId },
  };
}

const layouts = new Map<string, LayoutSpace[]>([
  ["local", [{ id: "example", name: "Example", folder: "/workspace/layout" }]],
]);

it("uses the modal agent working directory regardless of shell or layout folders", () => {
  const result = liveTeams(
    [
      terminal("t1", "/workspace/app", "codex"),
      {
        ...terminal("t2", "/workspace/app/", null),
        foreground: { name: "node", argv: ["/bin/agent"] },
      },
      terminal("t3", "/workspace/helper", "claude-code"),
      terminal("t4", "/workspace/layout", "zsh"),
      terminal("t5", "/workspace/layout", null),
    ],
    layouts,
  );
  expect(result[0]).toMatchObject({
    name: "Example",
    folder: "/workspace/app",
  });
  expect(result[0].employees[1].agent).toBe("agent");
  expect(result[0].employees.map(({ address }) => address)).toEqual([
    "t1",
    "t2",
    "t3",
  ]);
});

it("uses the nearest common folder among tied agent paths", () => {
  const result = liveTeams(
    [
      terminal("t1", "/workspace/app/client", "codex"),
      terminal("t2", "/workspace/app/server", "claude-code"),
      terminal("t3", "/workspace/tools", "sh"),
    ],
    layouts,
  );
  expect(result[0].folder).toBe("/workspace/app");
});

it("falls back to all usable terminal paths and then the layout", () => {
  const agent = terminal("t1", "", "codex");
  expect(
    liveTeams([agent, terminal("t2", "/workspace/shell", "zsh")], layouts)[0]
      .folder,
  ).toBe("/workspace/shell");
  expect(liveTeams([agent], layouts)[0].folder).toBe("/workspace/layout");
});

it("does not create a team for shell-only or non-agent process spaces", () => {
  const result = liveTeams(
    [
      terminal("t1", "/workspace/shell", "/bin/bash"),
      {
        ...terminal("t2", "/workspace/service", null),
        foreground: { name: "node", argv: ["node", "service.js"] },
      },
      terminal("t3", "/workspace/project", "codex", "project"),
    ],
    layouts,
  );
  expect(result.map(({ id }) => id)).toEqual(["project"]);
});
