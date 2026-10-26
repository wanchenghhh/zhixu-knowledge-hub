import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { initialState } from "./data";
import type { Role, State } from "./data";
import { api, getApiRole, setApiRole } from "./api";
const KEY = "zhixu-prototype-v1";
const Store = createContext<{
  state: State;
  setState: Dispatch<SetStateAction<State>>;
  switchRole: (role: Role) => void;
  live: boolean;
  connectionError: string;
  refresh: () => Promise<State>;
} | null>(null);
function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const x = JSON.parse(raw);
      if (
        x.version === 1 &&
        Array.isArray(x.knowledge) &&
        Array.isArray(x.files) &&
        Array.isArray(x.models) &&
        Array.isArray(x.logs) &&
        Array.isArray(x.sessions) &&
        Array.isArray(x.tasks) &&
        ["admin", "manager", "user"].includes(x.role)
      )
        return x;
    }
  } catch {
    /* unavailable browser storage falls back to in-memory demo */
  }
  return initialState();
}
export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, rawSetState] = useState<State>(load);
  const [live, setLive] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const liveRef = useRef(false);

  const refresh = useCallback(async () => {
    const role = getApiRole();
    try {
      const next = await api<State>("/state");
      if (role === getApiRole()) {
        rawSetState(next);
        setConnectionError("");
      }
      return next;
    } catch (error) {
      if (role === getApiRole())
        setConnectionError(
          "后端连接中断，当前显示上次数据，请检查服务是否运行。",
        );
      throw error;
    }
  }, []);
  useEffect(() => {
    if (import.meta.env.VITE_PUBLIC_PREVIEW === "true") return;
    let mounted = true;
    fetch("/api/v1/health")
      .then((r) => (r.ok ? r.json() : null))
      .then(async (health) => {
        if (health?.mode === "live" && mounted) {
          liveRef.current = true;
          rawSetState((previous) => ({
            ...previous,
            role: getApiRole(),
            knowledge: [],
            files: [],
            tasks: [],
            sessions: [],
            logs: [],
            models: [],
          }));
          setLive(true);
          try {
            await refresh();
          } catch (error) {
            console.error("后端状态加载失败", error);
          }
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [refresh]);
  const setState = rawSetState;
  const switchRole = useCallback(
    (role: Role) => {
      setApiRole(role);
      rawSetState((previous) => ({
        ...previous,
        role,
        knowledge: [],
        files: [],
        tasks: [],
        sessions: [],
        logs: [],
      }));
      void refresh().catch(() => {});
    },
    [refresh],
  );
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [live, refresh]);
  useEffect(() => {
    try {
      if (!liveRef.current) localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* prototype remains usable if storage quota is reached */
    }
  }, [state]);
  useEffect(() => {
    if (live || !state.tasks.some((t) => t.status === "running")) return;
    const timer = setTimeout(
      () =>
        setState((s) => {
          const ids = new Set(
            s.tasks
              .filter((t) => t.status === "running")
              .flatMap((t) => t.fileIds),
          );
          return {
            ...s,
            tasks: s.tasks.map((t) =>
              t.status === "running"
                ? {
                    ...t,
                    status: "success",
                    finished: t.total,
                    error: undefined,
                  }
                : t,
            ),
            files: s.files.map((f) =>
              ids.has(f.id) && f.status === "failed"
                ? { ...f, status: "ready", error: undefined }
                : f,
            ),
          };
        }),
      1000,
    );
    return () => clearTimeout(timer);
  }, [state.tasks, live]);
  return (
    <Store.Provider
      value={{ state, setState, live, connectionError, refresh, switchRole }}
    >
      {children}
    </Store.Provider>
  );
}
export function useStore() {
  const context = useContext(Store);
  if (!context) throw new Error("StoreProvider missing");
  return context;
}
