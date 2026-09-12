import { useCallback, useEffect, useState } from "react";

import { BUILT_IN_FLOWS, type FlowDefinition } from "./flows";
import type { RunRecord } from "./vision-types";

const SETTINGS_KEY = "vbl.settings.v1";
const FLOWS_KEY = "vbl.flows.v1";
const HISTORY_KEY = "vbl.history.v1";

export interface AdminSettings {
  defaultBrowser: "chromium" | "firefox" | "webkit";
  defaultReasoner: string;
  headless: boolean;
  showBoxes: boolean;
  maxSteps: number;
  disabledFlowIds: string[];
  stopOnFirstError: boolean;
  allowLiveRuns: boolean;
  historyLimit: number;
}

export const DEFAULT_SETTINGS: AdminSettings = {
  defaultBrowser: "chromium",
  defaultReasoner: "gateway-astra",
  headless: true,
  showBoxes: true,
  maxSteps: 12,
  disabledFlowIds: [],
  stopOnFirstError: true,
  allowLiveRuns: true,
  historyLimit: 20,
};

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function readList<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent("vbl:store", { detail: key }));
  } catch {
    // storage full or blocked — settings stay in memory for this session
  }
}

function useStored<T>(key: string, loader: () => T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(loader);

  useEffect(() => {
    setValue(loader());
    const onChange = (event: Event) => {
      if ((event as CustomEvent).detail === key) setValue(loader());
    };
    window.addEventListener("vbl:store", onChange);
    return () => window.removeEventListener("vbl:store", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      write(key, next);
    },
    [key],
  );

  return [value, update];
}

export function useSettings() {
  return useStored<AdminSettings>(SETTINGS_KEY, () => read(SETTINGS_KEY, DEFAULT_SETTINGS));
}

export function useCustomFlows() {
  return useStored<FlowDefinition[]>(FLOWS_KEY, () => readList<FlowDefinition>(FLOWS_KEY));
}

export function useRunHistory() {
  const [history, setHistory] = useStored<RunRecord[]>(HISTORY_KEY, () => readList<RunRecord>(HISTORY_KEY));

  const append = useCallback(
    (record: RunRecord, limit: number) => {
      const next = [record, ...readList<RunRecord>(HISTORY_KEY)].slice(0, limit);
      setHistory(next);
    },
    [setHistory],
  );

  const clear = useCallback(() => setHistory([]), [setHistory]);

  return { history, append, clear };
}

/** Built-in flows plus saved custom flows, with disabled ones filtered out. */
export function resolveFlows(custom: FlowDefinition[], settings: AdminSettings): FlowDefinition[] {
  const all = [...BUILT_IN_FLOWS.map((flow) => ({ ...flow, builtIn: true })), ...custom];
  return all.filter((flow) => !settings.disabledFlowIds.includes(flow.id));
}

export function allFlows(custom: FlowDefinition[]): FlowDefinition[] {
  return [...BUILT_IN_FLOWS.map((flow) => ({ ...flow, builtIn: true })), ...custom];
}
