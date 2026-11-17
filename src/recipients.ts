import { z } from "zod";

export const recipientSchema = z.object({
  type: z.enum(["chat", "user"]),
  id: z.string().trim().min(1).max(128),
}).refine(value => value.type === "chat" ? /^oc_[\w-]+$/.test(value.id) : /^ou_[\w-]+$/.test(value.id), {
  message: "群聊请填写 oc_ 开头的 chat_id，用户请填写当前应用的 ou_ 开头 open_id",
});
export type Recipient = z.infer<typeof recipientSchema>;
export const recipientsSchema = z.array(recipientSchema).min(1).max(500);

export function normalizeRecipients(targets: Array<string | Recipient>): Recipient[] {
  const unique = new Map<string, Recipient>();
  for (const target of targets) {
    const value = typeof target === "string" ? { type: "chat" as const, id: target.trim() } : target;
    if (value.id) unique.set(`${value.type}:${value.id}`, value);
  }
  return [...unique.values()];
}

export function scheduleRecipients(schedule: { recipients?: Recipient[] | undefined; chatId?: string | undefined }): Recipient[] {
  return normalizeRecipients(schedule.recipients ?? (schedule.chatId ? [schedule.chatId] : []));
}

// A failed destination must not prevent the remaining destinations from receiving their report.
export async function deliverRecipients(targets: Recipient[], deliver: (target: Recipient) => Promise<unknown>): Promise<void> {
  const failures: string[] = [];
  for (const target of targets) {
    try { await deliver(target); }
    catch (error) { failures.push(`${target.id}: ${error instanceof Error ? error.message : "发送失败"}`); }
  }
  if (failures.length) throw new Error(`${failures.length}/${targets.length} 个收件人发送失败：${failures.join("；")}`);
}
