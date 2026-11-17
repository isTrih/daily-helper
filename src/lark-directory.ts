import type { Client } from "@larksuiteoapi/node-sdk";

export type UserOption = { id: string; name: string };
type Page = { has_more?: boolean | undefined; page_token?: string | undefined };

async function pages<T extends Page>(load: (token?: string) => Promise<{ code?: number | undefined; msg?: string | undefined; data?: T | undefined }>, consume: (data: T) => void) {
  let token: string | undefined;
  const seen = new Set<string>();
  do {
    const result = await load(token);
    if (result.code !== 0 || !result.data) throw new Error(`通讯录读取失败（${result.code ?? "网络错误"}）`);
    consume(result.data);
    if (!result.data.has_more) return;
    token = result.data.page_token;
    if (!token || seen.has(token)) throw new Error("通讯录分页不完整，请刷新重试");
    seen.add(token);
  } while (token);
}

// Only return names and open IDs. Do not expose phones, email addresses or other HR fields.
export async function readDirectory(client: Client): Promise<{ users: UserOption[]; warning: string }> {
  const api = client.contact.v3;
  const departments = new Set<string>();
  const ids = new Set<string>();
  const groups = new Set<string>();
  const users = new Map<string, UserOption>();
  let partial = false;
  const collect = (items: Array<{ open_id?: string | undefined; name: string; status?: { is_resigned?: boolean | undefined; is_exited?: boolean | undefined; is_frozen?: boolean | undefined } | undefined }>) => {
    for (const user of items) if (user.open_id && !user.status?.is_resigned && !user.status?.is_exited && !user.status?.is_frozen) {
      users.set(user.open_id, { id: user.open_id, name: user.name?.trim() || user.open_id });
    }
  };
  await pages(token => api.scope.list({ params: { user_id_type: "open_id", department_id_type: "open_department_id", page_size: 100, ...(token ? { page_token: token } : {}) } }), data => {
    data.department_ids?.forEach(id => departments.add(id));
    data.user_ids?.forEach(id => ids.add(id));
    data.group_ids?.forEach(id => groups.add(id));
  });
  // Scope user_ids can be omitted without employee-ID permission. Read root users
  // directly when full visibility allows it; denial is expected for limited apps.
  let fullVisibility = false;
  try {
    await pages(token => api.user.findByDepartment({ params: { department_id: "0", user_id_type: "open_id", page_size: 50, ...(token ? { page_token: token } : {}) } }), data => collect(data.items ?? []));
    fullVisibility = true;
  } catch { /* Explicit scopes below still cover partially visible directories. */ }
  for (const group of fullVisibility ? [] : groups) {
    for (const memberType of ["user", "department"] as const) {
      try {
        await pages(token => api.groupMember.simplelist({ path: { group_id: group }, params: { member_type: memberType, member_id_type: "open_id", page_size: 100, ...(token ? { page_token: token } : {}) } }), data => {
          for (const member of data.memberlist) (memberType === "user" ? ids : departments).add(member.member_id);
        });
      } catch { partial = true; }
    }
  }
  // Walk direct children, avoiding Feishu's 1,000-department recursive-query limit.
  for (const department of departments) {
    try {
      await pages(token => api.user.findByDepartment({ params: { department_id: department, department_id_type: "open_department_id", user_id_type: "open_id", page_size: 50, ...(token ? { page_token: token } : {}) } }), data => collect(data.items ?? []));
      await pages(token => api.department.children({ path: { department_id: department }, params: { department_id_type: "open_department_id", fetch_child: false, page_size: 50, ...(token ? { page_token: token } : {}) } }), data => {
        for (const item of data.items ?? []) if (item.open_department_id && !item.status?.is_deleted) departments.add(item.open_department_id);
      });
    } catch { partial = true; }
  }
  const directIds = [...ids].filter(id => !users.has(id));
  for (let offset = 0; offset < directIds.length; offset += 50) {
    try {
      const result = await api.user.batch({ params: { user_ids: directIds.slice(offset, offset + 50), user_id_type: "open_id" } });
      if (result.code !== 0) throw new Error("读取用户失败");
      collect(result.data?.items ?? []);
    } catch { partial = true; }
  }
  return { users: [...users.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")), warning: partial ? "部分通讯录未能读取，请检查应用通讯录、用户组读取权限及可见范围；可手动填写用户 open_id。" : "" };
}
