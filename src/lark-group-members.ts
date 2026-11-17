import type { Client } from "@larksuiteoapi/node-sdk";
import type { ChatOption } from "./types.ts";

export type UserOption = { id: string; name: string };

// The IM member endpoint returns people only. Never fall back to enterprise contacts.
export async function readGroupUsers(client: Client, chats: ChatOption[]): Promise<{ users: UserOption[]; warning: string }> {
  const users = new Map<string, UserOption>();
  const groupIds = new Set(chats.map(chat => chat.chatId));
  let completed = 0;
  let failed = 0;
  let limited = 0;
  for (const chatId of groupIds) {
    let token: string | undefined;
    const seen = new Set<string>();
    let truncated = false;
    try {
      do {
        const response = await client.im.v1.chatMembers.get({
          path: { chat_id: chatId },
          params: { member_id_type: "open_id", page_size: 100, check_security_conf: true, ...(token ? { page_token: token } : {}) },
        });
        if (response.code !== 0 || !response.data) throw new Error("群成员读取失败");
        for (const member of response.data.items ?? []) {
          const id = member.member_id;
          if (!id || !/^ou_[\w-]+$/.test(id) || (member.member_id_type && member.member_id_type !== "open_id")) continue;
          const name = member.name?.trim();
          if (!users.has(id) || (users.get(id)!.name === id && name)) users.set(id, { id, name: name || id });
        }
        truncated ||= response.data.trigger_security_conf_limit === true;
        if (!response.data.has_more) break;
        token = response.data.page_token;
        if (!token || seen.has(token)) throw new Error("群成员分页不完整");
        seen.add(token);
      } while (token);
      completed++;
    } catch { failed++; }
    if (truncated) limited++;
  }
  if (groupIds.size > 0 && completed === 0 && users.size === 0) {
    throw new Error("无法读取所在群聊成员，请检查机器人群成员读取权限及入群状态");
  }
  const warnings = [
    failed ? `${failed} 个群的成员未能完整读取，请刷新重试并检查群成员读取权限及入群状态。` : "",
    limited ? `${limited} 个群的成员列表受飞书安全配置限制，当前结果不完整。` : "",
  ].filter(Boolean);
  return { users: [...users.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")), warning: warnings.join(" ") };
}
