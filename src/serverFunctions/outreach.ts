import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  OutreachError,
  OutreachService,
} from "@/server/features/outreach/services/OutreachService";
import { OutreachScheduler } from "@/server/features/outreach/services/OutreachScheduler";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  outreachChannelSchema,
  outreachMoveSchema,
  outreachNumberSchema,
  outreachSettingsInputSchema,
} from "@/types/schemas/outreach";
import type {
  OutreachProspect,
  OutreachScheduleView,
  OutreachSettingsView,
} from "@/shared/outreach";

// Outreach for the app (fork feature). The `projectId` field in each
// validator is what triggers project authorization; the service never
// authorizes. Domain refusals ("approve it again", "today's limit is
// reached") come back as data, because the app's error path strips thrown
// messages down to their code and the owner needs the reason.

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

async function asResult<T>(
  work: () => Promise<T>,
  // After a change that can add to or void the send queue, bring it up to
  // date so the Scheduled tab shows it at once (the scheduler would within
  // five minutes anyway).
  replan?: { id: string; domain: string | null },
): Promise<Result<T>> {
  try {
    const value = await work();
    if (replan) await OutreachScheduler.plan(replan);
    return { ok: true, value };
  } catch (error) {
    if (error instanceof OutreachError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

const projectOnly = z.object({ projectId: z.string().min(1) });
const prospectRef = projectOnly.extend({ number: outreachNumberSchema });

export const getOutreachSnapshot = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectOnly)
  .handler(async ({ context }) => OutreachService.getSnapshot(context.project));

export const getOutreachFavicons = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectOnly)
  .handler(async ({ context }) =>
    OutreachService.getFavicons(context.projectId),
  );

export const approveOutreach = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(prospectRef.extend({ expectedHash: z.string().length(64) }))
  .handler(
    async ({ data, context }): Promise<Result<OutreachProspect>> =>
      asResult(
        () =>
          OutreachService.approve(context.project, {
            number: data.number,
            expectedHash: data.expectedHash,
          }),
        context.project,
      ),
  );

export const undoOutreachApproval = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(prospectRef)
  .handler(
    async ({ data, context }): Promise<Result<OutreachProspect>> =>
      asResult(
        () => OutreachService.undoApproval(context.project, data.number),
        context.project,
      ),
  );

export const editOutreachEmail = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    prospectRef.extend({
      subject: z.string().max(200),
      body: z.string().max(20_000),
      expectedHash: z.string().length(64),
    }),
  )
  .handler(
    async ({ data, context }): Promise<Result<OutreachProspect>> =>
      asResult(
        () =>
          OutreachService.editEmail(context.project, {
            number: data.number,
            subject: data.subject,
            body: data.body,
            expectedHash: data.expectedHash,
          }),
        context.project,
      ),
  );

export const moveOutreachStatus = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    prospectRef.extend({
      move: outreachMoveSchema,
      reason: z.string().max(500).optional(),
    }),
  )
  .handler(
    async ({ data, context }): Promise<Result<OutreachProspect>> =>
      asResult(
        () =>
          OutreachService.moveStatus(context.project, {
            number: data.number,
            move: data.move,
            reason: data.reason,
          }),
        context.project,
      ),
  );

export const sendOutreach = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(prospectRef.extend({ channel: outreachChannelSchema }))
  .handler(
    async ({ data, context }): Promise<Result<OutreachProspect>> =>
      asResult(() =>
        OutreachService.send(context.project, {
          number: data.number,
          channel: data.channel,
        }),
      ),
  );

export const checkOutreachLink = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(prospectRef)
  .handler(
    async ({ data, context }): Promise<Result<OutreachProspect>> =>
      asResult(async () => {
        const result = await OutreachService.checkLink(context.project, {
          number: data.number,
          actor: "owner",
        });
        return result.prospect;
      }),
  );

export const updateOutreachSettings = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectOnly.extend({
      settings: outreachSettingsInputSchema,
      // Blank keeps the saved password.
      smtpPassword: z.string().max(500).optional(),
    }),
  )
  .handler(
    async ({ data, context }): Promise<Result<OutreachSettingsView>> =>
      asResult(
        () =>
          OutreachService.updateSettings(
            context.project,
            data.settings,
            data.smtpPassword?.trim(),
          ),
        context.project,
      ),
  );

export const testOutreachMail = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectOnly)
  .handler(
    async ({ context }): Promise<Result<string>> =>
      asResult(() => OutreachService.testMail(context.project)),
  );

// ---- Scheduled sending -------------------------------------------------------

export const getOutreachSchedule = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectOnly)
  .handler(async ({ context }) => OutreachScheduler.view(context.project));

export const rescheduleOutreach = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    prospectRef.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u) }),
  )
  .handler(
    async ({ data, context }): Promise<Result<OutreachScheduleView>> =>
      asResult(() =>
        OutreachScheduler.reschedule(context.project, {
          number: data.number,
          date: data.date,
          actor: "owner",
        }),
      ),
  );

export const setOutreachQueued = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(prospectRef.extend({ queued: z.boolean() }))
  .handler(
    async ({ data, context }): Promise<Result<OutreachScheduleView>> =>
      asResult(() =>
        OutreachScheduler.setQueued(context.project, {
          number: data.number,
          queued: data.queued,
          actor: "owner",
        }),
      ),
  );

export const setOutreachPaused = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectOnly.extend({ paused: z.boolean() }))
  .handler(
    async ({ data, context }): Promise<Result<OutreachScheduleView>> =>
      asResult(() => OutreachScheduler.setPaused(context.project, data.paused)),
  );
