import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { outreachQueryKey } from "@/client/features/outreach/outreachUi";
import {
  testOutreachMail,
  updateOutreachSettings,
} from "@/serverFunctions/outreach";
import type { OutreachSettingsView } from "@/shared/outreach";

// The project's outreach identity and pacing. SMTP credentials are never
// entered here: the server reads them from its environment.

type FormState = Omit<
  OutreachSettingsView,
  "linkDomains" | "mailReady" | "mailProblem"
> & {
  linkDomains: string;
};

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
      linkDomains,
      ...rest
    } = settings;
    return { ...rest, linkDomains: linkDomains.join(" ") };
  });
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
  const envKey = form.mailEnvKey.toUpperCase().replace(/[^A-Z0-9]+/gu, "_");

  const save = async () => {
    setSaving(true);
    try {
      const result = await updateOutreachSettings({
        data: { projectId, settings: form },
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Outreach settings saved");
      await queryClient.invalidateQueries({
        queryKey: outreachQueryKey(projectId),
      });
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
      <span className="label-text mb-1 text-sm font-medium">{label}</span>
      <input
        className="input input-sm input-bordered w-full"
        value={form[key]}
        placeholder={placeholder}
        onChange={(event) =>
          setForm((current) => ({ ...current, [key]: event.target.value }))
        }
      />
      {hint ? (
        <span className="mt-1 text-xs text-base-content/60">{hint}</span>
      ) : null}
    </label>
  );
  const number = (key: NumberKey, label: string) => (
    <label className="flex flex-col">
      <span className="label-text mb-1 text-sm font-medium">{label}</span>
      <input
        type="number"
        className="input input-sm input-bordered w-full"
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
      <div className="flex items-start gap-2 rounded-lg border border-base-300 bg-base-200/50 px-4 py-3 text-sm">
        <span
          className={`mt-1.5 size-1.5 shrink-0 rounded-full ${settings.mailReady ? "bg-success" : "bg-base-content/30"}`}
          aria-hidden
        />
        <span className="text-base-content/80">
          {settings.mailReady
            ? "Sending from the app is ready."
            : `Sending from the app is off. ${settings.mailProblem ?? ""} Prospects, drafts and approvals still work.`}
        </span>
      </div>

      <section className="space-y-3 rounded-xl border border-base-300 bg-base-100 p-4">
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

      <section className="space-y-3 rounded-xl border border-base-300 bg-base-100 p-4">
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
          <span className="label-text mb-1 text-sm font-medium">Signature</span>
          <textarea
            className="textarea textarea-bordered h-24 w-full text-sm"
            value={form.signature}
            placeholder={"Alex\nExample\nhttps://example.com"}
            onChange={(event) => set("signature", event.target.value)}
          />
          <span className="mt-1 text-xs text-base-content/60">
            Pen name, brand and site, one per line. Added under every email.
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
          {text("smtpHost", "SMTP host (SSL)", undefined, "smtp.zoho.com")}
          {number("smtpPort", "Port")}
        </div>
        {text(
          "mailEnvKey",
          "Mail env key",
          envKey
            ? `The server reads OUTREACH_${envKey}_SMTP_USER and OUTREACH_${envKey}_SMTP_PASSWORD from its environment (use an app password).`
            : "A short name, for example the project name. Credentials stay in the server environment, never here.",
          "EXAMPLE",
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-base-300 bg-base-100 p-4">
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
        <p className="text-xs text-base-content/60">
          A new mailbox: 2 to 3 a working day and 10 to 20 a week, counting
          first emails, follow-ups and replies.
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-primary btn-sm"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? (
            <span className="loading loading-spinner loading-xs" />
          ) : null}
          Save settings
        </button>
        <button
          className="btn btn-ghost btn-sm"
          disabled={testing || !settings.mailReady}
          title={
            settings.mailReady
              ? "Log in to the SMTP server and out again; sends nothing."
              : (settings.mailProblem ?? undefined)
          }
          onClick={() => void testConnection()}
        >
          {testing ? (
            <span className="loading loading-spinner loading-xs" />
          ) : null}
          Test mail login
        </button>
      </div>
    </div>
  );
}
