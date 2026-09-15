import { expect, test } from "bun:test";
import { readConfig } from "../src/config.ts";

test("PROJECT_ORDER 解析为去重的正整数项目顺序", () => {
  const config = readConfig({ PROJECT_ORDER: "3, 1,2,3,invalid,-1" });
  expect(config.projectOrder).toEqual([3, 1, 2]);
});

test("COLOR 解析项目主题色并忽略无效配置", () => {
  const config = readConfig({
    COLOR: "1-yellow, 2-purple,3-BLUE,4-orange,5-xxxx,0-red,2-green,invalid",
  });
  expect(config.projectColors).toEqual({
    1: "yellow",
    2: "green",
    3: "blue",
    4: "orange",
  });
});

test("ICON 解析项目标题图标并忽略无效配置", () => {
  const config = readConfig({
    ICON: "1-img_v2_first, 2-img_v2_second,2-img_v2_latest,0-img_invalid,invalid,3-hyphen-key",
  });
  expect(config.projectIcons).toEqual({
    1: "img_v2_first",
    2: "img_v2_latest",
    3: "hyphen-key",
  });
});
