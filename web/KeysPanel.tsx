import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  DEFAULT_KEY_DAYS,
  MAX_KEY_DAYS,
  MAX_LABEL_LENGTH,
} from "../src/key-limits";
import { type AuthKey, createKey, listKeys, revealKey, revokeKey } from "./api";
import { Alert, type AlertTone } from "./ui/Alert";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

const COPIED_FEEDBACK_MS = 1200;
const DATE_LENGTH = 10;

type Status = { tone: AlertTone; text: string } | null;

const day = (iso: string) => iso.slice(0, DATE_LENGTH);
const isActive = (key: AuthKey) =>
  !key.revokedAt && Date.parse(key.expiresAt) > Date.now();

function keyState(key: AuthKey) {
  if (key.revokedAt)
    return { tone: "danger" as const, text: `revoked ${day(key.revokedAt)}` };
  if (!isActive(key))
    return { tone: "neutral" as const, text: `expired ${day(key.expiresAt)}` };
  return { tone: "success" as const, text: `expires ${day(key.expiresAt)}` };
}

function CopyButton({
  getText,
  onError,
}: {
  getText: () => Promise<string>;
  onError: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(await getText());
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch (error) {
      onError(`Copy failed: ${(error as Error).message}`);
    }
  };
  return (
    <Button size="sm" variant="outline" onClick={copy}>
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function KeysPanel() {
  const [keys, setKeys] = useState<AuthKey[] | null>(null);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(DEFAULT_KEY_DAYS);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const fail = useCallback(
    (text: string) => setStatus({ tone: "danger", text }),
    [],
  );

  const load = useCallback(async () => {
    try {
      setKeys(await listKeys());
    } catch (error) {
      fail(`Cannot load keys: ${(error as Error).message}`);
    }
  }, [fail]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await createKey(label.trim(), days);
      setNewKey(created.key);
      setLabel("");
      setStatus({
        tone: "success",
        text: created.revealable
          ? "Created. You can copy it again later."
          : "Created. Copy it now: it is not stored.",
      });
      await load();
    } catch (error) {
      fail(`Create failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (key: AuthKey) => {
    if (!confirm(`Revoke ${key.label}? CLIs using it stop working.`)) return;
    try {
      await revokeKey(key.id);
      await load();
    } catch (error) {
      fail(`Revoke failed: ${(error as Error).message}`);
    }
  };

  return (
    <section className="mt-6 border-t border-border-subtle pt-5 text-left">
      <h2 className="mb-3 text-sm font-semibold text-fg">Auth keys</h2>
      <form className="flex gap-2" onSubmit={create}>
        <Input
          aria-label="Key name"
          placeholder="Name, e.g. mac cli"
          maxLength={MAX_LABEL_LENGTH}
          required
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <div className="w-20 shrink-0">
          <Input
            aria-label="Days until it expires"
            type="number"
            min={1}
            max={MAX_KEY_DAYS}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          />
        </div>
        <Button type="submit" loading={busy}>
          Create
        </Button>
      </form>
      {newKey && (
        <div className="mt-2 flex gap-2">
          <Input
            aria-label="New key"
            readOnly
            value={newKey}
            onFocus={(event) => event.target.select()}
          />
          <CopyButton getText={async () => newKey} onError={fail} />
        </div>
      )}
      {status && (
        <Alert tone={status.tone} className="mt-3">
          {status.text}
        </Alert>
      )}
      <ul className="mt-3 max-h-60 divide-y divide-border-subtle overflow-y-auto">
        {keys?.length === 0 && (
          <li className="py-2 text-sm text-fg-muted">No keys yet.</li>
        )}
        {keys?.map((key) => {
          const state = keyState(key);
          const active = isActive(key);
          return (
            <li
              key={key.id}
              className={`flex items-center gap-2 py-2 ${active ? "" : "opacity-60"}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">
                  {key.label} <span className="text-fg-muted">({key.id})</span>
                </p>
                <p className="flex items-center gap-2 text-xs text-fg-muted">
                  <Badge tone={state.tone}>{state.text}</Badge>
                  last used {key.lastUsedAt ? day(key.lastUsedAt) : "never"}
                </p>
              </div>
              {active && key.revealable && (
                <CopyButton getText={() => revealKey(key.id)} onError={fail} />
              )}
              {active && (
                <Button size="sm" variant="danger" onClick={() => revoke(key)}>
                  Revoke
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
