import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  mobileSecretaryDev, mobileSecretaryState, talkhintProjectModels,
} from "../../shared/schema";

const columns = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).columns.map(c => ({
    name: c.name, type: c.getSQLType(), notNull: c.notNull, primary: c.primary,
  }));

describe("Publish preserves independent runtime tables", () => {
  it("declares both mobile tables with the existing production contract", () => {
    expect(getTableConfig(mobileSecretaryState).name).toBe("mobile_secretary_state");
    expect(getTableConfig(mobileSecretaryDev).name).toBe("mobile_secretary_dev");
    const expected = [
      { name: "id", type: "text", notNull: true, primary: true },
      { name: "owner", type: "text", notNull: true, primary: false },
      { name: "kind", type: "text", notNull: true, primary: false },
      { name: "payload", type: "jsonb", notNull: true, primary: false },
      { name: "expires", type: "timestamp with time zone", notNull: true, primary: false },
    ];
    expect(columns(mobileSecretaryState)).toEqual(expected);
    expect(columns(mobileSecretaryDev)).toEqual(expected);
    expect(mobileSecretaryState.id).not.toBe(mobileSecretaryDev.id);
  });

  it("keeps the project model separate with its original owner primary key and state", () => {
    expect(getTableConfig(talkhintProjectModels).name).toBe("talkhint_project_models");
    expect(columns(talkhintProjectModels)).toEqual([
      { name: "owner_key", type: "text", notNull: true, primary: true },
      { name: "revision", type: "integer", notNull: true, primary: false },
      { name: "state", type: "jsonb", notNull: true, primary: false },
      { name: "updated_at", type: "timestamp with time zone", notNull: true, primary: false },
    ]);
    const config = getTableConfig(talkhintProjectModels);
    expect(config.columns.find(c => c.name === "updated_at")?.hasDefault).toBe(true);
    expect(config.foreignKeys).toHaveLength(0);
    expect(getTableConfig(mobileSecretaryState).columns.every(c => !c.hasDefault || c.primary)).toBe(true);
  });
});
