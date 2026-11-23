import { z } from "zod";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { OutreachScheduler } from "@/server/features/outreach/services/OutreachScheduler";
import type { OutreachScheduleView } from "@/shared/outreach";
import { outreachNumberSchema } from "@/types/schemas/outreach";

// Scheduled outreach sending tools (fork feature, see FORK-CHANGES.md). An
// agent can read and arrange the send queue, and pause it, but never send:
// only emails the owner approved in the app are ever in the queue, and only
// the owner resumes sending (in the app).

const schedulePath = (projectId: string) => `/p/${projectId}/outreach`;

const scheduleOutput = z.looseObject({
  projectId: z.string(),
  paused: z.boolean(),
  queue: z.array(z.looseObject({ number: z.number(), at: z.string() })),
  ...optionalMetaOutputSchema,
});

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function when(at: string, timeZone: string) {
  const city = timeZone.split("/").at(-1)?.replace(/_/gu, " ") ?? timeZone;
  return `${new Date(at).toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })} ${city}`;
}

function summary(view: OutreachScheduleView) {
  const lines = [
    `Sending ${view.paused ? "PAUSED" : "on"}: ${view.days.length} days a week at ${view.time} ${view.timeZone}, ${view.windowMinutes}-minute window, at most ${view.dailyMax} a day and ${view.weeklyMax} a week.`,
    view.stale
      ? `Scheduler: last run ${view.checkedAt ?? "never"} (overdue: is the Mac awake and Docker running?).`
      : `Scheduler: last run ${view.checkedAt ?? "never"}.`,
    `Next sending days: ${view.nextSlots.map((slot) => slot.date).join(", ") || "none"}.`,
    "",
    view.queue.length ? "Queue:" : "The queue is empty.",
    ...view.queue.map(
      (item) =>
        `- ${when(item.at, view.timeZone)}: #${item.number} ${item.prospect} (${item.kind ?? "email"}): ${item.subject}${item.manual ? " [day picked by hand]" : ""}`,
    ),
    ...(view.waiting.length
      ? [
          "",
          "Approved but not queued:",
          ...view.waiting.map(
            (item) => `- #${item.number} ${item.prospect}: ${item.reason}`,
          ),
        ]
      : []),
  ];
  return lines.join("\n");
}

function respond(
  context: Parameters<typeof buildProjectMeta>[0],
  projectId: string,
  view: OutreachScheduleView,
  lead?: string,
) {
  return mcpResponse({
    text: lead ? `${lead}\n\n${summary(view)}` : summary(view),
    meta: buildProjectMeta(context, projectId, schedulePath(projectId), {
      tab: "scheduled",
    }),
    structuredContent: { projectId, ...view },
  });
}

const projectOnly = { projectId: projectIdSchema } as const;

export const getOutreachScheduleTool = {
  name: "get_outreach_schedule",
  config: {
    title: "Get outreach send schedule",
    description:
      "The project's outreach send queue: approved emails and follow-ups with the time each goes out (sending days and time in the recipients' zone, inside a window, within the daily and weekly limits), approved emails that are not queued and why, the next sending days, whether sending is paused, and when the scheduler last ran. Free.",
    inputSchema: projectOnly,
    outputSchema: scheduleOutput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof projectOnly>>, context) =>
      respond(
        context,
        args.projectId,
        await OutreachScheduler.view(context.project),
      ),
  ),
};

const rescheduleInput = {
  projectId: projectIdSchema,
  number: outreachNumberSchema,
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u)
    .describe(
      "One of the next sending days from get_outreach_schedule (YYYY-MM-DD, in the schedule's zone).",
    ),
} as const;

export const rescheduleOutreachEmailTool = {
  name: "reschedule_outreach_email",
  config: {
    title: "Reschedule an outreach email",
    description:
      "Move one approved, queued email to another sending day; it goes inside that day's window, after the others. Refused when that day is full under the limits. Does not send anything. Only with the owner's go. Free.",
    inputSchema: rescheduleInput,
    outputSchema: scheduleOutput,
    annotations: writeAnnotations,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof rescheduleInput>>, context) => {
      const view = await OutreachScheduler.reschedule(context.project, {
        number: args.number,
        date: args.date,
        actor: "agent",
      });
      return respond(
        context,
        args.projectId,
        view,
        `#${args.number} moved to ${args.date}.`,
      );
    },
  ),
};

const queuedInput = {
  projectId: projectIdSchema,
  number: outreachNumberSchema,
  queued: z
    .boolean()
    .describe(
      "false takes the email out of the queue (it stays approved); true puts it back.",
    ),
} as const;

export const setOutreachQueuedTool = {
  name: "set_outreach_queued",
  config: {
    title: "Take an outreach email out of the queue, or back in",
    description:
      "Take one approved email out of the send queue (it stays approved and is not sent until it is back in the queue or the owner sends it), or put it back. Only with the owner's go. Free.",
    inputSchema: queuedInput,
    outputSchema: scheduleOutput,
    annotations: writeAnnotations,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof queuedInput>>, context) => {
      const view = await OutreachScheduler.setQueued(context.project, {
        number: args.number,
        queued: args.queued,
        actor: "agent",
      });
      return respond(
        context,
        args.projectId,
        view,
        args.queued
          ? `#${args.number} is back in the queue.`
          : `#${args.number} is out of the queue.`,
      );
    },
  ),
};

export const pauseOutreachScheduleTool = {
  name: "pause_outreach_schedule",
  config: {
    title: "Pause scheduled outreach sending",
    description:
      "Stop every scheduled outreach send of the project at once (for example after a reply that changes plans, or a bounce). Only the owner resumes sending, in the OpenSEO app. Free.",
    inputSchema: projectOnly,
    outputSchema: scheduleOutput,
    annotations: writeAnnotations,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof projectOnly>>, context) => {
      const view = await OutreachScheduler.setPaused(context.project, true);
      return respond(
        context,
        args.projectId,
        view,
        "Scheduled sending is paused.",
      );
    },
  ),
};
