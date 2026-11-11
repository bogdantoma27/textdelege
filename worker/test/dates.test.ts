import { describe, expect, it } from "vitest";
import { dayAfter, dayBefore, formatRo, isIsoDate, parseDate, today } from "../src/lib/dates";

describe("dates", () => {
  it("formats ISO dates as DD.MM.YYYY", () => {
    expect(formatRo("2014-10-19")).toBe("19.10.2014");
    expect(formatRo("2021-03-01")).toBe("01.03.2021");
  });

  it.each([
    ["2014-10-19", true],
    ["2020-02-29", true],
    ["2021-02-30", false],
    ["2021-02-29", false],
    ["2021-13-01", false],
    ["2021-00-10", false],
    ["2021-1-1", false],
    ["19.10.2014", false],
    ["", false],
    ["2021-04-31", false],
  ])("isIsoDate(%s) is %s", (input, expected) => {
    expect(isIsoDate(input)).toBe(expected);
  });

  it.each([
    ["19.10.2014", "2014-10-19"],
    ["1.3.2021", "2021-03-01"],
    ["29.02.2020", "2020-02-29"],
    ["  19.10.2014 ", "2014-10-19"],
    ["2014-10-19", "2014-10-19"],
    ["30.02.2021", null],
    ["29.02.2021", null],
    ["19.13.2014", null],
    ["2014-10-32", null],
    ["19/10/2014", null],
    ["19.10.14", null],
    ["19.10", null],
    ["ieri", null],
    ["", null],
  ])("parseDate(%j) is %j", (input, expected) => {
    expect(parseDate(input)).toBe(expected);
  });

  it("returns today as the calendar day in Romania", () => {
    const value = today();
    expect(isIsoDate(value)).toBe(true);
    expect(value).toBe(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest" }).format(new Date()));
  });

  it("computes the day before", () => {
    expect(dayBefore("2014-10-19")).toBe("2014-10-18");
    expect(dayBefore("2021-03-01")).toBe("2021-02-28");
    expect(dayBefore("2024-03-01")).toBe("2024-02-29");
    expect(dayBefore("2020-01-01")).toBe("2019-12-31");
  });

  it("computes the day after", () => {
    expect(dayAfter("2014-10-18")).toBe("2014-10-19");
    expect(dayAfter("2021-02-28")).toBe("2021-03-01");
    expect(dayAfter("2024-02-28")).toBe("2024-02-29");
    expect(dayAfter("2019-12-31")).toBe("2020-01-01");
  });
});
