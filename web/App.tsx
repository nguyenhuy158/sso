import { useEffect, useState } from "react";
import { loadSession, PATHS, type Session } from "./api";
import { KeysPanel } from "./KeysPanel";
import { Alert } from "./ui/Alert";
import { Avatar } from "./ui/Avatar";
import { Card } from "./ui/Card";
import { Spinner } from "./ui/Spinner";

const MS_PER_SECOND = 1000;
const LINK_BUTTON =
  "mt-6 inline-flex h-11 items-center justify-center rounded-ui px-5 font-semibold transition sm:h-10 sm:text-sm";

type State =
  | { status: "loading" }
  | { status: "ready"; session: Session | null }
  | { status: "error"; message: string };

function SignedIn({ session }: { session: Session }) {
  const { user } = session;
  const name = user.name || user.email || user.id;
  return (
    <>
      <div className="mt-4 flex items-center justify-center gap-3">
        <Avatar name={name} src={user.picture} />
        <div className="text-left">
          <p className="who text-sm text-fg">
            Signed in as <strong>{user.email ?? name}</strong>
          </p>
          <p className="text-xs text-fg-muted">
            Session until{" "}
            {new Date(session.expiresAt * MS_PER_SECOND).toLocaleString()}
          </p>
        </div>
      </div>
      <a
        className={`${LINK_BUTTON} bg-danger text-danger-fg hover:brightness-110`}
        href={PATHS.logout}
      >
        Sign out of every app
      </a>
      {session.isAdmin && <KeysPanel />}
    </>
  );
}

function SignedOut() {
  return (
    <>
      <p className="mt-2 text-sm text-fg-muted">
        Single sign-on for every app on huyab.cfd.
      </p>
      <a
        className={`${LINK_BUTTON} bg-primary text-primary-fg hover:bg-primary-hover`}
        href={PATHS.login}
      >
        Sign in with Google
      </a>
    </>
  );
}

function Hint() {
  const origin = window.location.origin;
  return (
    <div className="mt-8 space-y-1 text-left text-xs leading-relaxed text-fg-muted">
      <p>Apps start a login with</p>
      <code className="block rounded bg-surface-muted px-2 py-1">{`${origin}${PATHS.login}?redirect_uri=<page>`}</code>
      <p>and verify the huyab_sso cookie against</p>
      <code className="block rounded bg-surface-muted px-2 py-1">{`${origin}${PATHS.jwks}`}</code>
    </div>
  );
}

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    loadSession()
      .then((session) => setState({ status: "ready", session }))
      .catch((error: Error) =>
        setState({ status: "error", message: error.message }),
      );
  }, []);

  const wide = state.status === "ready" && state.session?.isAdmin;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <Card className={`w-full text-center ${wide ? "max-w-lg" : "max-w-sm"}`}>
        <img
          src="/icon-192.png"
          alt=""
          width={72}
          height={72}
          className="mx-auto mb-3 rounded-2xl"
        />
        <h1 className="text-xl font-bold text-fg">huyab.cfd SSO</h1>
        {state.status === "loading" && (
          <div className="mt-6 flex justify-center">
            <Spinner />
          </div>
        )}
        {state.status === "error" && (
          <Alert tone="danger" className="mt-4 text-left">
            Cannot check the session: {state.message}
          </Alert>
        )}
        {state.status === "ready" &&
          (state.session ? (
            <SignedIn session={state.session} />
          ) : (
            <SignedOut />
          ))}
        {!wide && state.status === "ready" && <Hint />}
      </Card>
    </main>
  );
}
