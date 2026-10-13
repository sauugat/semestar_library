import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import { resolveAppRole } from '@/utils/roles';

export type AdminMode = 'admin' | 'normal';

const ADMIN_MODE_STORAGE_KEY = '@semester_library_admin_view_mode';

export interface AdminModeContextType {
  isAdmin: boolean;
  adminMode: AdminMode;
  isInAdminMode: boolean;
  setAdminMode: (mode: AdminMode) => Promise<void>;
  toggleAdminMode: () => Promise<void>;
}

const AdminModeContext = createContext<AdminModeContextType>({
  isAdmin: false,
  adminMode: 'admin',
  isInAdminMode: false,
  setAdminMode: async () => {},
  toggleAdminMode: async () => {},
});

export function AdminModeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const appRole = resolveAppRole(user);
  const isAdmin = appRole === 'admin';

  const [adminMode, setAdminModeState] = useState<AdminMode>('admin');

  // Load persisted preference on mount or when user changes
  useEffect(() => {
    let isMounted = true;
    if (!isAdmin) {
      setAdminModeState('admin');
      return;
    }

    AsyncStorage.getItem(ADMIN_MODE_STORAGE_KEY)
      .then((saved) => {
        if (!isMounted) return;
        if (saved === 'normal' || saved === 'admin') {
          setAdminModeState(saved);
        } else {
          setAdminModeState('admin');
        }
      })
      .catch(() => {
        if (isMounted) setAdminModeState('admin');
      });

    return () => {
      isMounted = false;
    };
  }, [isAdmin, user?.studentId]);

  const setAdminMode = useCallback(
    async (nextMode: AdminMode) => {
      setAdminModeState(nextMode);
      try {
        await AsyncStorage.setItem(ADMIN_MODE_STORAGE_KEY, nextMode);
      } catch {}
    },
    []
  );

  const toggleAdminMode = useCallback(async () => {
    const nextMode: AdminMode = adminMode === 'admin' ? 'normal' : 'admin';
    await setAdminMode(nextMode);
  }, [adminMode, setAdminMode]);

  const isInAdminMode = isAdmin && adminMode === 'admin';

  const value = useMemo(
    () => ({
      isAdmin,
      adminMode,
      isInAdminMode,
      setAdminMode,
      toggleAdminMode,
    }),
    [isAdmin, adminMode, isInAdminMode, setAdminMode, toggleAdminMode]
  );

  return <AdminModeContext.Provider value={value}>{children}</AdminModeContext.Provider>;
}

export function useAdminMode(): AdminModeContextType {
  return useContext(AdminModeContext);
}
