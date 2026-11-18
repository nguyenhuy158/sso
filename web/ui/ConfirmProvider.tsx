import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "./Button";
import { Field } from "./Field";
import { Input } from "./Input";
import { Modal } from "./Modal";

export type ConfirmOptions = {
  title: string;
  /** Chi tiet phu, vi du ten muc sap xoa hoac hau qua khong hoan tac duoc. */
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Nut xac nhan mau do: dung cho xoa hoac thao tac khong hoan tac duoc. */
  destructive?: boolean;
};

export type PromptOptions = {
  title: string;
  description?: string;
  /** Nhan cua o nhap. Mac dinh dung `title`. */
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
export type PromptFn = (options: PromptOptions) => Promise<string | null>;

type Shown =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (v: boolean) => void }
  | {
      kind: "prompt";
      options: PromptOptions;
      resolve: (v: string | null) => void;
    };

const Context = createContext<{ confirm: ConfirmFn; prompt: PromptFn } | null>(
  null,
);

function useDialogs() {
  const value = useContext(Context);
  if (!value) {
    throw new Error("useConfirm/usePrompt must be used inside ConfirmProvider");
  }
  return value;
}

/**
 * Thay window.confirm: `if (!(await confirm({ title: "Xoa?" }))) return;`.
 * Esc hoac bam ra ngoai tra ve false.
 */
export const useConfirm = (): ConfirmFn => useDialogs().confirm;

/**
 * Thay window.prompt: tra ve chuoi nguoi dung nhap, hoac null khi huy
 * (Esc, bam ra ngoai, nut huy), giong window.prompt.
 */
export const usePrompt = (): PromptFn => useDialogs().prompt;

/**
 * Bao quanh app mot lan de `useConfirm` / `usePrompt` dung duoc o bat ky dau.
 * Chi mot hop thoai mot luc: hop moi duoc yeu cau thi hop cu coi nhu bi huy.
 * Hop thoai dong lai van giu noi dung cu den het animation dong.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const current = useRef<Shown | null>(null);
  const formId = useId();

  const cancelCurrent = useCallback(() => {
    const previous = current.current;
    if (!previous) return;
    if (previous.kind === "confirm") previous.resolve(false);
    else previous.resolve(null);
    current.current = null;
  }, []);

  const show = useCallback(
    (next: Shown) => {
      cancelCurrent();
      current.current = next;
      setShown(next);
      setOpen(true);
    },
    [cancelCurrent],
  );

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) =>
        show({ kind: "confirm", options, resolve }),
      ),
    [show],
  );

  const prompt = useCallback<PromptFn>(
    (options) =>
      new Promise<string | null>((resolve) => {
        setValue(options.defaultValue ?? "");
        show({ kind: "prompt", options, resolve });
      }),
    [show],
  );

  // Provider go khoi cay khi con hop thoai mo: tra loi huy de khong treo caller.
  useEffect(() => cancelCurrent, [cancelCurrent]);

  const close = () => {
    cancelCurrent();
    setOpen(false);
  };

  const accept = () => {
    const active = current.current;
    if (!active) return;
    if (active.kind === "confirm") active.resolve(true);
    else active.resolve(value);
    current.current = null;
    setOpen(false);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    accept();
  };

  const api = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);
  const options = shown?.options;
  const cancelLabel = options?.cancelLabel ?? "Huỷ";
  const confirmLabel = options?.confirmLabel ?? "Xác nhận";

  return (
    <Context.Provider value={api}>
      {children}
      {shown && options && (
        <Modal
          open={open}
          onClose={close}
          title={options.title}
          description={options.description}
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={close}>
                {cancelLabel}
              </Button>
              {shown.kind === "prompt" ? (
                <Button type="submit" form={formId}>
                  {confirmLabel}
                </Button>
              ) : (
                <Button
                  variant={
                    shown.kind === "confirm" && shown.options.destructive
                      ? "danger"
                      : "primary"
                  }
                  onClick={accept}
                >
                  {confirmLabel}
                </Button>
              )}
            </>
          }
        >
          {shown.kind === "prompt" && (
            <form id={formId} onSubmit={submit}>
              <Field label={shown.options.label ?? shown.options.title}>
                <Input
                  value={value}
                  placeholder={shown.options.placeholder}
                  onChange={(event) => setValue(event.target.value)}
                />
              </Field>
            </form>
          )}
        </Modal>
      )}
    </Context.Provider>
  );
}
