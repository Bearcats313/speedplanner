import { getProfile, updateProfile } from "@/lib/actions/profile";

const DIFFICULTIES = [
  { value: 1, label: "Beginner" },
  { value: 2, label: "Intermediate" },
  { value: 3, label: "Advanced" },
];

export default async function SettingsPage() {
  const profile = await getProfile();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-[28px] font-semibold text-ink">Settings</h1>

      <form action={updateProfile} className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-medium text-ink/70">
            Experience level — applied to every generated week (PRD R9)
          </legend>
          <div className="flex gap-2">
            {DIFFICULTIES.map((d) => (
              <label key={d.value} className="flex-1">
                <input
                  type="radio"
                  name="difficulty"
                  value={d.value}
                  defaultChecked={profile.difficulty === d.value}
                  className="peer sr-only"
                />
                <div className="flex h-11 items-center justify-center rounded-md border border-line text-[14px] text-ink peer-checked:border-signal peer-checked:bg-signal peer-checked:text-white">
                  {d.label}
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-medium text-ink/70">
            Speediance account email (used only when you push)
          </span>
          <input
            name="speediance_email"
            type="email"
            defaultValue={profile.speediance_email ?? ""}
            className="h-11 rounded-md border border-line bg-surface px-3 text-[16px] text-ink outline-none focus-visible:border-signal"
          />
          <span className="text-[13px] text-ink/50">
            The password is never stored — you&apos;ll enter it each time you push.
          </span>
        </label>

        <button
          type="submit"
          className="h-11 rounded-md bg-signal text-[14px] font-medium text-white"
        >
          Save
        </button>
      </form>
    </div>
  );
}
