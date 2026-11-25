import type { OfficeSnapshot } from "@herdr-office/core";
import { expect, it } from "vitest";
import {
  hostnameLabel,
  publicAddress,
  publicDelta,
  publicMachineId,
  publicSnapshot,
  withoutIp,
} from "./publicView.ts";

it("removes network addresses from view labels and remaps cross-building references", () => {
  const id = "192.0.2.5";
  const employeeAddress = `${id}/t4`;
  const snapshot: OfficeSnapshot = {
    connected: true,
    revision: 1,
    organization: {
      buildings: [
        {
          id,
          name: id,
          host: "example-host",
          groups: [],
          departments: [
            {
              id: "example-team",
              name: "Example",
              machineId: id,
              folder: null,
              vacantSince: null,
              leadAddress: employeeAddress,
              departments: [],
              employees: [
                {
                  address: employeeAddress,
                  spaceId: "example-team",
                  machineId: id,
                  name: "Example",
                  agent: "codex",
                  cwd: "/workspace",
                  status: "working",
                  turn: 1,
                  title: "Check 192.0.2.5:80 or [2001:db8::1]",
                  labels: {},
                  parent: `${id}/t3`,
                },
              ],
            },
          ],
        },
      ],
    },
  };
  const publicView = publicSnapshot(snapshot).organization.buildings[0];
  expect(publicView.id).toBe(publicMachineId(id));
  expect(publicView.departments[0].leadAddress).toBe(
    publicAddress(employeeAddress),
  );
  expect(publicView.departments[0].employees[0].parent).toBe(
    publicAddress(`${id}/t3`),
  );
  expect(JSON.stringify(publicView)).not.toMatch(/192\.0\.2\.5|2001:db8/u);
  expect(
    publicDelta({
      revision: 2,
      buildings: { upsert: [], remove: [id] },
      messages: [{ from: employeeAddress, to: "t1", at: 1, body: "private" }],
    }),
  ).toEqual({
    revision: 2,
    buildings: { upsert: [], remove: [publicMachineId(id)] },
  });
  expect(hostnameLabel("example-host.local")).toBe("example-host");
  expect(hostnameLabel(id)).toBeUndefined();
  expect(withoutIp("localhost:8080")).toBe("localhost:8080");
});
