import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Textarea } from "@/client/components/ui/textarea";
import { outreachQueryKey } from "@/client/features/outreach/outreachUi";
import { outreachScheduleKey } from "@/client/features/outreach/OutreachSchedule";
import { ScheduleSection } from "@/client/features/outreach/OutreachScheduleSettings";
import {
  testOutreachMail,
  updateOutreachSettings,
} from "@/serverFunctions/outreach";
import type { OutreachSettingsView } from "@/shared/outreach";

// The project's outreach identity and pacing, and the mailbox login. The
// saved SMTP password never comes back: a blank field keeps it.

export type OutreachSettingsFormState = Omit<
  OutreachSettingsView,
  "linkDomains" | "mailReady" | "mailProblem" | "smtpPasswordSet"
> & {
  linkDomains: string;
};
type FormState = OutreachSettingsFormState;

export function OutreachSettingsForm({
  projectId,
  settings,
}: {
  projectId: string;
  settings: OutreachSettingsView;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => {
    const {
      mailReady: _ready,
      mailProblem: _problem,
      smtpPasswordSet: _passwordSet,
      linkDomains,
      ...rest
    } = settings;
    return { ...rest, linkDomains: linkDomains.join(" ") };
  });
  const [smtpPassword, setSmtpPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const testConnection = async () => {
    setTesting(true);
    try {
      const result = await testOutreachMail({ data: { projectId } });
      if (result.ok) toast.success(result.value);
      else toast.error(result.message);
    } catch {
      toast.error("Could not test the connection.");
    } finally {
      setTesting(false);
    }
  };
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const result = await updateOutreachSettings({
        data: { projectId, settings: form, smtpPassword },
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setSmtpPassword("");
      toast.success("Outreach settings saved");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: outreachQueryKey(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: outreachScheduleKey(projectId),
        }),
      ]);
    } catch {
      toast.error("Could not save the settings.");
    } finally {
      setSaving(false);
    }
  };

  type TextKey = {
    [K in keyof FormState]: FormState[K] extends string ? K : never;
  }[keyof FormState];
  type NumberKey = {
    [K in keyof FormState]: FormState[K] extends number ? K : never;
  }[keyof FormState];
  const text = (
    key: TextKey,
    label: string,
    hint?: string,
    placeholder?: string,
  ) => (
    <label className="flex w-full flex-col">
      <span className="mb-1 text-sm font-medium">{label}</span>
      <Input
        className="h-9"
        value={form[key]}
        placeholder={placeholder}
        onChange={(event) =>
          setForm((current) => ({ ...current, [key]: event.target.value }))
        }
      />
      {hint ? (
        <span className="mt-1 text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
  const number = (key: NumberKey, label: string) => (
    <label className="flex flex-col">
      <span className="mb-1 text-sm font-medium">{label}</span>
      <Input
        type="number"
        className="h-9"
        value={form[key]}
        onChange={(event) =>
          setForm((current) => ({
            ...current,
            [key]: Number(event.target.value),
          }))
        }
      />
    </label>
  );

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted px-4 py-3 text-sm">
        <span
          className={cn(
            "mt-1.5 size-1.5 shrink-0 rounded-full",
            settings.mailReady ? "bg-success" : "bg-muted-foreground/40",
          )}
          aria-hidden
        />
        <span className="text-foreground/80">
          {settings.mailReady
            ? "Sending from the app is ready."
            : `Sending from the app is off. ${settings.mailProblem ?? ""} Prospects, drafts and approvals still work.`}
        </span>
      </div>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h3 className="font-semibold">Site</h3>
        {text(
          "siteUrl",
          "Site URL",
          "The site we earn links for.",
          "https://example.com",
        )}
        {text(
          "linkDomains",
          "Link domains",
          "Hosts that count as a link to us, separated by spaces. Subdomains count too.",
          "example.com",
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h3 className="font-semibold">Sender</h3>
        {text(
          "senderName",
          "Sender name",
          'Shown as the From name: "<Pen name> from <Brand>".',
          "Alex from Example",
        )}
        {text(
          "senderEmail",
          "Sender email",
          "The outreach mailbox. Never a support address.",
          "outreach@example.com",
        )}
        <label className="flex w-full flex-col">
          <span className="mb-1 text-sm font-medium">Signature</span>
          <Textarea
            className="h-24 field-sizing-fixed text-sm"
            value={form.signature}
            placeholder={"Alex\nExample\nhttps://example.com"}
            onChange={(event) => set("signature", event.target.value)}
          />
          <span className="mt-1 text-xs text-muted-foreground">
            Pen name, brand and site, one per line. Added under every email.
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
          {text("smtpHost", "SMTP host (SSL)", undefined, "smtp.zoho.com")}
          {number("smtpPort", "Port")}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {text(
            "smtpUser",
            "SMTP user",
            "Usually the mailbox address.",
            "outreach@example.com",
          )}
          <label className="flex w-full flex-col">
            <span className="mb-1 text-sm font-medium">SMTP password</span>
            <Input
              type="password"
              autoComplete="new-password"
              className="h-9"
              value={smtpPassword}
              placeholder={
                settings.smtpPasswordSet ? "Saved (leave blank to keep)" : ""
              }
              onChange={(event) => setSmtpPassword(event.target.value)}
            />
            <span className="mt-1 text-xs text-muted-foreground">
              Use an app password. Stored encrypted and never shown again.
            </span>
          </label>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h3 className="font-semibold">Pace</h3>
        {text(
          "timeZone",
          "Time zone",
          "Days and weeks (from Monday) are counted here.",
          "Europe/Belgrade",
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {number("dailyMin", "Per day, min")}
          {number("dailyMax", "Per day, max")}
          {number("weeklyMin", "Per week, min")}
          {number("weeklyMax", "Per week, max")}
          {number("followUpDays", "Follow up after (days)")}
        </div>
        <p className="text-xs text-muted-foreground">
          A new mailbox: 2 to 3 a working day and 10 to 20 a week, counting
          first emails, follow-ups and replies.
        </p>
      </section>

      <ScheduleSection
        form={form}
        checkedAt={settings.schedulerCheckedAt}
        onChange={(values) => setForm((current) => ({ ...current, ...values }))}
      />

      <div className="flex flex-wrap gap-2">
        <Button pending={saving} onClick={() => void save()}>
          Save settings
        </Button>
        <Button
          variant="ghost"
          pending={testing}
          disabled={!settings.mailReady}
          title={
            settings.mailReady
              ? "Log in to the SMTP server and out again; sends nothing."
              : (settings.mailProblem ?? undefined)
          }
          onClick={() => void testConnection()}
        >
          Test mail login
        </Button>
      </div>
    </div>
  );
}
