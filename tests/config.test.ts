import { expect, test } from "bun:test";
import { readConfig } from "../src/config.ts";

test("PROJECT_ORDER 解析为去重的正整数项目顺序", () => {
  const config = readConfig({ PROJECT_ORDER: "3, 1,2,3,invalid,-1" });
  expect(config.projectOrder).toEqual([3, 1, 2]);
});
