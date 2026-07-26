import { create } from "zustand";

interface DeviceState {
  deviceId: string | null;
  deviceName: string | null;
  deviceIdError: string | null;
  loading: boolean;
  initialized: boolean;
  initialize: () => Promise<void>;
  clearError: () => void;
}

export const useDeviceStore = create<DeviceState>()((set, get) => ({
  deviceId: null,
  deviceName: null,
  deviceIdError: null,
  loading: false,
  initialized: false,

  initialize: async () => {
    if (get().initialized) return;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ device_id: string; device_name: string }>("get_or_register_device_id");
      set({ deviceId: result.device_id, deviceName: result.device_name, initialized: true, deviceIdError: null });
    } catch (e: any) {
      const msg = e?.message || e?.toString() || "Erro desconhecido";
      set({ deviceIdError: msg, initialized: true });
    }
  },

  clearError: () => set({ deviceIdError: null }),
}));
