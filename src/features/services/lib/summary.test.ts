import { describe, expect, it } from "vitest";
import {
  filterServices,
  groupByCategory,
  summarize
} from "@/features/services/lib/summary";
import type { LocalServiceApp, ServiceHealthMap } from "@/features/services/types";

function app(id: string, overrides: Partial<LocalServiceApp> = {}): LocalServiceApp {
  return {
    id,
    name: id,
    host: `${id}.deedlit.dev`,
    url: `https://${id}.deedlit.dev`,
    description: "",
    category: "ops",
    icon: "generic",
    order: 0,
    ...overrides
  };
}

const at = "2026-10-24T00:00:00.000Z";

describe("summarize", () => {
  it("counts states, treating a missing probe as unknown", () => {
    const apps = [app("a"), app("b"), app("c"), app("d")];
    const health: ServiceHealthMap = {
      a: { state: "up", responseTime: 10, checkedAt: at },
      b: { state: "down", responseTime: 3000, checkedAt: at },
      c: { state: "unknown", checkedAt: at }
    };

    expect(summarize(apps, health)).toEqual({
      total: 4,
      up: 1,
      down: 1,
      unknown: 2,
      medianResponseMs: 10
    });
  });

  it("takes the median over services that are up only", () => {
    const apps = [app("a"), app("b"), app("c"), app("d")];
    const health: ServiceHealthMap = {
      a: { state: "up", responseTime: 10, checkedAt: at },
      b: { state: "up", responseTime: 30, checkedAt: at },
      c: { state: "up", responseTime: 21, checkedAt: at },
      d: { state: "up", responseTime: 100, checkedAt: at }
    };
    expect(summarize(apps, health).medianResponseMs).toBe(26);
  });

  it("reports no median when nothing answered", () => {
    expect(summarize([app("a")], {}).medianResponseMs).toBeNull();
    expect(summarize([], {}).total).toBe(0);
  });
});

describe("filterServices", () => {
  const apps = [
    app("zot", { name: "Container Registry", namespace: "registry" }),
    app("bookorbit", { name: "BookOrbit", category: "media", description: "Ebook library" })
  ];
  const health: ServiceHealthMap = {
    zot: { state: "up", checkedAt: at },
    bookorbit: { state: "down", checkedAt: at }
  };

  it("matches name, host, namespace, category label and description", () => {
    const ids = (q: string) => filterServices(apps, health, q, "all").map((a) => a.id);
    expect(ids("registry")).toEqual(["zot"]);
    expect(ids("ZOT.deedlit")).toEqual(["zot"]);
    expect(ids("media & reading")).toEqual(["bookorbit"]);
    expect(ids("ebook")).toEqual(["bookorbit"]);
    expect(ids("  ")).toEqual(["zot", "bookorbit"]);
  });

  it("filters by status", () => {
    expect(filterServices(apps, health, "", "down").map((a) => a.id)).toEqual(["bookorbit"]);
    expect(filterServices(apps, health, "", "unknown")).toEqual([]);
  });
});

describe("groupByCategory", () => {
  it("orders groups, keeps in-group order and drops empty groups", () => {
    const groups = groupByCategory([
      app("b", { category: "media" }),
      app("a", { category: "ops" }),
      app("c", { category: "media" })
    ]);

    expect(groups.map((g) => [g.category, g.apps.map((a) => a.id)])).toEqual([
      ["ops", ["a"]],
      ["media", ["b", "c"]]
    ]);
  });
});
