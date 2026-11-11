import { useEffect, useRef, useState } from "react";
import type { AccountController } from "./accounts";

const invoke = () => window.__TAURI__!.core.invoke<void>("desktop_start");
type Preparation = {
  epoch: number;
  phase: "starting" | "prepared" | "failed";
  error: string;
};
export function useWorkspacePreparation(
  account: AccountController,
  introduced: boolean,
) {
  // Only confirmed native account transitions change this identity. A failed
  // snapshot suspends new actions without inventing a logout or a new grant.
  const authorization = useRef({
    epoch: 0,
    active: false,
    owner: null as string | null,
  });
  if (account.available && account.state) {
    const signedIn =
      account.state.authorizationStatus === "signedIn" &&
      account.state.signedIn;
    const owner = account.state.subject ?? account.state.accountLabel;
    if (
      signedIn &&
      (!authorization.current.active || authorization.current.owner !== owner)
    ) {
      authorization.current = {
        epoch: authorization.current.epoch + 1,
        active: true,
        owner,
      };
    } else if (!signedIn && authorization.current.active) {
      authorization.current = {
        epoch: authorization.current.epoch + 1,
        active: false,
        owner: null,
      };
    }
  }
  const current = useRef({ ...authorization.current, canSubmit: false });
  current.current = {
    ...authorization.current,
    canSubmit:
      account.available && authorization.current.active && !account.pending,
  };
  const epoch = authorization.current.epoch;
  const attempted = useRef(-1);
  const remoteAttempted = useRef(-1);
  const inFlight = useRef(new Set<number>());
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  async function prepare() {
    const owner = current.current;
    if (!introduced || !owner.canSubmit || inFlight.current.has(owner.epoch))
      return;
    inFlight.current.add(owner.epoch);
    attempted.current = owner.epoch;
    setPreparation({ epoch: owner.epoch, phase: "starting", error: "" });
    try {
      await invoke();
      if (current.current.active && current.current.epoch === owner.epoch)
        setPreparation({ epoch: owner.epoch, phase: "prepared", error: "" });
    } catch {
      if (current.current.active && current.current.epoch === owner.epoch)
        setPreparation({
          epoch: owner.epoch,
          phase: "failed",
          error: "工作区没有就绪。请检查本机设置与服务状态后重试。",
        });
    } finally {
      inFlight.current.delete(owner.epoch);
    }
  }
  useEffect(() => {
    if (introduced && current.current.canSubmit && attempted.current !== epoch)
      void prepare();
  }, [introduced, epoch, account.available, account.pending]);
  useEffect(() => {
    if (
      introduced &&
      current.current.canSubmit &&
      preparation?.epoch === epoch &&
      preparation.phase === "prepared" &&
      remoteAttempted.current !== epoch
    ) {
      remoteAttempted.current = epoch;
      void account.remoteAction(
        () => window.__TAURI__!.core.invoke<void>("account_enable_default"),
        () => current.current.active && current.current.epoch === epoch,
      );
    }
  }, [introduced, epoch, preparation, account.available, account.pending]);
  return {
    active: authorization.current.active,
    canSubmit: introduced && current.current.canSubmit,
    phase: preparation?.epoch === epoch ? preparation.phase : null,
    error: preparation?.epoch === epoch ? preparation.error : "",
    retry: prepare,
  };
}
