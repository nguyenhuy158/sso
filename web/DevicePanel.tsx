import { type FormEvent, useState } from "react";
import { type DeviceRequest, decideDevice, lookupDevice } from "./api";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

const USER_CODE_PARAM = "user_code";
const USER_CODE_PLACEHOLDER = "XXXX-XXXX";
const USER_CODE_MAX_LENGTH = 9;
const ERROR_MESSAGES: Record<string, string> = {
  invalid_code: "That code is wrong, already used or expired.",
};

type Step =
  | { kind: "enter" }
  | { kind: "confirm"; device: DeviceRequest }
  | { kind: "done"; allowed: boolean };

const messageOf = (error: unknown) => {
  const code = error instanceof Error ? error.message : String(error);
  return ERROR_MESSAGES[code] ?? code;
};

export const isDevicePage = () =>
  new URLSearchParams(window.location.search).has("device");

export function DevicePanel({ email }: { email: string }) {
  const [userCode, setUserCode] = useState(
    () =>
      new URLSearchParams(window.location.search).get(USER_CODE_PARAM) ?? "",
  );
  const [step, setStep] = useState<Step>({ kind: "enter" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  const lookup = (event: FormEvent) => {
    event.preventDefault();
    run(async () =>
      setStep({ kind: "confirm", device: await lookupDevice(userCode) }),
    );
  };

  const decide = (device: DeviceRequest, allow: boolean) =>
    run(async () => {
      await decideDevice(device.user_code, allow);
      setStep({ kind: "done", allowed: allow });
    });

  return (
    <div className="mt-4 text-left">
      {error && (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      )}
      {step.kind === "enter" && (
        <form onSubmit={lookup} className="space-y-3">
          <p className="text-sm text-fg-muted">
            Enter the code shown on your device.
          </p>
          <Input
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={USER_CODE_MAX_LENGTH}
            placeholder={USER_CODE_PLACEHOLDER}
            value={userCode}
            onChange={(event) => setUserCode(event.target.value.toUpperCase())}
            className="text-center font-mono text-2xl tracking-[0.3em]"
          />
          <Button type="submit" block loading={busy} disabled={!userCode}>
            Continue
          </Button>
        </form>
      )}
      {step.kind === "confirm" && (
        <div className="space-y-3">
          <p className="text-sm text-fg">
            <strong>{step.device.client_name}</strong> wants to sign in as{" "}
            <strong>{email}</strong>.
          </p>
          <p className="font-mono text-center text-xl tracking-[0.3em]">
            {step.device.user_code}
          </p>
          <p className="text-xs text-fg-muted">
            Only continue if you started this on a device you own. It will act
            as you on every huyab.cfd app for 30 days.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              block
              disabled={busy}
              onClick={() => decide(step.device, false)}
            >
              Cancel
            </Button>
            <Button
              block
              loading={busy}
              onClick={() => decide(step.device, true)}
            >
              Authorize
            </Button>
          </div>
        </div>
      )}
      {step.kind === "done" && (
        <Alert tone={step.allowed ? "success" : "info"}>
          {step.allowed
            ? "Device connected. You can close this page and go back to it."
            : "Request cancelled. The device was not signed in."}
        </Alert>
      )}
    </div>
  );
}
